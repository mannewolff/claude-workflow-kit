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
 *           node tools/migrate-issues.mjs import --file <exportdatei> ...
 *           node tools/migrate-issues.mjs verify --in <exportdatei> [--from N --to M]
 *
 * `export` liest ausschliesslich: kein Schreibzugriff auf GitHub, keine Abhaengigkeit
 * zu kanban-kit. Geschrieben wird genau eine Datei im Zielverzeichnis.
 *
 * `import` spricht kanban-kit direkt per fetch an (Issue #289) und nicht ueber
 * kit/board.mjs: Dessen createIssue kennt weder `number` noch `externalKey` und sendet
 * immer column BACKLOG — die Migration braucht aber genau diese drei Felder, und
 * board.mjs bleibt laut Plandokument (#287) unveraendert. Die Auth-Kette (Host aus der
 * Config bzw. dem tbx-Login, Token aus TBX_TOKEN > toolbox.tokenFile > tokens.json)
 * ist bewusst dieselbe wie dort: dasselbe Board, derselbe Login.
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
import { tmpdir, homedir } from "node:os";
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
  "  node tools/migrate-issues.mjs import --file <exportdatei>",
  "      (--dry-run --out-dir <verzeichnis> | --yes) [--from N --to N] [--limit N]",
  "      Spielt einen Export in kanban-kit ein. Genau einer der beiden Modi muss",
  "      gesetzt sein: --dry-run schreibt nur Vorschaudateien, --yes legt Karten an.",
  "  node tools/migrate-issues.mjs verify --in <exportdatei> [--from N --to M]",
  "      Vergleicht Export und Ziel als Gate. Liest nur.",
  "      Exit 0 = keine Abweichung, 1 = Abweichung gefunden, 2 = Betriebsfehler.",
  "  node tools/migrate-issues.mjs --help",
  "",
  `Ohne --out schreibt export nach ${DEFAULT_OUT}.`,
  "Der Dateiname traegt den UTC-Zeitpunkt des Laufs; eine vorhandene Datei wird nie",
  "ueberschrieben. Auf stdout steht ausschliesslich der Pfad der erzeugten Datei.",
  "",
  "Vor dem ersten --yes-Lauf muss import einmal als --dry-run ohne --from/--to/--limit",
  "ueber den vollstaendigen Bestand gelaufen und die Vorschau geprueft worden sein:",
  "Ein Formatfehler faellt sonst erst auf, wenn er schon auf dem Board steht.",
  "import meldet auf stdout genau ein JSON-Objekt mit den Zaehlern des Laufs.",
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

function leseConfig() {
  const pfad = resolve(".claude", "workflow.config.json");
  if (!existsSync(pfad)) throw new MigrateError(`${pfad} nicht gefunden — bitte im Projektverzeichnis starten.`);
  try {
    return JSON.parse(readFileSync(pfad, "utf-8"));
  } catch (e) {
    throw new MigrateError(`${pfad} ist kein gueltiges JSON: ${e.message}`);
  }
}

function projectNumber() {
  const config = leseConfig();
  const num = config.github?.projectNumber;
  if (!num) throw new MigrateError("github.projectNumber fehlt in der Konfiguration — ohne Projektnummer gibt es keine Board-Spalte.");
  return Number(num);
}

/** Liest eine JSON-Datei, wenn sie da und lesbar ist — sonst null. */
function leseJsonWennDa(pfad) {
  if (!existsSync(pfad)) return null;
  try { return JSON.parse(readFileSync(pfad, "utf-8")); } catch { return null; }
}

/**
 * Host und Token fuer kanban-kit, aufgeloest wie in kit/board.mjs (#135, #367):
 * Host aus config.toolbox.host, sonst aus dem tbx-Login; Token aus TBX_TOKEN, sonst
 * toolbox.tokenFile, sonst tokens.json des tbx-Logins. Ein Klartext-Token in der
 * eingecheckten Config bricht ab — dieselbe Leitplanke wie dort, weil es dieselbe
 * Datei ist und ein Werkzeug sie nicht unterlaufen darf.
 */
function kanbanZugang() {
  const config = leseConfig();
  const dir = process.env.TBX_CONFIG_DIR || join(homedir(), ".config", "toolbox-cli");

  const host = config.toolbox?.host || leseJsonWennDa(join(dir, "config.json"))?.host;
  if (!host) {
    throw new MigrateError(
      "Kein kanban-kit-Host gefunden. toolbox.host in .claude/workflow.config.json setzen oder 'tbx auth login' ausfuehren."
    );
  }

  if (config.toolbox?.token) {
    throw new MigrateError("kein Klartext-Token in workflow.config.json — nutze TBX_TOKEN oder toolbox.tokenFile.");
  }

  const envToken = (process.env.TBX_TOKEN || "").trim();
  let token = envToken;
  if (!token && config.toolbox?.tokenFile) {
    const tokenPfad = resolve(config.toolbox.tokenFile);
    let inhalt;
    try {
      inhalt = readFileSync(tokenPfad, "utf-8");
    } catch (e) {
      throw new MigrateError(`toolbox.tokenFile '${config.toolbox.tokenFile}' nicht lesbar: ${e.message}`);
    }
    token = inhalt.trim();
  }
  if (!token) token = (leseJsonWennDa(join(dir, "tokens.json"))?.token || "").trim();
  if (!token) {
    throw new MigrateError(
      "Kein kanban-kit-Token gefunden. TBX_TOKEN setzen, toolbox.tokenFile zeigen lassen oder 'tbx auth login' ausfuehren."
    );
  }

  return { host: String(host).replace(/\/$/, ""), token };
}

/**
 * Ein Request gegen die Kanban-API. Fehler werden zu MigrateError, damit der Aufrufer
 * sie nicht von einem Bedienfehler unterscheiden muss; die Server-Meldung bleibt
 * erhalten, weil sie bei einem abgebrochenen Import die einzige Spur ist.
 */
async function kanbanFetch(zugang, pfad, optionen = {}) {
  let res;
  try {
    res = await fetch(`${zugang.host}${pfad}`, {
      ...optionen,
      headers: { ...optionen.headers, "X-Kanban-Token": zugang.token },
    });
  } catch (e) {
    throw new MigrateError(`kanban-kit nicht erreichbar (${zugang.host}): ${e.message}`);
  }
  if (!res.ok) {
    let meldung = `HTTP ${res.status}`;
    try {
      const koerper = await res.json();
      if (koerper?.message) meldung = koerper.message;
    } catch { /* kein JSON-Body */ }
    throw new MigrateError(`kanban-kit-Fehler bei ${pfad}: ${meldung}`);
  }
  return res;
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
    issues(first:50,states:OPEN,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){
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
  const outDir = resolve(leseOption(cliArgs, "--out", "ein Verzeichnis") ?? DEFAULT_OUT);
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

/** Der Wert eines Flags, oder null. Wirft, wenn das Flag ohne Wert dasteht. */
function leseOption(cliArgs, name, was) {
  const i = cliArgs.indexOf(name);
  if (i === -1) return null;
  const wert = cliArgs[i + 1];
  if (!wert || wert.startsWith("-")) throw new CliError(`${name} braucht ${was}`);
  return wert;
}

// ============================================================
// import
// ============================================================

// Die Zielspalten des Boards. Der Export legt den sichtbaren Namen der GitHub-Spalte
// ab ("In progress"), die Abbildung ist aber ueber die Status-Werte des Workflows
// definiert (in_progress) — deshalb wird der Wert vor dem Nachschlagen normalisiert.
// Beide Schreibweisen treffen damit dieselbe Spalte, jeder andere Wert keine.
const ZIELSPALTEN = {
  backlog: "BACKLOG",
  ready: "READY",
  in_progress: "IN_PROGRESS",
  in_review: "IN_REVIEW",
  done: "DONE",
  // Das GitHub-Board dieses Repos fuehrt eine sechste Spalte, die kanban-kit nicht
  // kennt. Sie wird ausdruecklich abgebildet, nicht ueber ein stilles Fallback
  // aufgefangen: Eine unbekannte Spalte bleibt ein Abbruch (Issue #289), sonst
  // landet irgendwann eine falsch geschriebene Spalte lautlos im Backlog.
  // Die Information geht nicht verloren — die Herkunfts-Kopfzeile im Body nennt
  // weiterhin "Zurückgestellt" (Plan-Entscheidung 10).
  "zurückgestellt": "BACKLOG",
  zurueckgestellt: "BACKLOG",
};

function zielSpalte(wert) {
  if (wert == null || String(wert).trim() === "") return "BACKLOG";
  const schluessel = String(wert).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const spalte = ZIELSPALTEN[schluessel];
  if (!spalte) {
    throw new MigrateError(`Unbekannte Spalte '${wert}' — bekannt sind: ${Object.keys(ZIELSPALTEN).join(", ")}.`);
  }
  return spalte;
}

function externalKey(number) {
  return `github#${number}`;
}

function issueUrl(repoUrl, number) {
  return `${repoUrl}/issues/${number}`;
}

/**
 * Der Karten-Body: Herkunfts-Kopfzeile, Leerzeile, urspruenglicher Body unveraendert.
 *
 * Die Kopfzeile nennt die Spalte auch dann, wenn es keine gab (Literal `keine`,
 * Plan-Entscheidung 10): Ohne sie saehen die im Backlog gelandeten Karten aus wie
 * normale Arbeit, und niemand koennte spaeter sagen, woher sie kamen.
 */
function kartenBody(eintrag, repoUrl) {
  const spalte = eintrag.spalte == null || String(eintrag.spalte).trim() === "" ? "keine" : eintrag.spalte;
  return `> Quelle: ${issueUrl(repoUrl, eintrag.number)}\n> Ursprüngliche Spalte: ${spalte}\n\n${eintrag.body}`;
}

// Kommentare werden nicht in den Karten-Body gefaltet, sondern einzeln angelegt:
// verify (#290) vergleicht sie in Reihenfolge, und das setzt zaehlbare Einheiten
// voraus. Ein leerer Autor wird zu 'unbekannt' — der Export normalisiert einen
// geloeschten GitHub-Account zu "", und eine Kopfzeile mit leerem Feld liest sich wie
// ein Fehler statt wie eine fehlende Angabe.
function kommentarBody(eintrag, kommentar, repoUrl) {
  const autor = String(kommentar.author ?? "").trim() || "unbekannt";
  return `> Quelle: ${issueUrl(repoUrl, eintrag.number)}\n> Autor: ${autor}\n> Datum: ${kommentar.createdAt}\n\n${kommentar.body}`;
}

// Array.prototype.sort ist stabil: Bei gleichem createdAt bleibt die Reihenfolge der
// Exportdatei erhalten, wie im Issue gefordert.
function sortierteKommentare(kommentare) {
  return [...kommentare].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// ------------------------------------------------------------
// Eingabe
// ------------------------------------------------------------

function pruefeText(wert, feld, ort) {
  if (typeof wert !== "string") throw new MigrateError(`${ort}: '${feld}' fehlt oder ist kein Text.`);
}

/**
 * Prueft die Exportdatei vollstaendig gegen das Schema aus Issue #288, bevor
 * irgendetwas geschrieben wird. Ein Teilimport, der an Eintrag 40 auffliegt, waere
 * teurer als jede Vorabpruefung: Er hinterlaesst ein halb gefuelltes Board.
 */
function validiereExport(daten) {
  if (!Array.isArray(daten)) throw new MigrateError("Die Exportdatei enthaelt kein Array von Eintraegen.");
  const nummern = new Set();
  daten.forEach((eintrag, i) => {
    const ort = `Eintrag ${i + 1}`;
    if (!eintrag || typeof eintrag !== "object" || Array.isArray(eintrag)) {
      throw new MigrateError(`${ort}: kein Objekt.`);
    }
    if (!Number.isInteger(eintrag.number)) throw new MigrateError(`${ort}: 'number' fehlt oder ist keine Ganzzahl.`);
    pruefeText(eintrag.title, "title", ort);
    pruefeText(eintrag.body, "body", ort);
    if (!Array.isArray(eintrag.labels) || !eintrag.labels.every((l) => typeof l === "string")) {
      throw new MigrateError(`${ort}: 'labels' fehlt oder ist keine Liste von Namen.`);
    }
    if (eintrag.spalte !== null && typeof eintrag.spalte !== "string") {
      throw new MigrateError(`${ort}: 'spalte' muss ein Text oder null sein.`);
    }
    if (!Array.isArray(eintrag.comments)) throw new MigrateError(`${ort}: 'comments' fehlt oder ist keine Liste.`);
    eintrag.comments.forEach((k, j) => {
      const kOrt = `${ort}, Kommentar ${j + 1}`;
      if (!k || typeof k !== "object") throw new MigrateError(`${kOrt}: kein Objekt.`);
      pruefeText(k.author, "author", kOrt);
      pruefeText(k.body, "body", kOrt);
      pruefeText(k.createdAt, "createdAt", kOrt);
    });
    if (nummern.has(eintrag.number)) throw new MigrateError(`Issue-Nummer ${eintrag.number} kommt mehrfach vor.`);
    nummern.add(eintrag.number);
  });
  return daten;
}

function leseExportDatei(pfad) {
  const voll = resolve(pfad);
  if (!existsSync(voll)) throw new MigrateError(`Exportdatei nicht gefunden: ${voll}`);
  let daten;
  try {
    daten = JSON.parse(readFileSync(voll, "utf-8"));
  } catch (e) {
    throw new MigrateError(`${voll} ist kein gueltiges JSON: ${e.message}`);
  }
  return validiereExport(daten);
}

/** Der Wert eines Zahlen-Flags als positive Ganzzahl, oder null. */
function leseZahlOption(cliArgs, name) {
  const roh = leseOption(cliArgs, name, "eine Zahl");
  if (roh === null) return null;
  if (!/^\d+$/.test(roh)) throw new MigrateError(`${name} braucht eine positive Ganzzahl, nicht '${roh}'.`);
  return Number(roh);
}

/**
 * Alle Optionen des import-Laufs, vollstaendig geprueft — vor jedem Datei- oder
 * Netzzugriff. Genau einer der beiden Modi muss gesetzt sein: ohne beide waere unklar,
 * was gemeint ist, mit beiden waere es der schreibende Lauf mit einem Feigenblatt.
 */
function leseImportOptionen(cliArgs) {
  const datei = leseOption(cliArgs, "--file", "die Exportdatei");
  if (!datei) throw new MigrateError("import braucht --file <exportdatei>.");

  const dryRun = cliArgs.includes("--dry-run");
  const yes = cliArgs.includes("--yes");
  if (dryRun === yes) {
    throw new MigrateError("Genau einer der beiden Modi muss gesetzt sein: --dry-run oder --yes.");
  }

  const outDir = leseOption(cliArgs, "--out-dir", "ein Verzeichnis");
  if (dryRun && !outDir) throw new MigrateError("--dry-run braucht --out-dir <verzeichnis> fuer die Vorschau.");

  const from = leseZahlOption(cliArgs, "--from");
  const to = leseZahlOption(cliArgs, "--to");
  if ((from === null) !== (to === null)) throw new MigrateError("--from und --to gehoeren zusammen.");
  if (from !== null && from > to) throw new MigrateError(`--from ${from} liegt hinter --to ${to}.`);

  const limit = leseZahlOption(cliArgs, "--limit");
  if (limit !== null && limit < 1) throw new MigrateError("--limit braucht eine positive Ganzzahl.");

  return { datei, dryRun, outDir, from, to, limit };
}

/** Erst nach Nummer sortieren, dann den Bereich filtern, zuletzt limitieren. */
function waehleAus(daten, { from, to, limit }) {
  let auswahl = [...daten].sort((a, b) => a.number - b.number);
  if (from !== null) auswahl = auswahl.filter((e) => e.number >= from && e.number <= to);
  return limit === null ? auswahl : auswahl.slice(0, limit);
}

// ------------------------------------------------------------
// Ausfuehrung
// ------------------------------------------------------------

/**
 * Schreibt die Vorschau. Alle Zieldateien werden geprueft, bevor die erste entsteht:
 * Ein Abbruch in der Mitte liesse einen halben Vorschaustand zurueck, den beim
 * naechsten Lauf niemand von einem vollstaendigen unterscheiden koennte.
 */
function schreibeVorschau(auswahl, repoUrl, outDir) {
  const ziel = resolve(outDir);
  const dateien = auswahl.map((eintrag) => ({ eintrag, pfad: join(ziel, `github-${eintrag.number}.md`) }));
  const belegt = dateien.find((d) => existsSync(d.pfad));
  if (belegt) throw new MigrateError(`Vorschaudatei existiert bereits: ${belegt.pfad}`);

  mkdirSync(ziel, { recursive: true });
  for (const datei of dateien) {
    writeFileSync(datei.pfad, kartenBody(datei.eintrag, repoUrl), "utf-8");
  }
}

/** Der Kartenbestand des Boards als flache Liste (die API gruppiert nach Spalte). */
async function ladeBestand(zugang) {
  const res = await kanbanFetch(zugang, "/api/kanban/items");
  const gruppiert = await res.json();
  if (!gruppiert || typeof gruppiert !== "object") {
    throw new MigrateError("Unerwartete Antwort beim Lesen des Kartenbestands.");
  }
  return Object.values(gruppiert).flat().filter((k) => k && typeof k === "object");
}

/**
 * Teilt die Auswahl in "schon da" und "anzulegen" — vor dem ersten Schreibzugriff.
 *
 * Der externalKey ist der Anker der Idempotenz (Plan-Entscheidung 3): Der Umzug laeuft
 * step by step, jeder Block muss wiederholbar sein. Eine belegte Zielnummer mit
 * fremdem Schluessel ist dagegen kein Wiederholungsfall, sondern eine fremde Karte —
 * der Lauf endet, statt sie zu ueberschreiben.
 */
function teileAuf(auswahl, bestand, bilanz) {
  const nachKey = new Map();
  const nachNummer = new Map();
  for (const karte of bestand) {
    if (karte.externalKey) nachKey.set(String(karte.externalKey), karte);
    if (karte.number != null) nachNummer.set(Number(karte.number), karte);
  }

  const offen = [];
  for (const eintrag of auswahl) {
    if (nachKey.has(externalKey(eintrag.number))) {
      bilanz.skipped += 1;
      continue;
    }
    const belegt = nachNummer.get(eintrag.number);
    if (belegt) {
      throw new MigrateError(
        `Zielnummer ${eintrag.number} ist bereits belegt (externalKey: ${belegt.externalKey ?? "keiner"}) — nichts wird ueberschrieben.`
      );
    }
    offen.push(eintrag);
  }
  return offen;
}

async function legeKarteAn(zugang, eintrag, repoUrl) {
  const res = await kanbanFetch(zugang, "/api/kanban/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      number: eintrag.number,
      externalKey: externalKey(eintrag.number),
      column: zielSpalte(eintrag.spalte),
      title: eintrag.title,
      body: kartenBody(eintrag, repoUrl),
      // Ohne `direct` legt kanban-kit die Karte als board-lose Idee im Pool an --
      // und lehnt sie mit HTTP 400 ab, sobald zugleich eine `number` vorgegeben
      // ist: Eine Pool-Idee bekommt ihre Nummer erst beim Einplanen, beides
      // zusammen ist ein Widerspruch. Die Migration will immer direkt aufs Board.
      // Issue #295 hat dieselbe Umstellung in kit/board.mjs gemacht; dieses
      // Werkzeug spricht die API mit eigenem fetch an und war davon nicht erfasst.
      direct: true,
    }),
  });

  let angelegt = null;
  try { angelegt = await res.json(); } catch { /* leere Antwort */ }
  const id = angelegt?.id ?? null;
  if (id == null && eintrag.comments.length > 0) {
    throw new MigrateError(
      `Die Create-Response zu Issue #${eintrag.number} enthaelt keine 'id' — die Kommentare koennen nicht angehaengt werden.`
    );
  }
  return id;
}

async function schreibeKarten(zugang, offen, repoUrl, bilanz) {
  for (const eintrag of offen) {
    try {
      const id = await legeKarteAn(zugang, eintrag, repoUrl);
      for (const kommentar of sortierteKommentare(eintrag.comments)) {
        await kanbanFetch(zugang, `/api/kanban/items/${id}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: kommentarBody(eintrag, kommentar, repoUrl) }),
        });
      }
      bilanz.created += 1;
    } catch (e) {
      // Der Lauf endet hier statt weiterzumachen: Ein Fehler an dieser Stelle heisst
      // meist, dass etwas Grundsaetzliches nicht stimmt, und die Bilanz sagt genau,
      // wo fortzusetzen ist — der externalKey macht den naechsten Lauf dublettenfrei.
      bilanz.failed += 1;
      throw new MigrateError(`Issue #${eintrag.number} konnte nicht angelegt werden: ${e.message}`);
    }
  }
}

/** Die Repository-URL als Basis der Herkunftsangaben. Rein lesender gh-Aufruf. */
function repositoryUrl() {
  const url = exec("gh", ["repo", "view", "--json", "url", "-q", ".url"]);
  if (!/^https?:\/\//.test(url)) throw new MigrateError(`Konnte die Repository-URL nicht bestimmen: '${url}'`);
  return url.replace(/\/$/, "");
}

async function fuehreImportAus(cliArgs) {
  const optionen = leseImportOptionen(cliArgs);
  const auswahl = waehleAus(leseExportDatei(optionen.datei), optionen);

  // Spaltenpruefung fuer die ganze Auswahl, bevor irgendetwas entsteht: Ein
  // unbekannter Wert soll nicht erst auffallen, wenn die Haelfte schon steht.
  for (const eintrag of auswahl) zielSpalte(eintrag.spalte);

  const bilanz = { selected: auswahl.length, created: 0, skipped: 0, failed: 0 };
  const melde = () => process.stdout.write(`${JSON.stringify(bilanz)}\n`);
  if (auswahl.length === 0) {
    melde();
    return;
  }

  const repoUrl = repositoryUrl();
  if (optionen.dryRun) {
    schreibeVorschau(auswahl, repoUrl, optionen.outDir);
    melde();
    return;
  }

  const zugang = kanbanZugang();
  const offen = teileAuf(auswahl, await ladeBestand(zugang), bilanz);
  try {
    await schreibeKarten(zugang, offen, repoUrl, bilanz);
  } finally {
    // Auch beim Abbruch: Die Bilanz nennt die bis dahin angelegten und
    // uebersprungenen Karten und ist damit der Ansatzpunkt des naechsten Laufs.
    melde();
  }
}

// ============================================================
// CLI
// ============================================================

// ============================================================
// verify
// ============================================================

const ABWEICHUNG = 1;
const BETRIEBSFEHLER = 2;

/**
 * Die Spalte auf den Workflow-Status normalisieren — "In progress" und
 * "IN_PROGRESS" sind dasselbe.
 *
 * Fuer Quellspalten, die der Import auf eine andere Zielspalte abbildet, wird
 * dieselbe Abbildung angewandt: Sonst meldete das Gate genau die Karten als
 * abweichend, die spezifikationsgemaess umgezogen sind. Die Abbildung wird aus
 * ZIELSPALTEN abgeleitet und nicht zweitgeschrieben — zwei Tabellen, die dasselbe
 * meinen, laufen auseinander.
 */
function normalisiereSpalte(wert) {
  if (wert == null || String(wert).trim() === "") return null;
  const schluessel = String(wert).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const ziel = ZIELSPALTEN[schluessel];
  return ziel ? ziel.toLowerCase() : schluessel;
}

/**
 * Den Ziel-Body auf den urspruenglichen zurueckfuehren: Die zwei Kopfzeilen aus
 * Issue #289 plus die trennende Leerzeile abziehen. Ohne das waere ein Vergleich
 * bei JEDER importierten Karte rot — die Kopfzeile steht ja ueberall.
 * Fehlt die Kopfzeile, bleibt der Body unveraendert; dann meldet der Vergleich sie
 * als Abweichung, was richtig ist.
 */
function ohneHerkunft(body) {
  const treffer = /^> Quelle: [^\n]*\n> Ursprüngliche Spalte: [^\n]*\n\n/.exec(body ?? "");
  return treffer ? String(body).slice(treffer[0].length) : String(body ?? "");
}

function alsJson(wert) {
  return JSON.stringify(wert === undefined ? null : wert);
}

/**
 * Die Kommentare einer Zielkarte lesen.
 *
 * Anders als der Board-Adapter (`ToolboxIssueTracker._comments`) wird ein Ausfall
 * hier NICHT zu einer leeren Liste geglaettet: Fuer ein Gate waere ein nicht
 * erreichbarer Endpunkt von echtem Datenverlust ununterscheidbar.
 */
async function leseZielKommentare(zugang, kartenId) {
  let res;
  try {
    res = await kanbanFetch(zugang, `/api/kanban/items/${kartenId}/comments`);
  } catch (e) {
    throw new MigrateError(`Kommentare nicht prüfbar (Karte ${kartenId}): ${e.message}`);
  }
  const roh = await res.json();
  if (!Array.isArray(roh)) {
    throw new MigrateError(`Kommentare nicht prüfbar (Karte ${kartenId}): Antwort ist keine Liste.`);
  }
  return roh;
}

/** Ein Eintrag gegen seine Zielkarte. Liefert die Abweichungszeilen. */
async function vergleiche(eintrag, karte, zugang) {
  const zeilen = [];
  const melde = (feld, quelle, ziel) =>
    zeilen.push(`#${eintrag.number} field=${feld} source=${alsJson(quelle)} target=${alsJson(ziel)}`);

  if (!karte) {
    melde("card", eintrag.title, null);
    return zeilen;
  }
  if (eintrag.title !== karte.title) melde("title", eintrag.title, karte.title);

  const zielBody = ohneHerkunft(karte.body);
  if (eintrag.body !== zielBody) melde("body", eintrag.body, zielBody);

  // Eine Quelle ohne Spalte landet laut Plan-Entscheidung 10 im Backlog. Das ist
  // spezifikationsgemaess und keine Abweichung — sonst waeren es 23 Fehlalarme.
  const quellSpalte = normalisiereSpalte(eintrag.spalte) ?? "backlog";
  const zielSpalteWert = normalisiereSpalte(karte.column);
  if (quellSpalte !== zielSpalteWert) melde("spalte", quellSpalte, zielSpalteWert);

  const zielKommentare = await leseZielKommentare(zugang, karte.id);
  const quellKommentare = sortierteKommentare(eintrag.comments ?? []);
  if (quellKommentare.length !== zielKommentare.length) {
    melde("comments", quellKommentare.length, zielKommentare.length);
  } else {
    quellKommentare.forEach((k, i) => {
      const ziel = zielKommentare[i];
      const zielText = ohneHerkunftKommentar(ziel?.body);
      if (k.body !== zielText) melde(`comment[${i}]`, k.body, zielText);
    });
  }
  return zeilen;
}

/** Wie ohneHerkunft, nur fuer die dreizeilige Kommentar-Kopfzeile aus Issue #289. */
function ohneHerkunftKommentar(body) {
  const treffer = /^> Quelle: [^\n]*\n> Autor: [^\n]*\n> Datum: [^\n]*\n\n/.exec(body ?? "");
  return treffer ? String(body).slice(treffer[0].length) : String(body ?? "");
}

async function fuehreVerifyAus(cliArgs) {
  const pfad = leseOption(cliArgs, "--in", "ein Pfad");
  if (!pfad) throw new MigrateError("--in <pfad> ist erforderlich.");
  const from = leseZahlOption(cliArgs, "--from");
  const to = leseZahlOption(cliArgs, "--to");
  if (from !== null && to !== null && from > to) {
    throw new MigrateError(`--from (${from}) darf nicht groesser als --to (${to}) sein.`);
  }

  const daten = leseExportDatei(pfad);
  const auswahl = daten.filter(
    (e) => (from === null || e.number >= from) && (to === null || e.number <= to)
  );

  const zugang = kanbanZugang();
  const bestand = await ladeBestand(zugang);
  const nachNummer = new Map(bestand.map((k) => [Number(k.number), k]));

  const alle = [];
  for (const eintrag of auswahl) {
    alle.push(...(await vergleiche(eintrag, nachNummer.get(Number(eintrag.number)), zugang)));
  }

  for (const zeile of alle) process.stdout.write(`${zeile}\n`);
  process.stdout.write(`${auswahl.length} Karten geprüft, ${alle.length} Abweichungen\n`);
  return alle.length === 0 ? 0 : ABWEICHUNG;
}

function hilfeAufStderr() {
  process.stderr.write(HILFE);
  return 1;
}

export async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HILFE);
    return 0;
  }

  const [unterkommando, ...rest] = argv;
  if (!UNTERKOMMANDOS.includes(unterkommando)) return hilfeAufStderr();

  // verify trennt zwei Lagen ueber den Exit-Code und faengt deshalb selbst:
  // 1 = fachliche Abweichung, 2 = Betriebsfehler. Wer beides auf 1 abbildet, kann
  // "die Daten stimmen nicht" nicht von "die Pruefung fand nicht statt" unterscheiden.
  if (unterkommando === "verify") {
    try {
      return await fuehreVerifyAus(rest);
    } catch (e) {
      if (e instanceof CliError) {
        process.stderr.write(`Fehler: ${e.message}\n`);
        return BETRIEBSFEHLER;
      }
      process.stderr.write(`Fehler: ${e.message}\n`);
      return BETRIEBSFEHLER;
    }
  }

  try {
    if (unterkommando === "export") fuehreExportAus(rest);
    else await fuehreImportAus(rest);
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
// exitCode statt process.exit: Seit import asynchron arbeitet, wuerde ein sofortiges
// exit die noch nicht geleerten stdout-Puffer abschneiden — und genau darin steht die
// Bilanz des Laufs.
if (runAsCli) {
  process.exitCode = await main(process.argv.slice(2));
}
