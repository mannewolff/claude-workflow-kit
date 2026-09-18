#!/usr/bin/env node
/**
 * changelog.mjs — generiert CHANGELOG.md vollautomatisch aus der Git-Historie.
 *
 * Es gibt keine Git-Tags; die `chore: vX.Y.Z`-Commits sind die Versionsmarken.
 * Feature-Commits (Betreff mit "(Issue #N)") werden der Version zugeordnet, die
 * chronologisch auf sie folgt. Folgen mehrere Marken unmittelbar aufeinander —
 * typisch der Minor-Bump aus `merge production` direkt nach dem letzten
 * Patch-Bump —, bilden sie einen Block mit der hoechsten Version: Der Changelog
 * beschreibt, was veroeffentlicht wurde, nicht wie intern gezaehlt wurde
 * (Issue #245). Commits ohne eigene Marke stehen unter [Unreleased] — sie sind
 * noch nicht veroeffentlicht und bekommen keine Nummer, die bereits vergeben ist
 * (Issue #265). Rueckwirkend ab v1.16.
 *
 * Die Datei wird bei jedem Lauf KOMPLETT neu geschrieben (idempotent). Kein
 * Handpflege-Zustand. Gedacht als Release-Schritt (siehe RELEASING.md): laeuft
 * nach dem Version-Bump, CHANGELOG.md wandert in denselben Version-Commit.
 *
 * --marke nimmt genau eine kommende Versionsmarke vorweg: Der Lauf haengt einen
 * virtuellen `chore: vX.Y.Z`-Eintrag an die aus git gelesene Historie an, bevor
 * die Bloecke entstehen. Damit kann CHANGELOG.md VOR dem Version-Commit
 * geschrieben werden und trotzdem denselben Text tragen, den ein Lauf danach
 * erzeugte — noetig, seit der eine Prueflauf den fertigen Stand misst und das
 * nachtraegliche `--amend` entfaellt (Issue #657, Plan #652). Das Datum dieses
 * Eintrags entsteht in LOKALER Zeit, nicht ueber toISOString(): `git log
 * --date=short` datiert lokal, und zwischen dem lokalen und dem UTC-Tageswechsel
 * bekaeme die Marke sonst ein anderes Datum als der Commit danach — --check
 * waere genau an dem Kriterium rot, das den Umbau verifizieren soll.
 * --marke und --check schliessen sich aus: "erzeuge den Stand nach dem
 * kommenden Commit" und "ist der Stand aktuell" koennen nicht gleichzeitig gelten.
 *
 * Nutzung:  node tools/changelog.mjs        # CHANGELOG.md (neu) schreiben
 *           node tools/changelog.mjs --check # nur pruefen, ob aktuell (Exit 1 wenn nicht)
 *           node tools/changelog.mjs --marke v1.2.3 # die kommende Marke vorwegnehmen
 *
 * Single-File-Tool: nur node:*-Imports, git im PATH, Pfade relativ zum cwd.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const START_VERSION = "1.16.0"; // untere Grenze der Changelog-Historie
const CHANGELOG_PATH = resolve("CHANGELOG.md");

function fail(msg) {
  process.stderr.write(`Fehler: ${msg}\n`);
  process.exit(1);
}

// PATH-Aufloesung bewusst (SonarQube S4036, Issue #183): Ein absoluter git-Pfad waere
// nicht portabel (Windows, Homebrew), und ein kontrollierter env.PATH erfuellt die
// Regel nicht — beanstandet wird die Aufloesung selbst. Ausfuehrliche Begruendung
// in kit/night.mjs ueber gitClean(). Regelausschluss in sonar-project.properties
// (Issue #494).
function git(args) {
  const res = spawnSync("git", args, { encoding: "utf-8" });
  if (res.status !== 0) fail(`git ${args.join(" ")} schlug fehl: ${(res.stderr || "").trim()}`);
  return res.stdout;
}

// --- Reine Logik (testbar) ---

// Leitet aus den git-log-Eintraegen (chronologisch, aelteste zuerst) die
// Changelog-Bloecke ab: sammelt Feature-Commits, ordnet sie beim naechsten
// chore-Bump dieser Version zu. Commits nach dem letzten Bump bilden den
// obersten Block, der bis zum naechsten Bump [Unreleased] heisst. Rueckgabe:
// neueste Version zuerst, Items je Version neueste zuerst.
//
// Folgen mehrere Marken unmittelbar aufeinander, ohne Commits dazwischen, bilden
// sie EINEN Block mit der hoechsten Version und deren Bump-Datum (Issue #245).
// Der Grund liegt im Release-Ablauf: Beim `merge production`-Trigger folgt der
// Minor-Bump direkt auf den letzten Patch-Bump aus `push main`. Wurde die leere
// Marke uebersprungen, verschwand ausgerechnet jede Version, die je ausgeliefert
// wurde, und die Arbeit stand unter der internen Patch-Nummer, die nie jemand
// bekommen hat. Ein Block traegt die Version, unter der VEROEFFENTLICHT wurde.
export function parseVersions(entries, today) {
  const blocks = [];
  let pending = [];
  for (const e of entries) {
    const chore = e.subject.match(/^chore: v(\d+\.\d+\.\d+)$/);
    if (chore) {
      if (pending.length) {
        blocks.push({ version: chore[1], date: e.date, items: pending });
      } else if (blocks.length) {
        // Kein pending heisst: seit der letzten Marke kam nichts. Diese Marke
        // gehoert zum vorigen Block und hebt ihn auf ihre Version. Beliebig oft
        // wiederholbar, damit auch drei Bumps in Folge zusammenfallen.
        blocks.at(-1).version = chore[1];
        blocks.at(-1).date = e.date;
      }
      // blocks leer und kein pending: Marken vor dem ersten Commit haben nichts,
      // dem sie eine Version geben koennten.
      pending = [];
      continue;
    }
    if (e.subject.startsWith("Merge ")) continue; // defensiv; git --no-merges filtert regulaer
    const m = e.subject.match(/^(.*) \(Issue #(\d+)\)$/);
    pending.push(m ? { text: m[1], ref: m[2] } : { text: e.subject, ref: null });
  }
  // Commits ohne eigene Marke sind noch nicht veroeffentlicht und bekommen deshalb
  // KEINE Versionsnummer (Issue #265). Frueher stand hier `currentVersion` aus
  // install.mjs — steht die bereits als Marke in der Historie, was direkt nach
  // jedem Release der Fall ist, entstanden zwei Bloecke mit derselben Nummer.
  if (pending.length) blocks.push({ version: "Unreleased", date: today, items: pending });
  return blocks.toReversed().map((b) => ({ ...b, items: b.items.toReversed() }));
}

function renderItem(it) {
  const ref = it.ref ? ` (#${it.ref})` : "";
  return `- ${it.text}${ref}`;
}

export function renderChangelog(blocks) {
  const header =
    "# Changelog\n\n" +
    "Alle nennenswerten Änderungen an diesem Projekt. Automatisch aus der Git-Historie " +
    "generiert (`tools/changelog.mjs`) — nicht von Hand pflegen. Die Einträge sind die " +
    "Commit-Betreffzeilen. Folgen mehrere Versions-Bumps unmittelbar aufeinander, stehen " +
    "die Änderungen unter der höchsten davon — der Version, mit der sie veröffentlicht " +
    "wurden; die internen Zwischenstände dazwischen erscheinen nicht. Was seit dem letzten " +
    "Versions-Commit dazugekommen ist, steht unter `[Unreleased]`.\n";
  const body = blocks
    .map(
      (b) =>
        // Unreleased hat kein Release-Datum — ein "heute" daran waere eine Angabe,
        // die sich bei jedem Lauf aendert und nichts bedeutet.
        (b.version === "Unreleased" ? `## [Unreleased]\n` : `## [${b.version}] - ${b.date}\n`) +
        b.items.map(renderItem).join("\n")
    )
    .join("\n\n");
  return `${header}\n${body}\n`;
}

// --- I/O ---

function readEntries() {
  const escaped = START_VERSION.replaceAll(".", String.raw`\.`);
  const grep = `^chore: v${escaped}$`;
  const startHash = git(["log", "-1", "--format=%H", `--grep=${grep}`]).trim();
  if (!startHash) fail(`Startmarke 'chore: v${START_VERSION}' nicht in der Historie gefunden.`);
  const raw = git(["log", "--reverse", "--no-merges", "--date=short", "--format=%cd%x09%s", `${startHash}..HEAD`]);
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      return { date: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
}

// Heutiges Datum in LOKALER Zeit, in der Form von `git log --date=short`. Kein
// toISOString(): das liefert UTC, und die vorweggenommene Marke muss dasselbe
// Datum tragen wie der Commit, der ihr folgt (siehe Kopfkommentar).
function heuteLokal() {
  const d = new Date();
  const zweistellig = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`;
}

function generate(marke) {
  const today = new Date().toISOString().slice(0, 10); // nur fuer [Unreleased], nie gerendert
  const entries = readEntries();
  // Der virtuelle Eintrag steht am Ende der chronologischen Liste, also dort, wo
  // der Bump-Commit gleich stehen wird. Danach laufen Block-Bildung und die
  // Block-Verschmelzung aus Issue #245 unveraendert.
  if (marke) entries.push({ date: heuteLokal(), subject: `chore: v${marke}` });
  const blocks = parseVersions(entries, today);
  return renderChangelog(blocks);
}

// Liest --marke <x.y.z> aus den Argumenten. Rueckgabe: die Version ohne fuehrendes
// "v", oder null wenn die Option fehlt. Ein fehlender oder formfremder Wert bricht ab.
function leseMarke(args) {
  const i = args.indexOf("--marke");
  if (i === -1) return null;
  const wert = args[i + 1];
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(wert ?? "");
  if (!m) fail(`--marke braucht eine Version der Form vX.Y.Z, bekommen: ${wert ?? "(nichts)"}`);
  return m[1];
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  if (check && args.includes("--marke")) {
    fail("--marke und --check schliessen sich aus: die Marke erzeugt den Stand NACH dem kommenden Commit, --check prueft den aktuellen.");
  }
  const next = generate(leseMarke(args));
  if (check) {
    const current = existsSync(CHANGELOG_PATH) ? readFileSync(CHANGELOG_PATH, "utf-8") : "";
    if (current !== next) fail("CHANGELOG.md ist nicht aktuell. Bitte `node tools/changelog.mjs` ausfuehren.");
    process.stdout.write("CHANGELOG.md ist aktuell.\n");
    return;
  }
  writeFileSync(CHANGELOG_PATH, next);
  process.stdout.write("CHANGELOG.md geschrieben.\n");
}

// Nur ausfuehren, wenn direkt gestartet (nicht beim Import in Tests).
//
// fileURLToPath statt new URL(...).pathname: Unter Windows liefert pathname einen
// fuehrenden Slash vor dem Laufwerksbuchstaben ("/D:/repo/tools/changelog.mjs"), der
// Vergleich schlug dort immer fehl — main() lief nie, `node tools/changelog.mjs`
// tat gar nichts, und --check meldete als Gate faelschlich "aktuell", weil es nicht
// prueft. Gefunden vom ersten Windows-CI-Lauf (Issue #197).
//
// realpathSync wie in kit/board.mjs: Node loest fuer import.meta.url Symlinks auf
// (macOS: /var -> /private/var), ein nur normalisierter argv[1] wuerde nie matchen.
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) {
  main();
}
