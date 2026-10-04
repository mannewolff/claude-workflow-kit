/**
 * windows-brueche.mjs — findet auf dem Mac Stellen, die unter Windows brechen, ohne
 * Windows-Rechner (Issue #1147, Kriterium 2; Plan #1150, E13 bis E17; Issue #1157).
 *
 *   node tools/windows-brueche.mjs [--wurzel <dir>] [--namen <datei>] [--json]
 *
 * Ohne `--wurzel` prueft das Werkzeug den Bestand unter dem Arbeitsverzeichnis (E17):
 * `kit/`, `tools/`, `test/`, `install.mjs` und `.githooks/` vollstaendig, in
 * `skills/**\/SKILL.md` und `templates/*.md` nur die Code-Bloecke mit `bash` oder `sh`.
 * Ausgenommen sind die eingebauten Brueche unter `test/fixtures/windows-brueche/` und die
 * installierte Kopie unter `.claude/`. Mit `--wurzel` liest es dort jede Datei, auch
 * `.txt` — so liegen die Fixtures, ohne dass `node --test` sie ausfuehrt.
 *
 * `--namen <datei>` liest eine Namensliste (eine Zeile je Name) fuer die Art `dateien`,
 * die ein Folgepaket ergaenzt. `--json` gibt die Funde als Liste aus.
 *
 * Ausgabe je Fund: `Hinweis: <datei>:<zeile> — <art>: <grund>`. Exit 0 auch bei Funden —
 * das Werkzeug meldet, es haelt nicht an; Exit 2 nur bei eigenem Fehler.
 *
 * Je Art eine benannte Regel in `REGELN` (E16). Bisher: `skips`. Die Arten `pfade`,
 * `kommandos`, `dateien`, `prozesse`, `zeilenenden` und `fakes` folgen in eigenen Paketen.
 *
 * Vermerk (E14): `windows-ausnahme: <Grund>` in derselben oder der direkt vorangehenden
 * Zeile, in Markdown als HTML-Kommentar, nimmt eine Stelle aus — aber nur, wenn in der
 * Stelle oder den fuenf Zeilen davor eine Plattformweiche steht (`process.platform`, ein
 * injizierter Parameter `plattform`, der Plattformname selbst). Sonst bleibt der Fund
 * mit dem Grund „Vermerk ohne Plattformzweig". Ein Vermerk ohne Grund ist selbst ein Fund.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---- Art skips --------------------------------------------------------------
//
// Kein Test ueberspringt sich wegen des Plattformnamens (Issue #1138, #1133; Plan #1128
// E6). Eine Zeile mit dem Plattformnamen ist ein Fund, wenn ihre Anweisung das Wort
// `skip` oder eine Konstante `NUR_POSIX*` nennt. Der Name allein ist erlaubt: Tests mit
// injizierter Plattform sind erwuenscht. Der Waechter `test/plattform-skips.test.mjs`
// importiert diese Regel und bleibt blockierend (Plan #1150, E19). Datendateien
// (`.json`, `.jsonl`, `.log`) sind kein Test: Ein aufgezeichneter Issue-Text, der von
// einem solchen Skip erzaehlt, ist kein Fund (E15).

const PLATTFORMNAME = "win32";
const VERBOTEN = /\bskip\b|\bNUR_POSIX\w*/;
// Wo eine Anweisung endet: Was danach folgt, gehoert nicht mehr zur Skip-Bedingung.
const ANWEISUNG_ENDET = /[;{]$|\),?$/;
const HOECHSTENS_ZEILEN = 4;
const DATEN = /\.(json|jsonl|log)$/;

/** Die Zeilennummern (ab 1) der Plattform-Skips in einem Quelltext. */
export function skipFunde(quelle) {
  const zeilen = quelle.split(/\r?\n/);
  const funde = [];
  zeilen.forEach((zeile, i) => {
    if (!zeile.includes(PLATTFORMNAME)) return;
    let anweisung = zeile;
    for (let j = i; j < zeilen.length && j < i + HOECHSTENS_ZEILEN; j++) {
      if (j > i) anweisung += `\n${zeilen[j]}`;
      if (ANWEISUNG_ENDET.test(zeilen[j].trimEnd())) break;
    }
    if (VERBOTEN.test(anweisung)) funde.push(i + 1);
  });
  return funde;
}

/** Je Art eine Regel: `pruefe(zeilen, kontext)` liefert `[{ zeile, grund }]`. */
export const REGELN = [
  {
    art: "skips",
    pruefe: (zeilen, { datei = "" } = {}) => DATEN.test(datei) ? [] : skipFunde(zeilen.join("\n")).map((zeile) => ({
      zeile,
      grund: "Test ueberspringt sich nach dem Plattformnamen statt nach einer Faehigkeit",
    })),
  },
];

// ---- Vermerk ----------------------------------------------------------------

const VERMERK = /windows-ausnahme:(.*)$/;
const WEICHE = /process\.platform|\bplattform\b|win32/;
const WEICHE_ZEILEN = 5;

function vermerkGrund(zeile) {
  const m = VERMERK.exec(zeile);
  if (!m) return null;
  return m[1].replace(/-->.*$/, "").replace(/\*\/.*$/, "").trim();
}

/**
 * Alle Funde in einem Quelltext, nach Vermerk gefiltert: `[{ zeile, art, grund }]`.
 * `regeln` ersetzt die Regeln (Tests), `kontext` geht an jede Regel (`datei`: der
 * angezeigte Pfad, `namen`: die Namensliste aus `--namen`).
 */
