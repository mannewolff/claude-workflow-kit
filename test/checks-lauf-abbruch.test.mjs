// Die Pruef-Zusammenfassung begleitet den Lauf (Issue #857, Plan #810, E1/E5).
//
// Bis zu diesem Paket entstand die Zusammenfassung erst NACH der Schleife. Starb ein
// Lauf dazwischen — an der Uhr, gekillt, oder weil die Session endete —, fehlte die
// Datei ganz, oder es blieb eine aeltere liegen, die wie das Ergebnis dieses Laufs
// aussah. Gate (`.githooks/gate.mjs`) und Nacht-Runner (`lesePruefung` in
// kit/night.mjs) werten allein `ergebnis !== "gruen"` aus; ein Feld `abgeschlossen`
// sehen sie nicht. Darum muss jede Fassung, die ein Abbruch hinterlassen kann, schon
// von sich aus ungruen sein (Fachplan #769, AK 3 und 4).
//
// Die Tests sehen den Lauf von innen: Ein Pruefkommando kopiert die Zusammenfassung,
// waehrend es selbst laeuft. Ein von Hand geschriebenes JSON pruefte nur die Form,
// die der Test selbst gesetzt hat — nicht den Zeitpunkt, um den es hier geht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as warte } from "node:timers/promises";
import {
  mitRepo, repoAnlegen, run, zusammenfassung, datei, gate, gateEinbauen, git, CHECKS,
  prozessbaumBeenden, repoEntfernenHartnaeckig,
} from "./helpers/checks-repo.mjs";

const CHECK_AREAS = { kern: ["src/**"] };

/** Wartet, bis eine Bedingung eintritt — hoechstens zehn Sekunden. */
async function warteAuf(bedingung, meldung) {
  for (let versuch = 0; versuch < 500; versuch += 1) {
    if (bedingung()) return;
    await warte(20);
  }
  assert.fail(meldung);
}

/** Die pid des haengenden Pruefkommandos, sobald es sie hinterlassen hat. */
function kommandoPid(dir) {
  try {
    const roh = readFileSync(join(dir, "laeuft.txt"), "utf-8").trim();
    return /^\d+$/.test(roh) ? Number(roh) : null;
  } catch {
    return null;
  }
}

/**
 * Beendet das Pruefkommando, das den Kill des Laufs ueberlebt hat, und wartet auf
 * sein Ende. Keine Assertion: Die Funktion laeuft im `finally` und darf das Ergebnis
 * des Tests nicht ueberschreiben — auch ein Prozess, der sich nicht beenden laesst,
 * soll das Aufraeumen noch versuchen lassen.
 */
async function beendeKommando(pid) {
  if (!pid) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return; // schon weg
  }
  for (let versuch = 0; versuch < 100; versuch += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return; // gestorben
    }
    await warte(20);
  }
}

// Ein Pruefkommando, das die Zusammenfassung waehrend seines eigenen Laufs
// wegkopiert. Als Node-Skript statt `cp`, damit das Kommando unter Windows
// dieselbe Zeile ist — `checks.mjs` faehrt es ueber die Shell der Plattform.
const SNAPSHOT = [
  "// Generiert von test/checks-lauf-abbruch.test.mjs — kein Produktivcode.",
  'import { copyFileSync } from "node:fs";',
  'copyFileSync(".claude/checks-summary.json", process.argv[2]);',
  "",
].join("\n");

function snapshotWerkzeug(dir) {
  datei(dir, "werkzeug/snapshot.mjs", SNAPSHOT);
}

function snapshotKommando(name) {
  return `node werkzeug/snapshot.mjs ${name}`;
}

function gelesen(dir, name) {
  return JSON.parse(readFileSync(join(dir, name), "utf-8"));
}

function ergebnisse(fassung) {
  return fassung.laufen.map((e) => e.ergebnis);
}

