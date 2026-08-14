// Geruest und export-Lauf des Migrationswerkzeugs (Issue #288).
//
// Wie bei den board-Tests laeuft das ECHTE Script aus dem Repo mit cwd in einem
// Fixture-Verzeichnis, und `gh` wird als Fake-Binary im PATH ersetzt (Muster aus
// test/helpers/board-fixture.mjs, Issue #188). Ein Live-Vergleich gegen GitHub steht
// bewusst nicht in dieser Datei: Er haengt an Authentifizierung, Netz und dem
// aktuellen Zustand des Repos, und zwischen Export und Vergleich kann sich die Zahl
// aendern.
//
// Der Zeitstempel im Dateinamen kommt aus der Systemuhr. Damit der Kollisionsfall
// ("Zieldatei existiert schon") ueberhaupt am CLI-Pfad pruefbar ist, kennt das Tool
// den Test-Hook KIT_MIGRATE_STAMP — dieselbe Bauart wie NIGHT_CLAUDE_CMD in
// kit/night.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { setupProjekt, fakeCli, aufrufe, aufrufZeilen } from "./helpers/board-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Unter Windows uebersprungen: `fakeCli` legt das Fake-`gh` als endungslose Datei mit
// Shebang an, und dort entscheidet die ENDUNG (.cmd/.bat/.exe), ob etwas startbar
// ist. Die Tests unten erreichen das Fake deshalb nicht und starten das echte `gh` —
// in der CI scheitert das an GH_TOKEN (25 Fehlschlaege, Windows-Job rot seit dem
// 2026-08-11). Wortgleich zu test/board-issue-review.test.mjs (Issue #315).
//
// Ausgenommen wird genau die Menge, die das Fake-`gh` startet; die uebrigen Tests
// dieser Datei laufen unter Windows weiter.
const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Das Fake-Binary ist eine endungslose Datei mit Shebang; startbar sind dort nur .cmd/.bat/.exe. Siehe Issue #197 und #231." }
  : {};

const MIGRATE = join(repoRoot, "tools", "migrate-issues.mjs");

const ZIEL_REPO = "mannewolff/claude-workflow-kit";
const FREMD_REPO = "fremd/anderes-repo";

// Ein Body, der die verlustfreie Ablage belegt: Umlaute, scharfes S und ein
// Codeblock mit Zeichen, die in JSON escaped werden muessen.
const BODY_101 = 'Umlaute: ä ö ü ß — "Zitat"\n\n```js\nconst pfad = "C:\\\\tmp";\n```\n';

function fixture(praefix, ghRegeln) {
  const dir = setupProjekt({ issueTracker: "github", github: { projectNumber: 14 } }, praefix);
  fakeCli(dir, "gh", ghRegeln);
  return dir;
}

function runMigrate(dir, cliArgs, extraEnv = {}) {
  return spawnSync(process.execPath, [MIGRATE, ...cliArgs], {
    cwd: dir,
    encoding: "utf-8",
    env: { ...process.env, PATH: `${join(dir, "fakebin")}:${process.env.PATH}`, ...extraEnv },
  });
}

function kommentar(login, body, createdAt) {
  return { author: login === null ? null : { login }, body, createdAt };
}

/**
 * Die Regelliste des Fake-gh fuer den vollstaendigen Erfolgsfall.
 *
 * Beide Quellen liefern zwei Seiten, damit die Paginierung nicht nur behauptet ist:
 * Issue 103 und 104 sowie ihre Project-Items stehen ausschliesslich auf der zweiten
 * Seite. Die Cursor-Regeln stehen vor den Seite-1-Regeln, weil die erste passende
 * Regel gewinnt.
 */
