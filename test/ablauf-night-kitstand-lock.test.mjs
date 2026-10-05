// Ablauf-Pruefung: Gleichzeitige Anlaeufe auf die Sperre brauchen getrennte Prozesse, und ob Kette und Umsetzungsnacht den Lock waehrend ihrer Sessions halten, zeigt nur der echte Runner.
//
// Der Umsetzungs-Lock im Lauf (Plan #691, E10; Issue #696).
//
// Kette und Umsetzungsnacht duerfen nebeneinander laufen, solange die Kette im Worktree
// baut. Unter Variante B baut ihre Umsetzungsstufe in der Hauptkopie — zwei Laeufe, die
// gleichzeitig in denselben Working Tree committen, hinterlassen einen Zustand, den
// morgens niemand entwirrt. Beide Betriebsarten nehmen deshalb vor ihrer ersten
// Umsetzungs-Session dieselbe Datei `.claude/night-umsetzung.lock` in der Hauptkopie.
//
// Die Einheit `umsetzungLockNehmen` belegt test/night-kitstand-lock.test.mjs im selben
// Prozess (Issue #1226). Hier bleiben die gleichzeitigen Anlaeufe aus getrennten Prozessen
// und der Lock am ECHTEN kit/night.mjs gegen ein Temp-Repo mit lokalem Tracker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UMSETZUNG_LOCK } from "../kit/night/grundlagen.mjs";
import {
  run, board, setupProjekt, mitProjekt, fachplan, umgebung, sessions, stand,
  fake, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG, durchziehen,
} from "./helpers/kette-fixture.mjs";

/** Die vier erzeugenden Stufen, wie sie jeder Ketten-Test braucht. */
const ERZEUGEN = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN };

/** Ein Fachplan mit beiden Labels: Kettenlabel und das Kennzeichen der Variante B. */
function fachplanB(dir) {
  const F = fachplan(dir, "[Fachlich] Ein Anliegen");
  durchziehen(dir, F);
  return F;
}

/** Der Pfad des Locks in einer Hauptkopie. */
function lockPfad(dir) {
  return join(dir, UMSETZUNG_LOCK);
}

/** Legt eine Lock-Datei mit dem gegebenen Inhalt an. */
function lockSchreiben(dir, inhalt) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(lockPfad(dir), String(inhalt), "utf-8");
}

/**
 * Die Id eines Prozesses, den es sicher nicht mehr gibt: ein node-Prozess, der seine
 * eigene Nummer meldet und danach beendet ist. Eine geratene Zahl koennte einem fremden
 * laufenden Prozess gehoeren. Nicht `sh -c 'echo $'`: In der Git Bash ist `$` eine
 * MSYS-Nummer und nicht die Windows-Prozess-Id (Issue #1134).
 */
function totePid() {
  const res = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf-8" });
  assert.equal(res.status, 0, "der Hilfsprozess lief nicht");
  const pid = Number(res.stdout.trim());
  assert.ok(Number.isInteger(pid) && pid > 0, `keine Prozess-Id: ${res.stdout}`);
  return pid;
}

/**
 * Die Fake-Zeile, die eine Umsetzungs-Session vor ihrer Arbeit die Lage aufnehmen
 * laesst: der Inhalt des Locks und der Stand von `git status --porcelain`, beides in
 * das ignorierte `helfer/`. Nur so laesst sich pruefen, was WAEHREND des Laufs gilt.
 */
function probe(dir) {
  const lock = JSON.stringify(join(dir, "helfer", "lock-probe.txt"));
  const status = JSON.stringify(join(dir, "helfer", "status-probe.txt"));
  return `cat .claude/night-umsetzung.lock > ${lock}; git status --porcelain > ${status}`;
}

/** Was die Probe der ersten Umsetzungs-Session gesehen hat. */
function probeStand(dir) {
  const lies = (name) => readFileSync(join(dir, "helfer", name), "utf-8");
  return { lock: lies("lock-probe.txt").trim(), status: lies("status-probe.txt") };
}

// --- Gleichzeitige Anlaeufe (Plan #1113, E9; Issue #1184) ---

/**
 * Laesst `anzahl` Prozesse gleichzeitig `umsetzungLockNehmen(dir)` rufen und liefert ihre
 * Ergebnisse. Jeder Prozess laedt erst das Kit und meldet sich bereit; erst wenn alle bereit
 * sind, gibt eine Startdatei sie frei, auf die sie im Leerlauf warten — so treffen die
 * Anlaeufe so dicht wie moeglich aufeinander. Danach bleiben alle am Leben, bis jeder sein
 * Ergebnis gemeldet hat: Ein Halter, der vorher endet, hinterliesse einen verwaisten Lock,
 * und der zweite Anlauf naehme ihn zu Recht. Das Ende gibt der Test, indem er stdin der
 * Anlaeufe schliesst — sie warten darauf ohne Pause (Plan #1199, E7).
 */
