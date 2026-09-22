// Lesen im GitHub-Adapter von kit/board.mjs: `issue get` und `issue list` (Issue #188).
//
// Erste von drei Dateien des GitHub-Adapters (Issue #836): Eine einzelne Datei faehrt
// ihre Tests nacheinander und begrenzte damit die Wandzeit der ganzen Suite. Project
// und Cache liegen in `board-github-projekt.test.mjs`, Anlegen und CodeHost in
// `board-github-schreiben.test.mjs`, die gemeinsamen Fixtures in
// `helpers/board-github-fixture.mjs`.
//
// gh wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue): Der Adapter bleibt
// unangetastet, und die tatsaechlich abgesetzte Kommandozeile ist Teil der Pruefung —
// inklusive des Quotings aus shellQuote(). Kein Netz, kein echtes Board.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runBoard, board, aufrufZeilen } from "./helpers/board-fixture.mjs";
import { NUR_POSIX, mitProjekt } from "./helpers/board-github-fixture.mjs";

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
