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
 * `--namen <datei>` liest eine Namensliste (eine Zeile je Name) fuer die Art `dateien`.
 * Ohne `--namen` und ohne `--wurzel` kommen die Namen aus `git ls-files`; mit `--wurzel`
 * allein prueft das Werkzeug keine Namen. `--json` gibt die Funde als Liste aus.
 *
 * Ausgabe je Fund: `Hinweis: <datei>:<zeile> — <art>: <grund>`. Exit 0 auch bei Funden —
 * das Werkzeug meldet, es haelt nicht an; Exit 2 nur bei eigenem Fehler.
 *
 * Je Art eine benannte Regel in `REGELN` (E16). Bisher: `skips`, `pfade`, `kommandos`,
 * `dateien`. Die Arten `prozesse`, `zeilenenden` und `fakes` folgen in eigenen Paketen.
 *
 * Vermerk (E14): `windows-ausnahme: <Grund>` in derselben oder der direkt vorangehenden
 * Zeile, in Markdown als HTML-Kommentar, nimmt eine Stelle aus — aber nur, wenn in der
 * Stelle oder den fuenf Zeilen davor eine Plattformweiche steht (`process.platform`, ein
 * injizierter Parameter `plattform`, der Plattformname selbst). Sonst bleibt der Fund
 * mit dem Grund „Vermerk ohne Plattformzweig". Ein Vermerk ohne Grund ist selbst ein Fund.
 */

import { spawnSync } from "node:child_process";
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

// ---- Art pfade --------------------------------------------------------------
//
// Pfade und Pfadlisten in Mac-Schreibweise (Issue #1158; echte Faelle #1145, #1146). Die
// Regel meldet nur Stellen, an denen der Text als Pfad oder Pfadliste benutzt wird — ein
// Muster je Bruch, jedes mit eigenem Grund. Nicht gemeldet: `/dev/null` oder `/tmp` mitten
// in einer Shell-Zeile (das ist die Art `kommandos`), Testerwartungen und Kommentare, die
// solche Pfade nur nennen.

// Eine Zeichenkette, die mit `/tmp` oder `/dev/null` beginnt.
const POSIX_PFAD = /["'`](?:\/tmp[/"'`]|\/dev\/null["'`])/;
// Datei-, Pfad- und Prozessaufrufe ohne `Sync` im Namen; jeder `…Sync`-Aufruf zaehlt dazu.
const PFAD_AUFRUFE = new Set([
  "join", "resolve", "spawn", "execFile", "fork", "open", "readFile", "writeFile", "appendFile",
  "mkdtemp", "mkdir", "rm", "stat", "access", "unlink", "createReadStream", "createWriteStream",
]);

const PFADMUSTER = [
  {
    // Eine Variable der Programmpfade (`PATH`, `NODE_PATH`), zusammengesetzt oder zerlegt
    // am Doppelpunkt: zwei Einsetzungen mit `:` dazwischen oder `":"` als eigenes Stueck.
    // Unter Windows trennt `;`, der Eintrag wird nicht als eigener Pfad gelesen (#1145).
    treffer: (z) => /\b[A-Z_]*PATH\b/.test(z) && /\}:\$\{|[(+]\s*["'`]:["'`]|["'`]:["'`]\s*[)+]/.test(z),
    grund: "Pfadliste mit \":\" als Trenner statt path.delimiter",
  },
  {
    // Ein fester POSIX-Pfad als Argument eines Datei-, Pfad- oder Prozessaufrufs oder als
    // `cwd`. Unter Windows gibt es weder `/tmp` noch das Nullgeraet `/dev/null`.
    treffer: (z) => {
      const m = POSIX_PFAD.exec(z);
      if (!m) return false;
      const davor = z.slice(0, m.index);
      const aufruf = /\b(\w+)\s*\([^()]*$/.exec(davor);
      return /\bcwd:\s*$/.test(davor) || (aufruf !== null && (aufruf[1].endsWith("Sync") || PFAD_AUFRUFE.has(aufruf[1])));
    },
    grund: "fester POSIX-Pfad (/tmp oder /dev/null) statt os.tmpdir() bzw. Nullgeraet der Plattform",
  },
  {
    // Den letzten Teil eines Pfads am Schraegstrich abschneiden: Unter Windows trennt `\`,
    // das Ergebnis ist der ganze Pfad (#1146). Repo-Namen, URLs und Config-Vorlagen tragen
    // `/` als festes Format und sind kein Pfad des Dateisystems.
    treffer: (z) => /\.split\(\s*["'`]\/["'`]\s*\)\s*\.(?:pop\(\)|at\(\s*-1\s*\))/.test(z) && !/repo|url|template/i.test(z),
    grund: "Pfadzerlegung an \"/\" statt basename",
  },
];

