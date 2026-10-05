// Tests fuer den lokalen Datei-Tracker des Board-Werkzeugs (Issue #188).
//
// Der lokale Tracker ist der einzige, der ohne Fremdsystem auskommt: Issues sind
// Markdown-Dateien mit YAML-Frontmatter im Projektordner. Getestet werden ID-Vergabe,
// Frontmatter-Parser, Label-CSV, Epics und die Fehlerpfade — plus der LocalCodeHost.
//
// Seit Issue #1217 laufen die Tests im selben Prozess gegen kit/board/adapter.mjs:
// `resolveTracker`/`resolveCodeHost` statt des Einstiegs als Kindprozess, `imProjekt`
// stellt cwd und Umgebung wie `runBoard`. Was nur die Kommandozeile herstellt (die
// Ablehnung von `issue epics` und `code pr`), steht in
// test/ablauf-board-adapter-local.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";

import { resolveTracker, resolveCodeHost } from "../kit/board/adapter.mjs";
import { setupProjekt, imProjekt } from "./helpers/adapter-fixture.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const LOKAL = { codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } };

// Legt das Fixture an und ruft `fn(tracker, host, dir)` mit cwd im Fixture — der
// Adapter loest das issues-Verzeichnis und den Repo-Namen relativ zum cwd auf.
async function mitProjekt(fn, config = LOKAL) {
  const dir = setupProjekt(config);
  try {
    await imProjekt(dir, () => fn(resolveTracker(config), resolveCodeHost(config), dir));
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

// Ohne Body-Quelle reicht `issue create` einen leeren Body an den Adapter weiter
// (vor der Autor-Leitplanke); die Form mit Autor-Zeile belegt
// board-adapter-local-luecken.test.mjs.
test("create legt 0001.md mit Frontmatter und Abschnitts-Vorlage an", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    const angelegt = await tracker.createIssue({ title: "Erstes Issue", body: "" });
    assert.equal(angelegt.id, "0001");
    assert.equal(basename(angelegt.path), "0001.md");

    const inhalt = issueDatei(dir, "0001.md");
    assert.match(inhalt, /^---\nid: "0001"\ntype: task\nstatus: backlog\ntitle: Erstes Issue\ncreated: \d{4}-\d{2}-\d{2}\n---\n/);
    assert.match(inhalt, /## Kontext[\s\S]*## Aufgabe[\s\S]*## Akzeptanzkriterium[\s\S]*## Abhaengigkeiten/);
  });
});

test("create zaehlt die ID hoch, auch ueber Luecken hinweg", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\nstatus: backlog\ntitle: Vorhanden\n---\nText\n');
    const angelegt = await tracker.createIssue({ title: "Danach" });
    assert.equal(angelegt.id, "0008");
  });
});

// Dateien ohne fuehrende Zahl duerfen die Vergabe nicht kippen (parseInt -> NaN).
test("create faellt auf ID 1 zurueck, wenn keine Datei eine Nummer traegt", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "README.md", "# Kein Issue\n");
    const angelegt = await tracker.createIssue({ title: "Erstes echtes" });
    assert.equal(angelegt.id, "0001");
  });
});

test("create mit type, parent, color und shortcode schreibt alle Felder", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    const epic = await tracker.createIssue({ title: "Grosses Ganzes", type: "epic", color: "blau", shortcode: "GG" });
    const epicInhalt = issueDatei(dir, `${epic.id}.md`);
    assert.match(epicInhalt, /type: epic/);
    assert.match(epicInhalt, /color: blau/);
    assert.match(epicInhalt, /shortcode: GG/);
    // Epics nehmen nicht am Spalten-Workflow teil (E5): kein status-Feld.
    assert.doesNotMatch(epicInhalt, /^status:/m);

    const kind = await tracker.createIssue({ title: "Teil davon", parent: epic.id });
    const kindInhalt = issueDatei(dir, `${kind.id}.md`);
    assert.match(kindInhalt, new RegExp(`parent: "${epic.id}"`));
    assert.match(kindInhalt, /status: backlog/);
  });
});

test("create uebernimmt einen mitgegebenen Body statt der Vorlage", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    await tracker.createIssue({ title: "Mit Body", body: "## Abhaengigkeiten\nKeine." });
    const inhalt = issueDatei(dir, "0001.md");
    assert.match(inhalt, /## Abhaengigkeiten\nKeine\./);
    assert.doesNotMatch(inhalt, /## Kontext/);
  });
});

// --- Lesen ---

test("get liefert alle Frontmatter-Felder und den Body", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "0003.md",
      '---\nid: "0003"\ntype: task\nparent: "0001"\nstatus: ready\ntitle: Gelesen\ncreated: 2026-01-02\n---\nDer Body.\n');
    const geholt = await tracker.getIssue("0003");
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
test("get laesst ein formwidriges created im Frontmatter weg", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "0006.md", '---\nid: "0006"\ntitle: Krumm\ncreated: 14.08.2026\n---\nBody.\n');
    assert.equal("created" in await tracker.getIssue("0006"), false);
  });
});