async function gleichzeitig(dir, anzahl) {
  const start = join(dir, "start.signal");
  const kit = new URL("../kit/night/kitstand.mjs", import.meta.url).href;
  const skript = [
    `import { umsetzungLockNehmen } from ${JSON.stringify(kit)};`,
    `import { existsSync } from "node:fs";`,
    `const [dir, start] = process.argv.slice(1);`,
    `process.stdout.write("bereit\\n");`,
    `while (!existsSync(start)) {}`,
    `const r = umsetzungLockNehmen(dir);`,
    `process.stdout.write(JSON.stringify({ ok: r.ok, art: r.art ?? null }) + "\\n");`,
    `process.stdin.on("end", () => process.exit(0));`,
    `process.stdin.resume();`,
  ].join("\n");
  const kinder = Array.from({ length: anzahl }, () => {
    const kind = spawn(process.execPath, ["--input-type=module", "-e", skript, dir, start], { stdio: ["pipe", "pipe", "pipe"] });
    const zustand = { kind, zeilen: [], fehler: "" };
    let puffer = "";
    kind.stdout.on("data", (d) => {
      puffer += d;
      const teile = puffer.split("\n");
      puffer = teile.pop();
      zustand.zeilen.push(...teile);
    });
    kind.stderr.on("data", (d) => { zustand.fehler += d; });
    zustand.beendet = new Promise((ok) => kind.on("close", ok));
    return zustand;
  });
  const warteAufMeldung = async (bedingung) => {
    const frist = Date.now() + 30_000;
    while (!bedingung()) {
      for (const k of kinder) assert.equal(k.kind.exitCode, null, `ein Anlauf endete vorzeitig: ${k.fehler}`);
      assert.ok(Date.now() < frist, "die Anlaeufe meldeten sich nicht");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  try {
    await warteAufMeldung(() => kinder.every((k) => k.zeilen.length >= 1));
    writeFileSync(start, "");
    await warteAufMeldung(() => kinder.every((k) => k.zeilen.length >= 2));
    return kinder.map((k) => JSON.parse(k.zeilen[1]));
  } finally {
    for (const k of kinder) k.kind.stdin.end();
    await Promise.all(kinder.map((k) => k.beendet));
  }
}

/** Ein leeres Temp-Verzeichnis fuer asynchrone Einheitstests. */
async function mitOrdnerAsync(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-lock-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Wie oft ein Gleichzeitigkeits-Fall laeuft: Ein Rennen, das einmal gut ausgeht, beweist wenig. */
const RUNDEN = 8;

test("[night-35] zwei gleichzeitige Anlaeufe gegen eine freie Sperre: genau einer bekommt sie", async () => {
  for (let runde = 0; runde < RUNDEN; runde++) {
    await mitOrdnerAsync(async (dir) => {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      const ergebnisse = await gleichzeitig(dir, 2);
      assert.equal(ergebnisse.filter((r) => r.ok).length, 1, `Runde ${runde}: ${JSON.stringify(ergebnisse)}`);
      assert.deepEqual(ergebnisse.filter((r) => !r.ok).map((r) => r.art), ["belegt"]);
    });
  }
});

test("[night-35] eine verwaiste Sperre uebernimmt genau einer von zwei Anlaeufen, und unter .claude/ bleibt nur die Sperre", async () => {
  for (let runde = 0; runde < RUNDEN; runde++) {
    await mitOrdnerAsync(async (dir) => {
      lockSchreiben(dir, `${totePid()}\n`);
      const ergebnisse = await gleichzeitig(dir, 2);
      assert.equal(ergebnisse.filter((r) => r.ok).length, 1, `Runde ${runde}: ${JSON.stringify(ergebnisse)}`);
      assert.deepEqual(readdirSync(join(dir, ".claude")), ["night-umsetzung.lock"]);
    });
  }
});

// --- Die Kette unter Variante B ---

// Der Ausgang ist seit Issue #862 `unvollstaendig` statt `fertig`: Die Sperre selbst
// bleibt richtig — zwei Umsetzungen in einem Checkout gehen nicht —, aber eine Nacht, die
// ihre bestellte Umsetzung nicht ausgefuehrt hat, darf am Morgen nicht als gelungen
// dastehen. Was die Stufe tut, aendert das nicht: Sie laesst aus und faellt auf Variante A
// zurueck. Die Zusicherungen darunter sind deshalb unveraendert.
test("[night-35] ein lebender Lock haelt die Umsetzungsstufe ab: die Kette endet unvollstaendig, kein Paket wird gezogen", () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    lockSchreiben(dir, `${process.pid}\n`);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "unvollstaendig", einheit.grund);
    const stufe = einheit.stufen.umsetzung;
    assert.deepEqual(stufe.umgesetzt, []);
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), einheit.stufen.pakete.ids);
    for (const p of stufe.nichtBegonnen) assert.match(p.grund, /night-umsetzung\.lock/);
    assert.equal(sessions(env.logPfad).filter((s) => s.stufe === "umsetzung").length, 0, "es lief eine Umsetzungs-Session");
    assert.match(res.stdout, /night-umsetzung\.lock/);

    // Die Pakete bleiben in Backlog — der Rueckfall auf Variante A.
    for (const id of einheit.stufen.pakete.ids) {
      assert.equal(board(dir, "issue", "get", id).status, "backlog");
    }
    // Der fremde Lock bleibt unangetastet: Wer ihn nicht genommen hat, gibt ihn nicht frei.
    assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), String(process.pid));
    // Ausgelassen erst nach dem Warten im eigenen Umsetzungsbudget (Issue #1185).
    assert.match(einheit.grund, /im Umsetzungsbudget gewartet/);
  }, { umsetzungMin: 0.001 });
});

