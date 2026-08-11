#!/usr/bin/env node
/**
 * migrate-issues.mjs — Migrationswerkzeug fuer den Tracker-Wechsel GitHub -> kanban-kit.
 *
 * Auslöser des Umzugs war der 2026-08-10: Das GitHub-Kontingent war zweimal
 * vollstaendig leer, weil Issue-Review und Nacht-Runner sich still dieselbe Quote
 * teilen. Genau deshalb ist der Export vom Import getrennt (Issue #288): Er ist der
 * teure Teil, und wenn der Import scheitert, darf er nicht wiederholt werden muessen.
 *
 * Nutzung:  node tools/migrate-issues.mjs export [--out <verzeichnis>]
 *           node tools/migrate-issues.mjs import   # noch nicht implementiert (#289)
 *           node tools/migrate-issues.mjs verify   # noch nicht implementiert (#290)
 *
 * `export` liest ausschliesslich: kein Schreibzugriff auf GitHub, keine Abhaengigkeit
 * zu kanban-kit. Geschrieben wird genau eine Datei im Zielverzeichnis.
 *
 * Warum GraphQL statt der Kommandos aus kit/board.mjs: `gh issue list` und
 * `gh project item-list` kennen nur ein `--limit`, keinen Cursor — ein Export darf
 * aber weder Issues noch Project-Items abschneiden. Die Fallstricke des Adapters
 * gelten hier trotzdem und sind beruecksichtigt: `gh project item-list` liefert keine
 * Labels (Issue #180), sie kommen deshalb aus der Issue-Abfrage; das Status-Feld des
 * Boards heisst "Status" und traegt den sichtbaren Spaltennamen. kit/board.mjs bleibt
 * unveraendert.
 *
 * Single-File-Tool: nur node:*-Imports, gh im PATH, Pfade relativ zum cwd.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const UNTERKOMMANDOS = ["export", "import", "verify"];
const DEFAULT_OUT = join(tmpdir(), "claude-workflow-kit-migrationen");

const HILFE = [
  "migrate-issues.mjs — Migrationswerkzeug fuer den Tracker-Wechsel GitHub -> kanban-kit",
  "",
  "Nutzung:",
  "  node tools/migrate-issues.mjs export [--out <verzeichnis>]",
  "      Liest alle offenen Issues samt Body, Kommentaren, Labels und Board-Spalte",
  "      und schreibt sie als JSON. Nur lesende Zugriffe.",
  "  node tools/migrate-issues.mjs import",
  "      Spielt einen Export in kanban-kit ein.",
  "  node tools/migrate-issues.mjs verify",
  "      Vergleicht Export und Ziel als Gate.",
  "  node tools/migrate-issues.mjs --help",
  "",
  `Ohne --out schreibt export nach ${DEFAULT_OUT}.`,
  "Der Dateiname traegt den UTC-Zeitpunkt des Laufs; eine vorhandene Datei wird nie",
  "ueberschrieben. Auf stdout steht ausschliesslich der Pfad der erzeugten Datei.",
  "",
].join("\n");

class MigrateError extends Error {}

// Ein Bedienfehler auf der Kommandozeile — er fuehrt zur Hilfe, nicht zu einer
// Fehlermeldung ueber einen missglueckten Lauf.
class CliError extends MigrateError {}

// ============================================================
// Prozess- und Konfigurationsschicht
// ============================================================

// Ohne Shell, wie kit/board.mjs seit Issue #196: Die Argumente gehen als argv direkt
// ans Betriebssystem, es gibt kein Escaping-Layer, das pro Plattform anders arbeitet.
//
// maxBuffer weit ueber dem Node-Default von 1 MB: Eine Seite Issues samt Bodies und
// Kommentaren sprengt ihn muehelos, und die Ueberschreitung kaeme als ENOBUFS —
// also als Abbruch mitten im teuren Export.
function exec(datei, args) {
  const res = spawnSync(datei, args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (res.error) {
    throw new MigrateError(res.error.code === "ENOENT"
      ? `${datei} nicht gefunden — ist es installiert und im PATH?`
      : res.error.message);
  }
  if (res.status !== 0) {
    throw new MigrateError((res.stderr || res.stdout || "").trim() || `${datei} endete mit Exit ${res.status}`);
  }
  return (res.stdout || "").trim();
}

function execJSON(datei, args) {
  const roh = exec(datei, args);
  try {
    return JSON.parse(roh);
  } catch {
    throw new MigrateError(`${datei} lieferte kein gueltiges JSON: ${roh.slice(0, 200)}`);
  }
}

function projectNumber() {
  const pfad = resolve(".claude", "workflow.config.json");
  if (!existsSync(pfad)) throw new MigrateError(`${pfad} nicht gefunden — bitte im Projektverzeichnis starten.`);
  let config;
  try {
    config = JSON.parse(readFileSync(pfad, "utf-8"));
  } catch (e) {
    throw new MigrateError(`${pfad} ist kein gueltiges JSON: ${e.message}`);
  }
  const num = config.github?.projectNumber;
  if (!num) throw new MigrateError(`github.projectNumber fehlt in ${pfad} — ohne Projektnummer gibt es keine Board-Spalte.`);
  return Number(num);
}

// ============================================================
// GraphQL-Abfragen
// ============================================================

// Labels werden mit einer festen Obergrenze gelesen: 50 Labels an einem einzelnen
// Issue gibt es nicht, und im Gegensatz zu Issues und Project-Items waechst die Zahl
// nicht mit dem Projekt.
const ISSUES_QUERY = `
query($owner:String!,$repo:String!,$cursor:String){
  repository(owner:$owner,name:$repo){
    issues(first:50,states:OPEN,after:$cursor,orderBy:{field:NUMBER,direction:ASC}){
      pageInfo{ hasNextPage endCursor }
      nodes{
        number title body
        labels(first:50){ nodes{ name } }
        comments(first:100){
          pageInfo{ hasNextPage endCursor }
          nodes{ author{ login } body createdAt }
        }
      }
    }
  }
}`;

const KOMMENTARE_QUERY = `
query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){
    issue(number:$number){
      comments(first:100,after:$cursor){
        pageInfo{ hasNextPage endCursor }
        nodes{ author{ login } body createdAt }
      }
    }
  }
}`;

// Zwei Inline-Fragmente statt eines auf ProjectV2Owner: dasselbe Muster, mit dem
// kit/board.mjs den Owner aufloest — ein Board haengt entweder an einem User oder an
// einer Organisation, und beide Zweige liefern dasselbe projectV2.
const PROJEKT_QUERY = `
query($owner:String!,$number:Int!,$cursor:String){
  repositoryOwner(login:$owner){
    ... on User{ projectV2(number:$number){ ...ItemSeite } }
    ... on Organization{ projectV2(number:$number){ ...ItemSeite } }
  }
}
fragment ItemSeite on ProjectV2{
  items(first:100,after:$cursor){
    pageInfo{ hasNextPage endCursor }
    nodes{
      content{ ... on Issue{ number repository{ nameWithOwner } } }
      fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue{ name } }
    }
  }
}`;

function graphql(query, felder, cursor) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, wert] of Object.entries(felder)) {
    args.push(typeof wert === "number" ? "-F" : "-f", `${name}=${wert}`);
  }
  if (cursor) args.push("-f", `cursor=${cursor}`);
  return execJSON("gh", args);
}

/**
 * Laeuft eine GraphQL-Verbindung bis zum Ende ab und liefert alle nodes.
 *
 * `zugriff` holt das Verbindungsobjekt aus der Antwort. Fehlt es, ist die Antwort
 * nicht die erwartete — das ist ein Fehler und keine leere Seite, sonst saehe ein
 * unvollstaendiger Export wie ein leeres Board aus.
 *
 * `startCursor` setzt hinter einem bereits gelesenen Stueck der Verbindung an; ohne
 * ihn beginnt die Schleife bei der ersten Seite.
 */
