// Anlegen, Kommentieren, CodeHost und Fehlerform im GitHub-Adapter (Issue #188).
//
// Dritte von drei Dateien des GitHub-Adapters (Issue #836): `create`, `comment`,
// `code repo-name`, `code pr` und die Form unerwarteter Fehler. Lesen und Project
// liegen in den Nachbardateien `board-adapter-github-lesen.test.mjs` und
// `board-adapter-github-projekt.test.mjs`, die gemeinsamen Fixtures in
// `helpers/board-github-fixture.mjs`.
//
// gh wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue): Der Adapter bleibt
// unangetastet, und die tatsaechlich abgesetzte Kommandozeile ist Teil der Pruefung.
// Kein Netz, kein echtes Board.
//
// Seit Issue #1217 laufen die Tests im selben Prozess gegen kit/board/adapter.mjs:
// `createIssue`, `commentIssue`, `getRepoName` und `createPullRequest` statt
// `board.mjs issue|code ...` als Kindprozess. Den Body von `create` setzt die CLI vorher
// mit der Autor-Modell-Zeile zusammen; hier steht er schon fertig im Aufruf. Das Praefix
// unerwarteter Fehler vergibt erst der Einstieg — dieser eine Test steht in
// `ablauf-board-adapter-github.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";

import { aufrufZeilen } from "./helpers/adapter-fixture.mjs";
import { mitTracker, mitStderr } from "./helpers/board-github-fixture.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

// Der Body, den die CLI ohne --body aus KIT_AGENT_MODEL der Fixture baut.
const AUTOR_BODY = "Autor-Modell: fixture-modell";

// --- Anlegen ---

test("create legt das Issue an, haengt es ans Board und setzt es auf backlog", async () => {
  await mitTracker(async ({ dir, tracker }) => {
    const angelegt = await tracker.createIssue({ title: "Neu mit 'Quote'", body: "Autor-Modell: m\nBody" });
    assert.deepEqual(angelegt, { id: "42", url: "https://github.com/besitzer/mein-repo/issues/42" });

    const zeilen = aufrufZeilen(dir, "gh");
    // Das eingebettete Single Quote muss unversehrt als ein Argument ankommen.
    assert.ok(zeilen.some((z) => z.includes("issue create --repo besitzer/mein-repo --title Neu mit 'Quote' --body Autor-Modell: m\nBody")),
      `Kommandozeile unerwartet: ${zeilen.join(" | ")}`);
    assert.ok(zeilen.some((z) => z.startsWith("project item-add 14 --owner besitzer --url https://github.com/besitzer/mein-repo/issues/42")));
    assert.ok(zeilen.some((z) => z.includes("--single-select-option-id opt-backlog")));
  }, {
    regeln: [{ match: "^issue create", stdout: "Creating issue in besitzer/mein-repo\n\nhttps://github.com/besitzer/mein-repo/issues/42\n" }],
  });
});

test("create ohne lesbare Issue-URL in der gh-Ausgabe schlaegt fehl", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(
      tracker.createIssue({ title: "Ohne URL", body: AUTOR_BODY }),
      /Konnte Issue-URL aus gh-Ausgabe nicht lesen: irgendwas anderes/,
    );
  }, {
    regeln: [{ match: "^issue create", stdout: "irgendwas anderes\n" }],
  });
});

// Die Board-Zuordnung ist Kuer: schlaegt sie fehl, existiert das Issue trotzdem.
test("create ueberlebt eine fehlgeschlagene Board-Zuordnung mit Hinweis", async () => {
  await mitTracker(async ({ tracker }) => {
    const { wert, stderr } = await mitStderr(() => tracker.createIssue({ title: "Ohne Board", body: AUTOR_BODY }));
    assert.deepEqual(wert, { id: "42", url: "https://github.com/besitzer/mein-repo/issues/42" });
    assert.match(stderr, /Board-Zuordnung fehlgeschlagen/);
  }, {
    regeln: [
      { match: "^issue create", stdout: "https://github.com/besitzer/mein-repo/issues/42\n" },
      { match: "^project item-add", stderr: "could not add item\n", exit: 1 },
    ],
  });
});

