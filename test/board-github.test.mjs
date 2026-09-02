// Tests fuer den GitHub-Adapter in kit/board.mjs (Issue #188).
//
// gh wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue): Der Adapter bleibt
// unangetastet, und die tatsaechlich abgesetzte Kommandozeile ist Teil der Pruefung —
// inklusive des Quotings aus shellQuote(). Kein Netz, kein echtes Board.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";

import { setupProjekt, fakeCli, runBoard, board, aufrufZeilen } from "./helpers/board-fixture.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." } : {};


const GITHUB = { codeHost: "github", issueTracker: "github", github: { projectNumber: 14 } };

const OPTIONEN = [
  { id: "opt-backlog", name: "Backlog" },
  { id: "opt-ready", name: "Ready" },
  { id: "opt-progress", name: "In progress" },
  { id: "opt-review", name: "In review" },
  { id: "opt-done", name: "Done" },
];

// Antworten, die praktisch jeder Pfad braucht. Testspezifische Regeln werden davor
// gehaengt und gewinnen, weil die erste passende Regel zaehlt.
function basisRegeln() {
  return [
    { match: "^repo view", stdout: "besitzer/mein-repo\n" },
    { match: "^project list", stdout: { projects: [{ number: 14, title: "Mein Board", id: "PVT_1" }] } },
    { match: "^project field-list", stdout: { fields: [{ id: "FELD_STATUS", name: "Status", options: OPTIONEN }] } },
    { match: "^api graphql", stdout: graphqlItem("ITEM_1", 14, "besitzer") },
    { match: "^project item-edit", stdout: "" },
    { match: "^project item-add", stdout: "" },
    { match: "^issue comment", stdout: "" },
  ];
}

function graphqlItem(itemId, projektNummer, besitzer) {
  return {
    data: {
      repository: {
        issue: {
          projectItems: {
            nodes: [{ id: itemId, project: { number: projektNummer, owner: { login: besitzer } } }],
          },
        },
      },
    },
  };
}

function mitProjekt(fn, { regeln = [], config = GITHUB } = {}) {
  const dir = setupProjekt(config, "board-github-");
  fakeCli(dir, "gh", [...regeln, ...basisRegeln()]);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function metaCache(dir) {
  const p = join(dir, ".claude", "board-meta-cache.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
}

// --- Lesen ---

test("get liest das Issue ueber gh issue view und normalisiert die Kommentare", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const geholt = board(dir, "issue", "get", "42");
    assert.deepEqual(geholt, {
      id: "42",
      title: "Ein Issue",
      body: "Der Body",
      status: null, // Board-Status steht nicht im Issue-Objekt
      labels: [], // Antwort ohne Label-Feld -> leeres Array (Issue #312)
      comments: [{ author: "mannewolff", body: "Ein Kommentar", createdAt: "2026-07-28T09:00:00Z" }],
      created: "2026-08-14", // Anlagedatum aus createdAt (Issue #457)
    });
    assert.match(aufrufZeilen(dir, "gh").join("\n"), /issue view 42 --repo besitzer\/mein-repo --json number,title,body,state,comments/);
  }, {
    regeln: [{
      match: "^issue view",
      stdout: {
        number: 42, title: "Ein Issue", body: "Der Body", state: "OPEN",
        createdAt: "2026-08-14T09:12:33Z",
        comments: [{ author: { login: "mannewolff" }, body: "Ein Kommentar", createdAt: "2026-07-28T09:00:00Z" }],
      },
    }],
  });
});

// --- Anlagedatum bei `issue get` (Issue #457) ---
//
// Das Gate aus Ausbaustufe 4 wertet nur Pakete ab einem Stichtag. `createdAt` muss
// dafuer in der --json-Feldliste stehen: gh liefert nur, was ausdruecklich
// angefordert wird — ein fehlendes Feld waere still zu "kein Anlagedatum" geworden.

test("get fordert createdAt an und liefert es als Kalendertag", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.match(board(dir, "issue", "get", "42").created, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(aufrufZeilen(dir, "gh").join("\n"), /--json \S*createdAt/);
  }, {
    regeln: [{
      match: "^issue view",
      stdout: { number: 42, title: "Ein Issue", body: "Der Body", state: "OPEN", createdAt: "2026-08-14T09:12:33Z" },
    }],
  });
});

// Eine Antwort ohne createdAt (aeltere gh-Version, fremder Mock) darf kein Datum
// erfinden — sonst wertet das Gate ein altes Paket als neu.
test("get ohne createdAt laesst das Feld weg", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.equal("created" in board(dir, "issue", "get", "42"), false);
  }, {
    regeln: [{
      match: "^issue view",
      stdout: { number: 42, title: "Ein Issue", body: "Der Body", state: "OPEN" },
    }],
  });
});

