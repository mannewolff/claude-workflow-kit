// Journal, Lebenszeichen und Abbruch-Handler des Nachtlaufs (Issue #1084, Plan #1079 E5,
// E6, E8).
//
// Der Stand eines Laufs lebt nicht mehr nur im Prozess: Jeder Standwechsel geht zuerst
// als Zeile ins Journal `.claude/lauf/<lauf>.jsonl` und danach ans Board. Was das Board
// nicht annimmt, bleibt "offen" und wird beim naechsten Start nachgetragen. Daneben
// erneuert der Runner seine Puls-Datei, und ein Abbruch, den der Prozess noch bemerkt,
// hinterlaesst einen Stand.
//
// Geprueft am lokalen Tracker: die Bausteine direkt ueber ihre Exporte, Nachtrag, Puls
// und Handler ueber das echte CLI mit vorgetaeuschter Sitzung (NIGHT_CLAUDE_CMD).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { standSetzen, journalLesen, staendeNachtragen, nightStandLaden, boardUmgebung } from "../kit/night.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";

// Unter Windows ist SIGTERM nicht abfangbar: `kill` beendet den Runner dort hart, ohne dass
// sein Handler laeuft. Den Stand hinterlaesst dann der abgekoppelte Waechter (#1085, #1132),
// und genau das prueft der Signal-Test auf dieser Plattform.
const SIGTERM_ABFANGBAR = process.platform !== "win32";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");
const LAUF_ALT = "2026-09-30-010000";

function run(cwd, cmd, cliArgs, env = {}) {
  // NIGHT_VORFLUG_CMD: Die Kette startete sonst eine echte Vorflug-Session.
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, NIGHT_VORFLUG_CMD: "true", ...env } });
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

