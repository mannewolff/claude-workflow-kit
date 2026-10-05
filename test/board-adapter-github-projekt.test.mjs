// Project-Nummer, Meta-Cache und `issue move` im GitHub-Adapter (Issue #188).
//
// Zweite von drei Dateien des GitHub-Adapters (Issue #836): Hier steht, woher die
// Project-Nummer kommt, was ein kaputter Meta-Cache anrichten darf und wie `move` die
// Single-Select-Option setzt. Lesen und Schreiben liegen in den Nachbardateien
// `board-adapter-github-lesen.test.mjs` und `board-adapter-github-schreiben.test.mjs`,
// die gemeinsamen Fixtures in `helpers/board-github-fixture.mjs`.
//
// gh wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue): Der Adapter bleibt
// unangetastet, und die tatsaechlich abgesetzte Kommandozeile ist Teil der Pruefung.
// Kein Netz, kein echtes Board.
//
// Seit Issue #1217 laufen die Tests im selben Prozess gegen kit/board/adapter.mjs:
// `listIssues` und `moveIssue` statt `board.mjs issue list|move` als Kindprozess. Ein
// zweiter CLI-Aufruf heisst hier ein frischer Tracker aus `resolveTracker` — sein
// Gedaechtnis ist leer, nur der Datei-Cache bleibt, genau wie zwischen zwei Prozessen.
// Die Ausgabe `{ ok, id, status }` von `issue move` setzt allein die CLI zusammen; sie
// ist hier nicht Gegenstand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { aufrufZeilen } from "./helpers/adapter-fixture.mjs";
import { GITHUB, graphqlItem, mitTracker, mitStderr, metaCache } from "./helpers/board-github-fixture.mjs";
import { resolveTracker } from "../kit/board/adapter.mjs";

const OHNE_NUMMER = { codeHost: "github", issueTracker: "github" };

const feldAbrufe = (dir) => aufrufZeilen(dir, "gh").filter((z) => z.startsWith("project field-list")).length;

// --- Project-Nummer: Konfiguration, Auto-Erkennung, Cache ---

test("Ohne konfigurierte projectNumber wird ein einziges Project automatisch erkannt und gecacht", async () => {
  await mitTracker(async ({ dir, config, tracker }) => {
    const erster = await mitStderr(() => tracker.listIssues("ready"));
    assert.match(erster.stderr, /github\.projectNumber fehlt.*automatisch erkanntes einziges GitHub Project #14/s);

    const cache = metaCache(dir);
    assert.equal(cache["besitzer#auto"].projectNumber, 14);

    // Zweiter Lauf: die Auto-Erkennung kommt aus dem Cache, der Hinweis bleibt aus.
    const zweiter = await mitStderr(() => resolveTracker(config).listIssues("ready"));
    assert.doesNotMatch(zweiter.stderr, /automatisch erkanntes/);
  }, {
    config: OHNE_NUMMER,
    regeln: [{ match: "^project item-list", stdout: { items: [] } }],
  });
});

test("Kein Project fuer den Owner: harter Fehler mit Anleitung", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.moveIssue("42", "ready"), /hat kein GitHub Project.*projectNumber/s);
  }, {
    config: OHNE_NUMMER,
    regeln: [{ match: "^project list", stdout: { projects: [] } }],
  });
});

test("Mehrere Projects: harter Fehler mit Projektliste", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.moveIssue("42", "ready"), /mehrere Projects: #14 \(Mein Board\), #15 \(Zweites\)/);
  }, {
    config: OHNE_NUMMER,
    regeln: [{
      match: "^project list",
      stdout: { projects: [{ number: 14, title: "Mein Board", id: "PVT_1" }, { number: 15, title: "Zweites", id: "PVT_2" }] },
    }],
  });
});

// Ohne Project ist kein Board-Status-Filter moeglich — statt abzubrechen listet der
// Adapter alle offenen Issues und sagt das auf stderr.
test("list --status ohne bestimmbares Project faellt auf alle offenen Issues zurueck", async () => {
  await mitTracker(async ({ tracker }) => {
    const { wert, stderr } = await mitStderr(() => tracker.listIssues("ready"));
    assert.match(stderr, /kein Board-Status-Filter moeglich/);
    assert.deepEqual(wert, [{ id: "7", title: "Offen", body: "Text", status: null, labels: [] }]);
  }, {
    config: OHNE_NUMMER,
    regeln: [
      { match: "^project list", stdout: { projects: [] } },
      { match: "^issue list .* --state open", stdout: [{ number: 7, title: "Offen", body: "Text", labels: [] }] },
    ],
  });
});

