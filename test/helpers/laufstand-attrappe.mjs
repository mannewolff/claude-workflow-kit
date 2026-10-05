// Attrappen fuer die Tests des Nacht-Teils laufstand im selben Prozess (Issue #1225,
// Plan #1199, E6): ein Board, das jeden Aufruf samt Text mitschreibt, eine Uhr, die nur
// weitergeht, wenn der Test sie stellt, eine Prozess-Probe mit festen lebenden PIDs und ein
// Ende, das wirft statt den Prozess zu beenden. `mitProjekt` setzt alles ein, arbeitet in
// einem eigenen Verzeichnis und raeumt danach Zustand und Verzeichnis ab.

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  laufstandAbhaengigkeiten, laufstandZuruecksetzen, laufAbbrechen, pulsSchreiben, anhaltenLaeuft, zweiterVersuch,
  vermerkAnDieKarte, laufAnhalten,
} from "../../kit/night/laufstand.mjs";
import { ZUSTAND, LETZTES_PROTOKOLL, grundlagenAnbinden } from "../../kit/night/grundlagen.mjs";

/** Das Ende des Prozesses als Ausnahme mit Exit-Code — so bleibt der Test im Prozess. */
export class Ende extends Error {
  constructor(code) {
    super(`Prozessende mit Exit ${code}`);
    this.code = code;
  }
}

/**
 * Ein Board, das jeden Aufruf mitschreibt. Der Text einer `--text-file` wird beim Aufruf
 * gelesen, denn der Teil loescht die Zwischendatei danach. `antwort(aufruf)` darf ein
 * Ergebnis liefern; ohne Ergebnis nimmt das Board den Aufruf an.
 */
export function boardAttrappe(antwort = () => undefined) {
  const aufrufe = [];
  const board = (...args) => {
    const opts = args.at(-1) && typeof args.at(-1) === "object" ? args.pop() : {};
    const i = args.indexOf("--text-file");
    const aufruf = { args, opts, text: i >= 0 ? readFileSync(args[i + 1], "utf-8") : null };
    aufrufe.push(aufruf);
    return antwort(aufruf) ?? { status: 0, json: {}, text: "" };
  };
  /** Die `issue stand`-Aufrufe als `{ karte, zustand, text, budgetMs }`. */
  const staende = () => aufrufe
    .filter((a) => a.args[0] === "issue" && a.args[1] === "stand")
    .map((a) => ({ karte: a.args[2], zustand: a.args[4], text: a.text, budgetMs: a.opts.budgetMs }));
  return { board, aufrufe, staende };
}

/** Eine Uhr, die steht, bis der Test sie stellt. */
export function uhrAttrappe(start = "2026-10-01T01:00:00.000Z") {
  const uhr = { ms: Date.parse(start) };
  uhr.jetzt = () => new Date(uhr.ms);
  uhr.vor = (ms) => { uhr.ms += ms; };
  return uhr;
}

/** Die Zeilen einer JSONL-Datei. */
export function zeilen(pfad) {
  return readFileSync(pfad, "utf-8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
}

/**
 * Laesst `fn` in einem eigenen Projektverzeichnis laufen, mit eingesetzten Attrappen und an
 * die Grundlagen angebunden wie im Einstieg. `lebende` sind die PIDs, die die Prozess-Probe
 * als lebend meldet; jedes andere Signal als 0 schreibt sie nach `signale`. `config` landet
 * als `.claude/workflow.config.json` und in `ZUSTAND.config`. Danach ist der Zustand von
 * Teil und Grundlagen wieder der eines frischen Imports.
 */
export async function mitProjekt(fn, { antwort, lebende = [process.pid], config = null, abh = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-laufstand-"));
  const vorher = process.cwd();
  const attrappe = boardAttrappe(antwort);
  const uhr = uhrAttrappe();
  const signale = [];
  const schlaefe = [];
  const lebend = new Set(lebende);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  if (config) writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config, null, 2));
  process.chdir(dir);
  ZUSTAND.config = config;
  laufstandAbhaengigkeiten({
    board: attrappe.board,
    jetzt: uhr.jetzt,
    schlaf: (ms) => { schlaefe.push(ms); uhr.vor(ms); },
    warten: async () => { throw new Error("warten ohne eigene Attrappe"); },
    spawn: () => { throw new Error("spawn ohne eigene Attrappe"); },
    kill: (pid, signal) => {
      if (signal !== 0) {
        signale.push([pid, signal]);
        return true;
      }
      if (lebend.has(pid)) return true;
      throw Object.assign(new Error(`kill ESRCH ${pid}`), { code: "ESRCH" });
    },
    beenden: (code) => { throw new Ende(code); },
    ...abh,
  });
  grundlagenAnbinden({ pulsSchreiben, laufAbbrechen, anhaltenLaeuft, zweiterVersuch, vermerkAnDieKarte, laufAnhalten });
  try {
    return await fn({ dir, ...attrappe, uhr, signale, schlaefe, lebend });
  } finally {
    process.chdir(vorher);
    laufstandZuruecksetzen();
    laufstandAbhaengigkeiten();
    LETZTES_PROTOKOLL.clear();
    Object.assign(ZUSTAND, { LOG_FILE: null, ERGEBNIS_FILE: null, LAUF: null, LAUF_STEMPEL: null, STOPP_GRUND: "", config: null, LOG_KENNUNG: null });
    rmSync(dir, { recursive: true, force: true });
  }
}
