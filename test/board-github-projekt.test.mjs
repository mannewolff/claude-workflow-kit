// Project-Nummer, Meta-Cache und `issue move` im GitHub-Adapter (Issue #188).
//
// Zweite von drei Dateien des GitHub-Adapters (Issue #836): Hier steht, woher die
// Project-Nummer kommt, was ein kaputter Meta-Cache anrichten darf und wie `move` die
// Single-Select-Option setzt. Lesen und Schreiben liegen in den Nachbardateien
// `board-github.test.mjs` und `board-github-schreiben.test.mjs`, die gemeinsamen
// Fixtures in `helpers/board-github-fixture.mjs`.
//
// gh wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue): Der Adapter bleibt
// unangetastet, und die tatsaechlich abgesetzte Kommandozeile ist Teil der Pruefung —
// inklusive des Quotings aus shellQuote(). Kein Netz, kein echtes Board.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, fakeCli, runBoard, board, aufrufZeilen } from "./helpers/board-fixture.mjs";
import { NUR_POSIX, GITHUB, basisRegeln, graphqlItem, mitProjekt, metaCache } from "./helpers/board-github-fixture.mjs";

// --- Project-Nummer: Konfiguration, Auto-Erkennung, Cache ---

test("Ohne konfigurierte projectNumber wird ein einziges Project automatisch erkannt und gecacht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "list", "--status", "ready"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /github\.projectNumber fehlt.*automatisch erkanntes einziges GitHub Project #14/s);

    const cache = metaCache(dir);
    assert.equal(cache["besitzer#auto"].projectNumber, 14);

    // Zweiter Lauf: die Auto-Erkennung kommt aus dem Cache, der Hinweis bleibt aus.
    const zweiter = runBoard(dir, ["issue", "list", "--status", "ready"]);
    assert.equal(zweiter.status, 0, zweiter.stderr);
    assert.doesNotMatch(zweiter.stderr, /automatisch erkanntes/);
  }, {
    config: { codeHost: "github", issueTracker: "github" },
    regeln: [{ match: "^project item-list", stdout: { items: [] } }],
  });
});

test("Kein Project fuer den Owner: harter Fehler mit Anleitung", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /hat kein GitHub Project.*projectNumber/s);
  }, {
    config: { codeHost: "github", issueTracker: "github" },
    regeln: [{ match: "^project list", stdout: { projects: [] } }],
  });
});

test("Mehrere Projects: harter Fehler mit Projektliste", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /mehrere Projects: #14 \(Mein Board\), #15 \(Zweites\)/);
  }, {
    config: { codeHost: "github", issueTracker: "github" },
    regeln: [{
      match: "^project list",
      stdout: { projects: [{ number: 14, title: "Mein Board", id: "PVT_1" }, { number: 15, title: "Zweites", id: "PVT_2" }] },
    }],
  });
});

// Ohne Project ist kein Board-Status-Filter moeglich — statt abzubrechen listet der
// Adapter alle offenen Issues und sagt das auf stderr.
test("list --status ohne bestimmbares Project faellt auf alle offenen Issues zurueck", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "list", "--status", "ready"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /kein Board-Status-Filter moeglich/);
    assert.deepEqual(JSON.parse(res.stdout), [{ id: "7", title: "Offen", body: "Text", status: null, labels: [] }]);
  }, {
    config: { codeHost: "github", issueTracker: "github" },
    regeln: [
      { match: "^project list", stdout: { projects: [] } },
      { match: "^issue list .* --state open", stdout: [{ number: 7, title: "Offen", body: "Text", labels: [] }] },
    ],
  });
});

// Der Cache ist eine Beschleunigung, keine Quelle der Wahrheit: Ist die Datei kaputt,
// muss die Auto-Erkennung normal durchlaufen und die Datei sauber ersetzt werden.
test("Korrupter Cache blockiert weder Lesen noch Schreiben der Auto-Projektnummer", NUR_POSIX, () => {
  mitProjekt((dir) => {
    writeFileSync(join(dir, ".claude", "board-meta-cache.json"), "{kein JSON", "utf-8");
    const res = runBoard(dir, ["issue", "list", "--status", "ready"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /automatisch erkanntes einziges GitHub Project #14/);
    assert.equal(metaCache(dir)["besitzer#auto"].projectNumber, 14);
  }, {
    config: { codeHost: "github", issueTracker: "github" },
    regeln: [{ match: "^project item-list", stdout: { items: [] } }],
  });
});

// Zwischen dem Laden der Meta-Daten und dem Verwerfen des Caches kann ein anderer
// Prozess die Datei zerschiessen (paralleler board.mjs-Lauf, abgebrochener Schreib-
// vorgang). Das darf den Ablauf nicht kippen — der naechste Schreibzugriff heilt sie.
test("Ein waehrend des Laufs zerschossener Cache stoppt den move nicht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(metaCache(dir)["besitzer#14"].projectId, "PVT_1");
  }, {
    regeln: [{
      match: "^project item-edit",
      stderr: "could not find option\n",
      exit: 1,
      times: 1,
      schreibt: { pfad: ".claude/board-meta-cache.json", inhalt: "{mittendrin kaputt" },
    }],
  });
});