// Eventual Consistency: ein frisch hinzugefuegtes Item ist manchmal erst beim
// zweiten Versuch sichtbar — deshalb der Retry mit Wartezeit.
test("create wiederholt das Setzen auf backlog, wenn das Item noch nicht sichtbar ist", async () => {
  await mitTracker(async ({ dir, tracker }) => {
    const { stderr } = await mitStderr(() => tracker.createIssue({ title: "Verzoegert sichtbar", body: AUTOR_BODY }));
    assert.equal(stderr, "", "es haette keinen Hinweis geben duerfen");
    assert.ok(aufrufZeilen(dir, "gh").some((z) => z.includes("--single-select-option-id opt-backlog")));
  }, {
    regeln: [
      { match: "^issue create", stdout: "https://github.com/besitzer/mein-repo/issues/42\n" },
      // Erster Lookup: Issue noch nicht auf dem Board -> moveIssue wirft, es wird gewartet.
      { match: "^api graphql", stdout: { data: { repository: { issue: { projectItems: { nodes: [] } } } } }, times: 1 },
    ],
  });
});

// --- Kommentieren ---

test("comment reicht den Text als --body an gh weiter", async () => {
  await mitTracker(async ({ dir, tracker }) => {
    await tracker.commentIssue("42", "Zeile eins");
    assert.match(aufrufZeilen(dir, "gh").join("\n"), /issue comment 42 --repo besitzer\/mein-repo --body Zeile eins/);
  });
});

// --- CodeHost ---

test("repo-name kommt von gh", async () => {
  await mitTracker(async ({ host }) => {
    assert.equal(await host.getRepoName(), "besitzer/mein-repo");
  });
});

// Ist gh nicht nutzbar (nicht angemeldet, kein gh installiert), faellt der Adapter auf
// die origin-Remote zurueck und zuletzt auf den Verzeichnisnamen.
//
// Frueher stand hier "bewusst ohne Normalisierung: eine Notfall-Auskunft, keine zweite
// Quelle der Wahrheit". Die Entscheidung ist mit Issue #214 revidiert: Ein Konsument
// kann der Antwort nicht ansehen, ob sie aus gh oder aus dem Fallback stammt, und
// /document baute daraus einen Vault-Pfad. Aus "claude-workflow-kit.git" oder der
// ganzen URL wurde dort ein falscher Projektname. Eine Notfall-Auskunft darf luecken-
// haft sein, aber nicht ein anderes Format haben als der Normalfall.
test("repo-name faellt ohne nutzbares gh auf git-Remote und Verzeichnisnamen zurueck", async () => {
  const gescheitertesGh = [{ match: "^repo view", stderr: "gh: not authenticated\n", exit: 1 }];

  await mitTracker(async ({ dir, host }) => {
    lfAttribute(join(dir, ".gitattributes"));
    for (const argumente of [
      ["init", "-q"],
      ["remote", "add", "origin", "https://example.invalid/besitzer/mein-repo.git"],
    ]) {
      const res = spawnSync("git", argumente, { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 0, `git ${argumente.join(" ")} schlug fehl: ${res.stderr}`);
    }
    assert.equal(await host.getRepoName(), "besitzer/mein-repo");
  }, { regeln: gescheitertesGh });

  await mitTracker(async ({ dir, host }) => {
    assert.equal(await host.getRepoName(), basename(dir));
  }, { regeln: gescheitertesGh });
});

test("pr erzeugt einen Pull Request mit Standardtitel", async () => {
  await mitTracker(async ({ dir, host }) => {
    const ergebnis = await host.createPullRequest({ from: "feature", to: "main" });
    assert.deepEqual(ergebnis, { url: "https://github.com/besitzer/mein-repo/pull/5" });
    assert.match(aufrufZeilen(dir, "gh").join("\n"), /pr create --base main --head feature --title feature → main --body/);
  }, {
    regeln: [{ match: "^pr create", stdout: "https://github.com/besitzer/mein-repo/pull/5\n" }],
  });
});

test("pr uebernimmt einen mitgegebenen Titel", async () => {
  await mitTracker(async ({ dir, host }) => {
    await host.createPullRequest({ from: "feature", to: "main", title: "Mein Titel" });
    assert.match(aufrufZeilen(dir, "gh").join("\n"), /--title Mein Titel/);
  }, {
    regeln: [{ match: "^pr create", stdout: "https://github.com/besitzer/mein-repo/pull/5\n" }],
  });
});

// --- Fehlerform ---

// gh meldet Fehler auf stderr; ist stderr leer, muss die Meldung des Prozesses
// selbst durchkommen statt eines leeren Strings.
test("Leeres stderr eines gh-Fehlschlags liefert trotzdem eine Meldung", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.getIssue("42"), /gh endete mit Exit 3/);
  }, {
    regeln: [{ match: "^issue view", exit: 3 }],
  });
});