test("[checks-8] vor dem ersten Kommando liegt eine Zusammenfassung mit abgeschlossen: false und lauter 'nicht gestartet'", () => {
  const config = {
    buildChecks: [{ cmd: snapshotKommando("vorher.json"), always: true }, { cmd: "echo zwei", always: true }],
    checkAreas: CHECK_AREAS,
  };
  mitRepo({ config }, (dir) => {
    snapshotWerkzeug(dir);
    datei(dir, "src/a.txt");

    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    const fassung = gelesen(dir, "vorher.json");
    assert.equal(fassung.abgeschlossen, false, "die Fassung vor dem ersten Kommando gilt nicht als abgeschlossen");
    assert.deepEqual(ergebnisse(fassung), ["nicht gestartet", "nicht gestartet"],
      "vor dem ersten Kommando hat noch keines ein Ergebnis");
    for (const eintrag of fassung.laufen) {
      assert.equal(eintrag.dauerMs, null, `dauerMs fuer '${eintrag.cmd}' muss null sein, nie 0`);
    }
  });
});

test("[checks-8] waehrend des letzten Kommandos steht dessen Eintrag noch auf 'nicht gestartet'", () => {
  const config = {
    buildChecks: [{ cmd: "echo eins", always: true }, { cmd: snapshotKommando("letzter.json"), always: true }],
    checkAreas: CHECK_AREAS,
  };
  mitRepo({ config }, (dir) => {
    snapshotWerkzeug(dir);
    datei(dir, "src/a.txt");

    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    const fassung = gelesen(dir, "letzter.json");
    assert.equal(fassung.abgeschlossen, false);
    assert.deepEqual(ergebnisse(fassung), ["gruen", "nicht gestartet"],
      "das laufende Kommando darf sein Ergebnis noch nicht tragen");
    // Und am Ende steht es doch da: die Zwischenfassung ist keine Sackgasse.
    const ende = zusammenfassung(dir);
    assert.equal(ende.abgeschlossen, true);
    assert.deepEqual(ergebnisse(ende), ["gruen", "gruen"]);
  });
});

test("[checks-8] jede Fassung traegt hashes und zeitpunkt — sonst meldete das Gate 'altes Format'", () => {
  const config = {
    buildChecks: [{ cmd: snapshotKommando("vorher.json"), always: true }],
    checkAreas: CHECK_AREAS,
  };
  mitRepo({ config }, (dir) => {
    snapshotWerkzeug(dir);
    datei(dir, "src/a.txt");

    run(dir);

    for (const [name, fassung] of [["Zwischenfassung", gelesen(dir, "vorher.json")], ["Endfassung", zusammenfassung(dir)]]) {
      assert.equal(typeof fassung.hashes, "object", `${name} ohne hashes`);
      assert.notEqual(fassung.hashes, null, `${name} mit hashes: null`);
      assert.ok("src/a.txt" in fassung.hashes, `${name} kennt die geaenderte Datei nicht`);
      assert.equal(typeof fassung.zeitpunkt, "string", `${name} ohne zeitpunkt`);
      assert.ok(Array.isArray(fassung.laufen), `${name} ohne laufen`);
    }
    assert.equal(gelesen(dir, "vorher.json").zeitpunkt, zusammenfassung(dir).zeitpunkt,
      "beide Fassungen bezeugen denselben Stand und damit denselben Zeitpunkt");
  });
});

test("[checks-8] ein vollstaendiger Lauf endet mit abgeschlossen: true — auch ein roter", () => {
  for (const fall of [{ name: "gruen", cmd: "echo eins", status: 0 }, { name: "rot", cmd: "exit 1", status: 1 }]) {
    const config = { buildChecks: [{ cmd: fall.cmd, always: true }], checkAreas: CHECK_AREAS };
    mitRepo({ config }, (dir) => {
      datei(dir, "src/a.txt");

      const res = run(dir);

      assert.equal(res.status, fall.status, `Fall '${fall.name}': ${res.stderr}`);
      assert.equal(zusammenfassung(dir).abgeschlossen, true,
        `Fall '${fall.name}': ein zu Ende gefahrener Lauf ist abgeschlossen, auch wenn er rot endet`);
    });
  }
});

