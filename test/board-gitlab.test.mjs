// Anlegen und Lesen im GitLab-Adapter von kit/board.mjs (Issue #188).
//
// Erste von zwei Dateien des GitLab-Adapters (Issue #836): Eine einzelne Datei faehrt
// ihre Tests nacheinander und begrenzte damit die Wandzeit der ganzen Suite. Listen,
// Verschieben, Kommentieren und CodeHost liegen in `board-gitlab-listen.test.mjs`, die
// gemeinsamen Fixtures in `helpers/board-gitlab-fixture.mjs`.
//
// glab wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue) — derselbe Aufbau
// wie bei den GitHub-Tests.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runBoard, board, aufrufZeilen } from "./helpers/board-fixture.mjs";
import { NUR_POSIX, GITLAB_OPEN, mitProjekt } from "./helpers/board-gitlab-fixture.mjs";

// --- Anlegen ---

test("create liest die Issue-ID aus der glab-URL und setzt das Backlog-Label", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const angelegt = board(dir, "issue", "create", "--title", "Neu", "--body", "Autor-Modell: m\nBody");
    assert.deepEqual(angelegt, { id: "42", url: "https://gitlab.com/besitzer/repo/-/issues/42" });

    const zeilen = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeilen, /issue create --title Neu --description Autor-Modell: m\nBody/);
    assert.match(zeilen, /issue update 42 --label Backlog/);
  }, {
    regeln: [{ match: "^issue create", stdout: "https://gitlab.com/besitzer/repo/-/issues/42\n" }],
  });
});

test("create ohne lesbare Issue-ID schlaegt fehl", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "create", "--title", "Ohne URL"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Konnte Issue-ID aus glab-Ausgabe nicht lesen/);
  }, {
    regeln: [{ match: "^issue create", stdout: "kein Link\n" }],
  });
});

test("create ueberlebt ein fehlgeschlagenes Backlog-Label mit Hinweis", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "create", "--title", "Ohne Label"]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /Backlog-Label konnte nicht gesetzt werden/);
  }, {
    regeln: [
      { match: "^issue create", stdout: "https://gitlab.com/besitzer/repo/-/issues/42\n" },
      { match: "^issue update", stderr: "label not found\n", exit: 1 },
    ],
  });
});

// Ist backlog der native Open-Zustand, waere ein Backlog-Label ein Phantom-Label.
test("create setzt kein Label, wenn backlog der Open-Zustand ist", NUR_POSIX, () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Bleibt einfach offen");
    assert.doesNotMatch(aufrufZeilen(dir, "glab").join("\n"), /issue update/);
  }, {
    config: GITLAB_OPEN,
    regeln: [{ match: "^issue create", stdout: "https://gitlab.com/besitzer/repo/-/issues/42\n" }],
  });
});

// --- Lesen ---

test("get leitet den Status aus den Labels ab und liefert die Notes als Kommentare", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const geholt = board(dir, "issue", "get", "42");
    assert.deepEqual(geholt, {
      id: "42",
      title: "Ein Issue",
      body: "Die Beschreibung",
      status: "ready",
      labels: ["Ready"], // seit Issue #312 auch bei get
      comments: [{ author: "manne", body: "Eine Notiz", createdAt: "2026-07-28T10:00:00Z" }],
      created: "2026-08-14", // Anlagedatum aus created_at (Issue #457)
    });
    assert.match(aufrufZeilen(dir, "glab").join("\n"), /api projects\/:id\/issues\/42\/notes/);
  }, {
    regeln: [
      {
        match: "^issue view",
        stdout: {
          iid: 42, title: "Ein Issue", description: "Die Beschreibung", state: "opened",
          labels: [{ name: "Ready" }], created_at: "2026-08-14T09:12:33.000+02:00",
        },
      },
      {
        match: "^api projects",
        stdout: [
          { author: { username: "manne" }, body: "Eine Notiz", created_at: "2026-07-28T10:00:00Z" },
          { author: { username: "manne" }, body: "changed the description", created_at: "2026-07-28T10:01:00Z", system: true },
        ],
      },
    ],
  });
});

// --- Anlagedatum bei `issue get` (Issue #457) ---

test("get liefert created_at als Kalendertag", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.match(board(dir, "issue", "get", "42").created, /^\d{4}-\d{2}-\d{2}$/);
  }, {
    regeln: [
      { match: "^issue view", stdout: { iid: 42, title: "T", description: "B", state: "opened", created_at: "2026-08-14T23:30:00+02:00" } },
      { match: "^api projects", stdout: [] },
    ],
  });
});

