// Listen, Verschieben, Kommentieren und CodeHost im GitLab-Adapter (Issue #188).
//
// Zweite von zwei Dateien des GitLab-Adapters (Issue #836): Anlegen, Lesen und die
// Labels liegen in `board-adapter-gitlab.test.mjs`, die gemeinsamen Fixtures in
// `helpers/board-gitlab-fixture.mjs`.
//
// Seit Issue #1217 laufen die Tests im selben Prozess gegen Tracker und CodeHost aus
// kit/board/adapter.mjs — mit genau den Aufrufen, die `issue list|move|comment` und
// `code repo-name|pr` im Einstieg absetzen. Die Antwortform `{ ok: true, ... }` von
// move und comment baut der Einstieg selbst; sie pruefen die Ablauf-Tests der
// Wegmarken und Bewegungen, hier zaehlen die abgesetzten glab-Kommandos.
//
// glab wird als Fake-Binary im PATH ersetzt (Weg 1 aus dem Issue) — derselbe Aufbau
// wie bei den GitHub-Tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";

import { aufrufZeilen } from "./helpers/adapter-fixture.mjs";
import { GITLAB_OPEN, mitTracker } from "./helpers/board-gitlab-fixture.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

// Spalte in_review ohne Label: Der Adapter muss das melden, statt ein leeres Label zu setzen.
const OHNE_REVIEW_LABEL = { codeHost: "gitlab", issueTracker: "gitlab", columns: { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "", done: "Done" } };

// --- Listen ---

test("list ohne Filter sortiert numerisch und liefert die Label-Namen", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    const alle = await tracker.listIssues(undefined);
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

test("list --status filtert per Label und fragt die Board-Reihenfolge an", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    const bereit = await tracker.listIssues("ready");
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

test("list --status done fragt die geschlossenen Issues ab", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    await tracker.listIssues("done");
    assert.match(aufrufZeilen(dir, "glab").join("\n"), /issue list --output json --order relative_position --sort asc --closed/);
  }, {
    regeln: [{ match: "^issue list", stdout: [] }],
  });
});

// backlog als Open-Zustand: offene Issues, die kein anderes Spalten-Label tragen.
test("list --status backlog grenzt per --not-label ab, wenn backlog der Open-Zustand ist", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    await tracker.listIssues("backlog");
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

test("list --status ohne Label-Mapping schlaegt fehl", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.listIssues("in_review"), /Status 'in_review' hat kein GitLab-Label-Mapping/);
  }, { config: OHNE_REVIEW_LABEL });
});

// Antwortet glab nicht mit einem Array (Fehlerobjekt, leere Ausgabe), darf der
// Adapter nicht ueber .map stolpern.
test("list vertraegt eine Antwort, die kein Array ist", async () => {
  await mitTracker(async ({ tracker }) => {
    assert.deepEqual(await tracker.listIssues(undefined), []);
  }, {
    regeln: [{ match: "^issue list", stdout: { message: "keine Issues" } }],
  });
});

// --- Verschieben ---

test("move tauscht die Status-Labels und laesst das Ziel-Label ungetauscht", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    await tracker.moveIssue("42", "in_review");
    const zeile = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeile, /issue update 42 .*--label In review/);
    assert.match(zeile, /--unlabel Backlog/);
    assert.match(zeile, /--unlabel Ready/);
    // Das Ziel-Label darf nicht im selben Aufruf entfernt werden.
    assert.doesNotMatch(zeile, /--unlabel In review/);
  });
});

test("move nach done entfernt alle Labels und schliesst das Issue", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    await tracker.moveIssue("42", "done");
    const zeile = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeile, /issue update 42 --unlabel Backlog .*--unlabel Done/);
    assert.match(zeile, /issue close 42/);
    assert.doesNotMatch(zeile, /--label /);
  });
});

test("move nach backlog oeffnet das Issue wieder, wenn backlog der Open-Zustand ist", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    await tracker.moveIssue("42", "backlog");
    const zeile = aufrufZeilen(dir, "glab").join("\n");
    assert.match(zeile, /issue reopen 42/);
    assert.doesNotMatch(zeile, /--label /);
  }, { config: GITLAB_OPEN });
});

test("move ohne Label-Mapping fuer den Zielstatus schlaegt fehl", async () => {
  await mitTracker(async ({ tracker }) => {
    await assert.rejects(tracker.moveIssue("42", "in_review"), /Status 'in_review' hat kein GitLab-Label-Mapping/);
  }, { config: OHNE_REVIEW_LABEL });
});

// --- Kommentieren ---

// Ohne laufende Nachtsitzung haengt der Einstieg keine Kit-Stand-Zeile an: Der Text
// geht unveraendert an den Tracker, ein Idempotenz-Schluessel fehlt.
test("comment legt eine Note an", async () => {
  await mitTracker(async ({ tracker, dir }) => {
    await tracker.commentIssue("42", "Mein Kommentar", undefined);
    assert.match(aufrufZeilen(dir, "glab").join("\n"), /issue note 42 --message Mein Kommentar/);
  });
});

// --- CodeHost ---

test("repo-name schneidet Besitzer und Repo aus der origin-URL", async () => {
  await mitTracker(async ({ host, dir }) => {
    lfAttribute(join(dir, ".gitattributes"));
    for (const argumente of [
      ["init", "-q"],
      ["remote", "add", "origin", "https://gitlab.com/besitzer/mein-repo.git"],
    ]) {
      const res = spawnSync("git", argumente, { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 0, `git ${argumente.join(" ")} schlug fehl: ${res.stderr}`);
    }
    assert.equal(await host.getRepoName(), "besitzer/mein-repo");
  });
});

test("repo-name faellt ohne git-Repo auf den Verzeichnisnamen zurueck", async () => {
  await mitTracker(async ({ host, dir }) => {
    assert.equal(await host.getRepoName(), basename(dir));
  });
});

test("pr legt einen Merge Request an und liest die URL aus der Ausgabe", async () => {
  await mitTracker(async ({ host, dir }) => {
    // Der Einstieg prueft das vor dem Anlegen; ohne es braeche `code pr` ab.
    assert.equal(host.supportsPullRequests(), true);
    const ergebnis = await host.createPullRequest({ from: "feature", to: "main", title: undefined });
    assert.deepEqual(ergebnis, { url: "https://gitlab.com/besitzer/repo/-/merge_requests/5" });
    assert.match(aufrufZeilen(dir, "glab").join("\n"),
      /mr create --source-branch feature --target-branch main --title feature -> main --description {2}--yes/);
  }, {
    regeln: [{ match: "^mr create", stdout: "Creating merge request\nhttps://gitlab.com/besitzer/repo/-/merge_requests/5\n" }],
  });
});

test("pr nimmt die ganze Ausgabe, wenn keine URL darin steht", async () => {
  await mitTracker(async ({ host }) => {
    assert.deepEqual(await host.createPullRequest({ from: "feature", to: "main", title: "Mein MR" }),
      { url: "MR angelegt (offline)" });
  }, {
    regeln: [{ match: "^mr create", stdout: "MR angelegt (offline)\n" }],
  });
});