/** Die Funde der Art `pfade` in den Zeilen eines Quelltexts: `[{ zeile, grund }]`. */
export function pfadFunde(zeilen) {
  return zeilen.flatMap((z, i) => {
    const muster = PFADMUSTER.find((m) => m.treffer(z));
    return muster ? [{ zeile: i + 1, grund: muster.grund }] : [];
  });
}

// ---- Art kommandos ----------------------------------------------------------
//
// Kommandos, die nur auf Mac und Linux laufen (Issue #1159; echte Faelle #1137, #1131,
// #1143, #1139). Im Code: ein Zeichenketten-Aufruf (`exec`/`execSync`, `spawn`/`execFile`
// mit `shell: true`), dessen woertlicher Text POSIX-Shellsyntax enthaelt — unter Windows
// liest ihn die `cmd.exe` —, und ein Aufruf, der `sh` oder `bash` woertlich als Programm
// startet statt ueber die Git-Bash-Aufloesung (`posixShell`, `gitBashPfad`). Nur ein
// woertliches erstes Argument zaehlt: `spawn(cmd, { shell: true })` ueber ein
// konfiguriertes Projektkommando wie in `kit/checks.mjs` ist kein Fund (Nicht-Ziel der
// Quelle #1147). In Markdown: `$TMPDIR` in einem Bash-Block, ohne dass derselbe Abschnitt
// den Rueckfall `cygpath -m "$TEMP"` nennt — in der Git Bash ist `TMPDIR` leer.

