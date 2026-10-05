// Ablauf-Pruefung: Die maschinenweite Sperre ordnet echte, gleichzeitige checks.mjs-Prozesse; sie entfaellt mit E12 (#1241), darum bleibt diese Datei unveraendert ein Ablauf (Issue #1212).
//
// Gleichzeitige Prueflaeufe auf einer Maschine laufen nacheinander (Issue #958).
//
// Anlass (kanban-kit, 2026-09-24, Lauf `night-run-2026-09-24-125914`): Zwei Runner
// fuhren auf einer Maschine ihre Pruefungen gleichzeitig. Die Testsuite des Kits
// startet Hunderte `night.mjs`-Prozesse; die Load Average stieg auf 348, und
// `test:coverage` des anderen Projekts riss mit wechselnden Tests sein Zeitlimit.
// Die Pruefungen wurden rot, ohne dass die Aenderung schuld war.
//
// Die Sperre ist VORSORGE GEGEN LAST und kein Korrektheitsgate. Daraus folgt jeder
// ihrer Ausgaenge: Ein belegter Lock laesst warten, ein verwaister wird abgeraeumt,
// und nach Ablauf der Obergrenze laeuft der Prueflauf trotzdem — mit Protokollzeile.
// Rot zu melden waere ein Fehlschlag, der nicht am Code liegt; unbegrenzt zu warten
// liefe in das Rundenzeitlimit des Runners, und der Lauf zaehlte als Fehlschlag der
// Karte statt als Wartezeit.
//
// Die Tests fahren zwei ECHTE Laeufe in ZWEI Wegwerf-Projekten mit EINER Sperre —
// so wie der Anlass es zeigte. Zwei Laeufe in einem Projekt pruefte eine
// projektlokale Sperre mit; genau die ist verworfen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mitSperre, SPERRE_ENV, SPERRE_GRENZE_ENV, SPERRE_GRENZE_FREMD_ENV, sperrPfad, sperrGrenzeMs, sperrGrenzeFremdMs } from "../kit/checks.mjs";
import { repoAnlegen, datei, run, repoEntfernenTolerant } from "./helpers/checks-repo.mjs";
import { CHECKS } from "./helpers/checks-ablauf.mjs";
import "./helpers/checks-sperre.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Die Dauer des Pruefkommandos. Lang genug, dass ein zweiter Lauf seine Auswahl
 * (mehrere git-Aufrufe) fertig hat und die Sperre noch vorfindet — sonst pruefte der
 * erste Test nicht die Serialisierung, sondern zwei Laeufe, die sich nie begegneten.
 * Kurz genug, dass diese Datei nicht zur langsamsten der Suite wird.
 */
const FENSTER_MS = 400;

/**
 * Ein Pruefkommando, das sein Ausfuehrungsfenster protokolliert. Es SCHLAEFT, statt
 * einen Kern zu belegen: Die Frage dieses Tests ist, ob sich die Fenster
 * ueberschneiden, und dafuer zaehlt allein, wie lange das Kommando die Sperre haelt.
 * Ein Busy-Loop belegte in einer CPU-gebundenen Suite echte Wandzeit — er arbeitete
 * gegen genau das Ziel, zu dem dieses Paket angetreten ist.
 */
const FENSTER = [
  "// Generiert von test/ablauf-checks-sperre.test.mjs (Issue #958) — kein Produktivcode.",
  "import { appendFileSync } from 'node:fs';",
  "const pfad = process.env.FENSTER_DATEI;",
  "appendFileSync(pfad, `start ${Date.now()}\\n`);",
  `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${FENSTER_MS});`,
  "appendFileSync(pfad, `ende ${Date.now()}\\n`);",
  "",
].join("\n");

/** Ein Wegwerf-Projekt, dessen einziger Check sein Fenster protokolliert. */
function fensterProjekt(fensterDatei) {
  const dir = repoAnlegen({
    config: { buildChecks: [{ cmd: "node werkzeug/fenster.mjs", always: true }], checkAreas: { kern: ["src/**"] } },
  });
  datei(dir, "werkzeug/fenster.mjs", FENSTER);
  datei(dir, "src/a.txt");
  return { dir, fensterDatei };
}

