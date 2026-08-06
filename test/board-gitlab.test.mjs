// Tests fuer den GitLab-Adapter in kit/board.mjs (Issue #188).
//
// glab wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue) — derselbe Aufbau
// wie bei den GitHub-Tests. Besonderheit von GitLab: Spalten sind Labels, ausser
// 'done' (immer der Zustand Closed) und 'backlog', wenn es per Config der Zustand
// Open ist (columns.backlog === "Open"). Beide Konfigurationen werden geprueft.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

import { setupProjekt, fakeCli, runBoard, board, aufrufZeilen } from "./helpers/board-fixture.mjs";

// Unter Windows uebersprungen — der Grund steht im Skip-Text und erscheint im Report,
// damit ein ausgenommener Test nicht wie ein bestandener aussieht (Issue #197).
const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Das Fake-CLI liegt als .cmd im PATH; Node wirft dafuer EINVAL ohne shell:true (CVE-2024-27980), und board.mjs startet seit #196 bewusst ohne Shell. Siehe Issue #197." } : {};


const GITLAB = { codeHost: "gitlab", issueTracker: "gitlab" };
// backlog als nativer Open-Zustand statt als Label.
const GITLAB_OPEN = { codeHost: "gitlab", issueTracker: "gitlab", columns: { backlog: "Open", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Done" } };

function basisRegeln() {
  return [
    { match: "^issue update", stdout: "" },
    { match: "^issue close", stdout: "" },
    { match: "^issue reopen", stdout: "" },
    { match: "^issue note", stdout: "" },
    { match: "^api projects", stdout: [] },
  ];
}

function mitProjekt(fn, { regeln = [], config = GITLAB } = {}) {
  const dir = setupProjekt(config, "board-gitlab-");
  fakeCli(dir, "glab", [...regeln, ...basisRegeln()]);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Anlegen ---

test("create liest die Issue-ID aus der glab-URL und setzt das Backlog-Label", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const angelegt = board(dir, "issue", "create", "--title", "Neu", "--body", "Body");
    assert.deepEqual(angelegt, { id: "42", url: "https://gitlab.com/besitzer/repo/-/issues/42" });

    const zeilen = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeilen, /issue create --title Neu --description Body/);
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
      comments: [{ author: "manne", body: "Eine Notiz", createdAt: "2026-07-28T10:00:00Z" }],
    });
    assert.match(aufrufZeilen(dir, "glab").join("\n"), /api projects\/:id\/issues\/42\/notes/);
  }, {
    regeln: [
      {
        match: "^issue view",
        stdout: { iid: 42, title: "Ein Issue", description: "Die Beschreibung", state: "opened", labels: [{ name: "Ready" }] },
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

// --- Listen ---

test("list ohne Filter sortiert numerisch und liefert die Label-Namen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const alle = board(dir, "issue", "list");
    assert.deepEqual(alle.map((i) => i.id), ["7", "9"]);
    assert.deepEqual(alle[0], { id: "7", title: "Erstes", body: "A", status: "ready", labels: ["Ready", "nacht"] });
    // Ohne Status-Filter keine Board-Sortierung anfragen.
    assert.doesNotMatch(aufrufZeilen(dir, "glab").join("\n"), /relative_position/);
  }, {
    regeln: [{
      match: "^issue list",
      stdout: [
        { iid: 9, title: "Zweites", description: "B", state: "opened", labels: [] },
        { iid: 7, title: "Erstes", description: "A", state: "opened", labels: [{ name: "Ready" }, "nacht"] },
      ],
    }],
  });
});

test("list --status filtert per Label und fragt die Board-Reihenfolge an", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const bereit = board(dir, "issue", "list", "--status", "ready");
    assert.deepEqual(bereit.map((i) => i.id), ["9", "7"]);
    assert.match(aufrufZeilen(dir, "glab").join("\n"),
      /issue list --output json --order relative_position --sort asc --label Ready/);
  }, {
    regeln: [{
      match: "^issue list",
      stdout: [
        { iid: 9, title: "Oben", description: "", state: "opened", labels: ["Ready"] },
        { iid: 7, title: "Darunter", description: "", state: "opened", labels: ["Ready"] },
      ],
    }],
  });
});

test("list --status done fragt die geschlossenen Issues ab", NUR_POSIX, () => {
  mitProjekt((dir) => {
    board(dir, "issue", "list", "--status", "done");
    assert.match(aufrufZeilen(dir, "glab").join("\n"), /issue list --output json --order relative_position --sort asc --closed/);
  }, {
    regeln: [{ match: "^issue list", stdout: [] }],
  });
});