// Der Cache ist eine Beschleunigung, keine Quelle der Wahrheit: Ist die Datei kaputt,
// muss die Auto-Erkennung normal durchlaufen und die Datei sauber ersetzt werden.
test("Korrupter Cache blockiert weder Lesen noch Schreiben der Auto-Projektnummer", async () => {
  await mitTracker(async ({ dir, tracker }) => {
    writeFileSync(join(dir, ".claude", "board-meta-cache.json"), "{kein JSON", "utf-8");
    const { stderr } = await mitStderr(() => tracker.listIssues("ready"));
    assert.match(stderr, /automatisch erkanntes einziges GitHub Project #14/);
    assert.equal(metaCache(dir)["besitzer#auto"].projectNumber, 14);
  }, {
    config: OHNE_NUMMER,
    regeln: [{ match: "^project item-list", stdout: { items: [] } }],
  });
});

// Zwischen dem Laden der Meta-Daten und dem Verwerfen des Caches kann ein anderer
// Prozess die Datei zerschiessen (paralleler board.mjs-Lauf, abgebrochener Schreib-
// vorgang). Das darf den Ablauf nicht kippen — der naechste Schreibzugriff heilt sie.
test("Ein waehrend des Laufs zerschossener Cache stoppt den move nicht", async () => {
  await mitTracker(async ({ dir, tracker }) => {
    await tracker.moveIssue("42", "ready");
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

test("Korrupter Meta-Cache wird wie ein Cache-Miss behandelt und ueberschrieben", async () => {
  await mitTracker(async ({ dir, tracker }) => {
    writeFileSync(join(dir, ".claude", "board-meta-cache.json"), "{kaputt", "utf-8");
    await tracker.moveIssue("42", "ready");
    assert.equal(metaCache(dir)["besitzer#14"].projectId, "PVT_1");
  });
});

test("Geaenderte Spalten-Labels entwerten den Meta-Cache", async () => {
  await mitTracker(async ({ dir, tracker }) => {
    await tracker.moveIssue("42", "ready");
    assert.equal(feldAbrufe(dir), 1);

    // Zweiter Lauf mit unveraenderter Config: Meta kommt aus dem Cache.
    await resolveTracker(GITHUB).moveIssue("42", "ready");
    assert.equal(feldAbrufe(dir), 1);

    // Nach geaenderten Spalten-Labels muss die Zuordnung neu aufgebaut werden. Die CLI
    // liest die Config bei jedem Aufruf neu; hier bekommt der frische Tracker sie direkt.
    const geaendert = {
      ...GITHUB, columns: { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Erledigt" },
    };
    await resolveTracker(geaendert).moveIssue("42", "ready");
    assert.equal(feldAbrufe(dir), 2);
  });
});

test("Project nicht gefunden und fehlendes Status-Feld werden benannt", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.moveIssue("42", "ready"), /GitHub Project #14 nicht gefunden fuer Owner 'besitzer'/);
  }, {
    regeln: [{ match: "^project list", stdout: { projects: [{ number: 99, title: "Anderes", id: "PVT_9" }] } }],
  });

  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.moveIssue("42", "ready"), /Kein 'Status'-Feld in GitHub Project #14 gefunden/);
  }, {
    regeln: [{ match: "^project field-list", stdout: { fields: [{ id: "F_ANDERES", name: "Prioritaet" }] } }],
  });
});

// Weicht nur die Gross-/Kleinschreibung ab, greift der Fallback — aber mit Hinweis,
// damit die Config nachgezogen wird, bevor daraus ein stiller Folgefehler wird.
test("Abweichende Gross-/Kleinschreibung der Spalte wird erkannt und gemeldet", async () => {
  await mitTracker(async ({ tracker }) => {
    const { stderr } = await mitStderr(() => tracker.moveIssue("42", "ready"));
    assert.match(stderr, /konfiguriert fuer Status 'ready' das Label 'Ready'.*tatsaechlich 'READY'/s);
  }, {
    regeln: [{
      match: "^project field-list",
      stdout: { fields: [{ id: "FELD_STATUS", name: "Status", options: [{ id: "opt-ready", name: "READY" }, { id: "x", name: "Voellig anderes" }] }] },
    }],
  });
});

// --- Verschieben ---

test("move setzt die Single-Select-Option des Project-Items", async () => {
  await mitTracker(async ({ dir, tracker }) => {
    await tracker.moveIssue("42", "in_review");
    assert.match(
      aufrufZeilen(dir, "gh").join("\n"),
      /project item-edit --id ITEM_1 --project-id PVT_1 --field-id FELD_STATUS --single-select-option-id opt-review/
    );
  });
});

test("move findet das Issue nicht im Repo bzw. nicht auf dem Board", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.moveIssue("42", "ready"), /Issue #42 nicht in Repo 'besitzer\/mein-repo' gefunden/);
  }, {
    regeln: [{ match: "^api graphql", stdout: { data: { repository: { issue: null } } } }],
  });

  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.moveIssue("42", "ready"), /Issue #42 nicht im Project Board #14 gefunden/);
  }, {
    regeln: [{ match: "^api graphql", stdout: graphqlItem("ITEM_1", 99, "besitzer") }],
  });
});

// Gecachte Option-IDs koennen veralten (Option im Project ersetzt). Der erste
// item-edit scheitert dann, der Cache wird verworfen und einmal wiederholt.
test("move verwirft den Cache und wiederholt einmal, wenn item-edit scheitert", async () => {
  await mitTracker(async ({ dir, tracker }) => {
    await tracker.moveIssue("42", "ready");
    assert.equal(feldAbrufe(dir), 2, "Meta wurde nach dem Fehlschlag nicht frisch geladen");
  }, {
    regeln: [{ match: "^project item-edit", stderr: "could not find option\n", exit: 1, times: 1 }],
  });
});

test("move meldet beide Fehler, wenn auch der Wiederholungsversuch scheitert", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(
      tracker.moveIssue("42", "ready"),
      /Status-Update fehlgeschlagen \(auch nach Cache-Refresh\).*urspruenglicher Fehler/s,
    );
  }, {
    regeln: [{ match: "^project item-edit", stderr: "dauerhaft kaputt\n", exit: 1 }],
  });
});
