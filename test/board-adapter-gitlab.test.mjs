// Anlegen und Lesen im GitLab-Adapter (Issue #188).
//
// Erste von zwei Dateien des GitLab-Adapters (Issue #836): Eine einzelne Datei faehrt
// ihre Tests nacheinander und begrenzte damit die Wandzeit der ganzen Suite. Listen,
// Verschieben, Kommentieren und CodeHost liegen in `board-adapter-gitlab-listen.test.mjs`,
// die gemeinsamen Fixtures in `helpers/board-gitlab-fixture.mjs`.
//
// Seit Issue #1217 laufen die Tests im selben Prozess gegen den Tracker aus
// kit/board/adapter.mjs — mit genau den Aufrufen, die `issue create`, `issue get` und
// `issue list` im Einstieg absetzen. Ein Fehler ist dort ein BoardError, den der Einstieg
// als "Fehler: ..." mit Exit 1 ausgibt; Hinweise auf stderr faengt `mitStderr`.
//
// glab wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue) — derselbe Aufbau
// wie bei den GitHub-Tests.

import { test } from "node:test";
import assert from "node:assert/strict";

import { aufrufZeilen } from "./helpers/adapter-fixture.mjs";
import { GITLAB_OPEN, mitTracker, mitStderr } from "./helpers/board-gitlab-fixture.mjs";

// Der Body, den `issue create` ohne --body ans Board gibt: Der Einstieg setzt die
// Autor-Modell-Zeile aus KIT_AGENT_MODEL des Fixtures.
const OHNE_BODY = "Autor-Modell: fixture-modell\n\n";

// --- Anlegen ---

test("create liest die Issue-ID aus der glab-URL und setzt das Backlog-Label", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    const angelegt = await tracker.createIssue({ title: "Neu", body: "Autor-Modell: m\nBody" });
    assert.deepEqual(angelegt, { id: "42", url: "https://gitlab.com/besitzer/repo/-/issues/42" });

    const zeilen = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeilen, /issue create --title Neu --description Autor-Modell: m\nBody/);
    assert.match(zeilen, /issue update 42 --label Backlog/);
  }, {
    regeln: [{ match: "^issue create", stdout: "https://gitlab.com/besitzer/repo/-/issues/42\n" }],
  });
});

test("create ohne lesbare Issue-ID schlaegt fehl", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.createIssue({ title: "Ohne URL", body: OHNE_BODY }),
      /Konnte Issue-ID aus glab-Ausgabe nicht lesen/);
  }, {
    regeln: [{ match: "^issue create", stdout: "kein Link\n" }],
  });
});

test("create ueberlebt ein fehlgeschlagenes Backlog-Label mit Hinweis", async () => {
  await mitTracker(async ({ tracker }) => {
    const { ergebnis, stderr } = await mitStderr(() => tracker.createIssue({ title: "Ohne Label", body: OHNE_BODY }));
    assert.equal(ergebnis.id, "42");
    assert.match(stderr, /Backlog-Label konnte nicht gesetzt werden/);
  }, {
    regeln: [
      { match: "^issue create", stdout: "https://gitlab.com/besitzer/repo/-/issues/42\n" },
      { match: "^issue update", stderr: "label not found\n", exit: 1 },
    ],
  });
});

// Ist backlog der native Open-Zustand, waere ein Backlog-Label ein Phantom-Label.
test("create setzt kein Label, wenn backlog der Open-Zustand ist", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    await tracker.createIssue({ title: "Bleibt einfach offen", body: OHNE_BODY });
    assert.doesNotMatch(aufrufZeilen(dir, "glab").join("\n"), /issue update/);
  }, {
    config: GITLAB_OPEN,
    regeln: [{ match: "^issue create", stdout: "https://gitlab.com/besitzer/repo/-/issues/42\n" }],
  });
});

// --- Lesen ---

