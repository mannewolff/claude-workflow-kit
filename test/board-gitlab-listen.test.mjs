// Listen, Verschieben, Kommentieren und CodeHost im GitLab-Adapter (Issue #188).
//
// Zweite von zwei Dateien des GitLab-Adapters (Issue #836): Anlegen, Lesen und die
// Labels liegen in `board-gitlab.test.mjs`, die gemeinsamen Fixtures in
// `helpers/board-gitlab-fixture.mjs`.
//
// glab wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue) — derselbe Aufbau
// wie bei den GitHub-Tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

import { runBoard, board, aufrufZeilen } from "./helpers/board-fixture.mjs";
import { NUR_POSIX, GITLAB_OPEN, mitProjekt } from "./helpers/board-gitlab-fixture.mjs";

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