function erfolgsRegeln() {
  const seite1 = {
    data: {
      repository: {
        issues: {
          pageInfo: { hasNextPage: true, endCursor: "ISSUE-C1" },
          nodes: [
            {
              number: 101,
              title: "Erstes Issue",
              body: BODY_101,
              labels: { nodes: [{ name: "infra" }, { name: "kit" }] },
              comments: {
                pageInfo: { hasNextPage: true, endCursor: "KOMMENTAR-C1" },
                nodes: [kommentar("mannewolff", "Erster Kommentar", "2026-08-01T10:00:00Z")],
              },
            },
            {
              number: 102,
              title: "Zweites Issue",
              body: "",
              labels: { nodes: [] },
              comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
          ],
        },
      },
    },
  };

  const seite2 = {
    data: {
      repository: {
        issues: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              number: 103,
              title: "Drittes Issue",
              body: "letzte Seite",
              labels: { nodes: [{ name: "infra" }] },
              comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
            {
              number: 104,
              title: "Viertes Issue",
              body: "ohne Board-Spalte",
              labels: { nodes: [] },
              comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
          ],
        },
      },
    },
  };

  const kommentarSeite2 = {
    data: {
      repository: {
        issue: {
          comments: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [kommentar(null, "Zweiter Kommentar", "2026-08-02T11:00:00Z"), kommentar("bot", "", "2026-08-02T12:00:00Z")],
          },
        },
      },
    },
  };

  const projektSeite1 = {
    data: {
      repositoryOwner: {
        projectV2: {
          items: {
            pageInfo: { hasNextPage: true, endCursor: "PROJ-C1" },
            nodes: [
              { content: { number: 101, repository: { nameWithOwner: ZIEL_REPO } }, fieldValueByName: { name: "Ready" } },
              // Dieselbe Nummer aus einem fremden Repo: darf 102 nicht faerben.
              { content: { number: 102, repository: { nameWithOwner: FREMD_REPO } }, fieldValueByName: { name: "Done" } },
            ],
          },
        },
      },
    },
  };

  const projektSeite2 = {
    data: {
      repositoryOwner: {
        projectV2: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { content: { number: 103, repository: { nameWithOwner: ZIEL_REPO } }, fieldValueByName: { name: "In progress" } },
              // Item ohne Status-Feld -> spalte bleibt null.
              { content: { number: 104, repository: { nameWithOwner: ZIEL_REPO } }, fieldValueByName: null },
              // Draft-Item und Pull Request: kein Issue-Content, wird ignoriert.
              { content: {}, fieldValueByName: { name: "Ready" } },
              { content: null, fieldValueByName: { name: "Ready" } },
            ],
          },
        },
      },
    },
  };

  // Faellt der Filter auf offene Issues weg, antwortet das Fake mit einer Menge, die
  // ein geschlossenes Issue enthaelt — nur so ist "kein geschlossenes Issue im Export"
  // ueberhaupt pruefbar und nicht bloss behauptet.
  const ohneFilter = JSON.parse(JSON.stringify(seite1));
  ohneFilter.data.repository.issues.nodes.push({
    number: 999,
    title: "Geschlossenes Issue",
    body: "",
    labels: { nodes: [] },
    comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  });

  return [
    { match: "repo view", stdout: `${ZIEL_REPO}\n` },
    { match: "cursor=ISSUE-C1", stdout: seite2 },
    { match: "cursor=KOMMENTAR-C1", stdout: kommentarSeite2 },
    { match: "cursor=PROJ-C1", stdout: projektSeite2 },
    { match: "projectV2", stdout: projektSeite1 },
    { match: "states:OPEN", stdout: seite1 },
    { match: "issues\\(", stdout: ohneFilter },
  ];
}

function exportiere(dir, extraArgs = [], extraEnv = {}) {
  const out = join(dir, "export");
  const res = runMigrate(dir, ["export", "--out", out, ...extraArgs], extraEnv);
  return { res, out };
}

function geleseneDatei(res) {
  const pfad = res.stdout.trim();
  return { pfad, daten: JSON.parse(readFileSync(pfad, "utf-8")) };
}