function alleSeiten(query, felder, zugriff, was, startCursor = null) {
  const nodes = [];
  let cursor = startCursor;
  do {
    const antwort = graphql(query, felder, cursor);
    const verbindung = zugriff(antwort);
    if (!verbindung || !Array.isArray(verbindung.nodes)) {
      throw new MigrateError(`Unerwartete Antwort beim Lesen von ${was}: ${JSON.stringify(antwort).slice(0, 200)}`);
    }
    nodes.push(...verbindung.nodes);
    cursor = verbindung.pageInfo?.hasNextPage ? verbindung.pageInfo.endCursor : null;
  } while (cursor);
  return nodes;
}

// ============================================================
// Normalisierung
// ============================================================

// Dieselbe Form wie normalizeComments in kit/board.mjs: author als String (aus
// author.login), fehlende Felder als leerer String statt undefined, Kommentare ohne
// Body verworfen. Hier lokal umgesetzt, weil die tools/-Scripts nur node:*-Imports
// verwenden und nicht an kit/ haengen.
function normalisiereKommentare(roh) {
  if (!Array.isArray(roh)) return [];
  return roh
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      author: String(c.author?.login ?? ""),
      body: String(c.body ?? ""),
      createdAt: String(c.createdAt ?? ""),
    }))
    .filter((c) => c.body !== "");
}