test("[night-35] die Umsetzungsstufe haelt den Lock waehrend ihrer Sessions und gibt ihn am Ende frei", () => {
  mitProjekt((dir) => {
    const stufen = { ...ERZEUGEN, umsetzung: `${probe(dir)}; ${UMSETZUNG_ERFOLG}` };
    const env = umgebung(dir, { stufen });
    fachplanB(dir);
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const gesehen = probeStand(dir);
    assert.match(gesehen.lock, /^\d+$/, `die Session sah keinen Lock: ${JSON.stringify(gesehen.lock)}`);
    assert.notEqual(gesehen.lock, String(process.pid), "im Lock steht nicht die Id des Nachtlaufs");
    assert.equal(gesehen.status, "", `git status war nicht leer, waehrend der Lock lag:\n${gesehen.status}`);
    assert.equal(existsSync(lockPfad(dir)), false, "der Lock blieb nach der Kette liegen");
  });
});

test("[night-35] ein verwaister Lock haelt die Umsetzungsstufe nicht ab", () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    lockSchreiben(dir, `${totePid()}\n`);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.deepEqual(einheit.stufen.umsetzung.umgesetzt.map((e) => e.id), einheit.stufen.pakete.ids, "die Pakete wurden nicht umgesetzt");
    assert.equal(existsSync(lockPfad(dir)), false, "der Lock blieb nach der Kette liegen");
  });
});

test("[night-35] nach einem Wurf aus der Umsetzung heraus bleibt kein Lock liegen", () => {
  mitProjekt((dir) => {
    fachplanB(dir);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    // Derselbe Test-Hook wie in night-kette-umsetzung: der Wurf trifft zwischen dem Zug
    // nach Ready und der Session des ersten Pakets, also mitten in der Stufe.
    const res = run(dir, ["--kette"], { ...env, NIGHT_KETTE_WURF: "0003" });
    assert.notEqual(res.status, 0, "ein Wurf aus der Stufe heraus endet nicht regulaer");
    assert.equal(existsSync(lockPfad(dir)), false, "der Lock blieb nach dem Wurf liegen");
  });
});

test("[night-35] --kette --dry-run legt keinen Lock an und raeumt keinen vorhandenen weg", () => {
  mitProjekt((dir) => {
    fachplanB(dir);
    const env = umgebung(dir, { stufen: ERZEUGEN });
    const ohne = run(dir, ["--kette", "--dry-run"], env);
    assert.equal(ohne.status, 0, `${ohne.stdout}\n${ohne.stderr}`);
    assert.equal(existsSync(lockPfad(dir)), false, "der Dry-Run legte einen Lock an");

    lockSchreiben(dir, `${process.pid}\n`);
    const mit = run(dir, ["--kette", "--dry-run"], env);
    assert.equal(mit.status, 0, `${mit.stdout}\n${mit.stderr}`);
    assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), String(process.pid), "der Dry-Run raeumte den Lock weg");
  });
});

// --- Die Umsetzungsnacht ---

