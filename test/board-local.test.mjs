// Tests fuer den lokalen Datei-Tracker in kit/board.mjs (Issue #188).
//
// Der lokale Tracker ist der einzige, der ohne Fremdsystem auskommt: Issues sind
// Markdown-Dateien mit YAML-Frontmatter im Projektordner. Getestet werden ID-Vergabe,
// Frontmatter-Parser, Label-CSV, Epics und die Fehlerpfade — plus der LocalCodeHost.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";

import { setupProjekt, runBoard, board } from "./helpers/board-fixture.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

function mitProjekt(fn, config = LOKAL) {
  const dir = setupProjekt(config);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function schreibeIssue(dir, dateiname, inhalt) {
  const issuesDir = join(dir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(join(issuesDir, dateiname), inhalt, "utf-8");
}

function issueDatei(dir, dateiname) {
  return readFileSync(join(dir, "issues", dateiname), "utf-8");
}

// --- Anlegen und ID-Vergabe ---

test("create legt 0001.md mit Frontmatter und Abschnitts-Vorlage an", () => {
  mitProjekt((dir) => {
    const angelegt = board(dir, "issue", "create", "--title", "Erstes Issue");
    assert.equal(angelegt.id, "0001");
    assert.equal(basename(angelegt.path), "0001.md");

    const inhalt = issueDatei(dir, "0001.md");
    assert.match(inhalt, /^---\nid: "0001"\ntype: task\nstatus: backlog\ntitle: Erstes Issue\ncreated: \d{4}-\d{2}-\d{2}\n---\n/);
    assert.match(inhalt, /## Kontext[\s\S]*## Aufgabe[\s\S]*## Akzeptanzkriterium[\s\S]*## Abhaengigkeiten/);
  });
});

test("create zaehlt die ID hoch, auch ueber Luecken hinweg", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\nstatus: backlog\ntitle: Vorhanden\n---\nText\n');
    const angelegt = board(dir, "issue", "create", "--title", "Danach");
    assert.equal(angelegt.id, "0008");
  });
});

// Dateien ohne fuehrende Zahl duerfen die Vergabe nicht kippen (parseInt -> NaN).
test("create faellt auf ID 1 zurueck, wenn keine Datei eine Nummer traegt", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "README.md", "# Kein Issue\n");
    const angelegt = board(dir, "issue", "create", "--title", "Erstes echtes");
    assert.equal(angelegt.id, "0001");
  });
});

test("create mit type, parent, color und shortcode schreibt alle Felder", () => {
  mitProjekt((dir) => {
    const epic = board(dir, "issue", "create", "--title", "Grosses Ganzes",
      "--type", "epic", "--color", "blau", "--shortcode", "GG");
    const epicInhalt = issueDatei(dir, `${epic.id}.md`);
    assert.match(epicInhalt, /type: epic/);
    assert.match(epicInhalt, /color: blau/);
    assert.match(epicInhalt, /shortcode: GG/);
    // Epics nehmen nicht am Spalten-Workflow teil (E5): kein status-Feld.
    assert.doesNotMatch(epicInhalt, /^status:/m);

    const kind = board(dir, "issue", "create", "--title", "Teil davon", "--parent", epic.id);
    const kindInhalt = issueDatei(dir, `${kind.id}.md`);
    assert.match(kindInhalt, new RegExp(`parent: "${epic.id}"`));
    assert.match(kindInhalt, /status: backlog/);
  });
});

test("create uebernimmt einen mitgegebenen Body statt der Vorlage", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Mit Body", "--body", "## Abhaengigkeiten\nKeine.");
    const inhalt = issueDatei(dir, "0001.md");
    assert.match(inhalt, /## Abhaengigkeiten\nKeine\./);
    assert.doesNotMatch(inhalt, /## Kontext/);
  });
});

// --- Lesen ---