// Kein erfundenes Datum, wenn die Antwort keins traegt (Issue #457).
test("get ohne created_at laesst das Feld weg", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.equal("created" in board(dir, "issue", "get", "42"), false);
  }, {
    regeln: [
      { match: "^issue view", stdout: { iid: 42, title: "T", description: "B", state: "opened" } },
      { match: "^api projects", stdout: [] },
    ],
  });
});

// Der Verlauf ist Zusatzinformation: ein Fehlschlag darf `issue get` nicht kippen.
test("get ueberlebt nicht abrufbare Notes mit leerem Kommentar-Array", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "get", "42"]);
    assert.equal(res.status, 0, res.stderr);
    const geholt = JSON.parse(res.stdout);
    assert.deepEqual(geholt.comments, []);
    // Ohne Status-Label und im Zustand opened bleibt der Status offen (null).
    assert.equal(geholt.status, null);
    assert.equal(geholt.id, "42");
    assert.match(res.stderr, /Kommentare nicht abrufbar/);
  }, {
    regeln: [
      { match: "^issue view", stdout: { id: 42, title: "Ohne Notes", description: "", state: "opened" } },
      { match: "^api projects", stderr: "404 Not Found\n", exit: 1 },
    ],
  });
});

test("get erkennt geschlossene Issues als done", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.equal(board(dir, "issue", "get", "42").status, "done");
  }, {
    regeln: [{ match: "^issue view", stdout: { iid: 42, title: "Fertig", description: "", state: "closed", labels: ["Irgendwas"] } }],
  });
});

test("get erkennt offene Issues als backlog, wenn backlog der Open-Zustand ist", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.equal(board(dir, "issue", "get", "42").status, "backlog");
  }, {
    config: GITLAB_OPEN,
    regeln: [{ match: "^issue view", stdout: { iid: 42, title: "Offen", description: "", state: "opened", labels: [] } }],
  });
});

// --- Labels bei `issue get` (Issue #312) ---
//
// Bei GitLab tragen die Status-Labels die Spalte — `get` las sie bereits, gab sie
// aber nicht zurueck. Der Vertrag ist derselbe wie bei `list`: ein Namen-Array.

const GL_MIT_LABELS = {
  match: "^issue view",
  stdout: {
    iid: 42, title: "Ein Issue", description: "Die Beschreibung", state: "opened",
    labels: [{ name: "Ready" }, { name: "kit:nightrun" }],
  },
};

test("get liefert die Labels als Namen-Array", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "get", "42").labels, ["Ready", "kit:nightrun"]);
  }, { regeln: [GL_MIT_LABELS] });
});

test("get ohne Label-Feld in der Antwort liefert ein leeres Array, nie undefined", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "get", "42").labels, []);
  }, {
    regeln: [{ match: "^issue view", stdout: { iid: 42, title: "Ohne Labels", description: "", state: "opened" } }],
  });
});

test("get und list liefern fuer dasselbe Issue dieselben Labels", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const ausGet = board(dir, "issue", "get", "42").labels;
    const ausList = board(dir, "issue", "list").find((i) => i.id === "42").labels;
    assert.deepEqual(ausGet, ausList);
  }, {
    regeln: [GL_MIT_LABELS, {
      match: "^issue list",
      stdout: [{ iid: 42, title: "Ein Issue", description: "Die Beschreibung", state: "opened", labels: [{ name: "Ready" }, { name: "kit:nightrun" }] }],
    }],
  });
});

// Bei GitLab SIND Spalten Labels — deshalb der Kollisions-Guard in `label-sync`
// (Issue #384, Plan #347/A5). Solange kein Zustandslabel mit einem Spalten-Label
// kollidiert, darf es den abgeleiteten Status nicht beruehren.
test("Ein Zustandslabel aendert weder den Status noch die Spaltenlogik", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const geholt = board(dir, "issue", "get", "42");
    assert.equal(geholt.status, "ready", "das Zustandslabel hat den Status verschoben");
    assert.deepEqual(geholt.labels, ["Ready", "review:befunde"]);
  }, {
    regeln: [
      {
        match: "^issue view",
        stdout: { iid: 42, title: "Mit Zustandslabel", description: "", state: "opened", labels: [{ name: "Ready" }, { name: "review:befunde" }] },
      },
      { match: "^api projects", stdout: [] },
    ],
  });
});

test("Ein Zustandslabel allein ergibt keinen Status", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.equal(board(dir, "issue", "get", "42").status, null,
      "review:offen wurde als Spalte gelesen");
  }, {
    regeln: [
      {
        match: "^issue view",
        stdout: { iid: 42, title: "Nur Zustandslabel", description: "", state: "opened", labels: [{ name: "review:offen" }] },
      },
      { match: "^api projects", stdout: [] },
    ],
  });
});
