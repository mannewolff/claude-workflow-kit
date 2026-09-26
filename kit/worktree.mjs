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
 *
 * KEIN ZWEITER WEG (Entscheidung des Pakets): Angelegt, gespiegelt und abgeraeumt wird mit
 * denselben Funktionen, die die Nacht-Kette benutzt — `worktreeAnlegen`,
 * `worktreeEntfernen`, `worktreesAufraeumen` und `befundeZurueck` aus `night.mjs`. Diese
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
import { existsSync, copyFileSync, mkdirSync, readFileSync, appendFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { worktreeAnlegen, worktreeEntfernen, worktreesAufraeumen, befundeZurueck, nachziehenPruefen } from "./night.mjs";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "3.3.3";

const HELP = `worktree.mjs (claude-workflow-kit v${KIT_VERSION}) — Worktree fuer die Release-Skills

  anlegen [--praefix <p>] [--ref <ref>] [--issue <n>]   Worktree auf <ref> (Vorgabe HEAD)
  entfernen <pfad>                                      Worktree abbauen
  nachziehen-pruefen                                    Darf das lokale main rebased werden?
  rueckweg <pfad>                                       Zusammenfassung, Ausfuehrungen, Befunde zurueck

Die letzte Zeile der Ausgabe ist immer JSON.
`;

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
  if (res.status !== 0) throw new Error(`kein git-Repo: ${(res.stderr || res.stdout || "").trim()}`);
  const erste = res.stdout.split("\n").find((z) => z.startsWith("worktree "));
  if (!erste) throw new Error(`git worktree list nennt keine Hauptkopie: ${res.stdout.trim()}`);
  return erste.slice("worktree ".length).trim();
}

/** Ein Wert hinter einem Flag; `null`, wenn das Flag fehlt. */
function flagWert(cliArgs, name) {
  const i = cliArgs.indexOf(name);
  return i !== -1 && i + 1 < cliArgs.length ? cliArgs[i + 1] : null;
}

/** Der Zeitstempel im Ordnernamen — dieselbe Form wie im Protokollnamen des Runners. */
function stempel() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
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
  return { ok: true, pfad, ref, praefix, aufgeraeumt };
}

function entfernen(repoRoot, cliArgs) {
  const pfad = cliArgs.find((a) => !a.startsWith("--"));
  if (!pfad) throw new Error("entfernen braucht den Pfad des Worktrees");
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
  if (!pfad) throw new Error("rueckweg braucht den Pfad des Worktrees");

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
    const zeilen = readFileSync(protokoll, "utf-8").split("\n").filter((z) => z !== "");
    if (zeilen.length > 0) {
      const protokollZiel = pfadIn(repoRoot, ANGEHAENGT);
      mkdirSync(dirname(protokollZiel), { recursive: true });
      appendFileSync(protokollZiel, zeilen.map((z) => `${z}\n`).join(""), "utf-8");
      ausfuehrungen = zeilen.length;
    }
  }

  return { ok: true, zusammenfassung, ausfuehrungen, befundeArten: befundeZurueck(pfad, repoRoot) };
}

function fuehreAus(kommando, cliArgs) {
  if (kommando === "nachziehen-pruefen") return { ok: true, ...nachziehenPruefen(repoWurzel()) };
  if (kommando === "anlegen") return anlegen(repoWurzel(), cliArgs);
  if (kommando === "entfernen") return entfernen(repoWurzel(), cliArgs);
  if (kommando === "rueckweg") return rueckweg(repoWurzel(), cliArgs);
  throw new Error(`unbekanntes Kommando '${kommando}' — bekannt sind anlegen, entfernen, nachziehen-pruefen, rueckweg`);
}

function main() {
  const [kommando, ...cliArgs] = process.argv.slice(2);
  if (!kommando || kommando === "--help" || kommando === "-h") {
    process.stdout.write(HELP);
    return;
  }
  try {
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
