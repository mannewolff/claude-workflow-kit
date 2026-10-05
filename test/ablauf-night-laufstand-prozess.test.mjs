// Ablauf-Pruefung: Ein echtes Signal, ein abgekoppelter Waechter, der den gestorbenen Runner ueberlebt, und die Schritte, die main() des Einstiegs beim Start ausloest, zeigen sich nur am laufenden Runner.
//
// Laufstand, Puls, Abbruch und Waechter des Nachtlaufs als Prozess (Issue #1084, #1085,
// Plan #1079 E5-E8). Die Bausteine selbst prueft night-laufstand-*.test.mjs im selben
// Prozess gegen kit/night/laufstand.mjs (Issue #1225); hier bleibt, was nur der Runner als
// Ganzes zeigt:
//
//   - SIGTERM erreicht den Handler, und der Puls schlaegt im Takt.
//   - Nach SIGKILL auf den Runner schliesst der Waechter den Lauf binnen Frist plus Pruefakt.
//   - Ein regulaerer Abschluss beendet den Waechter.
//   - Der Start traegt offene Journalzeilen nach und schliesst verwaiste Laeufe ab, der
//     Trockenlauf nicht; ein unbrauchbarer Block night.stand haelt vor der ersten Session an.
//
// Geprueft am lokalen Tracker mit vorgetaeuschter Sitzung (NIGHT_CLAUDE_CMD). Die Sitzung,
// waehrend der der Runner stirbt, haengt: Der Test bricht sie ab und wartet nicht auf sie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { lfAttribute } from "./helpers/zeilenenden.mjs";

// Unter Windows ist SIGTERM nicht abfangbar: `kill` beendet den Runner dort hart, ohne dass
// sein Handler laeuft. Den Stand hinterlaesst dann der abgekoppelte Waechter (#1085, #1132),
// und genau das prueft der Signal-Test auf dieser Plattform.
const SIGTERM_ABFANGBAR = process.platform !== "win32";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const LAUF_ALT = "2026-09-30-010000";