test("[checks-8] ein Lauf, der waehrend eines Kommandos stirbt, hinterlaesst einen ungruenen Stand", async () => {
  // Ein Kommando, das seinen Start meldet und dann haengt: So trifft der Test den
  // Lauf sicher mitten darin und nicht davor oder danach. Gemeldet wird die eigene
  // pid und nicht bloss "ja": Der Kill trifft den Lauf, nicht dessen Kind — das
  // haengende Kommando ueberlebt ihn und muss eigens beendet werden (Issue #873).
  const LANGSAM = [
    "// Generiert von test/checks-lauf-abbruch.test.mjs — kein Produktivcode.",
    'import { writeFileSync } from "node:fs";',
    'writeFileSync("laeuft.txt", String(process.pid));',
    "setTimeout(() => {}, 15000);",
    "",
  ].join("\n");
  const config = {
    buildChecks: [{ cmd: "node werkzeug/langsam.mjs", always: true }, { cmd: "echo nie", always: true }],
    checkAreas: CHECK_AREAS,
  };
  // Nicht `mitRepo`: Das Aufraeumen ist dort synchron, dieser Fall wartet auf den
  // Tod eines Kindprozesses.
  const dir = repoAnlegen({ config });
  let kind = null;
  // Ausserhalb des `try`, weil das Aufraeumen im `finally` die pid des Laufs braucht.
  let proc = null;
  try {
    datei(dir, "werkzeug/langsam.mjs", LANGSAM);
    datei(dir, "src/a.txt");

    proc = spawn(process.execPath, [CHECKS, "run"], { cwd: dir });
    proc.stdout.resume();
    proc.stderr.resume();
    await warteAuf(() => kommandoPid(dir) !== null, "das erste Pruefkommando lief nicht an");
    kind = kommandoPid(dir);
    proc.kill("SIGKILL");
    await new Promise((fertig) => proc.on("exit", fertig));

    assert.ok(existsSync(join(dir, ".claude", "checks-summary.json")),
      "ein gekillter Lauf muss seinen Stand hinterlassen, sonst gilt die Session als ungeprueft");
    const fassung = zusammenfassung(dir);
    assert.equal(fassung.abgeschlossen, false);
    assert.ok(fassung.laufen.some((e) => e.ergebnis !== "gruen"),
      `ein abgebrochener Lauf darf nie ganz gruen aussehen: ${JSON.stringify(fassung.laufen)}`);
    assert.equal(typeof fassung.hashes, "object");
    assert.notEqual(fassung.hashes, null);
  } finally {
    // Erst die Prozesse, dann das Verzeichnis: Unter Windows haelt das ueberlebende
    // Kommando sein Arbeitsverzeichnis offen, und das Loeschen scheitert mit EBUSY.
    // `beendeKommando` trifft ueber die pid aus `laeuft.txt` nur das node-Kommando;
    // die `cmd.exe`, die `checks.mjs` wegen `shell: true` dazwischenstellt, kennt es
    // nie — SIGKILL beendet unter Windows keinen Prozessbaum. `prozessbaumBeenden`
    // holt sie ueber `taskkill /T` nach, und `repoEntfernenHartnaeckig` wartet den
    // Rest ab: Die Shell gibt das Verzeichnis erst kurz nach ihrem Kind frei
    // (Issue #873, #874).
    await beendeKommando(kind);
    prozessbaumBeenden(proc?.pid);
    await repoEntfernenHartnaeckig(dir);
  }
});

test("[checks-8] prozessbaumBeenden ruft taskkill nur unter Windows", () => {
  const rufe = [];
  const kill = (...args) => rufe.push(args);

  assert.equal(prozessbaumBeenden(4711, { plattform: "win32", kill }), true);
  assert.equal(rufe.length, 1, "unter Windows muss taskkill genau einmal laufen");
  assert.equal(rufe[0][0], "taskkill");
  assert.deepEqual(rufe[0][1], ["/pid", "4711", "/T", "/F"],
    "ohne /T bleibt die cmd.exe zwischen Lauf und Kommando am Leben");

  assert.equal(prozessbaumBeenden(4711, { plattform: "darwin", kill }), false);
  assert.equal(prozessbaumBeenden(null, { plattform: "win32", kill }), false);
  assert.equal(rufe.length, 1, "ausserhalb von Windows und ohne pid faellt kein Aufruf an");
});

