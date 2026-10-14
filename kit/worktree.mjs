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
 *   node .claude/kit/worktree.mjs create [--prefix release] [--ref <ref>] [--issue <n>]
 *   node .claude/kit/worktree.mjs remove <pfad>
 *   node .claude/kit/worktree.mjs catch-up-check
 *   node .claude/kit/worktree.mjs return <pfad>
 *   node .claude/kit/worktree.mjs record-preparation <pfad> --result <e> [--open "<Text>"]... [--fetch <f>]
 *   node .claude/kit/worktree.mjs check-preparation [--discard]
 *   node .claude/kit/worktree.mjs in <pfad> -- <kommando> [argumente]
 *
 * KEIN ZWEITER WEG (Entscheidung des Pakets): Angelegt, gespiegelt und abgeraeumt wird mit
 * denselben Funktionen, die die Nacht-Kette benutzt — `worktreeAnlegen`,
 * `worktreeEntfernen`, `worktreesAufraeumen` und `befundeZurueck` aus dem Teil `night/kitstand.mjs` (Issue #1226). Diese
 * Datei traegt darum bewusst eine Nachbar-Abhaengigkeit und ist keine fuer sich portable
 * Einzeldatei wie `effort.mjs` oder `findings.mjs` (Muster #440): Zwei Wege, einen Worktree
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
const KIT_VERSION = "5.2.0";

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
 * Die frueheren deutschen Namen der Unterkommandos, Optionen und Werte, je Eintrag deutsch ->
 * englisch (Issue #1564, Plan #1548 E5). Seit Version 5 nimmt worktree.mjs nur die englischen
 * an; diese Tabellen dienen allein der Meldung, die einen deutschen Namen abweist und den
 * englischen nennt — zum Ausfuehren werden sie nie benutzt.
 */
const ALTE_BEFEHLE = Object.freeze({
  anlegen: "create",
  entfernen: "remove",
  im: "in",
  "nachziehen-pruefen": "catch-up-check",
  rueckweg: "return",
  "vorbereitung-festhalten": "record-preparation",
  "vorbereitung-pruefen": "check-preparation",
});
const ALTE_OPTIONEN = Object.freeze({
  "--praefix": "--prefix",
  "--ergebnis": "--result",
  "--offen": "--open",
  "--verwerfen": "--discard",
});
const ALTE_WERTE = Object.freeze({ gruen: "green", "gruen-offen": "green-open", rot: "red", fehlgeschlagen: "failed" });

/**
 * Die getippten Werte von --result und --fetch zum internen Schluessel (E5): Getippt wird
 * englisch, festgehalten wird weiter der Wert, den `vorbereitungFesthalten` und der Leser
 * der Vorbereitungsdatei kennen.
 */
const ERGEBNIS_WERTE = Object.freeze({ green: "gruen", "green-open": "gruen-offen", red: "rot" });
const FETCH_WERTE = Object.freeze({ ok: "ok", failed: "fehlgeschlagen" });

/** Wirft die Abweisung, wenn `name` ein frueherer deutscher Name aus `tabelle` ist. */
function altnameAbweisen(tabelle, name) {
  if (typeof name === "string" && Object.hasOwn(tabelle, name)) {
    throw new Error(t("altname", { name, englisch: tabelle[name] }));
  }
}

/** Ein Wert hinter einem Flag; `null`, wenn das Flag fehlt. */
function flagWert(cliArgs, name) {
  const i = cliArgs.indexOf(name);
  return i !== -1 && i + 1 < cliArgs.length ? cliArgs[i + 1] : null;
}

/** Der interne Schluessel zum getippten Wert `wert` der Option `option` aus `tabelle`. */
function internerWert(tabelle, option, wert) {
  altnameAbweisen(ALTE_WERTE, wert);
  if (!Object.hasOwn(tabelle, wert)) {
    throw new Error(t("unbekannterWert", { option, wert, werte: Object.keys(tabelle).join(", ") }));
  }
  return tabelle[wert];
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
  const praefix = flagWert(cliArgs, "--prefix") ?? "release";
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
 * Ergebnis der Skill in je einen `findings.mjs suggest --kind <a>` uebersetzt.
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
  for (let i = 0; i < cliArgs.length - 1; i += 1) if (cliArgs[i] === name) werte.push(cliArgs[i + 1]);
  return werte;
}

/** Ruft nur `vorbereitungFesthalten` auf (Plan #1243, Plan-Review Runde 2, Fund 7). */
function vorbereitungFesthaltenAufruf(repoRoot, cliArgs) {
  const pfad = cliArgs[0];
  if (!pfad || pfad.startsWith("--")) throw new Error(t("festhaltenPfad"));
  const getippt = flagWert(cliArgs, "--result");
  if (getippt === null) throw new Error(t("festhaltenErgebnis", { werte: Object.keys(ERGEBNIS_WERTE).join("|") }));
  const ergebnis = internerWert(ERGEBNIS_WERTE, "--result", getippt);
  const fetch = internerWert(FETCH_WERTE, "--fetch", flagWert(cliArgs, "--fetch") ?? "ok");
  return { ok: true, ...vorbereitungFesthalten({ repoRoot, pfad, ergebnis, offen: flagWerte(cliArgs, "--open"), fetch }) };
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
  altnameAbweisen(ALTE_BEFEHLE, kommando);
  for (const arg of cliArgs) altnameAbweisen(ALTE_OPTIONEN, arg);
  if (kommando === "catch-up-check") return { ok: true, ...nachziehenPruefen(repoWurzel()) };
  if (kommando === "create") return anlegen(repoWurzel(), cliArgs);
  if (kommando === "remove") return entfernen(repoWurzel(), cliArgs);
  if (kommando === "return") return rueckweg(repoWurzel(), cliArgs);
  if (kommando === "record-preparation") return vorbereitungFesthaltenAufruf(repoWurzel(), cliArgs);
  // Das Urteil traegt das Feld `mutation` mit (Issue #1673, Plan #1671, E4): `/push-main`
  // nennt bei einer Uebernahme den Mutationstest der Nacht, statt ihn neu zu fahren.
  if (kommando === "check-preparation") {
    return { ok: true, ...vorbereitungPruefen({ repoRoot: repoWurzel(), verwerfen: cliArgs.includes("--discard") }) };
  }
  throw new Error(t("unbekannt", { kommando }));
}

// Die Hilfe gibt es genau einmal, englisch, in jedem Projekt (Issue #1564, Plan #1548 E7).
function hilfe() {
  return `worktree.mjs (claude-workflow-kit v${KIT_VERSION}) — worktree for the release skills

  create [--prefix <p>] [--ref <ref>] [--issue <n>]     Worktree on <ref> (default HEAD),
                                                        then the installCommand of the config
  remove <path>                                         Tear down the worktree
  catch-up-check                                        May the local main be rebased?
  return <path>                                         Summary, executions, findings back
  record-preparation <path> --result <${Object.keys(ERGEBNIS_WERTE).join("|")}>
      [--open "<text>"]... [--fetch <${Object.keys(FETCH_WERTE).join("|")}>]
                                                        Records the nightly preparation:
                                                        reference refs/kit/push-vorbereitet on
                                                        HEAD of the worktree, file
                                                        .claude/push-vorbereitung.json
  check-preparation [--discard]                         May /push-main take over the prepared
                                                        state? No git fetch of its own.
                                                        Field mutation: the mutation test of
                                                        the nightly push run, or null
                                                        --discard deletes file and reference
  in <path> -- <command> [arguments]                    Starts <command> with <path> as
                                                        working directory, without a shell; output
                                                        and exit code of the command pass through

The last line of the output is always JSON — except for 'in', which passes the output of
the command through and writes JSON only on an error of its own.
`;
}

function main() {
  const [kommando, ...cliArgs] = process.argv.slice(2);
  if (!kommando || kommando === "--help" || kommando === "-h") {
    process.stdout.write(hilfe());
    return;
  }
  try {
    if (kommando === "in") {
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
