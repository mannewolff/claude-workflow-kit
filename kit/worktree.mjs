#!/usr/bin/env node
/**
 * claude-workflow-kit Worktree fuer die Release-Skills (Issue #929)
 *
 * `/push-main` und `/merge-production` erzeugen Release-Dateien, fahren ihren Prueflauf und
 * committen — bis v3.3.2 im Haupt-Working-Tree. Dort baut unter Variante B aber auch die
 * Umsetzungsstufe des Nacht-Runners. Am 2026-09-25 riss das in kanban-kit zweimal
 * dieselbe Kette ab: Beide Seiten committeten korrekt nur ihre eigenen Dateien, danach fand
 * der Runner die Release-Dateien als unkommittierte Reste und stoppte hart. Dazu kam, dass
 * fremde, halbfertige Dateien den Release-Prueflauf verfaelscht haetten.
 *
 * Seither laufen beide Skills in einem eigenen Worktree ausserhalb des Repos, und diese
 * Datei ist ihre Tuer dorthin:
 *
 *   node .claude/kit/worktree.mjs anlegen [--praefix release] [--ref <ref>] [--issue <n>]
 *   node .claude/kit/worktree.mjs entfernen <pfad>
 *   node .claude/kit/worktree.mjs nachziehen-pruefen
 *   node .claude/kit/worktree.mjs rueckweg <pfad>
 *   node .claude/kit/worktree.mjs vorbereitung-festhalten <pfad> --ergebnis <e> [--offen "<Text>"]... [--fetch <f>]
 *   node .claude/kit/worktree.mjs vorbereitung-pruefen [--verwerfen]
 *
 * KEIN ZWEITER WEG (Entscheidung des Pakets): Angelegt, gespiegelt und abgeraeumt wird mit
 * denselben Funktionen, die die Nacht-Kette benutzt — `worktreeAnlegen`,
 * `worktreeEntfernen`, `worktreesAufraeumen` und `befundeZurueck` aus dem Teil `night/kitstand.mjs` (Issue #1226). Diese
 * Datei traegt darum bewusst eine Nachbar-Abhaengigkeit und ist keine fuer sich portable
 * Einzeldatei wie `aufwand.mjs` oder `befunde.mjs` (Muster #440): Zwei Wege, einen Worktree
 * vorzubereiten, laufen beim ersten Unterschied auseinander — und der Spiegel von
 * `.claude/` ist genau der Teil, den ein Skill nicht nebenbei nachbaut. `night.mjs`
 * seinerseits kennt diese Datei nicht; der Nacht-Runner bleibt ohne sie vollstaendig.
 *
 * AUSGABE: eine Zeile JSON auf stdout, immer als LETZTE Zeile — der Rueckweg kann ihr einen
 * Hinweis des Runners voranstellen (`befundeZurueck` protokolliert ein gescheitertes
 * Anhaengen, statt daran zu scheitern). Bei einem Fehler steht `{"ok":false,"fehler":…}`
 * und der Exitcode ist 1.
 */

