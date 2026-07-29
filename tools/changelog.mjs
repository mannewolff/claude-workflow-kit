#!/usr/bin/env node
/**
 * changelog.mjs — generiert CHANGELOG.md vollautomatisch aus der Git-Historie.
 *
 * Es gibt keine Git-Tags; die `chore: vX.Y.Z`-Commits sind die Versionsmarken.
 * Feature-Commits (Betreff mit "(Issue #N)") werden der Version zugeordnet, die
 * chronologisch auf sie folgt. Leere Versionen (kein Feature davor — typisch die
 * Minor-Bumps aus `merge production`) erscheinen nicht. Rueckwirkend ab v1.16.
 *
 * Die Datei wird bei jedem Lauf KOMPLETT neu geschrieben (idempotent). Kein
 * Handpflege-Zustand. Gedacht als Release-Schritt (siehe RELEASING.md): laeuft
 * nach dem Version-Bump, CHANGELOG.md wandert in denselben Version-Commit.
 *
 * Nutzung:  node tools/changelog.mjs        # CHANGELOG.md (neu) schreiben
 *           node tools/changelog.mjs --check # nur pruefen, ob aktuell (Exit 1 wenn nicht)
 *
 * Single-File-Tool: nur node:*-Imports, git im PATH, Pfade relativ zum cwd.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const START_VERSION = "1.16.0"; // untere Grenze der Changelog-Historie
const CHANGELOG_PATH = resolve("CHANGELOG.md");
const INSTALL_PATH = resolve("install.mjs");

function fail(msg) {
  process.stderr.write(`Fehler: ${msg}\n`);
  process.exit(1);
}

function git(args) {
  const res = spawnSync("git", args, { encoding: "utf-8" });
  if (res.status !== 0) fail(`git ${args.join(" ")} schlug fehl: ${(res.stderr || "").trim()}`);
  return res.stdout;
}

// --- Reine Logik (testbar) ---

// Leitet aus den git-log-Eintraegen (chronologisch, aelteste zuerst) die
// Changelog-Bloecke ab: sammelt Feature-Commits, ordnet sie beim naechsten
// chore-Bump dieser Version zu. Commits nach dem letzten Bump bilden den
// obersten Block (currentVersion, today). Rueckgabe: neueste Version zuerst,
// Items je Version neueste zuerst. Leere Versionen entfallen.
export function parseVersions(entries, currentVersion, today) {
  const blocks = [];
  let pending = [];
  for (const e of entries) {
    const chore = e.subject.match(/^chore: v(\d+\.\d+\.\d+)$/);
    if (chore) {
      if (pending.length) blocks.push({ version: chore[1], date: e.date, items: pending });
      pending = [];
      continue;
    }
    if (e.subject.startsWith("Merge ")) continue; // defensiv; git --no-merges filtert regulaer
    const m = e.subject.match(/^(.*) \(Issue #(\d+)\)$/);
    pending.push(m ? { text: m[1], ref: m[2] } : { text: e.subject, ref: null });
  }
  if (pending.length) blocks.push({ version: currentVersion, date: today, items: pending });
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
    "Commit-Betreffzeilen; Versionen ohne eigene Feature-Commits erscheinen nicht.\n";
  const body = blocks
    .map(
      (b) =>
        `## [${b.version}] - ${b.date}\n` +
        b.items.map(renderItem).join("\n")
    )
    .join("\n\n");
  return `${header}\n${body}\n`;
}

// --- I/O ---

function currentVersion() {
  if (!existsSync(INSTALL_PATH)) fail(`install.mjs nicht gefunden: ${INSTALL_PATH}`);
  const m = readFileSync(INSTALL_PATH, "utf-8").match(/const VERSION = "(\d+\.\d+\.\d+)";/);
  if (!m) fail("VERSION-Konstante in install.mjs nicht gefunden.");
  return m[1];
}

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

function generate() {
  const today = new Date().toISOString().slice(0, 10);
  const blocks = parseVersions(readEntries(), currentVersion(), today);
  return renderChangelog(blocks);
}

function main() {
  const check = process.argv.slice(2).includes("--check");
  const next = generate();
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
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main();
}
