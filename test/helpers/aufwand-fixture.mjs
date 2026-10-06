// Wegwerf-Projekt fuer die Tests von kit/aufwand.mjs (Issue #750, Plan #745).
//
// Die Auswertung ist eine reine Leseoperation ueber Dateien — kein Board, kein Git.
// Sie laesst sich deshalb vollstaendig an Fixtures pruefen: ein Temp-Verzeichnis mit
// .claude/ und darin die Ergebnisstaende, genau wie ein echtes Projekt sie traegt.
//
// Aufgerufen wird das ECHTE Werkzeug aus kit/ mit cwd im Fixture, im selben Prozess
// ueber `aufrufen` (Issue #1213, Plan #1199 E6) — nach demselben Muster wie
// test/helpers/checks-repo.mjs. Was nur als Prozess zu belegen ist (die fehlende
// Nachbardatei preise.mjs, die Kommandozeile), steht in test/ablauf-aufwand-*.test.mjs.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { aufrufen } from "../../kit/aufwand.mjs";

/**
 * Ein Ergebnisstand mit den Feldern, die night.mjs schreibt. Alles ist ueberschreibbar,
 * damit ein Test genau den einen Messwert wegnehmen kann, um den es ihm geht — die
 * uebrigen bleiben plausibel, statt dass jeder Test seinen eigenen Stand von Hand baut.
 */
export function lauf(stempel, felder = {}) {
  return {
    stempel,
    daten: {
      schemaFassung: 1,
      erzeugtVon: "2.0.1",
      start: `${stempel.slice(0, 10)}T00:00:00.000Z`,
      art: "implementierung",
      modell: "claude-opus-5",
      max: 10,
      label: "kit:nightrun",
      stufe: null,
      einheiten: [],
      abschluss: "regulaer",
      complete: true,
      verbrauch: { kostenUsd: null, eingabeTokens: null, ausgabeTokens: null, cacheErzeugtTokens: null, cacheGelesenTokens: null },
      verbrauchOhneEinheit: { kostenUsd: 0, eingabeTokens: 0, ausgabeTokens: 0, cacheErzeugtTokens: 0, cacheGelesenTokens: 0 },
      ...felder,
    },
  };
}

/** Eine Einheit mit Verbrauch, Zeiten und Pruefstand — dieselbe Form wie im echten Stand. */
export function einheit(id, felder = {}) {
  const {
    modell = "claude-opus-5",
    kostenUsd = 1,
    eingabeTokens = 100,
    ausgabeTokens = 10_000,
    cacheErzeugtTokens = 200_000,
    cacheGelesenTokens = 1_000_000,
    cache5mTokens,
    cache1hTokens,
    zeiten = { dauerMs: 600_000, nachdenkenMs: 300_000, werkzeugMs: 200_000, werkzeugSchuebe: 40, nebenlaeufigeSchuebe: 0 },
    pruefung = pruefstand(),
    ...rest
  } = felder;
  const e = {
    id: String(id),
    titel: `Paket ${id}`,
    modell,
    modellHerkunft: "stufe",
    modellGrund: null,
    stufe: "mittel",
    stufeVerwendet: "mittel",
    art: "implementierung",
    ausgang: "erfolg",
    verbrauch: { kostenUsd, eingabeTokens, ausgabeTokens, cacheErzeugtTokens, cacheGelesenTokens },
    dauerMs: zeiten?.dauerMs ?? null,
    commit: "abc1234",
    endStatus: "in_review",
    kennzahlen: {
      kostenUsd, apiDauerMs: zeiten?.nachdenkenMs ?? null, zuege: 40, stopReason: "end_turn", isError: false,
      eingabeTokens, ausgabeTokens, cacheErzeugtTokens, cacheGelesenTokens,
      cache5mTokens: cache5mTokens ?? null,
      cache1hTokens: cache1hTokens ?? null,
    },
    ...rest,
  };
  if (zeiten !== null) e.zeiten = zeiten;
  if (pruefung !== null) e.pruefung = pruefung;
  return e;
}

/** Ein Pruefstand, wie `lesePruefung` in night.mjs ihn ablegt. */
export function pruefstand(felder = {}) {
  const { laufen, ausgelassen = [], vollerUmfang = true, ...rest } = felder;
  return {
    id: "1",
    zustand: "geprueft",
    laufen: laufen ?? [
      { cmd: "node --test", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 50_000 },
      { cmd: "npx eslint .", grund: "voller Umfang", ergebnis: "gruen", dauerMs: 1_300 },
    ],
    ausgelassen,
    vollerUmfang,
    leeresPaket: false,
    basis: "abc1234",
    bereiche: [],
    dauerGesamtMs: null,
    ...rest,
  };
}

/**
 * Legt ein Projekt an, ruft `fn(dir)` und raeumt danach auf — auch nach einem
 * gescheiterten Assert (finally), sonst bleibt bei jedem roten Lauf ein Verzeichnis
 * im Temp stehen.
 */
export function mitProjekt({ laeufe = [], config }, fn) {
  const dir = mkdtempSync(join(tmpdir(), "aufwand-"));
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    for (const { stempel, daten } of laeufe) {
      writeFileSync(join(dir, ".claude", `night-run-${stempel}.json`), JSON.stringify(daten, null, 2) + "\n", "utf-8");
    }
    if (config !== undefined) {
      writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Roher Aufruf im selben Prozess — fuer die Faelle, in denen der Exit-Code selbst der
 * Befund ist. Ergebnis wie bei `spawnSync`: `{ status, stdout, stderr }`.
 */
export function aufwand(dir, ...cliArgs) {
  return aufrufen(cliArgs, { cwd: dir });
}

/** Erfolgreicher `auswerten`-Aufruf, JSON von stdout geparst. */
export function auswerten(dir, ...cliArgs) {
  const res = aufwand(dir, "auswerten", ...cliArgs);
  if (res.status !== 0) throw new Error(`auswerten schlug fehl (${res.status}): ${res.stderr}${res.stdout}`);
  return JSON.parse(res.stdout);
}

/** Der geschriebene Stand `.claude/aufwand.json`. */
export function stand(dir) {
  return JSON.parse(readFileSync(join(dir, ".claude", "aufwand.json"), "utf-8"));
}

/** Der geschriebene Bericht `.claude/aufwand.md`. */
export function bericht(dir) {
  return readFileSync(join(dir, ".claude", "aufwand.md"), "utf-8");
}

export function hatStand(dir) {
  return existsSync(join(dir, ".claude", "aufwand.json"));
}

export function standPfad(dir) {
  return join(dir, ".claude", "aufwand.json");
}