function aufraeumen(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// Geruest
// ============================================================

test("--help listet die drei Unterkommandos auf stdout und endet mit Exit 0", () => {
  const dir = fixture("migrate-help-", []);
  try {
    const res = runMigrate(dir, ["--help"]);
    assert.equal(res.status, 0, res.stderr);
    for (const sub of ["export", "import", "verify"]) {
      assert.match(res.stdout, new RegExp(`\\b${sub}\\b`), `--help nennt '${sub}' nicht`);
    }
    assert.equal(res.stderr, "");
    assert.deepEqual(aufrufe(dir, "gh"), [], "--help darf gh nicht aufrufen");
  } finally {
    aufraeumen(dir);
  }
});

// Alle drei Unterkommandos sind umgesetzt: export hier, import in
// test/migrate-issues-import.test.mjs (#289), verify in
// test/migrate-issues-verify.test.mjs (#290). Was hier bleibt, ist der
// Bedienfehler-Pfad: verify ohne --in darf gar nicht erst loslaufen.
test("verify ohne --in endet mit Exit 2 und ruft gh nicht auf", () => {
  const dir = fixture("migrate-verify-ohne-in-", []);
  try {
    const res = runMigrate(dir, ["verify"]);
    assert.equal(res.status, 2, "fehlendes --in ist ein Betriebsfehler, kein Abweichungsbefund");
    assert.match(res.stderr, /--in/);
    assert.equal(res.stdout, "");
    assert.deepEqual(aufrufe(dir, "gh"), [], "verify darf ohne Eingabedatei gh nicht aufrufen");
  } finally {
    aufraeumen(dir);
  }
});

test("fehlendes, unbekanntes Unterkommando und --out ohne Wert zeigen die Hilfe auf stderr", () => {
  for (const cliArgs of [[], ["exportiere"], ["export", "--out"]]) {
    const dir = fixture("migrate-cli-", []);
    try {
      const res = runMigrate(dir, cliArgs);
      assert.equal(res.status, 1, `'${cliArgs.join(" ")}' muss mit Exit 1 enden`);
      assert.match(res.stderr, /export/, `'${cliArgs.join(" ")}' zeigt die Hilfe nicht`);
      assert.equal(res.stdout, "", `'${cliArgs.join(" ")}' darf nichts auf stdout schreiben`);
      assert.deepEqual(aufrufe(dir, "gh"), [], "ein ungueltiger Aufruf darf gh nicht aufrufen");
    } finally {
      aufraeumen(dir);
    }
  }
});

test("der Direktstart-Guard laesst den Modul-Import wirkungslos", NUR_POSIX, () => {
  const dir = fixture("migrate-import-", []);
  try {
    const probe = join(dir, "probe.mjs");
    writeFileSync(probe, `await import(${JSON.stringify(MIGRATE)});\n`, "utf-8");
    const vorher = readdirSync(dir).sort();

    const res = spawnSync(process.execPath, [probe], {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, PATH: `${join(dir, "fakebin")}:${process.env.PATH}` },
    });

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "", "der Import darf nichts auf stdout schreiben");
    assert.equal(res.stderr, "", "der Import darf nichts auf stderr schreiben");
    assert.deepEqual(aufrufe(dir, "gh"), [], "der Import darf gh nicht aufrufen");
    assert.deepEqual(readdirSync(dir).sort(), vorher, "der Import darf keine Datei anlegen");
  } finally {
    aufraeumen(dir);
  }
});

// ============================================================
// export — Inhalt
// ============================================================

test("export schreibt alle offenen Issues beider Seiten im vereinbarten Schema", NUR_POSIX, () => {
  const dir = fixture("migrate-export-", erfolgsRegeln());
  try {
    const { res } = exportiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const { daten } = geleseneDatei(res);

    assert.deepEqual(daten.map((e) => e.number), [101, 102, 103, 104],
      "beide Seiten muessen exportiert sein, auch die letzte — und kein geschlossenes Issue");

    for (const eintrag of daten) {
      assert.deepEqual(Object.keys(eintrag).sort(),
        ["body", "comments", "labels", "number", "spalte", "title"],
        `Eintrag ${eintrag.number} weicht vom Schema ab`);
      assert.equal(typeof eintrag.number, "number");
      assert.equal(typeof eintrag.title, "string");
      assert.equal(typeof eintrag.body, "string");
      assert.ok(Array.isArray(eintrag.labels));
      assert.ok(eintrag.labels.every((l) => typeof l === "string"), "labels enthaelt nur Namen");
      assert.ok(Array.isArray(eintrag.comments));
      for (const k of eintrag.comments) {
        assert.deepEqual(Object.keys(k).sort(), ["author", "body", "createdAt"]);
      }
    }

    const nach = Object.fromEntries(daten.map((e) => [e.number, e]));
    assert.deepEqual(nach[101].labels, ["infra", "kit"]);
    assert.deepEqual(nach[102].labels, []);
  } finally {
    aufraeumen(dir);
  }
});

