/**
 * board/hook.mjs — Hook gegen Pipe und Umleitung hinter ausgenommenen Kommandos im
 * Board-Werkzeug (Issue #1223, Plan #1199, E17): die Pruefungen `pruefeBashZeile` und
 * `pruefeHintergrund` und der Befehl `hook bash-pruefen`.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus. Darum bekommt `dispatchHook` die Hilfe als Argument.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { fail } from "./grundlagen.mjs";

// ============================================================
// Hook gegen Pipe und Umleitung hinter ausgenommenen Kommandos (Issue #995)
// ============================================================
//
// Seit Claude Code 2.1.277 nimmt `sandbox.excludedCommands` eine zusammengesetzte
// Zeile nur noch aus der Sandbox, wenn JEDER Teil zu einem Eintrag passt. Ein
// `node .claude/kit/board.mjs … | head` laeuft darum ganz in der Sandbox — ohne Netz,
// samt dem codex, das board.mjs startet (Nachtlauf 2026-09-28, Issue #986). Eine
// Eingabeumleitung (`codex exec … < datei`) hebt die Ausnahme ebenfalls auf, auch
// wenn sonst nichts in der Zeile steht. Der Hook weist solche Zeilen ab, bevor sie
// laufen, und nennt die richtige Form.
//
// Die Muster kommen zur Laufzeit aus den Settings des Projekts, nicht aus einer festen
// Liste: Genau diese Eintraege verlieren ihre Wirkung, auch fremde wie `mvn *`.

/** Ein Muster aus `excludedCommands` als RegExp: `*` steht fuer einen beliebigen Rest. */
function bashMusterRegex(muster) {
  const quelle = muster.split("*").map((s) => s.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)).join(".*");
  return new RegExp(`^${quelle}$`, "s");
}

// Ein Umlenken auf einen anderen Dateideskriptor (`2>&1`, `>&2`, `<&0`) — kein Dateiziel.
const BASH_FD_DUPLIKAT = /^[<>]&(\d+|-)/;
// Eine Umleitung in oder aus einer Datei, laengste Form zuerst.
const BASH_UMLEITUNG = /^(&>>|&>|<<-|<<|>>|>\||<|>)/;
// Zeichen, an denen das Wort hinter einer Umleitung (ihr Ziel) endet.
const BASH_OPERATOR_ZEICHEN = "|;&<>\n";

/**
 * Zerlegt eine Bash-Zeile in ihre Befehle und merkt, ob sie in eine Datei oder aus
 * einer Datei umleitet. Operatoren zaehlen nur ausserhalb von Anfuehrungszeichen und
 * nicht hinter einem Backslash — `--text "a > b"` ist Text, kein Operator.
 *
 * Bewusst keine vollstaendige Shell: Befehlsersetzung (`$(…)`, Backticks) bleibt Teil
 * des Wortes. Im Zweifel faellt die Zeile damit nicht auf; abgewiesen wird nur, was
 * an der Oberflaeche sichtbar ist.
 */
class BashZerleger {
  constructor(zeile) {
    this.zeile = zeile;
    this.pos = 0;
    this.teile = [];
    this.aktuell = "";
    this.quote = null;
    this.umleitung = false;
    // Das Wort hinter einer Umleitung ist ihr Ziel, kein Argument des Befehls:
    // null (kein Ziel offen), "davor" (Leerraum vor dem Ziel), "drin" (im Ziel).
    this.ziel = null;
  }

  zerlege() {
    while (this.pos < this.zeile.length) this.schritt(this.zeile[this.pos]);
    this.schliessen();
    return { teile: this.teile.filter((t) => t.length > 0), umleitung: this.umleitung };
  }

  schreibe(text) {
    if (this.ziel) this.ziel = "drin";
    else this.aktuell += text;
    this.pos += text.length;
  }

  schliessen() {
    this.teile.push(this.aktuell.trim());
    this.aktuell = "";
    this.ziel = null;
  }

  schritt(c) {
    if (this.quote) return this.inAnfuehrung(c);
    if (c === "\\") return this.schreibe(this.zeile.slice(this.pos, this.pos + 2));
    if (c === "'" || c === '"') { this.quote = c; return this.schreibe(c); }
    if (this.imZiel(c)) { this.pos++; return; }
    if (this.trenner(c) || this.umlenkung()) return;
    this.aktuell += c;
    this.pos++;
  }

  inAnfuehrung(c) {
    if (c === "\\" && this.quote === '"') return this.schreibe(this.zeile.slice(this.pos, this.pos + 2));
    if (c === this.quote) this.quote = null;
    this.schreibe(c);
  }

