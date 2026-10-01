// Das Gate des Nacht-Runners fuer Pakete mit geschuetzter Datei (Issue #1046, Plan #987,
// Verifizierung 3, 4, 5; fachliche Quelle #868).
//
// Zweimal endete eine ganze Nacht, weil ein Paket eine Datei aendern sollte, die nur ein
// Mensch schreiben darf. Seit diesem Gate bekommt so ein Paket keine Session mehr: Der
// Runner schiebt es nach Backlog, setzt `kit:geschuetzt` und schreibt danach den
// Halt-Kommentar, dessen letzte Zeile den Ausgang des Labels vermerkt (E11). Erkennung,
// Kommentartext und Freigabe kommen aus kit/board.mjs (E1) — hier wird nur geprueft, dass
// der Runner sie bindet und in der richtigen Reihenfolge am Board handelt.
//
// Die Reihenfolge der Board-Aufrufe sieht man am lokalen Tracker nicht. Darum liegt unter
// `.claude/kit/board.mjs` ein Wrapper, der jeden Aufruf mitschreibt und an das echte Board
// weiterreicht. Mit NIGHT_TEST_LABEL_SCHEITERT laesst er `label add kit:geschuetzt`
// scheitern — so wie der Toolbox-Adapter ein am Board nicht angelegtes Label abweist.
//
// Laeuft komplett lokal: issueTracker "local" in einem Temp-Repo, Session-Fake via
// NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const NUR_POSIX = process.platform === "win32" ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." } : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const boardModul = await import(pathToFileURL(join(repoRoot, "kit", "board.mjs")).href);
const nightModul = await import(pathToFileURL(NIGHT).href);

// Geschuetzte Pfade kommen aus der Vorgabeliste (E18), nicht als eigenes Literal.
const PFAD = boardModul.GESCHUETZTE_PFADE[0];
const ZWEITER_PFAD = boardModul.GESCHUETZTE_PFADE[1];

const WRAPPER = `import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const hier = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (process.env.NIGHT_TEST_AUFRUFE) appendFileSync(process.env.NIGHT_TEST_AUFRUFE, JSON.stringify(args) + "\\n");
if (process.env.NIGHT_TEST_LABEL_SCHEITERT && args[0] === "issue" && args[1] === "label" && args[2] === "add" && args[4] === "kit:geschuetzt") {
  process.stderr.write("Label kit:geschuetzt ist am Board nicht angelegt\\n");
  process.exit(1);
}
const res = spawnSync(process.execPath, [join(hier, "board-echt.mjs"), ...args], { stdio: "inherit" });
process.exit(res.status ?? 1);
`;

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board-echt.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-geschuetzt-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board-echt.mjs"));
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), WRAPPER);
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/protokolle/\nsessions.log\naufrufe.log\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

const paketBody = (...pfade) => [
  "## Kontext",
  "Ein Paket fuer den Test.",
  "",
  "## Aufgabe",
  ...pfade.map((p) => `In \`${p}\` den Eintrag ergaenzen.`),
  "",
  "## Akzeptanzkriterium",
  "- Der Eintrag steht.",
  "",
  "## Abhaengigkeiten",
  "Keine.",
].join("\n");

function readyPaket(dir, titel, body) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  board(dir, "issue", "move", String(issue.id), "ready");
  return String(issue.id);
}

const issueText = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
const kommentare = (text) => text.split(/\n---\n\*\*Kommentar\*\* \([^)]*\)\n\n/).slice(1).map((k) => k.trim());
const spalte = (dir, id) => board(dir, "issue", "get", id).status;
const labels = (dir, id) => board(dir, "issue", "get", id).labels || [];

function nacht(dir, env = {}) {
  const aufrufe = join(dir, "aufrufe.log");
  const fake = `node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review`;
  const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake, NIGHT_TEST_AUFRUFE: aufrufe, ...env });
  const liste = existsSync(aufrufe) ? readFileSync(aufrufe, "utf-8").trim().split("\n").filter(Boolean).map((z) => JSON.parse(z)) : [];
  rmSync(aufrufe, { force: true });
  return { res, aufrufe: liste };
}

/** Die schreibenden Board-Aufrufe an einer Karte, in ihrer Reihenfolge, je als Kurzform. */
const schreibende = (aufrufe, id) => aufrufe
  .filter((a) => a[0] === "issue" && ["move", "label", "comment"].includes(a[1]))
  .filter((a) => (a[1] === "label" ? a[3] : a[2]) === id)
  .map(kurzform);

function kurzform(a) {
  if (a[1] === "label") return `label ${a[2]} ${a[4]}`;
  if (a[1] === "move") return `move ${a[3]}`;
  return "comment";
}

