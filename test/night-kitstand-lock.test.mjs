// Der Umsetzungs-Lock als Einheit (Plan #691, E10; Issue #696), im selben Prozess gegen den
// Teil kit/night/kitstand.mjs (Issue #1226, Plan #1199, E6).
//
// Beide Betriebsarten nehmen vor ihrer ersten Umsetzungs-Session dieselbe Datei
// `.claude/night-umsetzung.lock` in der Hauptkopie. Ob ein Halter lebt, fragt der Teil ueber
// die eingesetzte Prozess-Probe — ein toter Halter ist hier eine Id, fuer die die Probe
// `ESRCH` meldet, kein beendeter Hilfsprozess. Die gleichzeitigen Anlaeufe und der Lock im
// Lauf belegt test/ablauf-night-kitstand-lock.test.mjs.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { UMSETZUNG_LOCK } from "../kit/night/grundlagen.mjs";
import { umsetzungLockNehmen, nachziehenPruefen, RUNNER_SPERREN, kitstandAbhaengigkeiten } from "../kit/night/kitstand.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Eine Id, die die eingesetzte Prozess-Probe fuer tot erklaert; jede andere lebt.
const TOTE_PID = 999_999;

function probeMitToten(...tote) {
  return (pid) => {
    if (tote.includes(pid)) throw Object.assign(new Error(`kill ESRCH ${pid}`), { code: "ESRCH" });
    return true;
  };
}

afterEach(() => kitstandAbhaengigkeiten());

function lockPfad(dir) {
  return join(dir, UMSETZUNG_LOCK);
}

function lockSchreiben(dir, inhalt) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(lockPfad(dir), String(inhalt), "utf-8");
}

function mitOrdner(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-lock-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
  kitstandAbhaengigkeiten({ kill: probeMitToten(TOTE_PID) });
  mitOrdner((dir) => {
    lockSchreiben(dir, `${TOTE_PID}\n`);
    const res = umsetzungLockNehmen(dir);
    assert.equal(res.ok, true, res.grund);
    assert.match(res.hinweis ?? "", /verwaist/i);
    assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), String(process.pid));
    res.freigeben();
    assert.equal(existsSync(lockPfad(dir)), false, "der Lock wurde nicht freigegeben");
  });
});

test("[night-35] ein Halter, der einem anderen Nutzer gehoert (EPERM), lebt", () => {
  kitstandAbhaengigkeiten({ kill: () => { throw Object.assign(new Error("kill EPERM"), { code: "EPERM" }); } });
  mitOrdner((dir) => {
    lockSchreiben(dir, "4711\n");
    const res = umsetzungLockNehmen(dir);
    assert.equal(res.ok, false);
    assert.equal(res.art, "belegt");
  });
});

test("[night-35] eine nicht als Zahl lesbare Lock-Datei zaehlt als verwaist", () => {
  // `0` steht ausdruecklich dabei: `process.kill(0, 0)` zielte auf die eigene
  // Prozessgruppe und meldete damit immer einen lebenden Halter. Die leere Datei bekommt
  // ihren kurzen Moment ueber den eingesetzten Schlaf, ohne zu warten.
  kitstandAbhaengigkeiten({ schlaf: () => {} });
  for (const inhalt of ["", "   ", "kaputt", "0", "-1", "1.5"]) {
    mitOrdner((dir) => {
      lockSchreiben(dir, inhalt);
      const res = umsetzungLockNehmen(dir);
      assert.equal(res.ok, true, `Inhalt ${JSON.stringify(inhalt)}: ${res.grund}`);
      assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), String(process.pid));
    });
  }
});

test("[night-35] eine leere Lock-Datei, die waehrend des kurzen Moments ihre Id bekommt, ist belegt", () => {
  mitOrdner((dir) => {
    lockSchreiben(dir, "");
    const geschlafen = [];
    // Der andere Anlauf schreibt seine Id, waehrend dieser wartet.
    kitstandAbhaengigkeiten({
      kill: probeMitToten(),
      schlaf: (ms) => { geschlafen.push(ms); writeFileSync(lockPfad(dir), "4711\n"); },
    });
    const res = umsetzungLockNehmen(dir);
    assert.equal(res.ok, false);
    assert.equal(res.art, "belegt");
    assert.match(res.grund, /4711/);
    assert.equal(geschlafen.length, 1, "genau ein kurzer Moment");
    assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), "4711", "die frische Sperre bleibt stehen");
  });
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

test("[night-35] belegt und Schreibfehler sind an `art` zu unterscheiden, nicht am Wortlaut des Grundes", () => {
  // Der Wortlaut eines Grundes ist Prosa und wird umformuliert; haengt die Einstufung
  // einer ganzen Nacht daran, kippt sie bei der naechsten Umformulierung still.
  mitOrdner((dir) => {
    lockSchreiben(dir, `${process.pid}\n`);
    const belegt = umsetzungLockNehmen(dir);
    assert.equal(belegt.ok, false);
    assert.equal(belegt.art, "belegt");
    assert.match(belegt.grund, new RegExp(String(process.pid)));
  });
  mitOrdner((dir) => {
    mkdirSync(lockPfad(dir), { recursive: true });
    const fehler = umsetzungLockNehmen(dir);
    assert.equal(fehler.ok, false);
    assert.equal(fehler.art, "schreibfehler");
    assert.match(fehler.grund, /schreiben/);
  });
  mitOrdner((dir) => {
    const erfolg = umsetzungLockNehmen(dir);
    assert.equal(erfolg.ok, true, erfolg.grund);
    assert.equal(erfolg.hinweis, null);
    assert.equal(typeof erfolg.freigeben, "function");
    erfolg.freigeben();
  });
});

test("[night-35] freigeben laesst eine fremde Sperre stehen", () => {
  mitOrdner((dir) => {
    const res = umsetzungLockNehmen(dir);
    assert.equal(res.ok, true, res.grund);
    // Ein anderer Lauf hat die Sperre inzwischen uebernommen (etwa weil er diesen Lauf fuer
    // tot hielt) — wer sie nicht mehr haelt, raeumt sie nicht weg.
    lockSchreiben(dir, `${TOTE_PID}\n`);
    res.freigeben();
    assert.equal(readFileSync(lockPfad(dir), "utf-8").trim(), String(TOTE_PID), "die fremde Sperre wurde entfernt");
  });
});

test("[night-35] der Lock ist kein Rest im Arbeitsbaum: die .gitignore des Kits deckt ihn", () => {
  const res = spawnSync("git", ["check-ignore", "-q", UMSETZUNG_LOCK], { cwd: repoRoot, encoding: "utf-8" });
  assert.equal(res.status, 0, `${UMSETZUNG_LOCK} ist im Kit nicht ignoriert — gitClean() saehe ihn als Rest`);
});

// --- nachziehenPruefen (Issue #929) ---

test("[release-2] nachziehenPruefen fragt jede Sperre aus RUNNER_SPERREN mit derselben Prozess-Probe", () => {
  assert.deepEqual(RUNNER_SPERREN, [UMSETZUNG_LOCK]);
  kitstandAbhaengigkeiten({ kill: probeMitToten() });
  mitOrdner((dir) => {
    lockSchreiben(dir, "4711\n");
    const res = nachziehenPruefen(dir);
    assert.equal(res.nachziehen, false);
    assert.match(res.grund, /Prozess 4711/);
  });
});