test("Korrupter Meta-Cache wird wie ein Cache-Miss behandelt und ueberschrieben", NUR_POSIX, () => {
  mitProjekt((dir) => {
    writeFileSync(join(dir, ".claude", "board-meta-cache.json"), "{kaputt", "utf-8");
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(metaCache(dir)["besitzer#14"].projectId, "PVT_1");
  });
});

test("Geaenderte Spalten-Labels entwerten den Meta-Cache", NUR_POSIX, () => {
  const dir = setupProjekt(GITHUB, "board-github-");
  fakeCli(dir, "gh", basisRegeln());
  try {
    const erster = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(erster.status, 0, erster.stderr);
    const vorher = aufrufZeilen(dir, "gh").filter((z) => z.startsWith("project field-list")).length;
    assert.equal(vorher, 1);

    // Zweiter Lauf mit unveraenderter Config: Meta kommt aus dem Cache.
    runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(aufrufZeilen(dir, "gh").filter((z) => z.startsWith("project field-list")).length, 1);

    // Nach geaenderten Spalten-Labels muss die Zuordnung neu aufgebaut werden.
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
      ...GITHUB, columns: { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Erledigt" },
    }, null, 2));
    runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(aufrufZeilen(dir, "gh").filter((z) => z.startsWith("project field-list")).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Project nicht gefunden und fehlendes Status-Feld werden benannt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /GitHub Project #14 nicht gefunden fuer Owner 'besitzer'/);
  }, {
    regeln: [{ match: "^project list", stdout: { projects: [{ number: 99, title: "Anderes", id: "PVT_9" }] } }],
  });

  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Kein 'Status'-Feld in GitHub Project #14 gefunden/);
  }, {
    regeln: [{ match: "^project field-list", stdout: { fields: [{ id: "F_ANDERES", name: "Prioritaet" }] } }],
  });
});

// Weicht nur die Gross-/Kleinschreibung ab, greift der Fallback — aber mit Hinweis,
// damit die Config nachgezogen wird, bevor daraus ein stiller Folgefehler wird.
test("Abweichende Gross-/Kleinschreibung der Spalte wird erkannt und gemeldet", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /konfiguriert fuer Status 'ready' das Label 'Ready'.*tatsaechlich 'READY'/s);
  }, {
    regeln: [{
      match: "^project field-list",
      stdout: { fields: [{ id: "FELD_STATUS", name: "Status", options: [{ id: "opt-ready", name: "READY" }, { id: "x", name: "Voellig anderes" }] }] },
    }],
  });
});

// --- Verschieben ---

test("move setzt die Single-Select-Option des Project-Items", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "move", "42", "in_review"), { ok: true, id: "42", status: "in_review" });
    assert.match(
      aufrufZeilen(dir, "gh").join("\n"),
      /project item-edit --id ITEM_1 --project-id PVT_1 --field-id FELD_STATUS --single-select-option-id opt-review/
    );
  });
});

test("move findet das Issue nicht im Repo bzw. nicht auf dem Board", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Issue #42 nicht in Repo 'besitzer\/mein-repo' gefunden/);
  }, {
    regeln: [{ match: "^api graphql", stdout: { data: { repository: { issue: null } } } }],
  });

  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Issue #42 nicht im Project Board #14 gefunden/);
  }, {
    regeln: [{ match: "^api graphql", stdout: graphqlItem("ITEM_1", 99, "besitzer") }],
  });
});

// Gecachte Option-IDs koennen veralten (Option im Project ersetzt). Der erste
// item-edit scheitert dann, der Cache wird verworfen und einmal wiederholt.
test("move verwirft den Cache und wiederholt einmal, wenn item-edit scheitert", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 0, res.stderr);
    const felderAbrufe = aufrufZeilen(dir, "gh").filter((z) => z.startsWith("project field-list")).length;
    assert.equal(felderAbrufe, 2, "Meta wurde nach dem Fehlschlag nicht frisch geladen");
  }, {
    regeln: [{ match: "^project item-edit", stderr: "could not find option\n", exit: 1, times: 1 }],
  });
});

test("move meldet beide Fehler, wenn auch der Wiederholungsversuch scheitert", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "ready"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Status-Update fehlgeschlagen \(auch nach Cache-Refresh\).*urspruenglicher Fehler/s);
  }, {
    regeln: [{ match: "^project item-edit", stderr: "dauerhaft kaputt\n", exit: 1 }],
  });
});
