// Anlegen, Kommentieren, CodeHost und Fehlerform im GitHub-Adapter (Issue #188).
//
// Dritte von drei Dateien des GitHub-Adapters (Issue #836): `create`, `comment`,
// `code repo-name`, `code pr` und die Form unerwarteter Fehler. Lesen und Project
// liegen in den Nachbardateien `board-github.test.mjs` und
// `board-github-projekt.test.mjs`, die gemeinsamen Fixtures in
// `helpers/board-github-fixture.mjs`.
//
// gh wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue): Der Adapter bleibt
// unangetastet, und die tatsaechlich abgesetzte Kommandozeile ist Teil der Pruefung —
// inklusive des Quotings aus shellQuote(). Kein Netz, kein echtes Board.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

import { runBoard, board, aufrufZeilen } from "./helpers/board-fixture.mjs";
import { NUR_POSIX, mitProjekt } from "./helpers/board-github-fixture.mjs";

// --- Anlegen ---

test("create legt das Issue an, haengt es ans Board und setzt es auf backlog", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const angelegt = board(dir, "issue", "create", "--title", "Neu mit 'Quote'", "--body", "Autor-Modell: m\nBody");
    assert.deepEqual(angelegt, { id: "42", url: "https://github.com/besitzer/mein-repo/issues/42" });

    const zeilen = aufrufZeilen(dir, "gh");
    // shellQuote muss das eingebettete Single Quote ueberleben.
    assert.ok(zeilen.some((z) => z.includes("issue create --repo besitzer/mein-repo --title Neu mit 'Quote' --body Autor-Modell: m\nBody")),
      `Kommandozeile unerwartet: ${zeilen.join(" | ")}`);
    assert.ok(zeilen.some((z) => z.startsWith("project item-add 14 --owner besitzer --url https://github.com/besitzer/mein-repo/issues/42")));
    assert.ok(zeilen.some((z) => z.includes("--single-select-option-id opt-backlog")));
  }, {
    regeln: [{ match: "^issue create", stdout: "Creating issue in besitzer/mein-repo\n\nhttps://github.com/besitzer/mein-repo/issues/42\n" }],
  });
});

test("create ohne lesbare Issue-URL in der gh-Ausgabe schlaegt fehl", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "create", "--title", "Ohne URL"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Konnte Issue-URL aus gh-Ausgabe nicht lesen: irgendwas anderes/);
  }, {
    regeln: [{ match: "^issue create", stdout: "irgendwas anderes\n" }],
  });
});

// Die Board-Zuordnung ist Kuer: schlaegt sie fehl, existiert das Issue trotzdem.
test("create ueberlebt eine fehlgeschlagene Board-Zuordnung mit Hinweis", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "create", "--title", "Ohne Board"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { id: "42", url: "https://github.com/besitzer/mein-repo/issues/42" });
    assert.match(res.stderr, /Board-Zuordnung fehlgeschlagen/);
  }, {
    regeln: [
      { match: "^issue create", stdout: "https://github.com/besitzer/mein-repo/issues/42\n" },
      { match: "^project item-add", stderr: "could not add item\n", exit: 1 },
    ],
  });
});

// Eventual Consistency: ein frisch hinzugefuegtes Item ist manchmal erst beim
// zweiten Versuch sichtbar — deshalb der Retry mit Wartezeit.
test("create wiederholt das Setzen auf backlog, wenn das Item noch nicht sichtbar ist", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "create", "--title", "Verzoegert sichtbar"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "", "es haette keinen Hinweis geben duerfen");
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

test("comment reicht den Text als --body an gh weiter", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "comment", "42", "--text", "Zeile eins"), { ok: true, id: "42" });
    assert.match(aufrufZeilen(dir, "gh").join("\n"), /issue comment 42 --repo besitzer\/mein-repo --body Zeile eins/);
  });
});

// --- CodeHost ---

test("repo-name kommt von gh", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "code", "repo-name"), { repoName: "besitzer/mein-repo" });
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
test("repo-name faellt ohne nutzbares gh auf git-Remote und Verzeichnisnamen zurueck", NUR_POSIX, () => {
  const gescheitertesGh = [{ match: "^repo view", stderr: "gh: not authenticated\n", exit: 1 }];

  mitProjekt((dir) => {
    for (const argumente of [
      ["init", "-q"],
      ["remote", "add", "origin", "https://example.invalid/besitzer/mein-repo.git"],
    ]) {
      const res = spawnSync("git", argumente, { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 0, `git ${argumente.join(" ")} schlug fehl: ${res.stderr}`);
    }
    assert.deepEqual(board(dir, "code", "repo-name"), { repoName: "besitzer/mein-repo" });
  }, { regeln: gescheitertesGh });

  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "code", "repo-name"), { repoName: basename(dir) });
  }, { regeln: gescheitertesGh });
});

test("pr erzeugt einen Pull Request mit Standardtitel", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const ergebnis = board(dir, "code", "pr", "--from", "feature", "--to", "main");
    assert.deepEqual(ergebnis, { url: "https://github.com/besitzer/mein-repo/pull/5" });
    assert.match(aufrufZeilen(dir, "gh").join("\n"), /pr create --base main --head feature --title feature → main --body/);
  }, {
    regeln: [{ match: "^pr create", stdout: "https://github.com/besitzer/mein-repo/pull/5\n" }],
  });
});

test("pr uebernimmt einen mitgegebenen Titel", NUR_POSIX, () => {
  mitProjekt((dir) => {
    board(dir, "code", "pr", "--from", "feature", "--to", "main", "--title", "Mein Titel");
    assert.match(aufrufZeilen(dir, "gh").join("\n"), /--title Mein Titel/);
  }, {
    regeln: [{ match: "^pr create", stdout: "https://github.com/besitzer/mein-repo/pull/5\n" }],
  });
});

// --- Fehlerform ---

// Ein Fehler, der nicht aus dem Adapter kommt (hier: gh liefert kaputtes JSON),
// muss als "Unerwarteter Fehler" erkennbar sein — nicht als Bedienfehler.
test("Unerwartete Fehler tragen ein anderes Praefix als BoardError", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "get", "42"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Unerwarteter Fehler: /);
  }, {
    regeln: [{ match: "^issue view", stdout: "kein JSON" }],
  });
});

// gh meldet Fehler auf stderr; ist stderr leer, muss die Meldung des Prozesses
// selbst durchkommen statt eines leeren Strings.
test("Leeres stderr eines gh-Fehlschlags liefert trotzdem eine Meldung", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "get", "42"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Fehler: \S/);
  }, {
    regeln: [{ match: "^issue view", exit: 3 }],
  });
});
