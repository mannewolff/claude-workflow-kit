// Der Umsetzungs-Lock (Plan #691, E10; Issue #696).
//
// Kette und Umsetzungsnacht duerfen nebeneinander laufen, solange die Kette im Worktree
// baut. Unter Variante B baut ihre Umsetzungsstufe in der Hauptkopie — zwei Laeufe, die
// gleichzeitig in denselben Working Tree committen, hinterlassen einen Zustand, den
// morgens niemand entwirrt. Beide Betriebsarten nehmen deshalb vor ihrer ersten
// Umsetzungs-Session dieselbe Datei `.claude/night-umsetzung.lock` in der Hauptkopie.
//
// Geprueft wird in beiden Richtungen: als Einheit an `umsetzungLockNehmen` (lebender,
// verwaister und unlesbarer Lock) und am ECHTEN kit/night.mjs gegen ein Temp-Repo mit
// lokalem Tracker, wie in den uebrigen night-Tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UMSETZUNG_LOCK, umsetzungLockNehmen } from "../kit/night.mjs";
import {
  NUR_POSIX, repoRoot, run, board, setupProjekt, mitProjekt, fachplan, umgebung, sessions, stand,
  fake, PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG,
} from "./helpers/kette-fixture.mjs";

/** Die vier erzeugenden Stufen, wie sie jeder Ketten-Test braucht. */
const ERZEUGEN = { plan: PLAN_ANLEGEN, review: REVIEW_MARKER, pakete: PAKETE_ANLEGEN };

/** Ein Fachplan mit beiden Labels: Kettenlabel und das Kennzeichen der Variante B. */
function fachplanB(dir) {
  const F = fachplan(dir, "[Fachlich] Ein Anliegen");
  board(dir, "issue", "label", "add", F, "kit:durchziehen");
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
 * Die Id eines Prozesses, den es sicher nicht mehr gibt: eine Shell, die ihre eigene
 * Nummer meldet und danach beendet ist. Eine geratene Zahl koennte einem fremden
 * laufenden Prozess gehoeren.
 */
function totePid() {
  const res = spawnSync("sh", ["-c", "echo $$"], { encoding: "utf-8" });
  assert.equal(res.status, 0, "die Hilfs-Shell lief nicht");
  const pid = Number(res.stdout.trim());
  assert.ok(Number.isInteger(pid) && pid > 0, `keine Prozess-Id: ${res.stdout}`);
  return pid;
}

/** Ein leeres Temp-Verzeichnis fuer die Einheitstests. */
function mitOrdner(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-lock-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

// --- Die Einheit: umsetzungLockNehmen ---

test("[night-35] ein Lock mit lebendem Prozess wird nicht genommen und nicht ueberschrieben", () => {
  mitOrdner((dir) => {
    lockSchreiben(dir, `${process.pid}\n`);
    const res = umsetzungLockNehmen(dir);
    assert.equal(res.ok, false);
    assert.match(res.grund, /night-umsetzung\.lock/);
    assert.match(res.grund, new RegExp(String(process.pid)));
    assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), String(process.pid), "der fremde Lock wurde ueberschrieben");
  });
});

test("[night-35] ein verwaister Lock wird aufgeraeumt und selbst genommen", () => {
  mitOrdner((dir) => {
    lockSchreiben(dir, `${totePid()}\n`);
    const res = umsetzungLockNehmen(dir);
    assert.equal(res.ok, true, res.grund);
    assert.match(res.hinweis ?? "", /verwaist/i);
    assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), String(process.pid));
    res.freigeben();
    assert.equal(existsSync(lockPfad(dir)), false, "der Lock wurde nicht freigegeben");
  });
});

test("[night-35] eine nicht als Zahl lesbare Lock-Datei zaehlt als verwaist", () => {
  // `0` steht ausdruecklich dabei: `process.kill(0, 0)` zielte auf die eigene
  // Prozessgruppe und meldete damit immer einen lebenden Halter.
  for (const inhalt of ["", "   ", "kaputt", "0", "-1", "1.5"]) {
    mitOrdner((dir) => {
      lockSchreiben(dir, inhalt);
      const res = umsetzungLockNehmen(dir);
      assert.equal(res.ok, true, `Inhalt ${JSON.stringify(inhalt)}: ${res.grund}`);
      assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), String(process.pid));
    });
  }
});

test("[night-35] ein nicht schreibbarer Lock haelt die Umsetzung ab, statt sie ohne Lock laufen zu lassen", () => {
  mitOrdner((dir) => {
    // Ein Verzeichnis an der Stelle der Lock-Datei: lesbar ist es nicht als Zahl, also
    // gilt es als verwaist — schreiben laesst es sich trotzdem nicht.
    mkdirSync(lockPfad(dir), { recursive: true });
    const res = umsetzungLockNehmen(dir);
    assert.equal(res.ok, false);
    assert.match(res.grund, /schreiben/);
  });
});

test("[night-35] der Lock ist kein Rest im Arbeitsbaum: die .gitignore des Kits deckt ihn", () => {
  const res = spawnSync("git", ["check-ignore", "-q", UMSETZUNG_LOCK], { cwd: repoRoot, encoding: "utf-8" });
  assert.equal(res.status, 0, `${UMSETZUNG_LOCK} ist im Kit nicht ignoriert — gitClean() saehe ihn als Rest`);
});

// --- Die Kette unter Variante B ---

test("[night-35] ein lebender Lock haelt die Umsetzungsstufe ab: die Kette bleibt fertig, kein Paket wird gezogen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    lockSchreiben(dir, `${process.pid}\n`);
    const env = umgebung(dir, { stufen: { ...ERZEUGEN, umsetzung: UMSETZUNG_ERFOLG } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const einheit = stand(dir).einheiten.find((e) => e.id === F);
    assert.equal(einheit.ausgang, "fertig", einheit.grund);
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
  });
});

test("[night-35] die Umsetzungsstufe haelt den Lock waehrend ihrer Sessions und gibt ihn am Ende frei", NUR_POSIX, () => {
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

test("[night-35] ein verwaister Lock haelt die Umsetzungsstufe nicht ab", NUR_POSIX, () => {
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

test("[night-35] nach einem Wurf aus der Umsetzung heraus bleibt kein Lock liegen", NUR_POSIX, () => {
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

test("[night-35] --kette --dry-run legt keinen Lock an und raeumt keinen vorhandenen weg", NUR_POSIX, () => {
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

test("[night-35] ein lebender Lock haelt die Umsetzungsnacht ab: kein Paket, der Grund steht im Protokoll", NUR_POSIX, () => {
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

test("[night-35] die Umsetzungsnacht haelt den Lock waehrend ihrer Sessions und gibt ihn am Ende frei", NUR_POSIX, () => {
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

test("[night-35] ein verwaister Lock haelt die Umsetzungsnacht nicht ab", NUR_POSIX, () => {
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

test("[night-35] auch ohne .claude-Regel in der .gitignore ist der Lock kein Rest im Arbeitsbaum", NUR_POSIX, () => {
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

test("[night-35] ein Lauf ohne Ready-Paket nimmt keinen Lock — er haelt keine Kette ab", NUR_POSIX, () => {
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
