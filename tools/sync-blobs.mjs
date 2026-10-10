#!/usr/bin/env node
/**
 * sync-blobs.mjs — haelt die Base64-Blobs in install.mjs synchron mit templates/, kit/, skills/, agents/ und en/
 * und stempelt die Kit-Version in die Kit-Dateien (Issue #171).
 *
 * Nutzung:
 *   node tools/sync-blobs.mjs          # Stempel setzen, Blobs in install.mjs neu generieren
 *   node tools/sync-blobs.mjs --check  # nur pruefen; Exit 1 bei Drift
 *
 * Reihenfolge ist bindend: erst stempeln, dann Blobs backen — sonst enthielte
 * install.mjs die Kit-Dateien mit dem alten Stempel und jede Neuinstallation
 * verteilte eine Kopie, die eine falsche Version behauptet.
 *
 * Warum hier und nicht in version.mjs: Wuerde version.mjs stempeln, waeren nach
 * dem Bump die Blobs veraltet und `sync-blobs --check` — ein buildCheck dieses
 * Repos — ginge zwischenzeitlich rot. Hier bleibt es ein atomarer Schritt, und
 * RELEASING.md braucht keine zusaetzliche Reihenfolge-Regel.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Repo-Root: normalerweise der eigene Ort (<tool-dir>/..). KIT_ROOT ueberschreibt ihn
// und ist ein Test-Hook (Issue #186, analog NIGHT_CLAUDE_CMD/NIGHT_TIMEOUT_MS in
// night.mjs). Vorher kopierten die Tests dieses Script in ein Fixture-Verzeichnis und
// fuehrten die Kopie aus — dabei entsteht Coverage unter einem Temp-Pfad, den SonarCloud
// nicht auf die Repo-Datei abbilden kann. Mit dem Hook laeuft das ECHTE Script und zeigt
// nur mit dem Root ins Fixture.
const root = process.env.KIT_ROOT
  ? resolve(process.env.KIT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL = join(root, "install.mjs");

// Codepoint-Ordnung, unabhaengig von der Locale der Maschine (Issue #956, S2871).
// Die Reihenfolge landet in den Blobs von install.mjs; haenge sie an der Locale,
// erzeugte dieselbe Quelle auf zwei Rechnern zwei verschiedene install.mjs und
// `sync-blobs --check` ginge je nach Maschine rot. Gleichwertig zu `vergleicheText`
// in kit/checks.mjs — hier lokal, weil dieses Tool sonst nichts aus kit/ laedt.
function vergleicheText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Eine versteckte Datei gehoert in keinen Blob: weder das .gitkeep, das den leeren Spiegel en/
// im Repo haelt (Issue #1464), noch ein .DS_Store, den der Finder ablegt.
const versteckt = (datei) => datei.startsWith(".");

// Liest einen Ordner mit einer Unterordner-Ebene (z.B. skills/<name>/<datei>)
// zu { name: { datei: inhalt } } ein — Grundlage fuer einen gemeinsamen Blob.
// Ein fehlender Ordner ergibt {} wie bei buildFileJson: Der Spiegel en/skills/ kann fehlen.
function buildDirJson(dir) {
  const result = {};
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir).sort(vergleicheText)) {
    const entryDir = join(dir, entry);
    if (!statSync(entryDir).isDirectory()) continue;
    const files = {};
    for (const file of readdirSync(entryDir).sort(vergleicheText)) {
      const filePath = join(entryDir, file);
      if (!versteckt(file) && statSync(filePath).isFile()) files[file] = readFileSync(filePath, "utf-8");
    }
    result[entry] = files;
  }
  return result;
}

// Liest die Dateien eines flachen Ordners (z.B. kit/night/<datei>) zu { datei: inhalt }
// ein — Grundlage der Verzeichnis-Blobs fuer die Teile (Issue #1209, Plan #1199 E1).
// Ein fehlender Ordner ergibt {}: Solange es noch keinen Teil gibt, ist das Verzeichnis
// leer, und git fuehrt kein leeres Verzeichnis.
function buildFileJson(dir) {
  const result = {};
  if (!existsSync(dir)) return result;
  for (const file of readdirSync(dir).sort(vergleicheText)) {
    const filePath = join(dir, file);
    if (!versteckt(file) && statSync(filePath).isFile()) result[file] = readFileSync(filePath, "utf-8");
  }
  return result;
}

const BLOBS = [
  { constName: "CLAUDE_WORKFLOW_MD_B64", source: join(root, "templates", "CLAUDE-workflow.md") },
  { constName: "CLAUDE_FACHPLAN_MD_B64", source: join(root, "templates", "CLAUDE-Fachplan.md") },
  { constName: "CLAUDE_PLAN_MD_B64", source: join(root, "templates", "CLAUDE-Plan.md") },
  // Beispiel-Config, die der Installer als .claude/workflow.config.example.json ablegt.
  // Sie ist der einzige Ort, an dem ein Nutzer den issueReview-Block zu sehen bekommt,
  // ohne die Doku zu lesen — der Installer fragt ihn nicht ab (reviewers ist
  // maschinenabhaengig, pairs eine Denkentscheidung). Nebeneffekt: Die Vorlage stand
  // vorher in keiner Blob-Liste, wurde von niemandem gelesen und driftete unbemerkt;
  // jetzt bewacht sie `sync-blobs --check`, also ein buildCheck.
  { constName: "CONFIG_EXAMPLE_B64", source: join(root, "templates", "workflow.config.json") },
  { constName: "BOARD_MJS_B64", source: join(root, "kit", "board.mjs") },
  { constName: "NIGHT_MJS_B64", source: join(root, "kit", "night.mjs") },
  { constName: "CHECKS_MJS_B64", source: join(root, "kit", "checks.mjs") },
  // Preistabelle des Sitzungs-Melders (Issue #734). Eigene Datei, weil sie
  // Pflegedaten mit eigenem Stand traegt und kein Code ist; board.mjs laedt sie als
  // Nachbardatei und kommt ohne sie aus (dann eben ohne Dollarbetrag).
  { constName: "PREISE_MJS_B64", source: join(root, "kit", "preise.mjs") },
  // Aufwands-Auswertung (Issue #750). Eigene Datei statt Anbau an night.mjs: /push-main
  // muss den Befund lesen koennen, ohne den Nacht-Runner zu starten. Wie board.mjs laedt
  // sie preise.mjs als Nachbardatei und kommt ohne sie aus.
  { constName: "AUFWAND_MJS_B64", source: join(root, "kit", "aufwand.mjs") },
  // Wirksamkeits-Auswertung (Issue #787). Eigenes Werkzeug nach dem Muster von
  // aufwand.mjs: eine reine Leseoperation ueber das Ausfuehrungsprotokoll von
  // checks.mjs (#785), an Fixtures vollstaendig pruefbar.
  { constName: "WIRKSAMKEIT_MJS_B64", source: join(root, "kit", "wirksamkeit.mjs") },
  // Form und Arten der Funde (Issue #799). Eigenes Werkzeug nach demselben Muster:
  // Der Regeltext verweist fuer die Artenliste auf `befunde arten`, und die
  // Pruef-Skills setzen sie ueber dieses Kommando in ihre Prompts ein — ohne
  // Auslieferung ginge beides in jedem Projekt ins Leere.
  { constName: "BEFUNDE_MJS_B64", source: join(root, "kit", "befunde.mjs") },
  // Der Worktree der Release-Skills (Issue #929). Anders als die Werkzeuge darueber ist es
  // KEINE portable Einzeldatei: Es ruft die Worktree-Vorbereitung aus night.mjs als
  // Nachbardatei, damit es genau einen Weg gibt, einen Worktree anzulegen. Ohne
  // Auslieferung riefen `/push-main` und `/merge-production` in jedem Zielprojekt ins Leere.
  { constName: "WORKTREE_MJS_B64", source: join(root, "kit", "worktree.mjs") },
  // Die englischen Einstiege (Issue #1462, Plan #1420 E18): je ein Aufruf der deutschen
  // Quelle als Nachbardatei. settings.mjs fehlt, weil einstellungen.mjs Download ist.
  { constName: "FINDINGS_MJS_B64", source: join(root, "kit", "findings.mjs") },
  { constName: "EFFORT_MJS_B64", source: join(root, "kit", "effort.mjs") },
  { constName: "EFFECTIVENESS_MJS_B64", source: join(root, "kit", "effectiveness.mjs") },
  // Hook und Gate (Issue #473). gate.mjs gehoert bewusst NICHT in STAMPED: Die
  // Liste steuert Versions-Stempel und die Dogfooding-Kopie nach .claude/kit/,
  // und dort soll das Gate gerade nicht liegen (Plan #467, A2).
  { constName: "GATE_MJS_B64", source: join(root, ".githooks", "gate.mjs") },
  { constName: "PRE_COMMIT_B64", source: join(root, ".githooks", "pre-commit") },
  // Die Teile von night.mjs und board.mjs (Issue #1209, Plan #1199 E1): je ein
  // Verzeichnis-Blob, damit ein neuer Teil weder den Installer noch diese Liste aendert.
  { constName: "KIT_NIGHT_B64", sourceFiles: join(root, "kit", "night") },
  { constName: "KIT_BOARD_B64", sourceFiles: join(root, "kit", "board") },
  // Die Pruefrollen (Issue #1377, Plan #1375 A1): ein Teil wie night/ und board/.
  { constName: "KIT_ROLLEN_B64", sourceFiles: join(root, "kit", "rollen") },
  { constName: "SKILLS_B64", sourceDir: join(root, "skills") },
  // Der Leser-Agent der Pruefer (Issue #1377, Plan #1375 A2): eine flache Quelle neben skills/.
  { constName: "AGENTS_B64", sourceFiles: join(root, "agents") },
  // Der Spiegel en/ (Issue #1464, Plan #1420 E17): je Quelle ein englischer Blob neben dem
  // deutschen. Der Installer waehlt je Projektsprache und faellt fuer eine fehlende englische
  // Fassung auf die deutsche zurueck. Nicht skills/en/: buildDirJson buke den Ordner als Skill.
  { constName: "SKILLS_EN_B64", sourceDir: join(root, "en", "skills") },
  { constName: "TEMPLATES_EN_B64", sourceFiles: join(root, "en", "templates") },
  { constName: "AGENTS_EN_B64", sourceFiles: join(root, "en", "agents") },
  { constName: "KIT_ROLLEN_EN_B64", sourceFiles: join(root, "en", "kit", "rollen") },
];

// Dateien, die den Kit-Stand als KIT_VERSION tragen (Issue #170/#171).
// Die Liste steuert zugleich die Dogfooding-Kopie unter .claude/kit/ (weiter unten):
// Ein Werkzeug, das hier fehlt, entstuende dort nie — und die Skills dieses Repos
// riefen ein Kommando auf, das im eigenen Klon nicht liegt (Issue #425).
const STAMPED = ["board.mjs", "night.mjs", "checks.mjs", "preise.mjs", "aufwand.mjs", "wirksamkeit.mjs", "befunde.mjs", "worktree.mjs"];

// Download-Dateien (Issue #676, Plan #674 E1): gestempelt wie die Kit-Werkzeuge, aber ohne
// Kopie nach .claude/kit/ — sie arbeiten ueber mehrere Projekte und gehoeren in keines.
const STAMPED_DOWNLOADS = ["einstellungen.mjs"];

// Die englischen Einstiege (Issue #1462, Plan #1420 E18): kopiert nach .claude/kit/ wie die
// Werkzeuge, aber ungestempelt — sie tragen keine KIT_VERSION, `--version` beantwortet die
// Quelle. settings.mjs gehoert wie einstellungen.mjs nicht in die Kopie.
const EINSTIEGE = ["findings.mjs", "effort.mjs", "effectiveness.mjs"];

// Teilverzeichnisse unter kit/ (Issue #1209, Plan #1199 E19): kopiert nach .claude/kit/<teil>/
// wie die Werkzeuge, aber ungestempelt — KIT_VERSION steht nur im Einstieg. In STAMPED
// brachen sie den Lauf ab, weil ein Teil keine Konstante traegt.
const TEILE = ["night", "board", "rollen"];

// Was die Einstellungs-Oberflaeche eingebettet traegt: das Schema (Plan #674 E2) und die
// Namenstabelle der Einstellungen (Issue #1437, Plan #1420 E10), dazu die englischen
// Beschreibungen fuer ein englisches Projekt (Issue #1441) und der Texthelfer, ueber den
// die Oberflaeche ihre Meldungen in der Projektsprache waehlt (Issue #1456, Plan #1420
// E13). Eine eigene Datei mitzuliefern widerspraeche dem Download als einzelne Datei, und
// eine Kopie von Hand liefe der Quelle davon.
const EINBETTUNG_ZIEL = "einstellungen.mjs";
const EINBETTUNGEN = [
  { konstante: "SCHEMA_B64", quelle: "templates/workflow.config.schema.json", meldung: "Schema eingebettet" },
  { konstante: "CONFIG_NAMEN_B64", quelle: "kit/board/config-namen.mjs", meldung: "Namenstabelle eingebettet" },
  { konstante: "CONFIG_REFERENZ_EN_B64", quelle: "tools/config-referenz.en.json", meldung: "Englische Referenz eingebettet" },
  { konstante: "NAMEN_B64", quelle: "kit/board/namen.mjs", meldung: "Texthelfer eingebettet" },
];
const KIT_VERSION_RE = /(const KIT_VERSION = ")(\d+\.\d+\.\d+)(";)/;
const INSTALL_VERSION_RE = /const VERSION = "(\d+\.\d+\.\d+)";/;

// Die Kit-Version aus install.mjs — alleinige Versionsquelle laut RELEASING.md.
function kitVersion() {
  const m = readFileSync(INSTALL, "utf-8").match(INSTALL_VERSION_RE);
  if (!m) {
    process.stderr.write(`Fehler: VERSION-Konstante nicht in install.mjs gefunden\n`);
    process.exit(1);
  }
  return m[1];
}

const checkOnly = process.argv.includes("--check");

// --- Stempel (vor dem Blob-Backen, siehe Kopfkommentar) ---
const version = kitVersion();
const stampDrift = [];

for (const datei of [...STAMPED, ...STAMPED_DOWNLOADS]) {
  const pfad = join(root, "kit", datei);
  const src = readFileSync(pfad, "utf-8");
  const m = src.match(KIT_VERSION_RE);
  if (!m) {
    // Kein stiller Skip: eine Kit-Datei ohne Konstante wuerde unbemerkt
    // ungestempelt ausgeliefert und behauptete dann gar nichts.
    process.stderr.write(`Fehler: KIT_VERSION-Konstante nicht in kit/${datei} gefunden\n`);
    process.exit(1);
  }
  if (m[2] !== version) {
    stampDrift.push(`kit/${datei} ist ${m[2]}, erwartet ${version}`);
    if (!checkOnly) writeFileSync(pfad, src.replace(KIT_VERSION_RE, `$1${version}$3`), "utf-8");
  }
}

// --- Eingebettete Dateien (Issue #676, #1437, #1441) ---
// Nach dem Stempel gelesen, damit beide Schritte auf demselben Dateistand arbeiten.
const einbettungDrift = [];
{
  const pfad = join(root, "kit", EINBETTUNG_ZIEL);
  let src = readFileSync(pfad, "utf-8");
  for (const { konstante, quelle, meldung } of EINBETTUNGEN) {
    const re = new RegExp(`(const ${konstante} = ")([A-Za-z0-9+/=]*)(";)`);
    const erwartet = Buffer.from(readFileSync(join(root, quelle), "utf-8"), "utf-8").toString("base64");
    const m = src.match(re);
    if (!m) {
      process.stderr.write(`Fehler: ${konstante}-Konstante nicht in kit/${EINBETTUNG_ZIEL} gefunden\n`);
      process.exit(1);
    }
    if (m[2] === erwartet) continue;
    einbettungDrift.push({ quelle, meldung });
    // Base64 enthaelt kein '$' — Ersetzung ohne Escaping sicher.
    src = src.replace(re, `$1${erwartet}$3`);
  }
  if (einbettungDrift.length > 0 && !checkOnly) writeFileSync(pfad, src, "utf-8");
}

let installSrc = readFileSync(INSTALL, "utf-8");
const drift = [];

function blobRohtext({ source, sourceDir, sourceFiles }) {
  if (sourceDir) return JSON.stringify(buildDirJson(sourceDir));
  if (sourceFiles) return JSON.stringify(buildFileJson(sourceFiles));
  return readFileSync(source, "utf-8");
}

for (const eintrag of BLOBS) {
  const { constName } = eintrag;
  const raw = blobRohtext(eintrag);
  const expected = Buffer.from(raw, "utf-8").toString("base64");
  const re = new RegExp(`(const ${constName} = ")([A-Za-z0-9+/=]*)(";)`);
  const m = installSrc.match(re);
  if (!m) {
    process.stderr.write(`Fehler: Konstante ${constName} nicht in install.mjs gefunden\n`);
    process.exit(1);
  }
  if (m[2] !== expected) {
    drift.push(constName);
    // Base64-Alphabet enthaelt kein '$' — Ersetzung ohne Escaping sicher
    if (!checkOnly) installSrc = installSrc.replace(re, `$1${expected}$3`);
  }
}

// --- Dogfooding-Kopie unter .claude/kit/ (Issue #173) ---
//
// Hier schreibt das Tool bewusst eine NICHT versionierte Datei: .claude/ steht
// komplett in der .gitignore. Die Kopie ist der Runner, den dieses Repo selbst
// benutzt — laeuft sie der Quelle hinterher, fuehrt das Dogfooding einen anderen
// Stand aus als das Repo enthaelt (bei Issue #167 waere der manuelle cp beinahe
// vergessen worden). Fehlt das Verzeichnis, ist es ein frischer Clone ohne lokale
// Installation: stiller Skip, kein Anlegen — .claude/kit/ ist Laufzeitzustand,
// kein Repo-Inhalt.
const LOCAL_KIT = join(root, ".claude", "kit");
const copyDrift = [];

// --- Fester Kit-Stand eines laufenden Laufs (Issue #1102, Plan #1101 A5) ---
//
// Ein unbeaufsichtigter Lauf setzt die Kopie seines Stands in den Baum und markiert ihn mit
// `.claude/kit-stand.json`. Solange die Markierung lebt, gehoert die Kopie dem Lauf: Beide
// Abschnitte "Dogfooding-Kopie" schreiben sie nicht, und `--check` meldet ihre Abweichung
// nicht als Drift. Genau ueber diesen Weg erreichte bisher ein neues Werkzeug das naechste
// Paket derselben Nacht — und ein `sync-blobs` des Menschen am Tag den laufenden Lauf.
// Stempel und Blobs in install.mjs sind versioniert und Pruefgegenstand: Sie bleiben.
//
// Lebend heisst: Die Datei liegt vor, und ihr `pid` lebt. Eine verwaiste Markierung (der
// Lauf ist tot) gilt nicht. Bewusst ohne Blick auf KIT_STAND: Der Mensch, der am Tag
// `sync-blobs` ruft, traegt die Variable nicht, und gerade ihn soll die Markierung aufhalten.
function lebendeMarkierung() {
  let markierung;
  try {
    markierung = JSON.parse(readFileSync(join(root, ".claude", "kit-stand.json"), "utf-8"));
  } catch {
    return null;
  }
  if (!Number.isInteger(markierung?.pid) || markierung.pid <= 0) return null;
  try {
    process.kill(markierung.pid, 0);
  } catch (err) {
    // EPERM: Der Prozess lebt, gehoert nur einem anderen Nutzer.
    if (err.code !== "EPERM") return null;
  }
  return markierung;
}

const laufStand = lebendeMarkierung();
const laufStandZeile = laufStand
  ? `Kopie gehört dem Lauf auf ${String(laufStand.commit ?? "unbekannt").slice(0, 12)} — .claude/kit/, .claude/skills/ und .claude/agents/ bleiben unberuehrt.`
  : null;

if (existsSync(LOCAL_KIT) && !laufStand) {
  for (const datei of [...STAMPED, ...EINSTIEGE]) {
    const ziel = join(LOCAL_KIT, datei);
    const soll = readFileSync(join(root, "kit", datei), "utf-8");
    const ist = existsSync(ziel) ? readFileSync(ziel, "utf-8") : null;
    if (ist !== soll) {
      copyDrift.push(`.claude/kit/${datei}`);
      if (!checkOnly) writeFileSync(ziel, soll, "utf-8");
    }
  }
  // Die Teile: Ein Teil, der in der Kopie fehlt, ist Drift wie ein abweichender.
  for (const teil of TEILE) {
    for (const [datei, soll] of Object.entries(buildFileJson(join(root, "kit", teil)))) {
      const ziel = join(LOCAL_KIT, teil, datei);
      const ist = existsSync(ziel) ? readFileSync(ziel, "utf-8") : null;
      if (ist === soll) continue;
      copyDrift.push(`.claude/kit/${teil}/${datei}`);
      if (!checkOnly) {
        mkdirSync(dirname(ziel), { recursive: true });
        writeFileSync(ziel, soll, "utf-8");
      }
    }
  }
}

// --- Dogfooding-Kopien unter .claude/skills/ (Issue #213) ---
//
// Dieselbe Mechanik wie fuer .claude/kit/ darueber, aber aus einem konkreten Fehlbild
// geboren: Am 2026-08-06 liefen zwei Skill-Issues in einem Nachtlauf in eine
// Schreibsperre auf .claude/skills/, die Kopien drifteten — und `--check` blieb gruen,
// weil es die Skills gar nicht ansah. Die Konsistenz stand damit nur als Bitte im
// Issue-Text; nach dem Leitplanken-Prinzip (Issue #122) gehoert sie ins Gate.
//
// Ein Skill, der in skills/ liegt und unter .claude/skills/ fehlt, zaehlt als Drift und
// nicht als Skip — sonst verschwindet ein neu angelegter Skill unbemerkt aus dem
// Dogfooding. Fehlt das Verzeichnis ganz, ist es ein frischer Clone ohne lokale
// Installation: stiller Skip, wie bei .claude/kit/.
const LOCAL_SKILLS = join(root, ".claude", "skills");
const SKILLS_SRC = join(root, "skills");

// Schreibt eine Kopie unter .claude/skills/ oder .claude/agents/. Sichtbar scheitern statt
// still weiterlaufen: Genau diese Sperre war der Anlass von Issue #213, und ein verschluckter
// Fehler waere derselbe Fehler eine Ebene tiefer.
function kopieSchreiben(ziel, soll, ordner) {
  try {
    mkdirSync(dirname(ziel), { recursive: true });
    writeFileSync(ziel, soll, "utf-8");
  } catch (err) {
    process.stderr.write(
      `Fehler: ${ziel} liess sich nicht schreiben (${err.code || err.message}).\n` +
      `Steht ${ordner} unter Schreibschutz? Dann die Sandbox-Ausnahme setzen ` +
      `oder die Datei von Hand kopieren.\n`
    );
    process.exit(1);
  }
}

if (existsSync(LOCAL_SKILLS) && existsSync(SKILLS_SRC) && !laufStand) {
  for (const name of readdirSync(SKILLS_SRC, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const quelle = join(SKILLS_SRC, name.name, "SKILL.md");
    if (!existsSync(quelle)) continue;
    const ziel = join(LOCAL_SKILLS, name.name, "SKILL.md");
    const soll = readFileSync(quelle, "utf-8");
    const ist = existsSync(ziel) ? readFileSync(ziel, "utf-8") : null;
    if (ist === soll) continue;

    copyDrift.push(`.claude/skills/${name.name}/SKILL.md`);
    if (!checkOnly) kopieSchreiben(ziel, soll, ".claude/skills/");
  }
}

// --- Dogfooding-Kopie unter .claude/agents/ (Issue #1377, Plan #1375 A2) ---
//
// Der Leser-Agent der Pruefer, bewacht wie die Skills darueber. Massgeblich ist, ob es eine
// installierte Kopie gibt — `.claude/skills/` —, nicht `.claude/agents/` selbst: Das
// Verzeichnis entsteht erst mit dem ersten Agenten, und ein fehlender Agent ist Drift.
const LOCAL_AGENTS = join(root, ".claude", "agents");

if (existsSync(LOCAL_SKILLS) && !laufStand) {
  for (const [datei, soll] of Object.entries(buildFileJson(join(root, "agents")))) {
    const ziel = join(LOCAL_AGENTS, datei);
    const ist = existsSync(ziel) ? readFileSync(ziel, "utf-8") : null;
    if (ist === soll) continue;
    copyDrift.push(`.claude/agents/${datei}`);
    if (!checkOnly) kopieSchreiben(ziel, soll, ".claude/agents/");
  }
}

if (laufStandZeile) process.stdout.write(`${laufStandZeile}\n`);

if (checkOnly) {
  // Stempel- und Blob-Drift getrennt melden: sie haben verschiedene Ursachen
  // (vergessener Bump-Nachzug vs. geaenderte Quelldatei) und die Meldung soll
  // ohne Nachdenken sagen, was zu tun ist.
  const probleme = [];
  if (stampDrift.length > 0) probleme.push(`Versions-Stempel: ${stampDrift.join("; ")}.`);
  if (drift.length > 0) probleme.push(`Blob-Drift in install.mjs: ${drift.join(", ")} weicht von kit/ ab.`);
  if (copyDrift.length > 0) probleme.push(`Lokale Kopie veraltet: ${copyDrift.join(", ")}.`);
  for (const { quelle } of einbettungDrift) probleme.push(`Eingebettete Datei veraltet: kit/${EINBETTUNG_ZIEL} weicht von ${quelle} ab.`);
  if (probleme.length > 0) {
    process.stderr.write(`${probleme.join("\n")}\nBeheben mit: node tools/sync-blobs.mjs\n`);
    process.exit(1);
  }
  process.stdout.write("Blobs und Versions-Stempel synchron mit kit/.\n");
} else if (stampDrift.length > 0 || drift.length > 0 || copyDrift.length > 0 || einbettungDrift.length > 0) {
  if (drift.length > 0) writeFileSync(INSTALL, installSrc, "utf-8");
  const teile = [];
  const gestempelt = [...STAMPED, ...STAMPED_DOWNLOADS].map((d) => `kit/${d}`).join(", ");
  if (stampDrift.length > 0) teile.push(`Gestempelt auf v${version}: ${gestempelt}`);
  if (drift.length > 0) teile.push(`Aktualisiert: ${drift.join(", ")}`);
  if (copyDrift.length > 0) teile.push(`Lokale Kopie aufgefrischt: ${copyDrift.join(", ")}`);
  for (const { meldung } of einbettungDrift) teile.push(`${meldung}: kit/${EINBETTUNG_ZIEL}`);
  process.stdout.write(`${teile.join("\n")}\n`);
} else {
  process.stdout.write("Blobs bereits synchron.\n");
}