test("get liefert alle Frontmatter-Felder und den Body", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "0003.md",
      '---\nid: "0003"\ntype: task\nparent: "0001"\nstatus: ready\ntitle: Gelesen\ncreated: 2026-01-02\n---\nDer Body.\n');
    const geholt = board(dir, "issue", "get", "0003");
    assert.deepEqual(geholt, {
      id: "0003", type: "task", parent: "0001", title: "Gelesen",
      status: "ready", created: "2026-01-02", labels: [], body: "Der Body.\n",
    });
    assert.match(geholt.created, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// --- Anlagedatum bei `issue get` (Issue #457) ---
//
// Das Frontmatter ist handgeschrieben — ein Wert wie 14.08.2026 kommt vor. Er wird
// NICHT umgeformt: Das Gate aus Ausbaustufe 4 braucht ein verlaessliches Datum, und
// ein umgedeutetes waere schlimmer als keins.
test("get laesst ein formwidriges created im Frontmatter weg", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "0006.md", '---\nid: "0006"\ntitle: Krumm\ncreated: 14.08.2026\n---\nBody.\n');
    assert.equal("created" in board(dir, "issue", "get", "0006"), false);
  });
});

test("get liefert created auch mit Uhrzeit als reinen Kalendertag", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\ntitle: Mit Zeit\ncreated: 2026-08-14T09:12:33Z\n---\nBody.\n');
    assert.equal(board(dir, "issue", "get", "0007").created, "2026-08-14");
  });
});

// Der Frontmatter-Parser ist bewusst minimal. Fehlt der Block ganz, ist die ganze
// Datei Body — die Defaults muessen dann greifen, statt undefined zu liefern.
test("get ohne Frontmatter: Datei ist Body, Felder tragen Defaults", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "0005.md", "Nur Text, kein Frontmatter.\n");
    const geholt = board(dir, "issue", "get", "5");
    assert.equal(geholt.id, "0005");
    assert.equal(geholt.type, "task");
    assert.equal(geholt.status, "backlog");
    assert.equal(geholt.title, "");
    assert.equal(geholt.parent, "");
    // Ohne Frontmatter fehlt `created` ganz — frueher kam "" zurueck (Issue #457).
    // #450/#451 muessen sonst zwei Formen von "kein Datum" unterscheiden.
    assert.equal("created" in geholt, false);
    assert.equal(geholt.body, "Nur Text, kein Frontmatter.\n");
  });
});

test("get auf ein fehlendes Issue nennt den erwarteten Pfad", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "get", "42"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Issue 42 nicht gefunden: .*0042\.md/);
  });
});

// --- Listen ---

test("list ohne Filter liefert alle Issues aufsteigend nach Dateiname", () => {
  mitProjekt((dir) => {
    for (const titel of ["Eins", "Zwei", "Drei"]) {
      board(dir, "issue", "create", "--title", titel);
    }
    const alle = board(dir, "issue", "list");
    assert.deepEqual(alle.map((i) => i.id), ["0001", "0002", "0003"]);
    assert.deepEqual(alle.map((i) => i.title), ["Eins", "Zwei", "Drei"]);
  });
});

test("list ohne issues-Verzeichnis liefert eine leere Liste statt eines Fehlers", () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "issue", "list"), []);
  });
});

test("list --status filtert und laesst Epics aussen vor", () => {
  mitProjekt((dir) => {
    const epic = board(dir, "issue", "create", "--title", "Epic bleibt draussen", "--type", "epic");
    const eins = board(dir, "issue", "create", "--title", "Bereit");
    board(dir, "issue", "create", "--title", "Bleibt im Backlog");
    board(dir, "issue", "move", eins.id, "ready");
    // Ein Epic mit ready-Status im Frontmatter darf trotzdem nicht auftauchen.
    board(dir, "issue", "move", epic.id, "ready");

    const bereit = board(dir, "issue", "list", "--status", "ready");
    assert.deepEqual(bereit.map((i) => i.id), [eins.id]);
  });
});