test("get liefert created auch mit Uhrzeit als reinen Kalendertag", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\ntitle: Mit Zeit\ncreated: 2026-08-14T09:12:33Z\n---\nBody.\n');
    assert.equal((await tracker.getIssue("0007")).created, "2026-08-14");
  });
});

// Der Frontmatter-Parser ist bewusst minimal. Fehlt der Block ganz, ist die ganze
// Datei Body — die Defaults muessen dann greifen, statt undefined zu liefern.
test("get ohne Frontmatter: Datei ist Body, Felder tragen Defaults", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "0005.md", "Nur Text, kein Frontmatter.\n");
    const geholt = await tracker.getIssue("5");
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

// Der Adapter wirft BoardError; die Kommandozeile macht daraus Exit 1 und stderr.
test("get auf ein fehlendes Issue nennt den erwarteten Pfad", async () => {
  await mitProjekt(async (tracker) => {
    await assert.rejects(tracker.getIssue("42"), /Issue 42 nicht gefunden: .*0042\.md/);
  });
});

// --- Listen ---

test("list ohne Filter liefert alle Issues aufsteigend nach Dateiname", async () => {
  await mitProjekt(async (tracker) => {
    for (const titel of ["Eins", "Zwei", "Drei"]) {
      await tracker.createIssue({ title: titel });
    }
    const alle = await tracker.listIssues();
    assert.deepEqual(alle.map((i) => i.id), ["0001", "0002", "0003"]);
    assert.deepEqual(alle.map((i) => i.title), ["Eins", "Zwei", "Drei"]);
  });
});

test("list ohne issues-Verzeichnis liefert eine leere Liste statt eines Fehlers", async () => {
  await mitProjekt(async (tracker) => {
    assert.deepEqual(await tracker.listIssues(), []);
  });
});

test("list --status filtert und laesst Epics aussen vor", async () => {
  await mitProjekt(async (tracker) => {
    const epic = await tracker.createIssue({ title: "Epic bleibt draussen", type: "epic" });
    const eins = await tracker.createIssue({ title: "Bereit" });
    await tracker.createIssue({ title: "Bleibt im Backlog" });
    await tracker.moveIssue(eins.id, "ready");
    // Ein Epic mit ready-Status im Frontmatter darf trotzdem nicht auftauchen.
    await tracker.moveIssue(epic.id, "ready");

    const bereit = await tracker.listIssues("ready");
    assert.deepEqual(bereit.map((i) => i.id), [eins.id]);
  });
});

// Labels liegen als kommaseparierter Frontmatter-String vor (parseFrontmatter kann
// kein YAML-Array) und muessen als Array herauskommen — darauf baut das Routing-Label
// des Nacht-Runners auf (Issue #158/#159).
test("list liest labels als CSV und liefert sie als Array", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "0001.md", '---\nid: "0001"\nstatus: ready\ntitle: Mit Labels\nlabels: nacht, dringend ,\n---\nText\n');
    schreibeIssue(dir, "0002.md", '---\nid: "0002"\nstatus: ready\ntitle: Leere Labels\nlabels:   \n---\nText\n');
    schreibeIssue(dir, "0003.md", '---\nid: "0003"\nstatus: ready\ntitle: Ohne Labels\n---\nText\n');

    const alle = await tracker.listIssues();
    assert.deepEqual(alle[0].labels, ["nacht", "dringend"]);
    assert.deepEqual(alle[1].labels, []);
    assert.deepEqual(alle[2].labels, []);
  });
});

// --- Epics ---

test("epics liefert je Epic den Fortschritt aus den Kindern", async () => {
  await mitProjekt(async (tracker) => {
    const epic = await tracker.createIssue({ title: "Sammel-Epic", type: "epic", shortcode: "SE" });
    const leeres = await tracker.createIssue({ title: "Leeres Epic", type: "epic" });
    const a = await tracker.createIssue({ title: "Kind A", parent: epic.id });
    await tracker.createIssue({ title: "Kind B", parent: epic.id });
    await tracker.moveIssue(a.id, "done");

    const epics = await tracker.listEpics();
    assert.deepEqual(epics.map((e) => e.id), [epic.id, leeres.id]);
    assert.deepEqual(epics[0].progress, { total: 2, done: 1 });
    assert.deepEqual(epics[1].progress, { total: 0, done: 0 });
    assert.equal(epics[0].shortcode, "SE");
  });
});

// Ohne Status-Filter galt der Epic-Ausschluss frueher nicht (Issue #377).
test("list ohne Filter laesst Epics aussen vor", async () => {
  await mitProjekt(async (tracker) => {
    await tracker.createIssue({ title: "Ein Epic", type: "epic" });
    await tracker.createIssue({ title: "Ein Arbeitspaket" });
    const liste = await tracker.listIssues();
    assert.deepEqual(liste.map((i) => i.title), ["Ein Arbeitspaket"]);
  });
});

// _read setzte den Default "backlog" auch ueber ein Vorhaben, das per createIssue
// bewusst gar kein status-Feld traegt (Issue #377).
test("get auf ein lokales Vorhaben liefert status null", async () => {
  await mitProjekt(async (tracker) => {
    const epic = await tracker.createIssue({ title: "Vorhaben ohne Status", type: "epic" });
    const gelesen = await tracker.getIssue(epic.id);
    assert.equal(gelesen.status, null);
    assert.equal(gelesen.type, "epic");
  });
});