test("get leitet den Status aus den Labels ab und liefert die Notes als Kommentare", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    const geholt = await tracker.getIssue("42");
    assert.deepEqual(geholt, {
      id: "42",
      title: "Ein Issue",
      body: "Die Beschreibung",
      status: "ready",
      labels: ["Ready"], // seit Issue #312 auch bei get
      comments: [{ author: "manne", body: "Eine Notiz", createdAt: "2026-07-28T10:00:00Z", id: null }],
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

test("get liefert created_at als Kalendertag", async () => {
  await mitTracker(async ({ tracker }) => {
    assert.match((await tracker.getIssue("42")).created, /^\d{4}-\d{2}-\d{2}$/);
  }, {
    regeln: [
      { match: "^issue view", stdout: { iid: 42, title: "T", description: "B", state: "opened", created_at: "2026-08-14T23:30:00+02:00" } },
      { match: "^api projects", stdout: [] },
    ],
  });
});

// Kein erfundenes Datum, wenn die Antwort keins traegt (Issue #457).
test("get ohne created_at laesst das Feld weg", async () => {
  await mitTracker(async ({ tracker }) => {
    assert.equal("created" in await tracker.getIssue("42"), false);
  }, {
    regeln: [
      { match: "^issue view", stdout: { iid: 42, title: "T", description: "B", state: "opened" } },
      { match: "^api projects", stdout: [] },
    ],
  });
});

// Der Verlauf ist Zusatzinformation: ein Fehlschlag darf `issue get` nicht kippen.
test("get ueberlebt nicht abrufbare Notes mit leerem Kommentar-Array", async () => {
  await mitTracker(async ({ tracker }) => {
    const { ergebnis: geholt, stderr } = await mitStderr(() => tracker.getIssue("42"));
    assert.deepEqual(geholt.comments, []);
    // Ohne Status-Label und im Zustand opened bleibt der Status offen (null).
    assert.equal(geholt.status, null);
    assert.equal(geholt.id, "42");
    assert.match(stderr, /Kommentare nicht abrufbar/);
  }, {
    regeln: [
      { match: "^issue view", stdout: { id: 42, title: "Ohne Notes", description: "", state: "opened" } },
      { match: "^api projects", stderr: "404 Not Found\n", exit: 1 },
    ],
  });
});

test("get erkennt geschlossene Issues als done", async () => {
  await mitTracker(async ({ tracker }) => {
    assert.equal((await tracker.getIssue("42")).status, "done");
  }, {
    regeln: [{ match: "^issue view", stdout: { iid: 42, title: "Fertig", description: "", state: "closed", labels: ["Irgendwas"] } }],
  });
});

test("get erkennt offene Issues als backlog, wenn backlog der Open-Zustand ist", async () => {
  await mitTracker(async ({ tracker }) => {
    assert.equal((await tracker.getIssue("42")).status, "backlog");
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

test("get liefert die Labels als Namen-Array", async () => {
  await mitTracker(async ({ tracker }) => {
    assert.deepEqual((await tracker.getIssue("42")).labels, ["Ready", "kit:nightrun"]);
  }, { regeln: [GL_MIT_LABELS] });
});

test("get ohne Label-Feld in der Antwort liefert ein leeres Array, nie undefined", async () => {
  await mitTracker(async ({ tracker }) => {
    assert.deepEqual((await tracker.getIssue("42")).labels, []);
  }, {
    regeln: [{ match: "^issue view", stdout: { iid: 42, title: "Ohne Labels", description: "", state: "opened" } }],
  });
});

test("get und list liefern fuer dasselbe Issue dieselben Labels", async () => {
  await mitTracker(async ({ tracker }) => {
    const ausGet = (await tracker.getIssue("42")).labels;
    // `issue list` ohne --status ruft listIssues ohne Filter.
    const ausList = (await tracker.listIssues(undefined)).find((i) => i.id === "42").labels;
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
test("Ein Zustandslabel aendert weder den Status noch die Spaltenlogik", async () => {
  await mitTracker(async ({ tracker }) => {
    const geholt = await tracker.getIssue("42");
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

test("Ein Zustandslabel allein ergibt keinen Status", async () => {
  await mitTracker(async ({ tracker }) => {
    assert.equal((await tracker.getIssue("42")).status, null,
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
