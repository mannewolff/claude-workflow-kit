// Der Waechter eines Nachtlaufs (Issue #1085, Plan #1079 E7).
//
// Ein Lauf, der ohne Abschied stirbt (SIGKILL, Absturz), kann selbst nichts mehr
// schreiben. Beim Laufbeginn startet der Runner deshalb den abgekoppelten Kindprozess
// `night.mjs --waechter <lauf>`. Der gilt den Lauf als verstummt, wenn der Puls aelter als
// die Frist ist UND die PID des Runners nicht mehr lebt, setzt dann jede laufende Karte
// auf `abgebrochen`, traegt offene Journalzeilen nach und schreibt `abschluss: "verstummt"`
// in den Laufbericht. Einen Neustart gibt es nicht.
//
// Geprueft am lokalen Tracker mit kurzer Frist (KIT_NIGHT_WAECHTER_FRIST_S) und
// vorgetaeuschter Sitzung (NIGHT_CLAUDE_CMD). Unter Windows laeuft die Sitzung ueber die
// Git Bash (#1131), und der Waechter startet abgekoppelt und ohne Fenster (#1132).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { waechterStartOptionen } from "../kit/night.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const LAUF = "2026-09-30-010000";
const FRIST_S = "1";

const basisEnv = (dir, extra = {}) => ({ ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: dir, NIGHT_VORFLUG_CMD: "true", KIT_NIGHT_WAECHTER_FRIST_S: FRIST_S, ...extra });

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: basisEnv(cwd, env) });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt() {
  const dir = mkdtempSync(join(tmpdir(), "night-waechter-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
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

function warteAuf(pruefung, ms = 20000) {
  const ende = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      let wert;
      try { wert = pruefung(); } catch { wert = false; }
      if (wert) { clearInterval(t); resolve(wert); } else if (Date.now() > ende) { clearInterval(t); reject(new Error("Zeit abgelaufen")); }
    }, 100);
  });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ein Lauf, wie ihn ein gestorbener Runner hinterlaesst: Journal, alter Puls, offener Laufbericht. */
function hinterlassenerLauf(dir, eintraege, { pid, quittiert = [] }) {
  const ordner = join(dir, ".claude", "lauf");
  mkdirSync(ordner, { recursive: true });
  const text = [
    JSON.stringify({ art: "lauf", zeit: "2026-09-30T01:00:00.000Z", pid, text: "begonnen" }),
    ...eintraege.map(([k, zustand, t], i) => JSON.stringify({ art: "stand", nr: i + 1, zeit: `2026-09-30T01:0${i}:00.000Z`, karte: k, zustand, text: t, status: "offen" })),
    ...quittiert.map((nr) => JSON.stringify({ art: "quittung", nr })),
  ].join("\n");
  writeFileSync(join(ordner, `${LAUF}.jsonl`), `${text}\n`, "utf-8");
  writeFileSync(join(ordner, `${LAUF}.puls`), JSON.stringify({ zeit: "2026-09-30T01:05:00.000Z", pid }), "utf-8");
  writeFileSync(join(dir, ".claude", `night-run-${LAUF}.json`), JSON.stringify({ schemaFassung: 1, start: "2026-09-30T01:00:00.000Z", art: "implementierung", einheiten: [], abschluss: null, complete: false }, null, 2), "utf-8");
  return join(ordner, `${LAUF}.jsonl`);
}

function starteWaechter(dir) {
  const kind = spawn(process.execPath, [NIGHT, "--waechter", LAUF], { cwd: dir, stdio: "ignore", env: basisEnv(dir) });
  const ende = new Promise((resolve) => kind.on("exit", (code) => resolve(code)));
  return { kind, ende };
}

test("der Waechter startet abgekoppelt und ohne Fenster", () => {
  // `detached` auch unter Windows: Dort endete ein nicht abgekoppeltes Kind mit dem
  // Job-Objekt des Runners, also genau dann, wenn der Waechter gebraucht wird.
  assert.deepEqual(waechterStartOptionen("/repo"), { cwd: "/repo", detached: true, stdio: "ignore", windowsHide: true });
});