function zeilen(pfad) {
  return readFileSync(pfad, "utf-8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
}

function laufbericht(dir) {
  const name = readdirSync(join(dir, ".claude")).find((n) => /^night-run-.*\.json$/.test(n));
  assert.ok(name, "kein Laufbericht night-run-*.json");
  return JSON.parse(readFileSync(join(dir, ".claude", name), "utf-8"));
}

/** Ein Journal eines frueheren Laufs mit offenen Zeilen, wie es ein Board-Ausfall hinterlaesst. */
function altesJournal(dir, eintraege, { pid = 999999 } = {}) {
  const ordner = join(dir, ".claude", "lauf");
  mkdirSync(ordner, { recursive: true });
  const text = eintraege.map(([k, zustand, t], i) => JSON.stringify({ art: "stand", nr: i + 1, zeit: `2026-09-30T01:0${i}:00.000Z`, karte: k, zustand, text: t, status: "offen" })).join("\n");
  writeFileSync(join(ordner, `${LAUF_ALT}.jsonl`), `${text}\n`, "utf-8");
  writeFileSync(join(ordner, `${LAUF_ALT}.puls`), JSON.stringify({ zeit: "2026-09-30T01:05:00.000Z", pid }), "utf-8");
  return join(ordner, `${LAUF_ALT}.jsonl`);
}

test("standSetzen schreibt erst die Journalzeile, dann den Laufstand, und quittiert ihn", () => {
  const dir = setupProjekt();
  try {
    const id = karte(dir, "Paket");
    const ergebnis = standSetzen(id, "laeuft", "Zuletzt begonnen: Umsetzung um 01:00", { lauf: "2026-10-01-010000", repoRoot: dir });
    assert.equal(ergebnis, "geschrieben");
    const journal = journalLesen(join(dir, ".claude", "lauf", "2026-10-01-010000.jsonl"));
    assert.equal(journal.staende.length, 1);
    assert.equal(journal.staende[0].karte, id);
    assert.equal(journal.staende[0].zustand, "laeuft");
    assert.equal(journal.staende[0].status, "geschrieben");
    assert.deepEqual(board(dir, "issue", "get", id).labels, ["lauf:laeuft"]);
    assert.match(laufstaende(dir, id)[0], /Zuletzt begonnen: Umsetzung um 01:00/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scheitert der Board-Aufruf, bleibt die Journalzeile offen", () => {
  const dir = setupProjekt();
  try {
    const ergebnis = standSetzen("4711", "abgebrochen", "abgebrochen, Test", { lauf: "2026-10-01-010000", repoRoot: dir });
    assert.equal(ergebnis, "offen");
    const pfad = join(dir, ".claude", "lauf", "2026-10-01-010000.jsonl");
    const roh = zeilen(pfad);
    assert.equal(roh.length, 1, "keine Quittung fuer einen gescheiterten Aufruf");
    assert.equal(roh[0].status, "offen");
    assert.equal(journalLesen(pfad).staende[0].status, "offen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("staendeNachtragen laesst das Journal eines lebenden Laufs liegen", () => {
  const dir = setupProjekt();
  try {
    const id = karte(dir, "Paket");
    const pfad = altesJournal(dir, [[id, "laeuft", "Zuletzt begonnen: Plan"]], { pid: process.pid });
    assert.deepEqual(staendeNachtragen(dir), []);
    assert.equal(journalLesen(pfad).staende[0].status, "offen");
    assert.deepEqual(laufstaende(dir, id), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ein spaeter geschriebener Stand derselben Karte ueberholt eine offene Zeile", () => {
  const dir = setupProjekt();
  try {
    const id = karte(dir, "Paket");
    const pfad = altesJournal(dir, [[id, "laeuft", "alt"]]);
    writeFileSync(pfad, `${readFileSync(pfad, "utf-8")}${JSON.stringify({ art: "stand", nr: 2, zeit: "2026-09-30T01:09:00.000Z", karte: id, zustand: "fertig", text: "neu", status: "offen" })}\n${JSON.stringify({ art: "quittung", nr: 2 })}\n`);
    assert.deepEqual(staendeNachtragen(dir), [], "die alte Zeile darf den neueren Stand nicht ueberschreiben");
    assert.equal(journalLesen(pfad).staende[0].status, "ueberholt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("der naechste Start traegt offene Zeilen in derselben Reihenfolge nach", () => {
  const dir = setupProjekt();
  try {
    const a = karte(dir, "Erste");
    const b = karte(dir, "Zweite");
    const pfad = altesJournal(dir, [[b, "abgebrochen", "abgebrochen, SIGINT"], [a, "laeuft", "Zuletzt begonnen: Plan"]]);
    const res = run(dir, process.execPath, [NIGHT], { NIGHT_CLAUDE_CMD: "true" });
    assert.equal(res.status, 0, `night.mjs schlug fehl: ${res.stderr}\n${res.stdout}`);

    const quittungen = zeilen(pfad).filter((z) => z.art === "quittung").map((z) => z.nr);
    assert.deepEqual(quittungen, [1, 2], "nachgetragen in der Reihenfolge des Journals");
    assert.ok(journalLesen(pfad).staende.every((s) => s.status === "geschrieben"));
    assert.deepEqual(board(dir, "issue", "get", b).labels, ["lauf:abgebrochen"]);
    assert.deepEqual(board(dir, "issue", "get", a).labels, ["lauf:laeuft"]);
    assert.match(res.stdout, /Laufstand nachgetragen: #\d+ abgebrochen/);
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
    assert.equal(journalLesen(pfad).staende[0].status, "offen");
    const nachher = board(dir, "issue", "get", a);
    assert.deepEqual(nachher.labels, vorher.labels);
    assert.deepEqual(laufstaende(dir, a), []);
    assert.deepEqual(readdirSync(join(dir, ".claude", "lauf")).sort(), [`${LAUF_ALT}.jsonl`, `${LAUF_ALT}.puls`], "der Trockenlauf legt kein eigenes Journal an");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("night.stand mit pauseMin >= fristMin wird vor der ersten Session mit Feldnamen abgewiesen", () => {
  assert.deepEqual(nightStandLaden({}), { fristMin: 10, pauseMin: 5 });
  assert.deepEqual(nightStandLaden({ night: { stand: { fristMin: 20 } } }), { fristMin: 20, pauseMin: 5 });
  assert.match(nightStandLaden({ night: { stand: { fristMin: 5, pauseMin: 5 } } }).fehler, /night\.stand\.pauseMin.*night\.stand\.fristMin/);
  assert.match(nightStandLaden({ night: { stand: { fristMin: 0 } } }).fehler, /night\.stand\.fristMin/);
  assert.match(nightStandLaden({ night: { stand: { pauseMin: "5" } } }).fehler, /night\.stand\.pauseMin/);

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

test("boardUmgebung stellt ein ausdrueckliches Budget vor den Nachtwert", () => {
  assert.equal(boardUmgebung({}, 5000).KIT_TOOLBOX_BUDGET_MS, "5000");
  assert.equal(boardUmgebung({ KIT_TOOLBOX_BUDGET_MS: "90000" }, 5000).KIT_TOOLBOX_BUDGET_MS, "5000");
  assert.equal(boardUmgebung({ KIT_TOOLBOX_BUDGET_MS: "90000" }).KIT_TOOLBOX_BUDGET_MS, "90000");
});

function warteAuf(pruefung, ms = 15000) {
  const ende = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      const wert = pruefung();
      if (wert) { clearInterval(t); resolve(wert); } else if (Date.now() > ende) { clearInterval(t); reject(new Error("Zeit abgelaufen")); }
    }, 50);
  });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test("Puls wird erneuert, und SIGTERM hinterlaesst Journal, Kartenstand und Laufbericht", async () => {
  const dir = setupProjekt();
  let kind = null;
  try {
    const id = karte(dir, "Paket", ["kit:nightrun"]);
    board(dir, "issue", "move", id, "ready");
    // Die Sitzung meldet sich, traegt ihre Karte als laufend ins Journal ein (wie es die
    // Runde mit #1089 tun wird) und wartet dann, bis der Runner abgebrochen wird.
    const fake = String.raw`j=$(ls .claude/lauf/*.jsonl) && printf '{"art":"stand","nr":900,"karte":"%s","zustand":"laeuft","text":"x","status":"offen"}\n{"art":"quittung","nr":900}\n' "$NIGHT_ISSUE_ID" >> "$j" && touch marker && sleep 5`;
    kind = spawn(process.execPath, [NIGHT], {
      cwd: dir, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: dir, NIGHT_CLAUDE_CMD: fake, NIGHT_PULS_MS: "100", ...(SIGTERM_ABFANGBAR ? {} : { KIT_NIGHT_WAECHTER_FRIST_S: "1" }) },
    });
    let stdout = "";
    kind.stdout.on("data", (d) => { stdout += d; });
    kind.stderr.on("data", (d) => { stdout += d; });
    const ende = new Promise((resolve) => kind.on("exit", (code, signal) => resolve({ code, signal })));

    await warteAuf(() => existsSync(join(dir, "marker")));
    const pulsPfad = join(dir, ".claude", "lauf", readdirSync(join(dir, ".claude", "lauf")).find((n) => n.endsWith(".puls")));
    const erster = JSON.parse(readFileSync(pulsPfad, "utf-8"));
    assert.equal(erster.pid, kind.pid);
    await pause(400);
    const zweiter = JSON.parse(readFileSync(pulsPfad, "utf-8"));
    assert.ok(Date.parse(zweiter.zeit) > Date.parse(erster.zeit), `Puls nicht erneuert: ${erster.zeit} -> ${zweiter.zeit}`);

    kind.kill("SIGTERM");
    const { code } = await ende;
    kind = null;
    if (!SIGTERM_ABFANGBAR) {
      await warteAuf(() => laufbericht(dir).abschluss === "verstummt");
      assert.deepEqual(board(dir, "issue", "get", id).labels.filter((l) => l.startsWith("lauf:")), ["lauf:abgebrochen"]);
      assert.match(laufstaende(dir, id).at(-1), /nicht beendet, letztes Lebenszeichen/);
      return;
    }
    assert.equal(code, 143, stdout);

    const journalName = readdirSync(join(dir, ".claude", "lauf")).find((n) => n.endsWith(".jsonl"));
    const eintraege = zeilen(join(dir, ".claude", "lauf", journalName));
    assert.ok(eintraege.some((z) => z.art === "lauf" && z.text === "abgebrochen, SIGTERM"), JSON.stringify(eintraege));
    assert.equal(laufbericht(dir).abschluss, "abgebrochen");
    assert.deepEqual(board(dir, "issue", "get", id).labels.filter((l) => l.startsWith("lauf:")), ["lauf:abgebrochen"]);
    assert.match(laufstaende(dir, id)[0], /abgebrochen, SIGTERM/);
  } finally {
    if (kind) kind.kill("SIGKILL");
    await pause(100);
    rmSync(dir, { recursive: true, force: true });
  }
});