const basisEnv = (dir, extra = {}) => ({ ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: dir, NIGHT_VORFLUG_CMD: "true", NIGHT_BESTAETIGUNG_MS: "0", ...extra });

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: basisEnv(cwd, env) });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(extraConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-laufstand-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" }, ...extraConfig,
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\nsessions.log\nmarker\n");
  lfAttribute(join(dir, ".gitattributes"));
  for (const a of [["init", "-q"], ["config", "user.email", "test@example.invalid"], ["config", "user.name", "Night Test"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    const res = run(dir, "git", a);
    assert.equal(res.status, 0, `git ${a.join(" ")} schlug fehl: ${res.stderr}`);
  }
  return dir;
}

function karte(dir, titel, labels = []) {
  const { id } = board(dir, "issue", "create", "--title", titel, "--body", "## Abhaengigkeiten\nKeine.");
  if (labels.length > 0) {
    const datei = join(dir, "issues", `${id}.md`);
    writeFileSync(datei, readFileSync(datei, "utf-8").replace(/\n---\n/, `\nlabels: ${labels.join(",")}\n---\n`), "utf-8");
  }
  return id;
}

/** Die Laufstand-Kommentare einer Karte — der lokale Tracker haengt Kommentare an die Datei an. */
const laufstaende = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8")
  .split("\n---\n**Kommentar**").slice(1).filter((b) => /\n## Laufstand\b/.test(b));

const lauflabels = (dir, id) => board(dir, "issue", "get", id).labels.filter((l) => l.startsWith("lauf:"));

function zeilen(pfad) {
  return readFileSync(pfad, "utf-8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
}

const laufberichte = (dir) => readdirSync(join(dir, ".claude")).filter((n) => /^night-run-.*\.json$/.test(n));

function laufbericht(dir) {
  const [name] = laufberichte(dir);
  assert.ok(name, "kein Laufbericht night-run-*.json");
  return JSON.parse(readFileSync(join(dir, ".claude", name), "utf-8"));
}

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/** Die gemerkte PID des Waechters aus dem Journal eines Laufs; `null` ohne Waechter. */
function waechterPid(dir) {
  const ordner = join(dir, ".claude", "lauf");
  if (!existsSync(ordner)) return null;
  for (const name of readdirSync(ordner).filter((n) => n.endsWith(".jsonl"))) {
    const zeile = zeilen(join(ordner, name)).find((z) => z.art === "lauf" && Number.isInteger(z.waechterPid));
    if (zeile) return zeile.waechterPid;
  }
  return null;
}

/** Wartet, bis `bedingung` wahr ist; nach `ms` scheitert der Test mit `meldung`. */
async function warteAuf(bedingung, meldung, ms = 20_000) {
  const ende = Date.now() + ms;
  for (;;) {
    let wert;
    try { wert = bedingung(); } catch { wert = false; }
    if (wert) return wert;
    if (Date.now() > ende) assert.fail(`Zeit abgelaufen: ${meldung}`);
    await new Promise((weiter) => setTimeout(weiter, 50));
  }
}

/** Ein Journal eines frueheren Laufs mit offenen Zeilen, wie es ein Board-Ausfall hinterlaesst. */
function altesJournal(dir, eintraege, { pid = 999999, quittiert = [] } = {}) {
  const ordner = join(dir, ".claude", "lauf");
  mkdirSync(ordner, { recursive: true });
  const text = [
    ...eintraege.map(([k, zustand, t], i) => JSON.stringify({ art: "stand", nr: i + 1, zeit: `2026-09-30T01:0${i}:00.000Z`, karte: k, zustand, text: t, status: "offen" })),
    ...quittiert.map((nr) => JSON.stringify({ art: "quittung", nr })),
  ].join("\n");
  writeFileSync(join(ordner, `${LAUF_ALT}.jsonl`), `${text}\n`, "utf-8");
  writeFileSync(join(ordner, `${LAUF_ALT}.puls`), JSON.stringify({ zeit: "2026-09-30T01:05:00.000Z", pid }), "utf-8");
  return join(ordner, `${LAUF_ALT}.jsonl`);
}

/**
 * Die Sitzung traegt ihre Karte als laufend ins Journal ein (wie es die Runde tut) und haengt
 * dann, bis der Test den Runner abbricht.
 */
const HAENGENDE_SITZUNG = String.raw`j=$(ls .claude/lauf/*.jsonl) && printf '{"art":"stand","nr":900,"karte":"%s","zustand":"laeuft","text":"x","status":"offen"}\n{"art":"quittung","nr":900}\n' "$NIGHT_ISSUE_ID" >> "$j" && touch marker && sleep 5 # haengt`;

/** Startet den Runner im Hintergrund; `ende` erfuellt sich mit Exit-Code und Signal. */
function starteRunner(dir, env) {
  const kind = spawn(process.execPath, [NIGHT], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: basisEnv(dir, env) });
  let ausgabe = "";
  kind.stdout.on("data", (d) => { ausgabe += d; });
  kind.stderr.on("data", (d) => { ausgabe += d; });
  const ende = new Promise((resolve) => kind.on("exit", (code, signal) => resolve({ code, signal })));
  return { kind, ende, ausgabe: () => ausgabe };
}

test("Puls wird erneuert, und SIGTERM hinterlaesst Journal, Kartenstand und Laufbericht", async () => {
  const dir = setupProjekt();
  let runner = null;
  try {
    const id = karte(dir, "Paket", ["kit:nightrun"]);
    board(dir, "issue", "move", id, "ready");
    runner = starteRunner(dir, { NIGHT_CLAUDE_CMD: HAENGENDE_SITZUNG, NIGHT_PULS_MS: "100", ...(SIGTERM_ABFANGBAR ? {} : { KIT_NIGHT_WAECHTER_FRIST_S: "1" }) });

    await warteAuf(() => existsSync(join(dir, "marker")), "die Sitzung meldete sich nicht");
    const pulsPfad = join(dir, ".claude", "lauf", readdirSync(join(dir, ".claude", "lauf")).find((n) => n.endsWith(".puls")));
    const erster = JSON.parse(readFileSync(pulsPfad, "utf-8"));
    assert.equal(erster.pid, runner.kind.pid);
    await warteAuf(() => Date.parse(JSON.parse(readFileSync(pulsPfad, "utf-8")).zeit) > Date.parse(erster.zeit), `Puls nicht erneuert seit ${erster.zeit}`);

    runner.kind.kill("SIGTERM");
    const { code } = await runner.ende;
    const ausgabe = runner.ausgabe();
    runner = null;
    if (!SIGTERM_ABFANGBAR) {
      await warteAuf(() => laufbericht(dir).abschluss === "verstummt", "der Waechter schloss den Lauf nicht ab");
      assert.deepEqual(lauflabels(dir, id), ["lauf:abgebrochen"]);
      assert.match(laufstaende(dir, id).at(-1), /nicht beendet, letztes Lebenszeichen/);
      return;
    }
    assert.equal(code, 143, ausgabe);

    const journalName = readdirSync(join(dir, ".claude", "lauf")).find((n) => n.endsWith(".jsonl"));
    const eintraege = zeilen(join(dir, ".claude", "lauf", journalName));
    assert.ok(eintraege.some((z) => z.art === "lauf" && z.text === "abgebrochen, SIGTERM"), JSON.stringify(eintraege));
    assert.equal(laufbericht(dir).abschluss, "abgebrochen");
    assert.deepEqual(lauflabels(dir, id), ["lauf:abgebrochen"]);
    assert.match(laufstaende(dir, id)[0], /abgebrochen, SIGTERM/);
  } finally {
    if (runner) {
      runner.kind.kill("SIGKILL");
      await runner.ende;
    }
    const pid = waechterPid(dir);
    if (pid && lebt(pid)) process.kill(pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Belegfall 1: nach SIGKILL auf den Runner steht die Karte binnen Frist plus Pruefakt auf abgebrochen", async () => {
  const dir = setupProjekt();
  let runner = null;
  let pid = null;
  try {
    const id = karte(dir, "Paket", ["kit:nightrun"]);
    board(dir, "issue", "move", id, "ready");
    runner = starteRunner(dir, { NIGHT_CLAUDE_CMD: HAENGENDE_SITZUNG, NIGHT_PULS_MS: "100", KIT_NIGHT_WAECHTER_FRIST_S: "1" });
    await warteAuf(() => existsSync(join(dir, "marker")), "die Sitzung meldete sich nicht");
    pid = waechterPid(dir);
    assert.ok(Number.isInteger(pid) && lebt(pid), "der Runner hat keinen lebenden Waechter gestartet");
    runner.kind.kill("SIGKILL");
    await runner.ende;
    runner = null;
    const getoetet = Date.now();

    await warteAuf(() => lauflabels(dir, id).includes("lauf:abgebrochen"), "der Waechter setzte die Karte nicht auf abgebrochen");
    const dauerS = (Date.now() - getoetet) / 1000;
    // Frist eine Sekunde, Pruefakt eine Sekunde, dazu der Start der Board-Aufrufe.
    assert.ok(dauerS < 10, `zu spaet: ${dauerS} s`);
    assert.match(laufstaende(dir, id).at(-1), /nicht beendet, letztes Lebenszeichen \d{4}-\d\d-\d\dT[\d:.]+Z, Frist 1 s/);
    await warteAuf(() => laufbericht(dir).abschluss === "verstummt", "der Laufbericht wurde nicht abgeschlossen");
    await warteAuf(() => !lebt(pid), "der Waechter endete nicht", 5000);
    pid = null;
    assert.equal(laufberichte(dir).length, 1, "ein neuer Lauf darf nicht entstehen");
    assert.equal(readdirSync(join(dir, ".claude", "lauf")).filter((n) => n.endsWith(".jsonl")).length, 1);
  } finally {
    if (runner) {
      runner.kind.kill("SIGKILL");
      await runner.ende;
    }
    if (pid && lebt(pid)) process.kill(pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein regulaerer Abschluss beendet den Waechter", async () => {
  const dir = setupProjekt();
  let pid = null;
  try {
    const res = run(dir, process.execPath, [NIGHT], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    pid = waechterPid(dir);
    assert.ok(Number.isInteger(pid), "keine gemerkte Waechter-PID im Journal");
    await warteAuf(() => !lebt(pid), "der Waechter endete nicht", 5000);
    pid = null;
    assert.equal(laufbericht(dir).abschluss, "regulaer");
  } finally {
    if (pid && lebt(pid)) process.kill(pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("der naechste Start traegt offene Zeilen in derselben Reihenfolge nach", () => {
  const dir = setupProjekt();
  try {
    const a = karte(dir, "Erste");
    const b = karte(dir, "Zweite");
    const pfad = altesJournal(dir, [[b, "abgebrochen", "abgebrochen, SIGINT"], [a, "laeuft", "Zuletzt begonnen: Plan"]]);
    const res = run(dir, process.execPath, [NIGHT], { NIGHT_CLAUDE_CMD: "true", KIT_NIGHT_WAECHTER: "0" });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    const quittungen = zeilen(pfad).filter((z) => z.art === "quittung").map((z) => z.nr);
    assert.deepEqual(quittungen, [1, 2], "nachgetragen in der Reihenfolge des Journals");
    assert.deepEqual(lauflabels(dir, b), ["lauf:abgebrochen"]);
    assert.deepEqual(lauflabels(dir, a), ["lauf:laeuft"]);
    assert.match(res.stdout, /Laufstand nachgetragen: #\d+ abgebrochen/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Rueckfall beim Start: ein verwaister Lauf ohne lebenden Runner wird wie verstummt behandelt", () => {
  const dir = setupProjekt();
  try {
    const a = karte(dir, "Laufend");
    altesJournal(dir, [[a, "laeuft", "Zuletzt begonnen: Umsetzung"]], { quittiert: [1] });
    writeFileSync(join(dir, ".claude", `night-run-${LAUF_ALT}.json`), JSON.stringify({ schemaFassung: 1, art: "implementierung", einheiten: [], abschluss: null, complete: false }), "utf-8");
    const res = run(dir, process.execPath, [NIGHT], { NIGHT_CLAUDE_CMD: "true", KIT_NIGHT_WAECHTER: "0" });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.deepEqual(lauflabels(dir, a), ["lauf:abgebrochen"]);
    assert.match(laufstaende(dir, a).at(-1), /nicht beendet, letztes Lebenszeichen 2026-09-30T01:05:00\.000Z/);
    const alt = JSON.parse(readFileSync(join(dir, ".claude", `night-run-${LAUF_ALT}.json`), "utf-8"));
    assert.equal(alt.abschluss, "verstummt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--kette --dry-run traegt nichts nach und veraendert weder Label noch Kommentar", () => {
  const dir = setupProjekt();
  try {
    const a = karte(dir, "Erste", ["kit:nightrun"]);
    const vorher = board(dir, "issue", "get", a);
    const pfad = altesJournal(dir, [[a, "abgebrochen", "abgebrochen, SIGINT"]]);
    const res = run(dir, process.execPath, [NIGHT, "--kette", "--dry-run"], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.equal(zeilen(pfad).filter((z) => z.art === "quittung").length, 0);
    assert.deepEqual(board(dir, "issue", "get", a).labels, vorher.labels);
    assert.deepEqual(laufstaende(dir, a), []);
    assert.deepEqual(readdirSync(join(dir, ".claude", "lauf")).sort(), [`${LAUF_ALT}.jsonl`, `${LAUF_ALT}.puls`], "der Trockenlauf legt kein eigenes Journal an");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("night.stand mit pauseMin >= fristMin haelt vor der ersten Session an", () => {
  const dir = setupProjekt({ night: { stand: { fristMin: 4, pauseMin: 6 } } });
  try {
    const id = karte(dir, "Paket", ["kit:nightrun"]);
    board(dir, "issue", "move", id, "ready");
    const sessionLog = join(dir, "sessions.log");
    const res = run(dir, process.execPath, [NIGHT], { NIGHT_CLAUDE_CMD: `echo x >> ${JSON.stringify(sessionLog)}` });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /night\.stand\.pauseMin \(6\) muss kleiner sein als night\.stand\.fristMin \(4\)/);
    assert.ok(!existsSync(sessionLog), "es haette keine Session laufen duerfen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