// --- Treffer ---

test("Treffer: das Paket wird nach Backlog geschoben, gezeichnet und genau einmal kommentiert", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const geschuetzt = readyPaket(dir, "Paket mit geschuetzter Datei", paketBody(PFAD));
    const normal = readyPaket(dir, "Normales Paket", paketBody("kit/board.mjs"));

    const { res, aufrufe } = nacht(dir);
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    assert.equal(spalte(dir, geschuetzt), "backlog");
    assert.ok(labels(dir, geschuetzt).includes("kit:geschuetzt"), "kit:geschuetzt fehlt am Paket");
    assert.deepEqual(schreibende(aufrufe, geschuetzt), ["move backlog", "label add kit:geschuetzt", "comment"],
      "Reihenfolge nach E11: Move, label add, dann Kommentar");

    const ks = kommentare(issueText(dir, geschuetzt));
    assert.equal(ks.length, 1, `genau ein Kommentar erwartet, gefunden: ${JSON.stringify(ks)}`);
    const zeile = `In \`${PFAD}\` den Eintrag ergaenzen.`;
    const treffer = boardModul.geschuetzteTreffer(paketBody(PFAD), "Paket mit geschuetzter Datei", dir);
    assert.equal(ks[0], `${boardModul.geschuetztKommentar(treffer)}\n\nLabel kit:geschuetzt gesetzt`);
    assert.match(ks[0], /^## Geschuetzte Datei$/m);
    assert.ok(ks[0].includes(`- \`${PFAD}\``), "Backtick-Liste fehlt");

    // Logzeile: Pfad, zitierte Zeile, Handlung.
    const logzeile = res.stdout.split("\n").find((z) => z.includes(`#${geschuetzt} angehalten`));
    assert.ok(logzeile, `keine Logzeile zum Halt:\n${res.stdout}`);
    assert.ok(logzeile.includes(PFAD), "Logzeile nennt den Pfad nicht");
    assert.ok(logzeile.includes(zeile), "Logzeile zitiert die Zeile nicht");
    assert.match(logzeile, /ein Mensch/);

    // Die uebrigen Pakete laufen weiter.
    assert.equal(spalte(dir, normal), "in_review");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Gegenprobe ---

test("Gegenprobe: ein Paket ohne geschuetzten Pfad bekommt seine Session", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const normal = readyPaket(dir, "Normales Paket", paketBody("kit/board.mjs"));
    const { res, aufrufe } = nacht(dir);
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.equal(spalte(dir, normal), "in_review");
    assert.ok(!aufrufe.some((a) => a[1] === "label" && a[4] === "kit:geschuetzt"), "ohne Treffer kein Label");
    assert.ok(!labels(dir, normal).includes("kit:geschuetzt"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Board ohne Label ---

test("Board ohne Label: Move und Kommentar stehen trotzdem, der Lauf geht weiter, der naechste Anlauf haelt erneut", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const geschuetzt = readyPaket(dir, "Paket mit geschuetzter Datei", paketBody(PFAD));
    const normal = readyPaket(dir, "Normales Paket", paketBody("kit/board.mjs"));

    const { res, aufrufe } = nacht(dir, { NIGHT_TEST_LABEL_SCHEITERT: "1" });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.equal(spalte(dir, geschuetzt), "backlog");
    assert.ok(!labels(dir, geschuetzt).includes("kit:geschuetzt"));
    assert.deepEqual(schreibende(aufrufe, geschuetzt), ["move backlog", "label add kit:geschuetzt", "comment"]);
    const ks = kommentare(issueText(dir, geschuetzt));
    assert.equal(ks.length, 1);
    assert.ok(ks[0].endsWith("\n\nLabel kit:geschuetzt nicht gesetzt"), ks[0]);
    assert.match(res.stdout, /Label kit:geschuetzt nicht gesetzt.*am Board nicht angelegt/);
    assert.equal(spalte(dir, normal), "in_review", "der Lauf lief nicht weiter");

    // Ohne Handlung eines Menschen: wieder nach Ready, und es haelt erneut an.
    board(dir, "issue", "move", geschuetzt, "ready");
    const zweiter = nacht(dir);
    assert.equal(zweiter.res.status, 0, `zweiter Lauf schlug fehl: ${zweiter.res.stderr}`);
    assert.equal(spalte(dir, geschuetzt), "backlog");
    assert.deepEqual(schreibende(zweiter.aufrufe, geschuetzt), ["move backlog", "label add kit:geschuetzt", "comment"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Wiederaufnahme ---

/** Der Halt-Kommentar, wie ihn der Runner bei gesetztem Label schreibt. */
const haltKommentar = (dir, body, titel) =>
  `${boardModul.geschuetztKommentar(boardModul.geschuetzteTreffer(body, titel, dir))}\n\nLabel kit:geschuetzt gesetzt`;

test("Wiederaufnahme: Halt-Kommentar mit gesetztem Label, Label abgenommen — das Paket laeuft durch", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const body = paketBody(PFAD);
    const id = readyPaket(dir, "Freigegebenes Paket", body);
    board(dir, "issue", "comment", id, "--text", haltKommentar(dir, body, "Freigegebenes Paket"));
    const { res } = nacht(dir);
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.equal(spalte(dir, id), "in_review");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Wiederaufnahme: eine Karte mit kit:geschuetzt wird uebersprungen, das Label bleibt", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const body = paketBody(PFAD);
    const id = readyPaket(dir, "Gezeichnetes Paket", body);
    board(dir, "issue", "comment", id, "--text", haltKommentar(dir, body, "Gezeichnetes Paket"));
    board(dir, "issue", "label", "add", id, "kit:geschuetzt");
    const { res, aufrufe } = nacht(dir);
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.equal(spalte(dir, id), "backlog");
    assert.ok(labels(dir, id).includes("kit:geschuetzt"), "der Lauf hat kit:geschuetzt entfernt");
    assert.ok(!aufrufe.some((a) => a[1] === "label" && a[2] === "remove"), "label remove kommt im Runner nicht vor");
    assert.match(res.stdout, new RegExp(`#${id} uebersprungen: traegt kit:geschuetzt`));
    const ks = kommentare(issueText(dir, id));
    assert.equal(ks.at(-1), nightModul.GESCHUETZT_LABEL_GATE_TEXT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Wiederaufnahme: ein weiterer, im Kommentar nicht genannter Pfad haelt erneut an", NUR_POSIX, () => {
  const dir = setupProjekt();
  try {
    const alt = paketBody(PFAD);
    const id = readyPaket(dir, "Ergaenztes Paket", paketBody(PFAD, ZWEITER_PFAD));
    board(dir, "issue", "comment", id, "--text", haltKommentar(dir, alt, "Ergaenztes Paket"));
    const { res, aufrufe } = nacht(dir);
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.equal(spalte(dir, id), "backlog");
    assert.ok(labels(dir, id).includes("kit:geschuetzt"));
    assert.deepEqual(schreibende(aufrufe, id), ["move backlog", "label add kit:geschuetzt", "comment"]);
    assert.ok(kommentare(issueText(dir, id)).at(-1).includes(`- \`${ZWEITER_PFAD}\``));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Gleichlauf der Konstanten ---

const KONSTANTEN = ["GESCHUETZT_LABEL", "GESCHUETZT_ANKER"];

function konstantenAbweichungen(nacht, brett) {
  return KONSTANTEN.filter((name) => nacht[name] === undefined || nacht[name] !== brett[name]);
}

test("Gleichlauf: GESCHUETZT_LABEL und GESCHUETZT_ANKER in night.mjs gleichen denen in board.mjs", () => {
  assert.deepEqual(konstantenAbweichungen(nightModul, boardModul), []);
  assert.equal(nightModul.GESCHUETZT_LABEL, "kit:geschuetzt");
  assert.equal(nightModul.GESCHUETZT_ANKER, "## Geschuetzte Datei");
});

test("Gleichlauf: eine abgewandelte Kopie der Konstanten faellt auf", () => {
  const kopie = { ...nightModul, GESCHUETZT_ANKER: "## Geschuetzte Dateien" };
  assert.deepEqual(konstantenAbweichungen(kopie, boardModul), ["GESCHUETZT_ANKER"]);
  const ohneLabel = { ...nightModul, GESCHUETZT_LABEL: "kit:geschützt" };
  assert.deepEqual(konstantenAbweichungen(ohneLabel, boardModul), ["GESCHUETZT_LABEL"]);
});

test("hatGeschuetztLabel erkennt das Label und nur es", () => {
  assert.equal(nightModul.hatGeschuetztLabel({ labels: ["kit:geschuetzt"] }), true);
  assert.equal(nightModul.hatGeschuetztLabel({ labels: ["kit:klaeren"] }), false);
  assert.equal(nightModul.hatGeschuetztLabel({}), false);
});

test("Der Runner nimmt kit:geschuetzt nie ab", () => {
  const quelle = readFileSync(NIGHT, "utf-8");
  assert.doesNotMatch(quelle, /"label",\s*"remove",[^)]*GESCHUETZT_LABEL/);
  assert.doesNotMatch(quelle, /label remove[^\n]*kit:geschuetzt/);
});