const AUFRUF = /(\.?)\b(execSync|exec|execFileSync|execFile|spawnSync|spawn)\s*\(/g;
const NUR_SHELL = new Set(["exec", "execSync"]);
const AUFRUF_ZEILEN = 4;
const POSIX_SYNTAX = /\/dev\/null|\$\(|\$[A-Za-z_@]/;
const SHELL_PROGRAMM = /^(?:\S*\/)?(?:ba)?sh$/;
const SHELL_VORNE = /^\s*(?:\S*\/)?(?:ba)?sh\s/;
const CODE = /\.(?:mjs|cjs|js)$/;

/** Der Text eines Aufrufs ab der oeffnenden Klammer bis zur schliessenden, ohne sie. */
function aufrufText(text, start) {
  let tiefe = 1;
  let zeichenkette = null;
  let maskiert = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (maskiert) maskiert = false;
    else if (zeichenkette !== null) {
      if (c === "\\") maskiert = true;
      else if (c === zeichenkette) zeichenkette = null;
    } else if (c === '"' || c === "'" || c === "`") zeichenkette = c;
    else if (c === "(") tiefe++;
    else if (c === ")" && --tiefe === 0) return text.slice(start, i);
  }
  return text.slice(start);
}

/** Das erste Argument, wenn es eine woertliche Zeichenkette ist, sonst `null`. */
function woertlich(argumente) {
  const m = /^\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(argumente);
  return m ? m[2] : null;
}

/** Die Funde der Zeichenketten-Aufrufe in den Zeilen eines Quelltexts: `[{ zeile, grund }]`. */
export function aufrufFunde(zeilen) {
  const funde = [];
  zeilen.forEach((zeile, i) => {
    const text = zeilen.slice(i, i + AUFRUF_ZEILEN).join("\n");
    for (const m of zeile.matchAll(AUFRUF)) {
      if (m[1] === "." && m[2] === "exec") continue; // RegExp#exec
      const argumente = aufrufText(text, m.index + m[0].length);
      const programm = woertlich(argumente);
      if (programm === null) continue;
      const shell = NUR_SHELL.has(m[2]) || /\bshell:\s*true\b/.test(argumente);
      let grund = null;
      if (NUR_SHELL.has(m[2]) ? SHELL_VORNE.test(programm) : SHELL_PROGRAMM.test(programm.trim())) {
        grund = "sh/bash als Programm ohne Git-Bash-Aufloesung (posixShell, gitBashPfad)";
      } else if (shell && POSIX_SYNTAX.test(programm)) {
        grund = "POSIX-Shellsyntax in einem Zeichenketten-Aufruf, den unter Windows cmd.exe liest";
      }
      if (grund !== null) {
        funde.push({ zeile: i + 1, grund });
        break;
      }
    }
  });
  return funde;
}

const ZAUN = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;
const UEBERSCHRIFT = /^#{1,6}\s/;
const TMPDIR = /\$\{?TMPDIR\b/;
const RUECKFALL = 'cygpath -m "$TEMP"';

/** Die Zeilen mit `$TMPDIR` in Bash-Bloecken, deren Abschnitt keinen `cygpath`-Rueckfall nennt. */
export function tmpdirFunde(zeilen) {
  let zaun = null;
  let abschnitt = 0;
  const mitRueckfall = new Set();
  const kandidaten = [];
  zeilen.forEach((zeile, i) => {
    const m = ZAUN.exec(zeile);
    if (zaun === null) {
      if (m) zaun = { zeichen: m[1], shell: m[2] === "bash" || m[2] === "sh" };
      else if (UEBERSCHRIFT.test(zeile)) abschnitt++;
    } else if (m && m[1].startsWith(zaun.zeichen) && m[2] === "") {
      zaun = null;
    } else if (zaun.shell && TMPDIR.test(zeile)) {
      kandidaten.push({ zeile: i + 1, abschnitt });
    }
    if (zeile.includes(RUECKFALL)) mitRueckfall.add(abschnitt);
  });
  return kandidaten
    .filter((k) => !mitRueckfall.has(k.abschnitt))
    .map(({ zeile }) => ({ zeile, grund: "$TMPDIR ohne den Rueckfall cygpath -m \"$TEMP\" im selben Abschnitt" }));
}

// ---- Art dateien ------------------------------------------------------------
//
// Dateinamen und Dateirechte, die es unter Windows nicht gibt (Issue #1160; echte Faelle
// #1138, #1136, #1146). Die Namen prueft `namenFunde` ueber eine Liste — im Bestand aus
// `git ls-files`, sonst aus `--namen` —, nie ueber echte Dateien: Ein verbotener Name im
// Repository braeche jeden Windows-Klon. Im Inhalt meldet die Regel Dateirechte, auf die
// sich Code oder Test verlaesst: ein Rechte-Aufruf mit festem Modus, der dem Eigentuemer
// das Leserecht nimmt (unter Windows setzt er nur das Schreibschutz-Attribut), und das
// Lesen der x-Bits aus den Dateirechten von `stat` (unter Windows nie gesetzt). Kein Fund:
// Ausfuehrbarkeit setzen (dort wirkungslos, kein Bruch; ein Ersatzprogramm ohne Huelle
// ist die Art `fakes`), Schreibschutz, `X_OK` (unter Windows ein Existenztest), und ein
// Leseschutz in einem Test oder einer Probe, die sich ueber die Faehigkeit
// `MIT_DATEIRECHTEN` ausnimmt — dort laeuft er nur, wo er greift.

const VERBOTENE_ZEICHEN = '<>:"|?*';
const RESERVIERT = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const RECHTE_AUFRUF = /\b[fl]?chmod(?:Sync)?\s*\(/g;
const FESTER_MODUS = /^(?:0o[0-7]+|\d+|"[0-7]+"|'[0-7]+')$/;
const RECHTE_SHELL = /\bchmod\s+(?:-[a-zA-Z]+\s)?(?:0?[0-3][0-7]{2}\b|[ugoa]*-[wx]*r)/;
const X_BITS = /\bmode\)?\s?&\s?(0o[0-7]+)/;
const KOPF = /^\s*(?:export\s+)?(?:async\s+)?function\b|^\s*test\(/;
const FAEHIGKEIT = /\bMIT_DATEIRECHTEN\b|\bdateirechteGreifen\b/;

/**
 * Die Funde in einer Namensliste (`/` trennt die Teile eines Pfads): `[{ index, grund }]`.
 * Fuer zwei Namen, die sich nur in der Schreibweise unterscheiden, zaehlt der zweite.
 */
export function namenFunde(namen) {
  const gesehen = new Map();
  const funde = [];
  namen.forEach((name, index) => {
    const teile = name.split("/");
    const zeichen = [...name].find((c) => VERBOTENE_ZEICHEN.includes(c) || c.charCodeAt(0) < 32);
    const reserviert = teile.find((t) => RESERVIERT.test(t.split(".")[0]));
    let grund = null;
    if (zeichen) grund = `unter Windows verbotenes Zeichen ${JSON.stringify(zeichen)} im Namen ${name}`;
    else if (reserviert) grund = `unter Windows reservierter Name ${reserviert} in ${name}`;
    else {
      for (let n = 1; n <= teile.length && grund === null; n++) {
        const pfad = teile.slice(0, n).join("/");
        const frueher = gesehen.get(pfad.toLowerCase());
        if (frueher === undefined) gesehen.set(pfad.toLowerCase(), pfad);
        else if (frueher !== pfad) grund = `${pfad} unterscheidet sich von ${frueher} nur in der Schreibweise`;
      }
    }
    if (grund !== null) funde.push({ index, grund });
  });
  return funde;
}

/** Ob die Zeile in einem Test oder einer Funktion steht, deren Kopf die Faehigkeit nennt. */
function unterFaehigkeit(zeilen, i) {
  for (let j = i; j >= 0; j--) if (KOPF.test(zeilen[j])) return FAEHIGKEIT.test(zeilen[j]);
  return false;
}

/** Der Modus im letzten Argument eines Aufrufs als Zahl, oder `null`, wenn er nicht fest ist. */
function festerModus(argumente) {
  const ohneKomma = argumente.trimEnd().replace(/,$/, "");
  const text = ohneKomma.slice(ohneKomma.lastIndexOf(",") + 1).trim();
  if (!FESTER_MODUS.test(text)) return null;
  if (text.startsWith("0o")) return parseInt(text.slice(2), 8);
  const zeichenkette = text.startsWith('"') || text.startsWith("'");
  const ziffern = zeichenkette ? text.slice(1, -1) : text;
  return parseInt(ziffern, zeichenkette || ziffern.startsWith("0") ? 8 : 10);
}

/** Die Funde der Dateirechte in den Zeilen eines Quelltexts: `[{ zeile, grund }]`. */
export function rechteFunde(zeilen) {
  const funde = [];
  zeilen.forEach((zeile, i) => {
    const text = zeilen.slice(i, i + AUFRUF_ZEILEN).join("\n");
    const leseschutz = RECHTE_SHELL.test(zeile) || [...zeile.matchAll(RECHTE_AUFRUF)].some((m) => {
      const fest = festerModus(aufrufText(text, m.index + m[0].length));
      return fest !== null && (fest & 0o400) === 0;
    });
    const x = X_BITS.exec(zeile);
    if (leseschutz && !unterFaehigkeit(zeilen, i)) {
      funde.push({ zeile: i + 1, grund: "Rechte-Aufruf nimmt das Leserecht; unter Windows bleibt die Datei lesbar" });
    } else if (x && (parseInt(x[1].slice(2), 8) & 0o111) !== 0) {
      funde.push({ zeile: i + 1, grund: "liest die x-Bits der Dateirechte; unter Windows sind sie nie gesetzt" });
    }
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
  {
    art: "pfade",
    pruefe: (zeilen, { datei = "" } = {}) => DATEN.test(datei) ? [] : pfadFunde(zeilen),
  },
  {
    // Markdown liest die Regel roh (`kontext.roh`): Den Rueckfall nennt oft der Fliesstext
    // des Abschnitts, nicht der Block selbst. Eine Code-Datei traegt keine Bash-Bloecke.
    art: "kommandos",
    pruefe: (zeilen, { datei = "", roh = zeilen } = {}) => DATEN.test(datei) ? [] : [
      ...aufrufFunde(zeilen),
      ...(CODE.test(datei) ? [] : tmpdirFunde(roh)),
    ],
  },
  {
    // Die Namen prueft `pruefe` ueber `namenFunde`, sie stehen in keiner Datei.
    art: "dateien",
    pruefe: (zeilen, { datei = "" } = {}) => DATEN.test(datei) ? [] : rechteFunde(zeilen),
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
 * angezeigte Pfad, `roh`: die ungefilterten Zeilen einer Markdown-Datei).
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

/**
 * Prueft die Dateien und die Namensliste und liefert `[{ datei, zeile, art, grund }]`,
 * nach Datei geordnet. Ein Name der Liste traegt `datei` und `zeile`: die Zeile seiner
 * Namensliste, oder bei `git ls-files` den Namen selbst und Zeile 1.
 */
export function pruefe({ wurzel, dateien, namen = [], kontext = {} }) {
  const imInhalt = dateien.map((pfad) => ({ pfad, datei: anzeige(wurzel, pfad) })).flatMap(({ pfad, datei }) => {
    const roh = readFileSync(pfad, "utf-8");
    const quelle = pfad.endsWith(".md") ? shellBloecke(roh) : roh;
    return pruefeQuelle(quelle, { kontext: { ...kontext, datei, roh: roh.split(/\r?\n/) } }).map((f) => ({ datei, ...f }));
  });
  const imNamen = namenFunde(namen.map((n) => n.name))
    .map(({ index, grund }) => ({ datei: namen[index].datei, zeile: namen[index].zeile, art: "dateien", grund }));
  return [...imInhalt, ...imNamen].sort((a, b) => a.datei.localeCompare(b.datei) || a.zeile - b.zeile);
}

/** Die Namen aus `--namen`: `[{ name, datei, zeile }]`, leere Zeilen uebersprungen. */
function namenAusListe(wurzel, pfad) {
  const datei = anzeige(wurzel, resolve(pfad));
  return readFileSync(pfad, "utf-8").split(/\r?\n/)
    .map((z, i) => ({ name: z.trim(), datei, zeile: i + 1 }))
    .filter((n) => n.name !== "");
}

/** Die Namen aus `git ls-files`; ausserhalb eines Repositorys keine. */
function namenAusGit(wurzel) {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: wurzel, encoding: "utf-8" });
  if (r.status !== 0) return [];
  return r.stdout.split("\0").filter(Boolean).map((name) => ({ name, datei: name, zeile: 1 }));
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
  let namen = [];
  if (opts.namen !== null) namen = namenAusListe(wurzel, opts.namen);
  else if (opts.wurzel === null) namen = namenAusGit(wurzel);
  const funde = pruefe({ wurzel, dateien, namen });
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