import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync, readFileSync, appendFileSync, realpathSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Der Normalisierer der Einstellungsnamen aus dem Board-Teil config-namen (Issue #1436, Plan
// #1420 E10): Er bildet eine englisch benannte Config auf die deutschen Namen ab, die dieses
// Modul liest. Dynamisch und abgefangen, denn das Modul laeuft auch allein ohne den Board-Teil;
// fehlt er, bleibt die Config, wie sie gelesen wurde.
const { normalisiereConfig = (roh) => ({ config: roh, hinweise: [] }) } =
  await import(new URL("./board/config-namen.mjs", import.meta.url).href).catch(() => ({}));

import {
  worktreeAnlegen, worktreeEntfernen, worktreesAufraeumen, befundeZurueck, nachziehenPruefen, vorbereitungFesthalten, vorbereitungPruefen,
} from "./night/kitstand.mjs";
import { TEXTE } from "./texte/worktree.mjs";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "4.2.4";

// Die Texttabelle liegt im Teil texte/ (Issue #1524); exportiert bleibt sie unter ihrem Namen.
export { TEXTE };

// Der Texthelfer aus dem Board-Teil namen (Plan #1420 E13), abgefangen wie der Normalisierer:
// Fehlt board/namen.mjs neben worktree.mjs, bleiben die Texte deutsch.
const namen = await import(new URL("./board/namen.mjs", import.meta.url).href).catch(() => null);

/** Der Text zu `schluessel` aus `TEXTE` in der Sprache des Prozesses; ohne Register deutsch. */
function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

/** Die Dateien, die der Rueckweg ANHAENGT (Buchhaltung, nie ersetzen). */
const ANGEHAENGT = ".claude/ausfuehrungen.tsv";
/** Die Datei, die der Rueckweg ERSETZT: Sie bezeugt genau einen Stand. */
const ZUSAMMENFASSUNG = ".claude/checks-summary.json";

function pfadIn(root, relativ) {
  return join(root, ...relativ.split("/"));
}

/**
 * Die Hauptkopie des Repos — nicht das aktuelle Verzeichnis.
 *
 * `git rev-parse --show-toplevel` taugt hier nicht: In einem Worktree liefert es DEN
 * WORKTREE, und ein `entfernen` von dort aus zielte auf sich selbst. Der erste Eintrag von
 * `git worktree list --porcelain` ist immer die Hauptkopie — damit darf jedes Kommando auch
 * aus dem Worktree heraus gerufen werden, ohne dass der Skill vorher zuruecklaufen muss.
 */
function repoWurzel() {
  const res = spawnSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf-8" });
  if (res.status !== 0) throw new Error(t("keinRepo", { ausgabe: (res.stderr || res.stdout || "").trim() }));
  const erste = res.stdout.split(/\r?\n/).find((z) => z.startsWith("worktree "));
  if (!erste) throw new Error(t("keineHauptkopie", { ausgabe: res.stdout.trim() }));
  return erste.slice("worktree ".length).trim();
}

/**
 * Die englischen Namen der Unterkommandos und Optionen (Issue #1462, Plan #1420 E18): je
 * englischer Name der deutsche, den er vertritt. Die deutschen bleiben gueltig.
 */
const KOMMANDOS_EN = {
  create: "anlegen",
  remove: "entfernen",
  in: "im",
  "catch-up-check": "nachziehen-pruefen",
  return: "rueckweg",
  "record-preparation": "vorbereitung-festhalten",
  "check-preparation": "vorbereitung-pruefen",
};
const OPTIONEN_EN = {
  "--prefix": "--praefix",
  "--result": "--ergebnis",
  "--open": "--offen",
  "--discard": "--verwerfen",
};

/** Der deutsche Name hinter einem englischen; jeder andere Name bleibt, wie er ist. */
function deutscherName(tabelle, name) {
  return Object.hasOwn(tabelle, name) ? tabelle[name] : name;
}

/** Ob `arg` das Flag `name` ist, unter seinem deutschen oder seinem englischen Namen. */
function istFlag(arg, name) {
  return deutscherName(OPTIONEN_EN, arg) === name;
}

/** Ein Wert hinter einem Flag; `null`, wenn das Flag fehlt. */
function flagWert(cliArgs, name) {
  const i = cliArgs.findIndex((a) => istFlag(a, name));
  return i !== -1 && i + 1 < cliArgs.length ? cliArgs[i + 1] : null;
}

/** Der Zeitstempel im Ordnernamen — dieselbe Form wie im Protokollnamen des Runners. */
function stempel() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

/**
 * Das Installationskommando der Hauptkopie — der Weg zu den Abhaengigkeiten (Issue #964).
 *
 * Gelesen wird NUR die geteilte `workflow.config.json`: Das Feld gilt teamweit, genau wie
 * `formatFixCommand`, und eine persoenliche Datei darf es nicht abweichend setzen. Keine
 * oder unlesbare Config ist ein normaler Zustand und heisst "nichts tun" — dieselbe Regel
 * wie in `configVonPlatte` (night.mjs).
 */
function installKommando(repoRoot) {
  try {
    const { config: cfg } = normalisiereConfig(JSON.parse(readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8")));
    return (cfg.installCommand || "").trim();
  } catch {
    return "";
  }
}

/**
 * Stellt die Abhaengigkeiten IM Worktree her (Issue #964).
 *
 * Ein frischer Worktree traegt nur Versioniertes plus das gespiegelte `.claude/` — weder
 * `node_modules` noch `.venv` oder `vendor/`. Bis #964 stand nur als Text in zwei Skills,
 * dass sie herzustellen sind; am 2026-09-27 brach darum in einem Worktree ein Test nach
 * 43 ms mit ERR_MODULE_NOT_FOUND ab und die Messung war still zu niedrig. Der Schaden ist
 * nicht der rote Lauf, sondern der falsche Messwert — deshalb steht die Vorgabe jetzt hier
 * und nicht mehr nur im Text.
 *
 * Das Kommando kommt aus der Config und braucht deshalb die Shell der Plattform — derselbe
 * Weg, den `night.mjs` fuer `buildChecks` und `formatFixCommand` nimmt (Issue #199). Seine
 * Ausgabe geht VOR der JSON-Zeile auf stdout: Sie ist bei einem Fehlschlag die Diagnose,
 * und die letzte Zeile bleibt JSON.
 *
 * Ein roter Lauf laesst keinen halbfertigen Worktree zurueck — genau aus dem entstand der
 * stille Fehlmesswert.
 */
function installiereIn(pfad, repoRoot) {
  const kommando = installKommando(repoRoot);
  if (!kommando) return null;

  // PATH-Aufloesung bewusst, wie bei den uebrigen Config-Kommandos (S4036, Issue #183).
  const res = spawnSync(kommando, { cwd: pfad, encoding: "utf-8", shell: true });
  const ausgabe = `${res.stdout || ""}${res.stderr || ""}`;
  if (ausgabe.trim() !== "") process.stdout.write(ausgabe.endsWith("\n") ? ausgabe : `${ausgabe}\n`);
  if (res.status === 0) return kommando;

  worktreeEntfernen(pfad, repoRoot);
  const code = res.status === null ? t("signal", { signal: res.signal }) : t("exitCode", { status: res.status });
  throw new Error(t("installRot", { kommando, code }));
}

function anlegen(repoRoot, cliArgs) {
  const praefix = flagWert(cliArgs, "--praefix") ?? "release";
  const ref = flagWert(cliArgs, "--ref") ?? "HEAD";
  const issueId = flagWert(cliArgs, "--issue");
  // Erst abraeumen, dann anlegen: Ein harter Abbruch laesst Ordner und Eintrag liegen, und
  // der naechste Lauf legte sonst einen zweiten Worktree neben einen toten. Geraeumt wird
  // NUR der uebergebene Praefix — `kette` und `pruefung` koennen gerade laufen.
  const aufgeraeumt = worktreesAufraeumen(repoRoot, praefix);
  const pfad = worktreeAnlegen({ repoRoot, issueId, stempel: stempel(), praefix, ref });
  const installation = installiereIn(pfad, repoRoot);
  return { ok: true, pfad, ref, praefix, aufgeraeumt, installation };
}

function entfernen(repoRoot, cliArgs) {
  const pfad = cliArgs.find((a) => !a.startsWith("--"));
  if (!pfad) throw new Error(t("entfernenPfad"));
  worktreeEntfernen(pfad, repoRoot);
  return { ok: true, entfernt: pfad };
}

/**
 * Holt aus dem Worktree, was in der Hauptkopie weiterzaehlt (Issue #929, Aufgabe 4).
 *
 * Drei Dateien, zwei Arten: Die Zusammenfassung des Prueflaufs bezeugt genau einen Stand
 * und wird darum ERSETZT — sie ist der frischere Nachweis. Ausfuehrungsprotokoll und
 * Befunde sind Buchhaltung und werden ANGEHAENGT; der Spiegel traegt sie gar nicht erst in
 * den Worktree, dort stehen also ausschliesslich die Zeilen dieses Laufs. Fuer die Befunde
 * macht das `befundeZurueck` der Kette — samt Schwellenpruefung am Gesamtstand, deren
 * Ergebnis der Skill in je einen `befunde.mjs vorschlag --art <a>` uebersetzt.
 */
function rueckweg(repoRoot, cliArgs) {
  const pfad = cliArgs.find((a) => !a.startsWith("--"));
  if (!pfad) throw new Error(t("rueckwegPfad"));

  const quelle = pfadIn(pfad, ZUSAMMENFASSUNG);
  const ziel = pfadIn(repoRoot, ZUSAMMENFASSUNG);
  let zusammenfassung = false;
  if (existsSync(quelle)) {
    mkdirSync(dirname(ziel), { recursive: true });
    copyFileSync(quelle, ziel);
    zusammenfassung = true;
  }

  let ausfuehrungen = 0;
  const protokoll = pfadIn(pfad, ANGEHAENGT);
  if (existsSync(protokoll)) {
    const zeilen = readFileSync(protokoll, "utf-8").split(/\r?\n/).filter((z) => z !== "");
    if (zeilen.length > 0) {
      const protokollZiel = pfadIn(repoRoot, ANGEHAENGT);
      mkdirSync(dirname(protokollZiel), { recursive: true });
      appendFileSync(protokollZiel, zeilen.map((z) => `${z}\n`).join(""), "utf-8");
      ausfuehrungen = zeilen.length;
    }
  }

  return { ok: true, zusammenfassung, ausfuehrungen, befundeArten: befundeZurueck(pfad, repoRoot) };
}

/** Alle Werte eines wiederholbaren Flags, in Reihenfolge. */
function flagWerte(cliArgs, name) {
  const werte = [];
  for (let i = 0; i < cliArgs.length - 1; i += 1) if (istFlag(cliArgs[i], name)) werte.push(cliArgs[i + 1]);
  return werte;
}

/** Ruft nur `vorbereitungFesthalten` auf (Plan #1243, Plan-Review Runde 2, Fund 7). */
function vorbereitungFesthaltenAufruf(repoRoot, cliArgs) {
  const pfad = cliArgs[0];
  if (!pfad || pfad.startsWith("--")) throw new Error(t("festhaltenPfad"));
  const ergebnis = flagWert(cliArgs, "--ergebnis");
  if (ergebnis === null) throw new Error(t("festhaltenErgebnis"));
  const fetch = flagWert(cliArgs, "--fetch") ?? "ok";
  return { ok: true, ...vorbereitungFesthalten({ repoRoot, pfad, ergebnis, offen: flagWerte(cliArgs, "--offen"), fetch }) };
}

/**
 * `im <pfad> -- <kommando> [argumente]` (Issue #1372): Die Release-Skills fahren die
 * Schritte aus RELEASING.md im Worktree, ohne `cd`. Claude Code setzt das
 * Arbeitsverzeichnis ausserhalb der erlaubten Verzeichnisse nach jedem Aufruf zurueck, und
 * `cd <pfad> && …` fiele nicht mehr unter `sandbox.excludedCommands`. Gestartet wird ohne
 * Shell — die Argumente gehen woertlich durch —, mit geerbter Ausgabe; der Rueckgabewert
 * ist der Exitcode des Kommandos.
 */
function imWorktree(cliArgs) {
  const [pfad, trenner, programm, ...argumente] = cliArgs;
  if (!pfad || pfad === "--" || trenner !== "--" || !programm) {
    throw new Error(t("imForm"));
  }
  if (!existsSync(pfad) || !statSync(pfad).isDirectory()) throw new Error(t("imKeinVerzeichnis", { pfad }));
  const res = spawnSync(programm, argumente, { cwd: pfad, stdio: "inherit" });
  if (res.error) throw new Error(t("imStart", { programm, grund: res.error.message }));
  return res.status ?? 1;
}

function fuehreAus(kommando, cliArgs) {
  if (kommando === "nachziehen-pruefen") return { ok: true, ...nachziehenPruefen(repoWurzel()) };
  if (kommando === "anlegen") return anlegen(repoWurzel(), cliArgs);
  if (kommando === "entfernen") return entfernen(repoWurzel(), cliArgs);
  if (kommando === "rueckweg") return rueckweg(repoWurzel(), cliArgs);
  if (kommando === "vorbereitung-festhalten") return vorbereitungFesthaltenAufruf(repoWurzel(), cliArgs);
  if (kommando === "vorbereitung-pruefen") {
    return { ok: true, ...vorbereitungPruefen({ repoRoot: repoWurzel(), verwerfen: cliArgs.some((a) => istFlag(a, "--verwerfen")) }) };
  }
  throw new Error(t("unbekannt", { kommando }));
}

function main() {
  const [befehl, ...cliArgs] = process.argv.slice(2);
  const kommando = deutscherName(KOMMANDOS_EN, befehl);
  if (!kommando || kommando === "--help" || kommando === "-h") {
    process.stdout.write(t("hilfe", { version: KIT_VERSION }));
    return;
  }
  try {
    if (kommando === "im") {
      process.exitCode = imWorktree(cliArgs);
      return;
    }
    process.stdout.write(`${JSON.stringify(fuehreAus(kommando, cliArgs))}\n`);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, fehler: err.message })}\n`);
    process.exit(1);
  }
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen.
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) main();