// Auch ein per move geschriebenes status-Feld darf die Aussage nicht kippen:
// moveIssue schreibt meta.status ohne Typpruefung (Issue #377).
test("get auf ein Vorhaben mit geschriebenem status-Feld bleibt null", async () => {
  await mitProjekt(async (tracker) => {
    const epic = await tracker.createIssue({ title: "Verschobenes Vorhaben", type: "epic" });
    await tracker.moveIssue(epic.id, "done");
    assert.equal((await tracker.getIssue(epic.id)).status, null);
  });
});

// --- Verschieben und Kommentieren ---

// Die Antwort `{ ok, id, status }` setzt die Kommandozeile zusammen; der Adapter
// verantwortet die Datei.
test("move schreibt den neuen Status ins Frontmatter und laesst den Body unberuehrt", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    await tracker.createIssue({ title: "Wandert", body: "Unveraenderter Body.\n" });
    await tracker.moveIssue("0001", "in_review");

    const inhalt = issueDatei(dir, "0001.md");
    assert.match(inhalt, /status: in_review/);
    assert.match(inhalt, /Unveraenderter Body\.\n$/);
  });
});

test("move und comment auf ein fehlendes Issue schlagen fehl", async () => {
  await mitProjekt(async (tracker) => {
    await assert.rejects(tracker.moveIssue("77", "ready"), /Issue 77 nicht gefunden/);
    await assert.rejects(tracker.commentIssue("77", "Hallo"), /Issue 77 nicht gefunden/);
  });
});

// Ohne Kit-Stand-Markierung reicht die Kommandozeile den Text unveraendert durch.
test("comment haengt den Text mit Zeitstempel unten an", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    await tracker.createIssue({ title: "Bekommt Kommentar" });
    await tracker.commentIssue("0001", "## Abschlussbericht\nAlles gruen.");

    const inhalt = issueDatei(dir, "0001.md");
    assert.match(inhalt, /\n---\n\*\*Kommentar\*\* \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)\n\n## Abschlussbericht\nAlles gruen\.$/);
  });
});

// --- LocalCodeHost ---

// Liefert seit Issue #214 owner/repo statt nur repo — alle drei Code-Hosts geben
// dieselbe Form zurueck, sonst beantwortet dasselbe Kommando je nach Projekt etwas
// anderes.
test("repo-name nutzt die origin-Remote, wenn es eine gibt", async () => {
  await mitProjekt(async (_tracker, host, dir) => {
    lfAttribute(join(dir, ".gitattributes"));
    for (const argumente of [
      ["init", "-q"],
      ["remote", "add", "origin", "https://example.invalid/besitzer/mein-repo.git"],
    ]) {
      const res = spawnSync("git", argumente, { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 0, `git ${argumente.join(" ")} schlug fehl: ${res.stderr}`);
    }
    assert.equal(await host.getRepoName(), "besitzer/mein-repo");
  });
});

test("repo-name faellt ohne git-Repo auf den Verzeichnisnamen zurueck", async () => {
  await mitProjekt(async (_tracker, host, dir) => {
    assert.equal(await host.getRepoName(), basename(dir));
  });
});

// Regression zur Dateiablage: create darf das Verzeichnis selbst anlegen.
test("create legt das issues-Verzeichnis an, wenn es fehlt", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    await tracker.createIssue({ title: "Legt Verzeichnis an" });
    assert.deepEqual(readdirSync(join(dir, "issues")), ["0001.md"]);
  });
});

// --- Labels bei `issue get` (Issue #312) ---
//
// listIssues zerlegte den kommaseparierten Frontmatter-String bereits, _read nicht.
// Beide teilen sich jetzt denselben Helfer — zwei Lesarten desselben Feldes waeren
// die Stelle, an der sie auseinanderlaufen.

test("get liefert die Labels aus dem Frontmatter als Array", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\nstatus: ready\ntitle: Mit Labels\nlabels: kit:nightrun, fix\n---\nText\n');
    assert.deepEqual((await tracker.getIssue("7")).labels, ["kit:nightrun", "fix"]);
  });
});

test("get ohne labels-Zeile im Frontmatter liefert ein leeres Array, nie undefined", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\nstatus: ready\ntitle: Ohne Labels\n---\nText\n');
    assert.deepEqual((await tracker.getIssue("7")).labels, []);
  });
});

test("get und list liefern fuer dieselbe Datei dieselben Labels", async () => {
  await mitProjekt(async (tracker, _host, dir) => {
    schreibeIssue(dir, "0007.md", '---\nid: "0007"\nstatus: ready\ntitle: Mit Labels\nlabels: kit:nightrun, fix\n---\nText\n');
    const ausGet = (await tracker.getIssue("7")).labels;
    const ausList = (await tracker.listIssues()).find((i) => i.id === "0007").labels;
    assert.deepEqual(ausGet, ausList);
  });
});