test("[checks-8] prozessbaumBeenden schluckt den Fehler eines laengst toten Prozesses", () => {
  const kill = () => { throw new Error("taskkill: Prozess nicht gefunden"); };

  // Kein Testfehler: Die Funktion laeuft im `finally` und darf das Ergebnis des
  // Tests nicht ueberschreiben.
  assert.equal(prozessbaumBeenden(4711, { plattform: "win32", kill }), true);
});

test("[checks-8] repoEntfernenHartnaeckig wiederholt, bis das Loeschen gelingt", async () => {
  const optionen = [];
  let uebrig = 2;
  const rm = (pfad, opts) => {
    optionen.push(opts);
    if (uebrig > 0) {
      uebrig -= 1;
      throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${pfad}'`), { code: "EBUSY" });
    }
  };
  const pausen = [];

  await repoEntfernenHartnaeckig("/weg", { rm, warten: async (ms) => { pausen.push(ms); } });

  assert.equal(optionen.length, 3, "nach zwei EBUSY muss ein dritter Versuch folgen");
  assert.deepEqual(optionen[0], { recursive: true, force: true, maxRetries: 20, retryDelay: 250 },
    "die Wiederholungen von rmSync selbst bleiben der erste Weg");
  assert.equal(pausen.length, 2, "zwischen den Versuchen wird gewartet");
  assert.ok(pausen[1] > pausen[0], `der Abstand waechst nicht: ${JSON.stringify(pausen)}`);
});

test("[checks-8] repoEntfernenHartnaeckig gibt an der Obergrenze auf und wirft den Fehler", async () => {
  let jetzt = 0;
  const rm = () => { throw Object.assign(new Error("EBUSY"), { code: "EBUSY" }); };

  await assert.rejects(
    () => repoEntfernenHartnaeckig("/weg", {
      rm,
      grenzeMs: 10_000,
      uhr: () => jetzt,
      warten: async (ms) => { jetzt += ms; },
    }),
    { code: "EBUSY" },
    "ein Verzeichnis, das nach der Obergrenze noch belegt ist, wird nicht verschwiegen",
  );
});

test("[checks-8] repoEntfernenHartnaeckig wirft fremde Fehler sofort weiter", async () => {
  let versuche = 0;
  const rm = () => {
    versuche += 1;
    throw Object.assign(new Error("EACCES"), { code: "EACCES" });
  };

  await assert.rejects(() => repoEntfernenHartnaeckig("/weg", { rm }), { code: "EACCES" });
  assert.equal(versuche, 1, "ein fremder Fehler wird nicht wiederholt — er verginge nicht von selbst");
});

test("[checks-8] das Commit-Gate weist eine Zwischenfassung als 'nicht gestartet' ab, nicht als altes Format", () => {
  const config = {
    buildChecks: [{ cmd: snapshotKommando("vorher.json"), always: true }, { cmd: "echo zwei", always: true }],
    checkAreas: CHECK_AREAS,
  };
  mitRepo({ config }, (dir) => {
    gateEinbauen(dir);
    snapshotWerkzeug(dir);
    datei(dir, "src/a.txt");

    run(dir);
    // Der simulierte Abbruch: Was der Lauf mittendrin hinterlassen haette, liegt am
    // Ort der Zusammenfassung. Geschrieben hat die Fassung das echte Werkzeug.
    copyFileSync(join(dir, "vorher.json"), join(dir, ".claude", "checks-summary.json"));
    git(dir, "add", "src/a.txt");

    const res = gate(dir, "pre-commit");

    assert.notEqual(res.status, 0, "eine Zwischenfassung darf keinen Commit durchlassen");
    assert.match(res.stderr, /nicht gestartet/, `der Grund nennt nicht den unfertigen Lauf: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /altes Format/,
      `die Zwischenfassung wurde fuer eine Datei aus alter Zeit gehalten: ${res.stderr}`);
  });
});