test("list ohne Status fragt die offenen Issues samt Labels ab", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const alle = board(dir, "issue", "list");
    assert.deepEqual(alle, [
      { id: "7", title: "Offen", body: "Text", status: null, labels: ["nacht"] },
    ]);
  }, {
    regeln: [{
      match: "^issue list .* --state open",
      stdout: [{ number: 7, title: "Offen", body: "Text", labels: [{ name: "nacht" }] }],
    }],
  });
});

test("list --status filtert ueber das Project und schlaegt die Labels nach", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const bereit = board(dir, "issue", "list", "--status", "ready");
    assert.deepEqual(bereit, [
      { id: "7", title: "Erstes", body: null, status: "ready", labels: ["nacht"] },
      { id: "9", title: "Zweites", body: null, status: "ready", labels: [] },
    ]);
    // Board-Reihenfolge bleibt erhalten (Issue #128): kein numerisches Re-Sortieren.
    const zeilen = aufrufZeilen(dir, "gh").join("\n");
    assert.match(zeilen, /project item-list 14 --owner besitzer --format json --limit 1000/);
  }, {
    regeln: [
      {
        match: "^project item-list",
        stdout: {
          items: [
            { status: "Ready", content: { number: 7, title: "Erstes" } },
            { status: "Ready", content: { number: 9, title: "Zweites" } },
            { status: "Done", content: { number: 3, title: "Fertiges" } },
          ],
        },
      },
      {
        match: "^issue list .* --state all",
        stdout: [{ number: 7, labels: [{ name: "nacht" }] }, { number: 99, labels: [] }],
      },
    ],
  });
});

// Ein Netzwerkschluckauf beim Label-Nachschlag darf einen Nachtlauf nicht kippen:
// die Liste ueberlebt ohne Labels, mit Hinweis auf stderr.
test("list --status ueberlebt einen fehlgeschlagenen Label-Nachschlag", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "list", "--status", "ready"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), [
      { id: "7", title: "Erstes", body: null, status: "ready", labels: [] },
    ]);
    assert.match(res.stderr, /Labels konnten nicht nachgeschlagen werden/);
  }, {
    regeln: [
      { match: "^project item-list", stdout: { items: [{ status: "Ready", content: { number: 7, title: "Erstes" } }] } },
      { match: "^issue list .* --state all", stderr: "API rate limit exceeded\n", exit: 1 },
    ],
  });
});

// Leere Trefferliste: der zweite gh-Aufruf muss ausbleiben (nichts nachzuschlagen).
test("list --status ohne Treffer schlaegt keine Labels nach", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "list", "--status", "in_review"), []);
    assert.doesNotMatch(aufrufZeilen(dir, "gh").join("\n"), /--state all/);
  }, {
    regeln: [{ match: "^project item-list", stdout: { items: [{ status: "Ready", content: { number: 7, title: "Erstes" } }] } }],
  });
});

test("list --status ohne passende Project-Option schlaegt fehl", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "list", "--status", "in_review"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Status 'in_review' hat keine Entsprechung im GitHub Project/);
  }, {
    regeln: [
      { match: "^project field-list", stdout: { fields: [{ id: "FELD_STATUS", name: "Status", options: [{ id: "opt-ready", name: "Ready" }] }] } },
      { match: "^project item-list", stdout: { items: [] } },
    ],
  });
});

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

// --- Labels bei `issue get` (Issue #312) ---
//
// `issue list` lieferte Labels, `issue get` nicht — und der Fehler war still: Jeder
// Aufrufer schreibt `(issue.labels || [])`, ein fehlendes Feld wird damit zu einem
// leeren Array. Wer ein Label ueber `issue get` prueft, bekommt "kein Label" und
// glaubt es.

const GH_MIT_LABELS = {
  match: "^issue view",
  stdout: {
    number: 42, title: "Ein Issue", body: "Der Body", state: "OPEN", comments: [],
    labels: [{ name: "kit:nightrun" }, { name: "fix" }],
  },
};

test("get liefert die Labels als Namen-Array", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "get", "42").labels, ["kit:nightrun", "fix"]);
    assert.match(aufrufZeilen(dir, "gh").join("\n"), /--json number,title,body,state,comments,labels/);
  }, { regeln: [GH_MIT_LABELS] });
});

test("get ohne Label-Feld in der Antwort liefert ein leeres Array, nie undefined", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "get", "42").labels, []);
  }, {
    regeln: [{
      match: "^issue view",
      stdout: { number: 42, title: "Ohne Labels", body: "", state: "OPEN", comments: [] },
    }],
  });
});

test("get und list liefern fuer dasselbe Issue dieselben Labels", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const ausGet = board(dir, "issue", "get", "42").labels;
    const ausList = board(dir, "issue", "list").find((i) => i.id === "42").labels;
    assert.deepEqual(ausGet, ausList);
  }, {
    regeln: [GH_MIT_LABELS, {
      match: "^issue list",
      stdout: [{ number: 42, title: "Ein Issue", body: "Der Body", labels: [{ name: "kit:nightrun" }, { name: "fix" }] }],
    }],
  });
});