/** Die beiden Zeitpunkte aus einer Fensterdatei. */
function fenster(pfad) {
  const zeilen = readFileSync(pfad, "utf-8").trim().split("\n");
  const wert = (marke) => {
    const treffer = zeilen.find((z) => z.startsWith(`${marke} `));
    assert.ok(treffer, `in ${pfad} fehlt die Zeile '${marke}': ${zeilen.join(" | ")}`);
    return Number(treffer.split(" ")[1]);
  };
  return { start: wert("start"), ende: wert("ende") };
}

/** Ein Lauf im Hintergrund, mit eigener Fensterdatei und der uebergebenen Sperre. */
function starteLauf({ dir, fensterDatei }, sperre, weitereEnv = {}) {
  const proc = spawn(process.execPath, [CHECKS, "run"], {
    cwd: dir,
    env: { ...process.env, [SPERRE_ENV]: sperre, FENSTER_DATEI: fensterDatei, ...weitereEnv },
  });
  let ausgabe = "";
  proc.stdout.on("data", (stueck) => { ausgabe += stueck; });
  proc.stderr.on("data", (stueck) => { ausgabe += stueck; });
  const fertig = new Promise((aufloesen) => proc.on("exit", (code) => aufloesen(code)));
  return { proc, pid: proc.pid, fertig, ausgabe: () => ausgabe };
}

/** Eine Prozess-Id, die es sicher nicht mehr gibt: die eines beendeten Kindprozesses. */
function totePid() {
  const res = spawnSync(process.execPath, ["-e", ""], { encoding: "utf-8" });
  assert.equal(res.status, 0, "der Wegwerf-Prozess fuer die tote pid lief nicht");
  assert.ok(res.pid > 0, "kein pid vom Wegwerf-Prozess");
  return res.pid;
}