test("export ordnet nur Spalten des Ziel-Repositorys zu und laesst den Rest null", NUR_POSIX, () => {
  const dir = fixture("migrate-spalte-", erfolgsRegeln());
  try {
    const { res } = exportiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const { daten } = geleseneDatei(res);
    const spalten = Object.fromEntries(daten.map((e) => [e.number, e.spalte]));

    assert.equal(spalten[101], "Ready");
    assert.equal(spalten[102], null, "das Item des fremden Repositorys darf nicht zugeordnet werden");
    assert.equal(spalten[103], "In progress", "die letzte Project-Seite muss zugeordnet werden");
    assert.equal(spalten[104], null, "ein Item ohne Status-Feld traegt spalte: null");
  } finally {
    aufraeumen(dir);
  }
});

test("export holt Kommentare ueber die erste Seite hinaus und normalisiert sie", NUR_POSIX, () => {
  const dir = fixture("migrate-kommentare-", erfolgsRegeln());
  try {
    const { res } = exportiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const { daten } = geleseneDatei(res);
    const kommentare = daten.find((e) => e.number === 101).comments;

    assert.deepEqual(kommentare, [
      { author: "mannewolff", body: "Erster Kommentar", createdAt: "2026-08-01T10:00:00Z" },
      { author: "", body: "Zweiter Kommentar", createdAt: "2026-08-02T11:00:00Z" },
    ], "der Nachschlag muss angehaengt, ein leerer Kommentar verworfen werden");
  } finally {
    aufraeumen(dir);
  }
});

test("export gibt Umlaute und Codeblock zeichengleich zurueck", NUR_POSIX, () => {
  const dir = fixture("migrate-utf8-", erfolgsRegeln());
  try {
    const { res } = exportiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const { daten } = geleseneDatei(res);
    assert.equal(daten.find((e) => e.number === 101).body, BODY_101);
  } finally {
    aufraeumen(dir);
  }
});

test("export fragt ausschliesslich offene Issues ab und setzt nur lesende gh-Aufrufe ab", NUR_POSIX, () => {
  const dir = fixture("migrate-lesend-", erfolgsRegeln());
  try {
    const { res } = exportiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const zeilen = aufrufZeilen(dir, "gh");

    assert.ok(zeilen.some((z) => z.includes("states:OPEN")), "die Issue-Abfrage muss auf offene Issues filtern");
    for (const zeile of zeilen) {
      assert.doesNotMatch(zeile, /issue edit|issue comment|issue create|issue close/, `schreibender Aufruf: ${zeile}`);
      assert.doesNotMatch(zeile, /project item-add|project item-edit/, `schreibender Aufruf: ${zeile}`);
      assert.doesNotMatch(zeile, /mutation/, `GraphQL-Mutation: ${zeile}`);
    }
  } finally {
    aufraeumen(dir);
  }
});

// ============================================================
// export — Ausgabedatei
// ============================================================

test("export legt das Zielverzeichnis an und meldet ausschliesslich den absoluten Pfad", NUR_POSIX, () => {
  const dir = fixture("migrate-pfad-", erfolgsRegeln());
  try {
    const { res, out } = exportiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const pfad = res.stdout.trim();

    assert.equal(res.stdout, `${pfad}\n`, "stdout enthaelt nur den Pfad");
    assert.equal(dirname(pfad), out);
    assert.match(pfad.split("/").pop(), /^issues-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/);
    assert.ok(existsSync(pfad));
  } finally {
    aufraeumen(dir);
  }
});

test("ohne --out landet die Datei unter os.tmpdir()", NUR_POSIX, () => {
  const dir = fixture("migrate-default-out-", erfolgsRegeln());
  let pfad = null;
  try {
    const res = runMigrate(dir, ["export"]);
    assert.equal(res.status, 0, res.stderr);
    pfad = res.stdout.trim();
    assert.equal(dirname(pfad), join(tmpdir(), "claude-workflow-kit-migrationen"));
    assert.ok(existsSync(pfad));
  } finally {
    if (pfad) rmSync(pfad, { force: true });
    aufraeumen(dir);
  }
});