function labelNamen(labels) {
  return (labels?.nodes || []).map((l) => String(l?.name ?? "")).filter(Boolean);
}

// ============================================================
// export
// ============================================================

function leseIssues(owner, repo) {
  const roh = alleSeiten(
    ISSUES_QUERY,
    { owner, repo },
    (a) => a?.data?.repository?.issues,
    "offenen Issues"
  );

  return roh.map((issue) => {
    const kommentare = normalisiereKommentare(issue.comments?.nodes);
    // Ein bei 100 abgeschnittener Kommentarstrang waere stiller Datenverlust — der
    // Export ist der maßgebliche Lauf, ein Nachschlag ist billiger als ein zweiter.
    if (issue.comments?.pageInfo?.hasNextPage) {
      const weitere = alleSeiten(
        KOMMENTARE_QUERY,
        { owner, repo, number: Number(issue.number) },
        (a) => a?.data?.repository?.issue?.comments,
        `Kommentaren von Issue #${issue.number}`,
        issue.comments.pageInfo.endCursor
      );
      kommentare.push(...normalisiereKommentare(weitere));
    }
    return {
      number: Number(issue.number),
      title: String(issue.title ?? ""),
      body: String(issue.body ?? ""),
      comments: kommentare,
      labels: labelNamen(issue.labels),
      spalte: null,
    };
  });
}

/**
 * Board-Spalte je Issue-Nummer, gelesen aus dem Project.
 *
 * Ein Project kann Issues mehrerer Repositories enthalten: Ohne den Vergleich von
 * `content.repository` wuerde `repo-a#42` die Spalte von `repo-b#42` erben. Drafts und
 * Pull Requests haben keinen Issue-Content und fallen dabei ebenfalls heraus.
 */
function leseSpalten(owner, repoVoll, num) {
  const items = alleSeiten(
    PROJEKT_QUERY,
    { owner, number: num },
    (a) => a?.data?.repositoryOwner?.projectV2?.items,
    `Project #${num}`
  );

  const spalten = new Map();
  for (const item of items) {
    const inhalt = item?.content;
    if (!inhalt || inhalt.number == null) continue;
    if (inhalt.repository?.nameWithOwner !== repoVoll) continue;
    const name = item.fieldValueByName?.name;
    spalten.set(Number(inhalt.number), name ? String(name) : null);
  }
  return spalten;
}

function zeitstempel() {
  // Test-Hook wie NIGHT_CLAUDE_CMD in kit/night.mjs: Ohne ihn waere der Kollisionsfall
  // ("Zieldatei existiert schon") nur ueber Zeitmanipulation pruefbar.
  const gesetzt = process.env.KIT_MIGRATE_STAMP;
  if (gesetzt) return gesetzt;
  return new Date().toISOString().replace(/:/g, "-");
}