test("[checks-958-1] zwei gleichzeitige Laeufe in zwei Projekten laufen nacheinander, der zweite nennt die pid des ersten", async (t) => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-958-"));
  const sperre = join(ablage, "gemeinsam.lock");
  const a = fensterProjekt(join(ablage, "a.txt"));
  const b = fensterProjekt(join(ablage, "b.txt"));
  try {
    // Wirklich gleichzeitig gestartet, nicht gestaffelt: Wer die Sperre zuerst
    // bekommt, entscheidet das Rennen — die Zusicherungen lesen es hinterher aus den
    // Fenstern ab, statt es vorzugeben. Ein gestaffelter Start pruefte eine
    // Reihenfolge, die der Test selbst gesetzt hat.
    const laufA = starteLauf(a, sperre);
    const laufB = starteLauf(b, sperre);
    const [codeA, codeB] = await Promise.all([laufA.fertig, laufB.fertig]);
    assert.equal(codeA, 0, `Lauf A ging nicht gruen aus: ${laufA.ausgabe()}`);
    assert.equal(codeB, 0, `Lauf B ging nicht gruen aus: ${laufB.ausgabe()}`);

    const fA = fenster(a.fensterDatei);
    const fB = fenster(b.fensterDatei);
    const [erster, zweiter] = fA.start <= fB.start ? [
      { name: "A", f: fA, lauf: laufA }, { name: "B", f: fB, lauf: laufB },
    ] : [
      { name: "B", f: fB, lauf: laufB }, { name: "A", f: fA, lauf: laufA },
    ];
    assert.ok(erster.f.ende <= zweiter.f.start,
      `die Ausfuehrungsfenster ueberschneiden sich: ${erster.name} ${JSON.stringify(erster.f)}, `
      + `${zweiter.name} ${JSON.stringify(zweiter.f)}\n--- A (pid ${laufA.pid}) ---\n${laufA.ausgabe()}`
      + `\n--- B (pid ${laufB.pid}) ---\n${laufB.ausgabe()}`);

    const ausgabe = zweiter.lauf.ausgabe();
    assert.match(ausgabe, /es wird gewartet/,
      `der zweite Lauf muss das Warten protokollieren: ${ausgabe}`);
    assert.match(ausgabe, new RegExp(`Prozess ${erster.lauf.pid}\\b`),
      `die Wartezeile muss die pid des ersten Laufs (${erster.lauf.pid}) nennen: ${ausgabe}`);
    assert.doesNotMatch(erster.lauf.ausgabe(), /es wird gewartet/,
      `der erste Lauf hat auf nichts gewartet: ${erster.lauf.ausgabe()}`);

    assert.equal(existsSync(sperre), false, "nach beiden Laeufen darf keine Sperrdatei liegen");
  } finally {
    await repoEntfernenTolerant(a.dir, { notiz: (satz) => t.diagnostic(satz) });
    await repoEntfernenTolerant(b.dir, { notiz: (satz) => t.diagnostic(satz) });
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[checks-958-2] eine Sperre mit toter pid wird abgeraeumt, der Lauf wartet nicht", async (t) => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-958-"));
  const sperre = join(ablage, "verwaist.lock");
  const a = fensterProjekt(join(ablage, "a.txt"));
  const tot = totePid();
  writeFileSync(sperre, `${tot}\n`, "utf-8");
  try {
    const lauf = starteLauf(a, sperre);
    const code = await lauf.fertig;
    const ausgabe = lauf.ausgabe();
    assert.equal(code, 0, `der Lauf muss gruen durchlaufen: ${ausgabe}`);
    assert.match(ausgabe, new RegExp(`verwaist \\(Prozess ${tot} laeuft nicht\\)`),
      `das Abraeumen gehoert ins Protokoll, samt pid: ${ausgabe}`);
    assert.doesNotMatch(ausgabe, /es wird gewartet/,
      `auf einen toten Halter wird nicht gewartet: ${ausgabe}`);
    assert.ok(existsSync(a.fensterDatei), "das Pruefkommando lief nicht");
    assert.equal(existsSync(sperre), false, "der Lauf muss seine eigene Sperre wieder freigeben");
  } finally {
    await repoEntfernenTolerant(a.dir, { notiz: (satz) => t.diagnostic(satz) });
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[checks-958-3] nach einem roten Kommando liegt keine Sperrdatei mehr", async (t) => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-958-"));
  const sperre = join(ablage, "rot.lock");
  const dir = repoAnlegen({
    config: { buildChecks: [{ cmd: "exit 1", always: true }], checkAreas: { kern: ["src/**"] } },
  });
  try {
    datei(dir, "src/a.txt");
    const res = await run(dir, "--frisch");
    assert.notEqual(res.status, 0, "ein rotes Kommando muss den Lauf rot faerben");
    assert.equal(existsSync(sperre), false,
      "auch der rote Lauf gibt seine Sperre frei — sonst blockiert er jeden naechsten");
  } finally {
    await repoEntfernenTolerant(dir, { notiz: (satz) => t.diagnostic(satz) });
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[checks-958-4] mitSperre gibt auch bei einer Ausnahme frei und wirft sie weiter", () => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-958-"));
  const sperre = join(ablage, "ausnahme.lock");
  try {
    assert.throws(
      () => mitSperre(() => { throw new Error("mitten im Lauf"); }, { pfad: sperre, melde: () => {} }),
      /mitten im Lauf/,
    );
    assert.equal(existsSync(sperre), false,
      "die Ausnahme darf die Sperre nicht liegenlassen — sonst haengt danach jeder Lauf");
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[checks-958-5] mitSperre haelt die Sperre waehrend des Laufs und gibt den Rueckgabewert durch", () => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-958-"));
  const sperre = join(ablage, "gehalten.lock");
  try {
    const ergebnis = mitSperre(() => {
      assert.ok(existsSync(sperre), "waehrend des Laufs muss die Sperrdatei liegen");
      assert.equal(readFileSync(sperre, "utf-8").trim(), String(process.pid),
        "in der Sperrdatei steht die eigene pid");
      return 42;
    }, { pfad: sperre, melde: () => {} });
    assert.equal(ergebnis, 42);
    assert.equal(existsSync(sperre), false);
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[checks-958-6] nach Ablauf der Obergrenze laeuft der Lauf trotzdem und protokolliert es", async (t) => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-958-"));
  const sperre = join(ablage, "belegt.lock");
  const a = fensterProjekt(join(ablage, "a.txt"));
  // Die eigene pid des Testprozesses: ein Halter, der waehrend des ganzen Tests
  // nachweislich LEBT. Eine erfundene pid koennte zufaellig frei sein, und der Lauf
  // raeumte sie als verwaist ab — dann pruefte der Test den falschen Ausgang.
  writeFileSync(sperre, `${process.pid}\n`, "utf-8");
  try {
    const lauf = starteLauf(a, sperre, { [SPERRE_GRENZE_ENV]: "300" });
    const code = await lauf.fertig;
    const ausgabe = lauf.ausgabe();
    assert.equal(code, 0, `der Lauf muss trotz belegter Sperre gruen durchlaufen: ${ausgabe}`);
    assert.match(ausgabe, /es wird gewartet/, `zuerst wird gewartet: ${ausgabe}`);
    assert.match(ausgabe, /noch belegt .*faehrt ohne Sperre/,
      `der Ablauf der Obergrenze gehoert ins Protokoll: ${ausgabe}`);
    assert.ok(existsSync(a.fensterDatei), "das Pruefkommando lief nicht");
    assert.equal(readFileSync(sperre, "utf-8").trim(), String(process.pid),
      "ein Lauf ohne Sperre darf die fremde Sperre nicht entfernen");
  } finally {
    await repoEntfernenTolerant(a.dir, { notiz: (satz) => t.diagnostic(satz) });
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[checks-958-7] die Vorgaben: Pfad im Temp-Verzeichnis, Obergrenze als Zahl, beide ueberschreibbar", () => {
  const ohne = { ...process.env };
  delete ohne[SPERRE_ENV];
  delete ohne[SPERRE_GRENZE_ENV];
  assert.equal(sperrPfad(ohne), join(tmpdir(), "kit-checks-run.lock"));
  assert.ok(sperrGrenzeMs(ohne) > 0, "die Obergrenze braucht eine Vorgabe");

  assert.equal(sperrPfad({ ...ohne, [SPERRE_ENV]: "/wo/anders.lock" }), "/wo/anders.lock");
  assert.equal(sperrGrenzeMs({ ...ohne, [SPERRE_GRENZE_ENV]: "1234" }), 1234);
  // Unbrauchbare Werte fallen auf die Vorgabe zurueck: Ein leerer Pfad oder eine
  // Null-Grenze schaltete die Sperre still ab — die unsichere Richtung.
  assert.equal(sperrPfad({ ...ohne, [SPERRE_ENV]: "  " }), join(tmpdir(), "kit-checks-run.lock"));
  assert.equal(sperrGrenzeMs({ ...ohne, [SPERRE_GRENZE_ENV]: "keine Zahl" }), sperrGrenzeMs(ohne));
  assert.equal(sperrGrenzeMs({ ...ohne, [SPERRE_GRENZE_ENV]: "0" }), sperrGrenzeMs(ohne));
});