test("eine vorhandene gleichnamige Zieldatei wird nie ueberschrieben", NUR_POSIX, () => {
  const dir = fixture("migrate-kollision-", erfolgsRegeln());
  try {
    const stamp = "2026-08-11T09-00-00.000Z";
    const out = join(dir, "export");
    mkdirSync(out, { recursive: true });
    const ziel = join(out, `issues-${stamp}.json`);
    writeFileSync(ziel, "vorher", "utf-8");

    const res = runMigrate(dir, ["export", "--out", out], { KIT_MIGRATE_STAMP: stamp });

    assert.equal(res.status, 1);
    assert.match(res.stderr, /existiert/i);
    assert.equal(readFileSync(ziel, "utf-8"), "vorher", "die vorhandene Datei bleibt unveraendert");
    assert.deepEqual(readdirSync(out), [`issues-${stamp}.json`], "es entsteht keine weitere Datei");
  } finally {
    aufraeumen(dir);
  }
});

test("eine leer gelesene Issue-Liste wird als [] geschrieben", NUR_POSIX, () => {
  const leer = {
    data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } },
  };
  const projektLeer = {
    data: { repositoryOwner: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } },
  };
  const dir = fixture("migrate-leer-", [
    { match: "repo view", stdout: `${ZIEL_REPO}\n` },
    { match: "projectV2", stdout: projektLeer },
    { match: "issues\\(", stdout: leer },
  ]);
  try {
    const { res } = exportiere(dir);
    assert.equal(res.status, 0, res.stderr);
    const { daten } = geleseneDatei(res);
    assert.deepEqual(daten, []);
  } finally {
    aufraeumen(dir);
  }
});

// ============================================================
// export — Fehlerpfade
// ============================================================

test("ein fehlgeschlagener oder unlesbarer gh-Aufruf hinterlaesst keine Datei", () => {
  const faelle = [
    { name: "exit", regel: { match: "issues\\(", stderr: "gh: Kontingent leer\n", exit: 1 } },
    { name: "json", regel: { match: "issues\\(", stdout: "<html>kein JSON</html>" } },
  ];
  for (const fall of faelle) {
    const dir = fixture(`migrate-fehler-${fall.name}-`, [
      { match: "repo view", stdout: `${ZIEL_REPO}\n` },
      fall.regel,
      { match: "projectV2", stdout: "{}" },
    ]);
    try {
      const { res, out } = exportiere(dir);
      assert.equal(res.status, 1, `Fall '${fall.name}' muss mit Exit 1 enden`);
      assert.match(res.stderr, /Fehler:/, `Fall '${fall.name}' meldet nichts auf stderr`);
      assert.equal(res.stdout, "", `Fall '${fall.name}' darf keinen Pfad melden`);
      const inhalt = existsSync(out) ? readdirSync(out) : [];
      assert.deepEqual(inhalt, [], `Fall '${fall.name}' hinterlaesst eine Restdatei`);
    } finally {
      aufraeumen(dir);
    }
  }
});

test("ein Schreibfehler hinterlaesst keine Zieldatei", NUR_POSIX, () => {
  const dir = fixture("migrate-schreibfehler-", erfolgsRegeln());
  try {
    // Der temporaere Name ist als Verzeichnis belegt: writeFileSync scheitert
    // plattformneutral, ohne dass der Test Dateirechte manipulieren muss (die unter
    // Windows ohnehin anders wirken).
    const stamp = "2026-08-11T09-30-00.000Z";
    const out = join(dir, "export");
    mkdirSync(join(out, `issues-${stamp}.json.tmp`), { recursive: true });

    const res = runMigrate(dir, ["export", "--out", out], { KIT_MIGRATE_STAMP: stamp });

    assert.equal(res.status, 1);
    assert.match(res.stderr, /Zieldatei konnte nicht geschrieben werden/);
    assert.equal(res.stdout, "", "ohne geschriebene Datei darf kein Pfad gemeldet werden");
    assert.equal(existsSync(join(out, `issues-${stamp}.json`)), false, "es entsteht keine halbe Exportdatei");
  } finally {
    aufraeumen(dir);
  }
});

test("ohne github.projectNumber in der Config endet export mit Exit 1", () => {
  const dir = setupProjekt({ issueTracker: "github" }, "migrate-ohne-projekt-");
  fakeCli(dir, "gh", [{ match: "repo view", stdout: `${ZIEL_REPO}\n` }]);
  try {
    const { res, out } = exportiere(dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /projectNumber/);
    assert.equal(existsSync(out), false, "ohne Projektnummer entsteht kein Zielverzeichnis");
  } finally {
    aufraeumen(dir);
  }
});