/**
 * Schreibt den Export atomar: erst in eine Nachbardatei, dann umbenennen.
 *
 * Ein abgebrochenes writeFileSync direkt auf die Zieldatei hinterliesse eine halb
 * geschriebene Datei, die spaeter wie ein gueltiger Export aussieht. Bricht es hier
 * ab, verschwindet die temporaere Datei und das Ziel entsteht nie.
 */
function schreibeAtomar(ziel, inhalt) {
  const temp = `${ziel}.tmp`;
  try {
    writeFileSync(temp, inhalt, "utf-8");
    renameSync(temp, ziel);
  } catch (e) {
    // Das Aufraeumen darf den eigentlichen Fehler nicht ueberdecken: Was hier
    // scheitert, ist genau der Fall, in dem gar nichts angelegt wurde.
    try { rmSync(temp, { force: true }); } catch { /* nichts zu raeumen */ }
    try { rmSync(ziel, { force: true }); } catch { /* nichts zu raeumen */ }
    throw new MigrateError(`Zieldatei konnte nicht geschrieben werden: ${e.message}`);
  }
}

function fuehreExportAus(cliArgs) {
  const outDir = resolve(leseOutOption(cliArgs) ?? DEFAULT_OUT);
  const num = projectNumber();

  const repoVoll = exec("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const [owner, repo] = repoVoll.split("/");
  if (!owner || !repo) throw new MigrateError(`Konnte das Repository nicht bestimmen: '${repoVoll}'`);

  const issues = leseIssues(owner, repo);
  const spalten = leseSpalten(owner, repoVoll, num);
  for (const issue of issues) {
    issue.spalte = spalten.has(issue.number) ? spalten.get(issue.number) : null;
  }

  // Erst jetzt entsteht ueberhaupt etwas auf der Platte: Scheitert eine der Abfragen,
  // bleibt nicht einmal das Zielverzeichnis zurueck.
  const ziel = join(outDir, `issues-${zeitstempel()}.json`);
  mkdirSync(outDir, { recursive: true });
  if (existsSync(ziel)) throw new MigrateError(`Zieldatei existiert bereits: ${ziel}`);
  schreibeAtomar(ziel, `${JSON.stringify(issues, null, 2)}\n`);

  process.stdout.write(`${ziel}\n`);
}

/** Der Wert von --out, oder null. Wirft, wenn das Flag ohne Wert dasteht. */
function leseOutOption(cliArgs) {
  const i = cliArgs.indexOf("--out");
  if (i === -1) return null;
  const wert = cliArgs[i + 1];
  if (!wert || wert.startsWith("-")) throw new CliError("--out braucht ein Verzeichnis");
  return wert;
}

// ============================================================
// CLI
// ============================================================

function hilfeAufStderr() {
  process.stderr.write(HILFE);
  return 1;
}

export function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HILFE);
    return 0;
  }

  const [unterkommando, ...rest] = argv;
  if (!UNTERKOMMANDOS.includes(unterkommando)) return hilfeAufStderr();

  if (unterkommando !== "export") {
    process.stderr.write(`Noch nicht implementiert: ${unterkommando}\n`);
    return 1;
  }

  try {
    fuehreExportAus(rest);
    return 0;
  } catch (e) {
    if (e instanceof CliError) return hilfeAufStderr();
    process.stderr.write(`Fehler: ${e.message}\n`);
    return 1;
  }
}

// Nur ausfuehren, wenn direkt gestartet (nicht beim Import in Tests).
//
// fileURLToPath statt new URL(...).pathname: Unter Windows liefert pathname einen
// fuehrenden Slash vor dem Laufwerksbuchstaben, der Vergleich schlug dort immer fehl
// (Issue #197). realpathSync wie in kit/board.mjs, weil Node fuer import.meta.url
// Symlinks aufloest (macOS: /var -> /private/var).
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) {
  process.exit(main(process.argv.slice(2)));
}
