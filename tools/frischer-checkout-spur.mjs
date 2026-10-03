/**
 * frischer-checkout-spur.mjs — schreibt die Dateizugriffe mit, die unterhalb einer
 * Wurzel zur Laufzeit fehlschlagen (Issue #1037, Plan #1035, A2–A4).
 *
 * Anlass ist der stille Fall aus Issue #1012: Ein Test ueberspringt eine Datei, die
 * im frischen Checkout fehlt (`if (!existsSync(p)) return;`), und ist dort gruen,
 * ohne etwas geprueft zu haben. Sein Ergebnis verraet das nicht, nur sein Zugriff.
 * Das Pruefwerkzeug fuer den frischen Checkout laedt diesen Einstieg deshalb in jeden
 * Node-Prozess seines Laufs und wertet die Spur danach aus.
 *
 * Geladen wird er ueber `NODE_OPTIONS=--import <file-URL>`. Uebergeben wird immer die
 * `file://`-URL (`pathToFileURL(pfad).href`), nie der Pfad: Unter Windows laese Node
 * `c:\…` als URL mit dem Schema `c:` und scheiterte. `NODE_OPTIONS` erben Kindprozesse,
 * die ein Test mit `{ ...process.env }` startet; wer eine eigene, leere Umgebung
 * uebergibt, faellt aus der Spur (Plan #1035, E5).
 *
 * Umgebungsvariablen:
 *   KIT_CHECKOUT_SPUR       Spurdatei (JSON Lines). Fehlt sie, tut der Einstieg nichts.
 *   KIT_CHECKOUT_WURZEL     Wurzel des frischen Stands. Nur Fehlschlaege darunter zaehlen.
 *   KIT_CHECKOUT_TESTDATEI  Testdatei, der die Zugriffe gehoeren. Ist sie leer und fuehrt
 *                           der Prozess eine `*.test.mjs` aus, setzt der Einstieg sie aus
 *                           `process.argv[1]` — Kindprozesse erben sie ueber die Umgebung.
 *
 * Eine Spurzeile ist `{ datei, pfad, zugriff }`: `datei` die Testdatei relativ zur
 * Wurzel (oder `null`), `pfad` der fehlende Pfad relativ zur Wurzel mit `/`, `zugriff`
 * der Name der Funktion (`existsSync`, `promises.readFile`, …).
 *
 * Eingehuellt werden die synchronen Pruef- und Lesefunktionen von `fs` und ihre
 * Gegenstuecke in `fs/promises`; `module.syncBuiltinESMExports()` reicht die Huellen
 * an benannte ESM-Importe weiter. Die Huelle ruft die Originalfunktion und aendert
 * weder Ergebnis noch Fehler. Ein Marker am Funktionsobjekt macht das Einhuellen
 * idempotent, auch wenn der Einstieg unter zwei URLs zweimal geladen wird.
 * Fehlgeschlagene ESM-Importe spurt er bewusst nicht (Plan #1035, E4).
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = Symbol.for("kit.frischer-checkout.spur");
const SYNC = ["existsSync", "statSync", "lstatSync", "accessSync", "readFileSync", "readdirSync", "openSync"];
const ASYNC = ["stat", "lstat", "access", "readFile", "readdir", "open"];
const FEHLT = new Set(["ENOENT", "ENOTDIR"]);

const spurdatei = process.env.KIT_CHECKOUT_SPUR;

if (spurdatei && !fs.existsSync[MARKER]) {
  const { existsSync, realpathSync, appendFileSync } = fs;

  if (!process.env.KIT_CHECKOUT_TESTDATEI && /\.test\.mjs$/.test(process.argv[1] ?? "")) {
    process.env.KIT_CHECKOUT_TESTDATEI = resolve(process.argv[1]);
  }

  let wurzel;
  try {
    wurzel = process.env.KIT_CHECKOUT_WURZEL ? realpathSync(process.env.KIT_CHECKOUT_WURZEL) : null;
  } catch {
    wurzel = null;
  }

  /** Realer Pfad; fehlt er, ueber den naechsten existierenden Elternordner. */
  const realer = (pfad) => {
    let ordner = pfad;
    const rest = [];
    while (!existsSync(ordner)) {
      const oben = dirname(ordner);
      if (oben === ordner) return pfad;
      rest.unshift(ordner.slice(oben.length).replace(/^[\\/]+/, ""));
      ordner = oben;
    }
    return join(realpathSync(ordner), ...rest);
  };

  /** Pfad relativ zur Wurzel mit `/`, oder `null`, wenn er nicht darunter liegt. */
  const unterWurzel = (pfad) => {
    const rel = relative(wurzel, realer(resolve(pfad)));
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
    return rel.split(sep).join("/");
  };

  const schreibe = (ziel, zugriff) => {
    if (!wurzel) return;
    try {
      if (ziel instanceof URL) ziel = fileURLToPath(ziel);
      else if (Buffer.isBuffer(ziel)) ziel = ziel.toString();
      if (typeof ziel !== "string") return; // Dateideskriptor oder Filehandle
      const pfad = unterWurzel(ziel);
      if (!pfad) return;
      const test = process.env.KIT_CHECKOUT_TESTDATEI;
      const datei = test ? (unterWurzel(test) ?? test) : null;
      appendFileSync(spurdatei, JSON.stringify({ datei, pfad, zugriff }) + "\n");
    } catch {
      // Die Spur darf den Prozess, den sie beobachtet, nie stoeren.
    }
  };

  const markiere = (huelle) => Object.defineProperty(huelle, MARKER, { value: true });

  // readFileSync ruft intern das oeffentliche openSync: Nur der aeusserste Aufruf zaehlt.
  let tiefe = 0;
  for (const name of SYNC) {
    const original = fs[name];
    fs[name] = markiere(function (ziel, ...rest) {
      if (tiefe > 0) return original.call(this, ziel, ...rest);
      let ergebnis;
      tiefe++;
      try {
        ergebnis = original.call(this, ziel, ...rest);
      } catch (fehler) {
        if (FEHLT.has(fehler?.code)) schreibe(ziel, name);
        throw fehler;
      } finally {
        tiefe--;
      }
      // existsSync meldet false, statSync/lstatSync mit throwIfNoEntry:false undefined
      if (ergebnis === false && name === "existsSync") schreibe(ziel, name);
      if (ergebnis === undefined && (name === "statSync" || name === "lstatSync")) schreibe(ziel, name);
      return ergebnis;
    });
  }

  for (const name of ASYNC) {
    const original = fsp[name];
    fsp[name] = markiere(async function (ziel, ...rest) {
      try {
        return await original.call(this, ziel, ...rest);
      } catch (fehler) {
        if (FEHLT.has(fehler?.code)) schreibe(ziel, `promises.${name}`);
        throw fehler;
      }
    });
  }

  syncBuiltinESMExports();
}