// backlog als Open-Zustand: offene Issues, die kein anderes Spalten-Label tragen.
test("list --status backlog grenzt per --not-label ab, wenn backlog der Open-Zustand ist", NUR_POSIX, () => {
  mitProjekt((dir) => {
    board(dir, "issue", "list", "--status", "backlog");
    const zeile = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeile, /--not-label Ready/);
    assert.match(zeile, /--not-label In progress/);
    assert.match(zeile, /--not-label In review/);
    // 'done' ist der Zustand Closed, kein Label — darf nicht als --not-label auftauchen.
    assert.doesNotMatch(zeile, /--not-label Done/);
  }, {
    config: GITLAB_OPEN,
    regeln: [{ match: "^issue list", stdout: [] }],
  });
});

test("list --status ohne Label-Mapping schlaegt fehl", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "list", "--status", "in_review"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Status 'in_review' hat kein GitLab-Label-Mapping/);
  }, {
    config: { codeHost: "gitlab", issueTracker: "gitlab", columns: { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "", done: "Done" } },
  });
});

// Antwortet glab nicht mit einem Array (Fehlerobjekt, leere Ausgabe), darf der
// Adapter nicht ueber .map stolpern.
test("list vertraegt eine Antwort, die kein Array ist", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "list"), []);
  }, {
    regeln: [{ match: "^issue list", stdout: { message: "keine Issues" } }],
  });
});

// --- Verschieben ---

test("move tauscht die Status-Labels und laesst das Ziel-Label ungetauscht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "move", "42", "in_review"), { ok: true, id: "42", status: "in_review" });
    const zeile = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeile, /issue update 42 .*--label In review/);
    assert.match(zeile, /--unlabel Backlog/);
    assert.match(zeile, /--unlabel Ready/);
    // Das Ziel-Label darf nicht im selben Aufruf entfernt werden.
    assert.doesNotMatch(zeile, /--unlabel In review/);
  });
});

test("move nach done entfernt alle Labels und schliesst das Issue", NUR_POSIX, () => {
  mitProjekt((dir) => {
    board(dir, "issue", "move", "42", "done");
    const zeile = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeile, /issue update 42 --unlabel Backlog .*--unlabel Done/);
    assert.match(zeile, /issue close 42/);
    assert.doesNotMatch(zeile, /--label /);
  });
});

test("move nach backlog oeffnet das Issue wieder, wenn backlog der Open-Zustand ist", NUR_POSIX, () => {
  mitProjekt((dir) => {
    board(dir, "issue", "move", "42", "backlog");
    const zeile = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeile, /issue reopen 42/);
    assert.doesNotMatch(zeile, /--label /);
  }, { config: GITLAB_OPEN });
});

test("move ohne Label-Mapping fuer den Zielstatus schlaegt fehl", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "move", "42", "in_review"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Status 'in_review' hat kein GitLab-Label-Mapping/);
  }, {
    config: { codeHost: "gitlab", issueTracker: "gitlab", columns: { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "", done: "Done" } },
  });
});

// --- Kommentieren ---

test("comment legt eine Note an", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "comment", "42", "--text", "Mein Kommentar"), { ok: true, id: "42" });
    assert.match(aufrufZeilen(dir, "glab").join("\n"), /issue note 42 --message Mein Kommentar/);
  });
});

// --- CodeHost ---

test("repo-name schneidet Besitzer und Repo aus der origin-URL", NUR_POSIX, () => {
  mitProjekt((dir) => {
    for (const argumente of [
      ["init", "-q"],
      ["remote", "add", "origin", "https://gitlab.com/besitzer/mein-repo.git"],
    ]) {
      const res = spawnSync("git", argumente, { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 0, `git ${argumente.join(" ")} schlug fehl: ${res.stderr}`);
    }
    assert.deepEqual(board(dir, "code", "repo-name"), { repoName: "besitzer/mein-repo" });
  });
});

test("repo-name faellt ohne git-Repo auf den Verzeichnisnamen zurueck", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "code", "repo-name"), { repoName: basename(dir) });
  });
});

test("pr legt einen Merge Request an und liest die URL aus der Ausgabe", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const ergebnis = board(dir, "code", "pr", "--from", "feature", "--to", "main");
    assert.deepEqual(ergebnis, { url: "https://gitlab.com/besitzer/repo/-/merge_requests/5" });
    assert.match(aufrufZeilen(dir, "glab").join("\n"),
      /mr create --source-branch feature --target-branch main --title feature -> main --description  --yes/);
  }, {
    regeln: [{ match: "^mr create", stdout: "Creating merge request\nhttps://gitlab.com/besitzer/repo/-/merge_requests/5\n" }],
  });
});

test("pr nimmt die ganze Ausgabe, wenn keine URL darin steht", NUR_POSIX, () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "code", "pr", "--from", "feature", "--to", "main", "--title", "Mein MR"),
      { url: "MR angelegt (offline)" });
  }, {
    regeln: [{ match: "^mr create", stdout: "MR angelegt (offline)\n" }],
  });
});