  /** Verbraucht Zeichen des Umleitungsziels; `false`, wenn keines offen ist oder es endet. */
  imZiel(c) {
    if (!this.ziel) return false;
    if (c !== "\n" && /\s/.test(c)) {
      if (this.ziel === "drin") { this.ziel = null; this.aktuell += " "; }
      return true;
    }
    if (!BASH_OPERATOR_ZEICHEN.includes(c)) { this.ziel = "drin"; return true; }
    this.ziel = null;
    return false;
  }

  /** `|`, `||`, `|&`, `&&`, `&`, `;`, Zeilenumbruch: Ende eines Befehls. */
  trenner(c) {
    const zwei = this.zeile.slice(this.pos, this.pos + 2);
    let laenge = 0;
    if (zwei === "&&" || zwei === "||" || zwei === "|&") laenge = 2;
    else if ("\n;|".includes(c) || (c === "&" && zwei !== "&>")) laenge = 1;
    if (laenge === 0) return false;
    this.schliessen();
    this.pos += laenge;
    return true;
  }

  umlenkung() {
    const rest = this.zeile.slice(this.pos);
    const dup = BASH_FD_DUPLIKAT.exec(rest);
    if (dup) {
      this.aktuell += dup[0];
      this.pos += dup[0].length;
      return true;
    }
    const um = BASH_UMLEITUNG.exec(rest);
    if (!um) return false;
    this.umleitung = true;
    // Die Nummer des umgeleiteten Deskriptors (`2>/dev/null`) gehoert zur Umleitung.
    this.aktuell = this.aktuell.replace(/(^|\s)\d+$/, "$1");
    this.ziel = "davor";
    this.pos += um[0].length;
    return true;
  }
}

/**
 * Weist eine Bash-Zeile ab, wenn ein Teil davon zu einem Muster aus
 * `sandbox.excludedCommands` passt, die Zeile die Ausnahme aber wieder aufhebt:
 * durch eine Umleitung in oder aus einer Datei, oder durch eine Pipe bzw. einen
 * weiteren Befehl (`&&`, `||`, `;`, Zeilenumbruch), dessen Teile nicht alle passen.
 *
 * MESSUNG zu `2>&1` (Claude Code 2.1.283, 2026-09-29, interaktive Session im
 * Auto-Modus mit aktiver Projekt-Sandbox dieses Repos; als Probe diente
 * `node .claude/kit/board.mjs issue get <n>`, ausgenommen und auf das Netz
 * angewiesen — in der Sandbox scheitert es mit "fetch failed"):
 *   - ohne Umleitung:  Board erreicht, laeuft ausserhalb der Sandbox.
 *   - mit `2>&1`:      Board erreicht, die Ausnahme bleibt bestehen.
 *   - mit `2>/dev/null`: nicht gemessen (die Messung wurde vom Auto-Modus
 *                      abgelehnt); faellt als Umleitung in eine Datei unter die
 *                      Grundregel und wird abgewiesen.
 * Die im Arbeitspaket vorgesehene headless Session (`claude -p`) wurde vom
 * Auto-Modus als neuer Agent abgelehnt; die Sandbox-Entscheidung liegt aber in
 * derselben Claude-Code-Fassung. Darum bleibt ein reines Umlenken auf einen anderen
 * Deskriptor (`2>&1`, `>&2`) erlaubt.
 *
 * @param {string} zeile  die Bash-Zeile aus `tool_input.command`
 * @param {string[]} muster  die Eintraege aus `excludedCommands`
 * @returns {{ abweisen: boolean, grund: string|null }}
 */
export function pruefeBashZeile(zeile, muster) {
  const erlaubt = { abweisen: false, grund: null };
  if (typeof zeile !== "string" || !Array.isArray(muster) || muster.length === 0) return erlaubt;
  const regexe = muster.filter((m) => typeof m === "string" && m.trim()).map((m) => [m, bashMusterRegex(m.trim())]);
  const { teile, umleitung } = new BashZerleger(zeile).zerlege();
  const passend = (teil) => regexe.find(([, re]) => re.test(teil))?.[0];

  const treffer = teile.map(passend);
  const erstes = treffer.find(Boolean);
  if (!erstes) return erlaubt;
  if (!umleitung && treffer.every(Boolean)) return erlaubt;

  return {
    abweisen: true,
    grund: `Abgewiesen: "${erstes}" steht in sandbox.excludedCommands, aber eine Pipe, eine Umleitung `
      + "oder ein weiterer Befehl in derselben Zeile hebt diese Ausnahme auf (seit Claude Code 2.1.277) — "
      + "der Aufruf liefe in der Sandbox, ohne Netz. Richtige Form: das Kommando allein aufrufen, ohne Pipe, "
      + "Umleitung und Folgebefehl (2>&1 ist erlaubt). Eine grosse Ausgabe legt Claude Code selbst in einer "
      + "Datei ab; die filtert ein zweiter Aufruf.",
  };
}