test("[checks-958-8] --help nennt die Sperre und die Namen beider Umgebungsvariablen", () => {
  const res = spawnSync(process.execPath, [CHECKS, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /sperre/i, "--help muss die Sperre nennen");
  assert.match(res.stdout, /faehrt der Prueflauf trotzdem|laeuft der Prueflauf\s+trotzdem/,
    "--help muss sagen, dass der Lauf nach der Obergrenze trotzdem faehrt");
  assert.ok(res.stdout.includes(SPERRE_ENV), `--help muss ${SPERRE_ENV} nennen`);
  assert.ok(res.stdout.includes(SPERRE_GRENZE_ENV), `--help muss ${SPERRE_GRENZE_ENV} nennen`);
});

// Die Testdateien, die `checks.mjs` nennen, es aber NICHT als `run` fahren — jede mit
// ihrem Grund. Eine Ausnahme mit Namen und Grund ist der einzige ehrliche Weg: Ein
// Muster, das "faehrt run" aus dem Quelltext erraet, wuerde entweder diese sieben
// mitziehen (Laerm, den bald niemand liest) oder eine echte Fundstelle uebersehen.
const OHNE_LAUF = new Map([
  ["install-checks-blob.test.mjs", "faehrt nur --help, kein run"],
  ["night-checks-fehlt.test.mjs", "prueft gerade das FEHLEN von checks.mjs"],
  ["night-nachbarn-identitaet.test.mjs", "importiert checks.mjs als Modul"],
  ["skills-regeln-im-werkzeug.test.mjs", "liest den Quelltext"],
  ["sync-blobs-skills.test.mjs", "vergleicht Blobs"],
  ["sync-blobs-stamp.test.mjs", "vergleicht Blobs"],
  ["tools-cli.test.mjs", "vergleicht Blobs"],
]);

test("[checks-958-9] jede Testdatei, die checks.mjs faehrt, setzt einen eigenen Sperrpfad", () => {
  // Die Invariante hinter Aufgabe 3, und sie gehoert geprueft statt nur hergestellt:
  // Eine spaeter hinzugefuegte Testdatei, die das echte checks.mjs faehrt, ohne den
  // Helfer zu ziehen, serialisiert die Suite wieder — und niemand saehe es, ausser
  // dass die Suite langsamer wird. Der Test nennt die Datei.
  const testDir = join(repoRoot, "test");
  const dateien = readdirSync(testDir).filter((n) => n.endsWith(".test.mjs"));
  const fehlend = [];
  const ueberfluessig = [];
  for (const name of dateien) {
    const text = readFileSync(join(testDir, name), "utf-8");
    // Weit gefasst: jede Datei, die das echte kit/checks.mjs ueberhaupt anfasst. Wer
    // es anfasst, ohne es zu fahren, steht in OHNE_LAUF — mit Grund.
    if (!/"checks\.mjs"/.test(text)) continue;
    if (OHNE_LAUF.has(name)) continue;
    // Der Wegwerf-Helfer zieht den Sperrpfad selbst; sonst braucht die Datei ihn direkt.
    const deckt = text.includes("helpers/checks-repo.mjs")
      || text.includes("helpers/checks-ablauf.mjs")
      || text.includes("helpers/checks-sperre.mjs");
    if (!deckt) fehlend.push(name);
  }
  assert.deepEqual(fehlend, [],
    `diese Testdateien fahren checks.mjs, ohne einen eigenen Sperrpfad zu setzen — `
    + `'import "./helpers/checks-sperre.mjs";' ergaenzen (oder mit Grund in OHNE_LAUF `
    + `aufnehmen): ${fehlend.join(", ")}`);

  // Die Gegenprobe: Eine Ausnahme, deren Datei es nicht mehr gibt oder die checks.mjs
  // nicht mehr nennt, ist eine Erlaubnis ohne Gegenstand — sie deckte spaeter die
  // falsche Datei.
  for (const [name, grund] of OHNE_LAUF) {
    const pfad = join(testDir, name);
    if (!dateien.includes(name) || !/"checks\.mjs"/.test(readFileSync(pfad, "utf-8"))) {
      ueberfluessig.push(`${name} (${grund})`);
    }
  }
  assert.deepEqual(ueberfluessig, [],
    `diese Ausnahmen in OHNE_LAUF haben keinen Gegenstand mehr: ${ueberfluessig.join(", ")}`);
});

// Ein Lesefehler ist kein Beweis fuer eine kaputte Sperre (Issue #999). Unter Windows
// scheitert das Lesen einer frisch verlinkten Datei manchmal kurz mit EBUSY oder EPERM
// — raeumte der Lauf sie dann ab, fuehren zwei Laeufe gleichzeitig. Die Tests stellen
// den Lesefehler ueber `lies` nach und nicht ueber das Timing: Ein Timing-Test waere
// selbst wieder ein Rennen.

/** Ein Fehler mit Code, wie ihn `readFileSync` wirft. */
function lesefehler(code) {
  return Object.assign(new Error(`${code}: gestellter Lesefehler`), { code });
}

/** Eine Uhr, die bei jeder Abfrage um `schritt` Millisekunden weiterlaeuft. */
function schrittUhr(schritt) {
  let jetzt = 0;
  return () => {
    const wert = jetzt;
    jetzt += schritt;
    return wert;
  };
}

test("[checks-958-10] ein voruebergehender Lesefehler (EBUSY) raeumt die Sperre nicht ab", () => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-999-"));
  const sperre = join(ablage, "busy.lock");
  // Der Elternprozess des Tests: ein fremder Halter, der waehrend des Tests nachweislich lebt.
  writeFileSync(sperre, `${process.ppid}\n`, "utf-8");
  let versuche = 0;
  const lies = () => {
    versuche += 1;
    if (versuche <= 2) throw lesefehler("EBUSY");
    return `${process.ppid}\n`;
  };
  const zeilen = [];
  try {
    let gelaufen = false;
    mitSperre(() => { gelaufen = true; }, {
      pfad: sperre, grenzeMs: 1000, melde: (satz) => zeilen.push(satz),
      uhr: schrittUhr(100), schlafe: () => {}, lies,
    });
    const ausgabe = zeilen.join("");
    assert.ok(gelaufen, "der Lauf muss nach der Obergrenze trotzdem fahren");
    assert.ok(versuche > 2, `nach dem Lesefehler muss neu nachgesehen werden: ${versuche} Leseversuche`);
    assert.doesNotMatch(ausgabe, /abgeraeumt/, `eine unlesbare Sperre ist keine kaputte: ${ausgabe}`);
    assert.match(ausgabe, /EBUSY/, `die Wartezeile nennt den Lesefehler: ${ausgabe}`);
    assert.match(ausgabe, /es wird gewartet/, `bei einem Lesefehler wird gewartet: ${ausgabe}`);
    assert.equal(readFileSync(sperre, "utf-8").trim(), String(process.ppid),
      "die fremde Sperre muss liegen bleiben");
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[checks-958-11] ein dauerhafter Lesefehler (EPERM) faehrt nach der Obergrenze ohne Sperre und laesst die Datei liegen", () => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-999-"));
  const sperre = join(ablage, "perm.lock");
  writeFileSync(sperre, `${process.ppid}\n`, "utf-8");
  const zeilen = [];
  try {
    let gelaufen = false;
    mitSperre(() => { gelaufen = true; }, {
      pfad: sperre, grenzeMs: 500, melde: (satz) => zeilen.push(satz),
      uhr: schrittUhr(100), schlafe: () => {}, lies: () => { throw lesefehler("EPERM"); },
    });
    const ausgabe = zeilen.join("");
    assert.ok(gelaufen, "der Lauf muss nach der Obergrenze trotzdem fahren");
    assert.match(ausgabe, /es wird gewartet/, `zuerst wird gewartet: ${ausgabe}`);
    assert.match(ausgabe, /noch belegt .*EPERM.*faehrt ohne Sperre/,
      `der Ablauf der Obergrenze gehoert samt Lesefehler ins Protokoll: ${ausgabe}`);
    assert.doesNotMatch(ausgabe, /abgeraeumt/, `eine unlesbare Sperre wird nicht abgeraeumt: ${ausgabe}`);
    assert.ok(existsSync(sperre), "die Sperrdatei muss liegen bleiben");
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[checks-958-12] eine lesbare Sperre ohne gueltige pid ist kaputt und wird abgeraeumt", () => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-999-"));
  const sperre = join(ablage, "kaputt.lock");
  writeFileSync(sperre, "kaputt\n", "utf-8");
  const zeilen = [];
  try {
    let gelaufen = false;
    mitSperre(() => {
      gelaufen = true;
      assert.equal(readFileSync(sperre, "utf-8").trim(), String(process.pid),
        "nach dem Abraeumen haelt der Lauf die Sperre selbst");
    }, { pfad: sperre, melde: (satz) => zeilen.push(satz), schlafe: () => {} });
    const ausgabe = zeilen.join("");
    assert.ok(gelaufen);
    assert.match(ausgabe, /war kaputt.*abgeraeumt/, `das Abraeumen gehoert ins Protokoll: ${ausgabe}`);
    assert.doesNotMatch(ausgabe, /es wird gewartet/, `auf eine kaputte Sperre wird nicht gewartet: ${ausgabe}`);
    assert.equal(existsSync(sperre), false, "der Lauf gibt seine eigene Sperre wieder frei");
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
});