test("Belegfall 1: nach SIGKILL auf den Runner steht die Karte binnen Frist plus Pruefakt auf abgebrochen", async () => {
  const dir = setupProjekt();
  let runner = null;
  let pid = null;
  try {
    const id = karte(dir, "Paket", ["kit:nightrun"]);
    board(dir, "issue", "move", id, "ready");
    // Die Sitzung traegt ihre Karte als laufend ein (wie es die Runde mit #1089 tun wird)
    // und wartet; der Runner stirbt waehrenddessen ohne Abschied.
    const fake = String.raw`j=$(ls .claude/lauf/*.jsonl) && printf '{"art":"stand","nr":900,"karte":"%s","zustand":"laeuft","text":"x","status":"offen"}\n{"art":"quittung","nr":900}\n' "$NIGHT_ISSUE_ID" >> "$j" && touch marker && sleep 3`;
    runner = spawn(process.execPath, [NIGHT], { cwd: dir, stdio: "ignore", env: basisEnv(dir, { NIGHT_CLAUDE_CMD: fake, NIGHT_PULS_MS: "100" }) });
    await warteAuf(() => existsSync(join(dir, "marker")));
    pid = waechterPid(dir);
    assert.ok(Number.isInteger(pid) && lebt(pid), "der Runner hat keinen lebenden Waechter gestartet");
    runner.kill("SIGKILL");
    runner = null;
    const getoetet = Date.now();

    await warteAuf(() => lauflabels(dir, id).includes("lauf:abgebrochen"));
    const dauerS = (Date.now() - getoetet) / 1000;
    // Frist eine Sekunde, Pruefakt eine Sekunde, dazu der Start der Board-Aufrufe.
    assert.ok(dauerS < 10, `zu spaet: ${dauerS} s`);
    assert.match(laufstaende(dir, id).at(-1), /nicht beendet, letztes Lebenszeichen \d{4}-\d\d-\d\dT[\d:.]+Z, Frist 1 s/);
    await warteAuf(() => laufbericht(dir).abschluss === "verstummt");
    await warteAuf(() => !lebt(pid), 5000);
    pid = null;
    assert.equal(laufberichte(dir).length, 1, "ein neuer Lauf darf nicht entstehen");
    assert.equal(readdirSync(join(dir, ".claude", "lauf")).filter((n) => n.endsWith(".jsonl")).length, 1);
  } finally {
    if (runner) runner.kill("SIGKILL");
    if (pid && lebt(pid)) process.kill(pid, "SIGKILL");
    await pause(3500);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("alter Puls, aber lebende PID: der Waechter setzt nichts auf abgebrochen", async () => {
  const dir = setupProjekt();
  const { kind, ende } = (() => {
    const id = karte(dir, "Paket");
    hinterlassenerLauf(dir, [[id, "laeuft", "Zuletzt begonnen: Umsetzung"]], { pid: process.pid, quittiert: [1] });
    return { ...starteWaechter(dir), id };
  })();
  try {
    await pause(3500);
    assert.ok(lebt(kind.pid), "der Waechter endete, obwohl der Runner lebt");
    assert.equal(laufbericht(dir).abschluss, null);
    const journal = readdirSync(join(dir, ".claude", "lauf")).find((n) => n.endsWith(".jsonl"));
    assert.ok(zeilen(join(dir, ".claude", "lauf", journal)).every((z) => z.zustand !== "abgebrochen"));
  } finally {
    kind.kill("SIGTERM");
    await ende;
    assert.ok(!lebt(kind.pid));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("der Waechter traegt offene Journalzeilen nach und schliesst den Lauf als verstummt", async () => {
  const dir = setupProjekt();
  try {
    const a = karte(dir, "Laufend");
    const b = karte(dir, "Fertig, aber nicht geschrieben");
    hinterlassenerLauf(dir, [[a, "laeuft", "Zuletzt begonnen: Umsetzung"], [b, "fertig", "Zuletzt abgeschlossen: Umsetzung"]], { pid: 999999, quittiert: [1] });
    const { kind, ende } = starteWaechter(dir);
    const code = await Promise.race([ende, pause(15000).then(() => "zeit")]);
    if (code === "zeit") kind.kill("SIGKILL");
    assert.equal(code, 0);
    assert.deepEqual(lauflabels(dir, a), ["lauf:abgebrochen"]);
    assert.deepEqual(lauflabels(dir, b), [], "fertig traegt kein Label");
    assert.match(laufstaende(dir, b).at(-1), /Zuletzt abgeschlossen: Umsetzung/);
    assert.match(laufstaende(dir, a).at(-1), /nicht beendet, letztes Lebenszeichen 2026-09-30T01:05:00\.000Z, Frist 1 s/);
    const bericht = laufbericht(dir);
    assert.equal(bericht.abschluss, "verstummt");
    assert.match(bericht.fehlerText, /nicht beendet/);
    const journal = zeilen(join(dir, ".claude", "lauf", `${LAUF}.jsonl`));
    assert.ok(journal.some((z) => z.art === "lauf" && /^verstummt, nicht beendet/.test(z.text)), JSON.stringify(journal));
  } finally {
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
    await warteAuf(() => !lebt(pid), 5000);
    pid = null;
    assert.equal(laufbericht(dir).abschluss, "regulaer");
  } finally {
    if (pid && lebt(pid)) process.kill(pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("KIT_NIGHT_WAECHTER=0 unterdrueckt den Start", () => {
  const dir = setupProjekt();
  try {
    const res = run(dir, process.execPath, [NIGHT], { NIGHT_CLAUDE_CMD: "true", KIT_NIGHT_WAECHTER: "0" });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.equal(waechterPid(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Rueckfall beim Start: ein verwaister Lauf ohne lebenden Runner wird wie verstummt behandelt", () => {
  const dir = setupProjekt();
  try {
    const a = karte(dir, "Laufend");
    hinterlassenerLauf(dir, [[a, "laeuft", "Zuletzt begonnen: Umsetzung"]], { pid: 999999, quittiert: [1] });
    const res = run(dir, process.execPath, [NIGHT], { NIGHT_CLAUDE_CMD: "true", KIT_NIGHT_WAECHTER: "0" });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);
    assert.deepEqual(lauflabels(dir, a), ["lauf:abgebrochen"]);
    assert.match(laufstaende(dir, a).at(-1), /nicht beendet, letztes Lebenszeichen 2026-09-30T01:05:00\.000Z/);
    const alt = JSON.parse(readFileSync(join(dir, ".claude", `night-run-${LAUF}.json`), "utf-8"));
    assert.equal(alt.abschluss, "verstummt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