/** Ein Repo mit einem Ready-Paket und dem Session-Fake der Umsetzungsnacht. */
function nachtProjekt(dir, zeilen) {
  const issue = board(dir, "issue", "create", "--title", "Ein Paket", "--body", "## Abhängigkeiten\n\nKeine.\n");
  board(dir, "issue", "move", String(issue.id), "ready");
  const env = umgebung(dir);
  return { id: String(issue.id), env: { ...env, NIGHT_CLAUDE_CMD: fake({ umsetzung: zeilen }) } };
}

test("[night-35] ein lebender Lock haelt die Umsetzungsnacht ab: kein Paket, der Grund steht im Protokoll", () => {
  const dir = setupProjekt({}, "night-lock-nacht-");
  try {
    const { id, env } = nachtProjekt(dir, UMSETZUNG_ERFOLG);
    lockSchreiben(dir, `${process.pid}\n`);
    const res = run(dir, ["--label", "none"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.match(res.stdout, /night-umsetzung\.lock/);
    assert.match(res.stdout, /0 Session\(s\) gestartet/);
    assert.equal(board(dir, "issue", "get", id).status, "ready", "das Paket wurde gezogen");
    assert.equal(sessions(env.logPfad).length, 0, "es lief eine Session");
    assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), String(process.pid), "der fremde Lock wurde weggeraeumt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-35] die Umsetzungsnacht haelt den Lock waehrend ihrer Sessions und gibt ihn am Ende frei", () => {
  const dir = setupProjekt({}, "night-lock-nacht-");
  try {
    const { id, env } = nachtProjekt(dir, `${probe(dir)}; ${UMSETZUNG_ERFOLG}`);
    const res = run(dir, ["--label", "none"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.equal(board(dir, "issue", "get", id).status, "in_review", res.stdout);
    const gesehen = probeStand(dir);
    assert.match(gesehen.lock, /^\d+$/, `die Session sah keinen Lock: ${JSON.stringify(gesehen.lock)}`);
    assert.equal(gesehen.status, "", `git status war nicht leer, waehrend der Lock lag:\n${gesehen.status}`);
    assert.equal(existsSync(lockPfad(dir)), false, "der Lock blieb nach der Umsetzungsnacht liegen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-35] ein verwaister Lock haelt die Umsetzungsnacht nicht ab", () => {
  const dir = setupProjekt({}, "night-lock-nacht-");
  try {
    const { id, env } = nachtProjekt(dir, UMSETZUNG_ERFOLG);
    lockSchreiben(dir, "kaputt\n");
    const res = run(dir, ["--label", "none"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.equal(board(dir, "issue", "get", id).status, "in_review", res.stdout);
    assert.equal(existsSync(lockPfad(dir)), false, "der Lock blieb nach der Umsetzungsnacht liegen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-35] auch ohne .claude-Regel in der .gitignore ist der Lock kein Rest im Arbeitsbaum", () => {
  const dir = setupProjekt({}, "night-lock-nacht-");
  try {
    // Die Fixture bildet den `.claude/*`-Block des Installers nach. Den laesst der Installer
    // aber unangetastet, wo ein Projekt eine eigene `.claude`-Regel fuehrt — dort haelt
    // allein der Ausschluss in `gitReste()` den Rest-Guard (#152) davon ab, nach der ersten
    // erfolgreichen Runde hart zu stoppen. Genau das ist hier nachgewiesen, nicht angenommen.
    const gitignore = join(dir, ".gitignore");
    writeFileSync(gitignore, readFileSync(gitignore, "utf-8").replace(`${UMSETZUNG_LOCK}\n`, ""), "utf-8");
    for (const a of [["add", "-A"], ["commit", "-q", "-m", "ohne lock-regel"]]) {
      assert.equal(spawnSync("git", a, { cwd: dir, encoding: "utf-8" }).status, 0);
    }
    assert.notEqual(spawnSync("git", ["check-ignore", "-q", UMSETZUNG_LOCK], { cwd: dir }).status, 0,
      "der Lock ist noch ignoriert — der Test prueft nicht, was er prueft");

    const { id, env } = nachtProjekt(dir, UMSETZUNG_ERFOLG);
    const res = run(dir, ["--label", "none"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.doesNotMatch(res.stdout, /HARTER STOPP/);
    assert.equal(board(dir, "issue", "get", id).status, "in_review", res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-35] ein Lauf ohne Ready-Paket nimmt keinen Lock — er haelt keine Kette ab", () => {
  const dir = setupProjekt({}, "night-lock-nacht-");
  try {
    const env = umgebung(dir);
    const res = run(dir, ["--label", "none"], { ...env, NIGHT_CLAUDE_CMD: fake({}) });
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(existsSync(lockPfad(dir)), false, "ein Lauf ohne Paket legte einen Lock an");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