// `run` faehrt seine Kommandos asynchron (Issue #1070, Plan #1066): `fn` liefert dann ein
// Promise, und die Sperre muss halten, bis es sich erledigt hat — nicht nur, bis `fn`
// zurueckkehrt. Gaebe sie frei, sobald das Promise entsteht, liefen zwei Laeufe wieder
// gleichzeitig, und niemand saehe es an der Ausgabe.
test("[checks-1070-1] mitSperre haelt die Sperre, solange das Promise laeuft, und gibt danach frei — auch wenn es verwirft", async () => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-1070-"));
  const sperre = join(ablage, "promise.lock");
  try {
    let freigeben;
    const laufend = mitSperre(() => new Promise((aufloesen) => { freigeben = aufloesen; }),
      { pfad: sperre, melde: () => {} });
    assert.ok(laufend instanceof Promise, "ein Promise von fn kommt als Promise zurueck");
    // Ein paar Runden der Ereignisschleife: Die Sperre darf nicht mit der Rueckkehr von fn fallen.
    await new Promise((weiter) => setTimeout(weiter, 20));
    assert.ok(existsSync(sperre), "solange das Promise laeuft, muss die Sperrdatei liegen");
    assert.equal(readFileSync(sperre, "utf-8").trim(), String(process.pid));
    freigeben(7);
    assert.equal(await laufend, 7, "der Wert des Promise kommt durch");
    assert.equal(existsSync(sperre), false, "nach dem Promise ist die Sperre frei");

    const verworfen = mitSperre(async () => {
      assert.ok(existsSync(sperre), "auch im verwerfenden Lauf haelt die Sperre");
      await new Promise((weiter) => setTimeout(weiter, 10));
      throw new Error("mitten im asynchronen Lauf");
    }, { pfad: sperre, melde: () => {} });
    await assert.rejects(verworfen, /mitten im asynchronen Lauf/);
    assert.equal(existsSync(sperre), false,
      "ein verworfenes Promise darf die Sperre nicht liegenlassen — sonst haengt danach jeder Lauf");
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
});