export function pruefeQuelle(quelle, { regeln = REGELN, kontext = {} } = {}) {
  const zeilen = quelle.split(/\r?\n/);
  const verbraucht = new Set();
  const funde = [];
  for (const regel of regeln) {
    for (const { zeile, grund } of regel.pruefe(zeilen, kontext)) {
      const bei = [zeile, zeile - 1].find((n) => n >= 1 && vermerkGrund(zeilen[n - 1]) !== null);
      if (bei === undefined) {
        funde.push({ zeile, art: regel.art, grund });
        continue;
      }
      verbraucht.add(bei);
      if (vermerkGrund(zeilen[bei - 1]) === "") {
        funde.push({ zeile, art: regel.art, grund: "Vermerk ohne Grund" });
      } else if (!zeilen.slice(Math.max(0, zeile - 1 - WEICHE_ZEILEN), zeile).some((z) => WEICHE.test(z))) {
        funde.push({ zeile, art: regel.art, grund: "Vermerk ohne Plattformzweig" });
      }
    }
  }
  zeilen.forEach((z, i) => {
    if (!verbraucht.has(i + 1) && vermerkGrund(z) === "") funde.push({ zeile: i + 1, art: "vermerk", grund: "Vermerk ohne Grund" });
  });
  return funde.sort((a, b) => a.zeile - b.zeile);
}

/**
 * Markdown: nur Code-Bloecke mit `bash` oder `sh` und Vermerke als HTML-Kommentar
 * bleiben stehen, jede andere Zeile wird leer — die Zeilennummern bleiben gleich.
 */
export function shellBloecke(markdown) {
  let zaun = null;
  return markdown.split(/\r?\n/).map((zeile) => {
    const m = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(zeile);
    if (zaun === null) {
      if (m) zaun = { zeichen: m[1], shell: m[2] === "bash" || m[2] === "sh" };
      return /<!--.*windows-ausnahme:/.test(zeile) ? zeile : "";
    }
    if (m && m[1].startsWith(zaun.zeichen) && m[2] === "") {
      zaun = null;
      return "";
    }
    return zaun.shell ? zeile : "";
  }).join("\n");
}

// ---- Dateiauswahl -----------------------------------------------------------

const VOLL = ["kit", "tools", "test", "install.mjs", ".githooks"];
const FIXTURES = join("test", "fixtures", "windows-brueche");

function alleDateien(dir, ausser = new Set()) {
  if (ausser.has(dir) || !existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => alleDateien(join(dir, e.name), ausser));
}

/** Die Dateien des Bestands unter `wurzel` (E17), jeweils mit Markdown-Kennzeichen. */
export function bestand(wurzel) {
  const ausser = new Set([join(wurzel, FIXTURES)]);
  const voll = VOLL.flatMap((p) => alleDateien(join(wurzel, p), ausser));
  const skills = alleDateien(join(wurzel, "skills")).filter((p) => /[\\/]SKILL\.md$/.test(p));
  const vorlagen = existsSync(join(wurzel, "templates"))
    ? readdirSync(join(wurzel, "templates")).filter((n) => n.endsWith(".md")).map((n) => join(wurzel, "templates", n))
    : [];
  return [...voll, ...skills, ...vorlagen];
}

const anzeige = (wurzel, pfad) => relative(wurzel, pfad).split(/[\\/]/).join("/");

/** Prueft die Dateien und liefert `[{ datei, zeile, art, grund }]`, nach Datei geordnet. */
export function pruefe({ wurzel, dateien, kontext = {} }) {
  return dateien
    .map((pfad) => ({ pfad, datei: anzeige(wurzel, pfad) }))
    .sort((a, b) => a.datei.localeCompare(b.datei))
    .flatMap(({ pfad, datei }) => {
      const roh = readFileSync(pfad, "utf-8");
      const quelle = pfad.endsWith(".md") ? shellBloecke(roh) : roh;
      return pruefeQuelle(quelle, { kontext: { ...kontext, datei } }).map((f) => ({ datei, ...f }));
    });
}

export const hinweisZeile = (f) => `Hinweis: ${f.datei}:${f.zeile} — ${f.art}: ${f.grund}`;

function argumente(argv) {
  const opts = { wurzel: null, namen: null, json: false };
  const rest = [...argv];
  while (rest.length > 0) {
    const a = rest.shift();
    if (a === "--json") opts.json = true;
    else if ((a === "--wurzel" || a === "--namen") && rest.length > 0) opts[a.slice(2)] = rest.shift();
    else throw new Error(`unbekanntes oder unvollstaendiges Argument: ${a}`);
  }
  return opts;
}

function haupt(argv) {
  const opts = argumente(argv);
  const kontext = {};
  if (opts.namen !== null) {
    kontext.namen = readFileSync(opts.namen, "utf-8").split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  }
  let wurzel;
  let dateien;
  if (opts.wurzel !== null) {
    wurzel = resolve(opts.wurzel);
    if (!existsSync(wurzel) || !statSync(wurzel).isDirectory()) throw new Error(`--wurzel ist kein Verzeichnis: ${opts.wurzel}`);
    dateien = alleDateien(wurzel);
  } else {
    wurzel = process.cwd();
    dateien = bestand(wurzel);
  }
  const funde = pruefe({ wurzel, dateien, kontext });
  process.stdout.write(opts.json ? JSON.stringify(funde, null, 2) + "\n" : funde.map((f) => hinweisZeile(f) + "\n").join(""));
}

const direkt = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (direkt) {
  try {
    haupt(process.argv.slice(2));
    process.exitCode = 0;
  } catch (e) {
    process.stderr.write(`windows-brueche: ${e.message}\n`);
    process.exitCode = 2;
  }
}