// Labels liegen als kommaseparierter Frontmatter-String vor (parseFrontmatter kann
// kein YAML-Array) und muessen als Array herauskommen — darauf baut das Routing-Label
// des Nacht-Runners auf (Issue #158/#159).
test("list liest labels als CSV und liefert sie als Array", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "0001.md", '---\nid: "0001"\nstatus: ready\ntitle: Mit Labels\nlabels: nacht, dringend ,\n---\nText\n');
    schreibeIssue(dir, "0002.md", '---\nid: "0002"\nstatus: ready\ntitle: Leere Labels\nlabels:   \n---\nText\n');
    schreibeIssue(dir, "0003.md", '---\nid: "0003"\nstatus: ready\ntitle: Ohne Labels\n---\nText\n');

    const alle = board(dir, "issue", "list");
    assert.deepEqual(alle[0].labels, ["nacht", "dringend"]);
    assert.deepEqual(alle[1].labels, []);
    assert.deepEqual(alle[2].labels, []);
  });
});

// --- Epics ---

test("epics liefert je Epic den Fortschritt aus den Kindern", () => {
  mitProjekt((dir) => {
    const epic = board(dir, "issue", "create", "--title", "Sammel-Epic", "--type", "epic", "--shortcode", "SE");
    const leeres = board(dir, "issue", "create", "--title", "Leeres Epic", "--type", "epic");
    const a = board(dir, "issue", "create", "--title", "Kind A", "--parent", epic.id);
    board(dir, "issue", "create", "--title", "Kind B", "--parent", epic.id);
    board(dir, "issue", "move", a.id, "done");

    const epics = board(dir, "issue", "epics");
    assert.deepEqual(epics.map((e) => e.id), [epic.id, leeres.id]);
    assert.deepEqual(epics[0].progress, { total: 2, done: 1 });
    assert.deepEqual(epics[1].progress, { total: 0, done: 0 });
    assert.equal(epics[0].shortcode, "SE");
  });
});

// Ohne Status-Filter galt der Epic-Ausschluss frueher nicht (Issue #377).
test("list ohne Filter laesst Epics aussen vor", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Ein Epic", "--type", "epic");
    board(dir, "issue", "create", "--title", "Ein Arbeitspaket");
    const liste = board(dir, "issue", "list");
    assert.deepEqual(liste.map((i) => i.title), ["Ein Arbeitspaket"]);
  });
});

// _read setzte den Default "backlog" auch ueber ein Vorhaben, das per createIssue
// bewusst gar kein status-Feld traegt (Issue #377).
test("get auf ein lokales Vorhaben liefert status null", () => {
  mitProjekt((dir) => {
    const epic = board(dir, "issue", "create", "--title", "Vorhaben ohne Status", "--type", "epic");
    const gelesen = board(dir, "issue", "get", epic.id);
    assert.equal(gelesen.status, null);
    assert.equal(gelesen.type, "epic");
  });
});

// Auch ein per move geschriebenes status-Feld darf die Aussage nicht kippen:
// moveIssue schreibt meta.status ohne Typpruefung (Issue #377).
test("get auf ein Vorhaben mit geschriebenem status-Feld bleibt null", () => {
  mitProjekt((dir) => {
    const epic = board(dir, "issue", "create", "--title", "Verschobenes Vorhaben", "--type", "epic");
    board(dir, "issue", "move", epic.id, "done");
    assert.equal(board(dir, "issue", "get", epic.id).status, null);
  });
});

// --- Verschieben und Kommentieren ---

test("move schreibt den neuen Status ins Frontmatter und laesst den Body unberuehrt", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Wandert", "--body", "Unveraenderter Body.\n");
    const ergebnis = board(dir, "issue", "move", "0001", "in_review");
    assert.deepEqual(ergebnis, { ok: true, id: "0001", status: "in_review" });

    const inhalt = issueDatei(dir, "0001.md");
    assert.match(inhalt, /status: in_review/);
    assert.match(inhalt, /Unveraenderter Body\.\n$/);
  });
});

test("move und comment auf ein fehlendes Issue schlagen fehl", () => {
  mitProjekt((dir) => {
    const verschoben = runBoard(dir, ["issue", "move", "77", "ready"]);
    assert.equal(verschoben.status, 1);
    assert.match(verschoben.stderr, /Issue 77 nicht gefunden/);

    const kommentiert = runBoard(dir, ["issue", "comment", "77", "--text", "Hallo"]);
    assert.equal(kommentiert.status, 1);
    assert.match(kommentiert.stderr, /Issue 77 nicht gefunden/);
  });
});