// Wer die Sperre haelt, steht in einer Nebendatei `<sperre>.halter` (Issue #1177). Auf
// ein fremdes Projekt wird nur kurz gewartet: Am 2026-10-02 wartete die
// Abschlusspruefung von #1102 rund 20 Minuten auf einen Push-Lauf von kanban-kit und
// scheiterte danach an der Sitzungsgrenze. Die Sperrdatei selbst bleibt bei der reinen
// Prozess-Id — aeltere Kit-Versionen auf derselben Maschine lesen sie so (#999).

const ZWANZIG_MINUTEN = 20 * 60 * 1000;
const ZWEI_MINUTEN = 2 * 60 * 1000;

/**
 * Legt eine Sperre des (lebenden) Elternprozesses an, auf Wunsch mit Nebendatei, und
 * faehrt `mitSperre` mit einer Uhr, die je Abfrage zehn Sekunden springt. Rueckgabe:
 * die Protokollzeilen und die gewartete Zeit aus der Zeile "nach <ms> ms".
 */
function warteAufHalter({ halter, halterText } = {}) {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-1177-"));
  const sperre = join(ablage, "halter.lock");
  writeFileSync(sperre, `${process.ppid}\n`, "utf-8");
  if (halter) writeFileSync(`${sperre}.halter`, JSON.stringify(halter), "utf-8");
  if (halterText !== undefined) writeFileSync(`${sperre}.halter`, halterText, "utf-8");
  const zeilen = [];
  try {
    let gelaufen = false;
    mitSperre(() => { gelaufen = true; }, {
      pfad: sperre, melde: (satz) => zeilen.push(satz), uhr: schrittUhr(10_000), schlafe: () => {},
    });
    assert.ok(gelaufen, "der Lauf muss nach der Obergrenze trotzdem fahren");
    assert.equal(readFileSync(sperre, "utf-8").trim(), String(process.ppid), "die fremde Sperre bleibt liegen");
    const ausgabe = zeilen.join("");
    const treffer = /nach (\d+) ms noch belegt/.exec(ausgabe);
    assert.ok(treffer, `die Zeile zum Ablauf der Obergrenze fehlt: ${ausgabe}`);
    return { ausgabe, gewartet: Number(treffer[1]) };
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
}

function halterAngaben(ueberschrieben = {}) {
  return {
    projekt: process.cwd(), stufe: "push", kommando: "checks.mjs run --stufe push",
    start: "2026-10-05T03:00:00.000Z", pid: process.ppid, ...ueberschrieben,
  };
}

test("[checks-1177-1] auf ein fremdes Projekt wird nur 2 Minuten gewartet, beide Zeilen nennen den Halter", () => {
  const { ausgabe, gewartet } = warteAufHalter({ halter: halterAngaben({ projekt: "/anderswo/kanban-kit" }) });
  assert.ok(gewartet >= ZWEI_MINUTEN && gewartet < ZWEI_MINUTEN + 20_000,
    `nach rund 2 Minuten muss der Lauf ohne Sperre fahren, nicht nach ${gewartet} ms: ${ausgabe}`);
  const zeilen = ausgabe.trim().split("\n");
  assert.match(zeilen[0], /es wird gewartet/);
  for (const zeile of zeilen) {
    assert.match(zeile, new RegExp(`Prozess ${process.ppid}\\b`), `die pid fehlt: ${zeile}`);
    assert.match(zeile, /\/anderswo\/kanban-kit/, `das Projekt fehlt: ${zeile}`);
    assert.match(zeile, /Stufe push/, `die Stufe fehlt: ${zeile}`);
    assert.match(zeile, /2026-10-05T03:00:00\.000Z/, `die Startzeit fehlt: ${zeile}`);
  }
  assert.match(zeilen.at(-1), /faehrt ohne Sperre/);
});

test("[checks-1177-2] auf das eigene Projekt wird bis zu 20 Minuten gewartet", () => {
  const { ausgabe, gewartet } = warteAufHalter({ halter: halterAngaben() });
  assert.ok(gewartet >= ZWANZIG_MINUTEN && gewartet < ZWANZIG_MINUTEN + 20_000,
    `beim eigenen Projekt gilt die bisherige Obergrenze, gewartet ${gewartet} ms: ${ausgabe}`);
  assert.ok(ausgabe.includes(`Projekt ${process.cwd()},`), `die Zeile nennt das eigene Projekt: ${ausgabe}`);
});

test("[checks-1177-3] ohne oder mit unlesbarer Nebendatei gilt die bisherige Obergrenze und das Projekt ist unbekannt", () => {
  for (const fall of [{}, { halterText: "{kein json" }]) {
    const { ausgabe, gewartet } = warteAufHalter(fall);
    assert.ok(gewartet >= ZWANZIG_MINUTEN && gewartet < ZWANZIG_MINUTEN + 20_000,
      `ohne Beleg wird der Lastschutz nicht verkuerzt (${JSON.stringify(fall)}), gewartet ${gewartet} ms: ${ausgabe}`);
    for (const zeile of ausgabe.trim().split("\n")) {
      assert.match(zeile, /Projekt unbekannt/, `${JSON.stringify(fall)}: ${zeile}`);
      assert.match(zeile, new RegExp(`Prozess ${process.ppid}\\b`), zeile);
    }
  }
});

test("[checks-1177-4] eine Nebendatei zu einer anderen Prozess-Id zaehlt wie keine", () => {
  const { ausgabe, gewartet } = warteAufHalter({ halter: halterAngaben({ projekt: "/anderswo/kanban-kit", pid: totePid() }) });
  assert.ok(gewartet >= ZWANZIG_MINUTEN, `eine fremde Nebendatei verkuerzt nichts, gewartet ${gewartet} ms: ${ausgabe}`);
  assert.match(ausgabe, /Projekt unbekannt/);
  assert.doesNotMatch(ausgabe, /kanban-kit/, `die Angaben eines anderen Halters gehoeren nicht in die Zeile: ${ausgabe}`);
});

test("[checks-1177-5] die Sperrdatei traegt nur die pid, die Nebendatei den Halter, die Freigabe raeumt beide", () => {
  const ablage = mkdtempSync(join(tmpdir(), "sperre-1177-"));
  const sperre = join(ablage, "eigen.lock");
  try {
    let gelaufen = false;
    mitSperre(() => {
      gelaufen = true;
      assert.equal(readFileSync(sperre, "utf-8"), `${process.pid}\n`, "die Sperrdatei bleibt bei der reinen Prozess-Id");
      const halter = JSON.parse(readFileSync(`${sperre}.halter`, "utf-8"));
      assert.equal(halter.pid, process.pid);
      assert.equal(halter.projekt, process.cwd());
      assert.equal(halter.stufe, "merge");
      assert.equal(halter.kommando, "checks.mjs run --stufe merge");
      assert.ok(!Number.isNaN(Date.parse(halter.start)), `keine Startzeit: ${halter.start}`);
    }, { pfad: sperre, melde: () => {}, halter: { stufe: "merge", kommando: "checks.mjs run --stufe merge" } });
    assert.ok(gelaufen);
    assert.equal(existsSync(sperre), false, "die Sperrdatei muss weg sein");
    assert.equal(existsSync(`${sperre}.halter`), false, "die Nebendatei muss mit der Sperre gehen");
  } finally {
    rmSync(ablage, { recursive: true, force: true });
  }
});

test("[checks-1177-6] die Obergrenze fuer fremde Projekte ist ueber die Umgebung zu setzen", () => {
  assert.equal(SPERRE_GRENZE_FREMD_ENV, "KIT_CHECKS_LOCK_FOREIGN_TIMEOUT_MS");
  assert.equal(sperrGrenzeFremdMs({}), ZWEI_MINUTEN);
  assert.equal(sperrGrenzeFremdMs({ [SPERRE_GRENZE_FREMD_ENV]: "5000" }), 5000);
  assert.equal(sperrGrenzeFremdMs({ [SPERRE_GRENZE_FREMD_ENV]: "0" }), ZWEI_MINUTEN);
  assert.equal(sperrGrenzeFremdMs({ [SPERRE_GRENZE_FREMD_ENV]: "abc" }), ZWEI_MINUTEN);
  const hilfe = spawnSync(process.execPath, [CHECKS, "--help"], { encoding: "utf-8" });
  assert.match(hilfe.stdout, /KIT_CHECKS_LOCK_FOREIGN_TIMEOUT_MS/, "die Hilfe nennt die neue Umgebungsvariable");
});