/**
 * Hintergrundarbeit ohne Aufsicht (Issue #1081): Eine headless Session hat keinen
 * Folge-Zug. Startet sie einen Bash-Aufruf mit `run_in_background` und beendet dann ihren
 * Zug, ist die Sitzung zu Ende und das Ergebnis verloren — in der Nacht zum 30.09.2026 bei
 * #1065, obwohl die Regel im Skilltext stand (#668, #754, #983). Unbeaufsichtigt heisst wie
 * ueberall im Kit: `KIT_AGENT_MODEL` ist gesetzt. Interaktiv bleibt Hintergrundarbeit
 * erlaubt, dort gibt es den Folge-Zug.
 */
export function pruefeHintergrund(toolInput, env = process.env) {
  const unbeaufsichtigt = typeof env.KIT_AGENT_MODEL === "string" && env.KIT_AGENT_MODEL.trim() !== "";
  if (!unbeaufsichtigt || toolInput?.run_in_background !== true) return { abweisen: false, grund: null };
  return {
    abweisen: true,
    grund: "Abgewiesen: run_in_background ist ohne Aufsicht gesperrt (KIT_AGENT_MODEL gesetzt). Eine "
      + "unbeaufsichtigte Session hat keinen Folge-Zug — beendet sie ihren Zug, waehrend der Befehl "
      + "noch laeuft, ist die Sitzung zu Ende und sein Ergebnis verloren. Richtige Form: denselben "
      + "Befehl im Vordergrund aufrufen und auf ihn warten; das Bash-Zeitlimit der Session reicht "
      + "bis knapp unter das Rundenlimit (Issue #668).",
  };
}

/** Die Muster aus `sandbox.excludedCommands` und `sandbox.network.excludedCommands` einer Settings-Datei. */
function bashMusterAus(pfad) {
  if (!existsSync(pfad)) return [];
  const settings = JSON.parse(readFileSync(pfad, "utf-8"));
  const sandbox = settings?.sandbox ?? {};
  return [sandbox.excludedCommands, sandbox.network?.excludedCommands].flatMap((l) => (Array.isArray(l) ? l : []));
}

/**
 * `hook bash-pruefen` — PreToolUse-Hook von Claude Code. Exit 2 mit Begruendung auf
 * stderr weist den Aufruf ab; bei eigenem Fehler laesst der Hook durch (Exit 0, eine
 * Zeile auf stderr): Ein kaputter Hook darf nicht jede Bash-Zeile einer Session sperren.
 *
 * Liefert `{ exitCode, stderr }` statt selbst zu schreiben; Hook-Rumpf, Umgebung und
 * Arbeitsverzeichnis kommen herein (Plan #1199, E6), damit der Beleg im selben Prozess
 * laeuft.
 */
export function hookBashPruefen({ eingabeLesen = () => readFileSync(0, "utf-8"), env = process.env, cwd = process.cwd() } = {}) {
  const durchlassen = (warum) => ({ exitCode: 0, stderr: `board.mjs hook bash-pruefen: ${warum} — Aufruf durchgelassen\n` });
  const ohneBefund = { exitCode: 0, stderr: "" };
  let eingabe;
  try {
    eingabe = JSON.parse(eingabeLesen());
  } catch (e) {
    return durchlassen(`Eingabe nicht lesbar (${e.message})`);
  }
  if (eingabe?.tool_name !== "Bash" || typeof eingabe?.tool_input?.command !== "string") return ohneBefund;
  const hintergrund = pruefeHintergrund(eingabe.tool_input, env);
  if (hintergrund.abweisen) return { exitCode: 2, stderr: hintergrund.grund + "\n" };

  const wurzel = env.CLAUDE_PROJECT_DIR || cwd;
  const muster = [];
  for (const datei of ["settings.json", "settings.local.json"]) {
    const pfad = join(wurzel, ".claude", datei);
    try {
      muster.push(...bashMusterAus(pfad));
    } catch (e) {
      return durchlassen(`${pfad} nicht lesbar (${e.message})`);
    }
  }
  const ergebnis = pruefeBashZeile(eingabe.tool_input.command, [...new Set(muster)]);
  return ergebnis.abweisen ? { exitCode: 2, stderr: ergebnis.grund + "\n" } : ohneBefund;
}

export async function dispatchHook(command, hilfe) {
  if (command === "bash-pruefen") {
    const { exitCode, stderr } = hookBashPruefen();
    if (stderr) process.stderr.write(stderr);
    process.exitCode = exitCode;
    return;
  }
  process.stdout.write(hilfe);
  fail(`Unbekannter hook-Befehl: '${command}'`);
}