test("comment haengt den Text mit Zeitstempel unten an", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Bekommt Kommentar");
    const ergebnis = board(dir, "issue", "comment", "0001", "--text", "## Abschlussbericht\nAlles gruen.");
    assert.deepEqual(ergebnis, { ok: true, id: "0001" });

    const inhalt = issueDatei(dir, "0001.md");
    assert.match(inhalt, /\n---\n\*\*Kommentar\*\* \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)\n\n## Abschlussbericht\nAlles gruen\.$/);
  });
});

// --- LocalCodeHost ---

// Liefert seit Issue #214 owner/repo statt nur repo — alle drei Code-Hosts geben
// dieselbe Form zurueck, sonst beantwortet dasselbe Kommando je nach Projekt etwas
// anderes.
test("repo-name nutzt die origin-Remote, wenn es eine gibt", () => {
  mitProjekt((dir) => {
    for (const argumente of [
      ["init", "-q"],
      ["remote", "add", "origin", "https://example.invalid/besitzer/mein-repo.git"],
    ]) {
      const res = spawnSync("git", argumente, { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 0, `git ${argumente.join(" ")} schlug fehl: ${res.stderr}`);
    }
    assert.deepEqual(board(dir, "code", "repo-name"), { repoName: "besitzer/mein-repo" });
  });
});

test("repo-name faellt ohne git-Repo auf den Verzeichnisnamen zurueck", () => {
  mitProjekt((dir) => {
    assert.deepEqual(board(dir, "code", "repo-name"), { repoName: basename(dir) });
  });
});

// Der lokale Modus kennt keine Pull Requests: codePr bricht ab, bevor der CodeHost
// gefragt wird — mit dem Hinweis auf den lokalen Merge.
test("code pr im lokalen Modus verweist auf den git-Merge", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["code", "pr", "--from", "feature", "--to", "main"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /keine Pull Requests.*lokalen git-Merge/);
  });
});

// --- epics nur im lokalen Modus ---

test("epics wird fuer Tracker ohne Epic-Begriff sauber abgelehnt", () => {
  mitProjekt((dir) => {
    const res = runBoard(dir, ["issue", "epics"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /epics wird von diesem Tracker nicht unterstuetzt/);
    assert.match(res.stderr, /local, toolbox/);
  }, { codeHost: "local", issueTracker: "gitlab" });
});

// Regression zur Dateiablage: create darf das Verzeichnis selbst anlegen.
test("create legt das issues-Verzeichnis an, wenn es fehlt", () => {
  mitProjekt((dir) => {
    board(dir, "issue", "create", "--title", "Legt Verzeichnis an");
    assert.deepEqual(readdirSync(join(dir, "issues")), ["0001.md"]);
  });
});

// --- Labels bei `issue get` (Issue #312) ---
//
// listIssues zerlegte den kommaseparierten Frontmatter-String bereits, _read nicht.
// Beide teilen sich jetzt denselben Helfer — zwei Lesarten desselben Feldes waeren
// die Stelle, an der sie auseinanderlaufen.

test("get liefert die Labels aus dem Frontmatter als Array", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\nstatus: ready\ntitle: Mit Labels\nlabels: kit:nightrun, fix\n---\nText\n');
    assert.deepEqual(board(dir, "issue", "get", "7").labels, ["kit:nightrun", "fix"]);
  });
});

test("get ohne labels-Zeile im Frontmatter liefert ein leeres Array, nie undefined", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\nstatus: ready\ntitle: Ohne Labels\n---\nText\n');
    assert.deepEqual(board(dir, "issue", "get", "7").labels, []);
  });
});

test("get und list liefern fuer dieselbe Datei dieselben Labels", () => {
  mitProjekt((dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\nstatus: ready\ntitle: Mit Labels\nlabels: kit:nightrun, fix\n---\nText\n');
    const ausGet = board(dir, "issue", "get", "7").labels;
    const ausList = board(dir, "issue", "list").find((i) => i.id === "0007").labels;
    assert.deepEqual(ausGet, ausList);
  });
});
