#!/usr/bin/env node
// Das Commit-Gate (Issue #470, Plan #467).
//
// Ein Commit entsteht nur, wenn jede Datei, die in ihn geht, beim gruenen
// Prueflauf denselben Inhalt trug. Der Nachweis steht in der Zusammenfassung, die
// `checks.mjs run` hinterlaesst; verglichen wird gegen den INDEX, nicht gegen den
// Working Tree — der Commit schreibt den Index, und die implement-Skills stagen
// ausdruecklich selektiv.
//
// Warum ein Git-Hook und kein Kit-Kommando: Kein Kit-Code committet. Jeder Commit
// im Workflow entsteht dadurch, dass eine Session Skill-Text befolgt. Nur git
// sieht jeden Commit, gleich welches Werkzeug ihn ausloest — auch ein
// selbstgebautes Hilfsskript.
//
// Die Zusicherung ist bewusst die schwaechere: Jede committete Datei war Teil
// eines gruenen Laufs. NICHT: Der committete Stand als Ganzes wurde geprueft. Wer
// A committet und das dazugehoerige B ungestagt liegen laesst, erzeugt einen
// Stand, den so nie jemand geprueft hat (Plan #467, A3).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HILFE = "node .claude/kit/checks.mjs run";

function ab(grund, pfad) {
  const wo = pfad ? `${pfad}: ` : "";
  process.stderr.write(`Commit abgewiesen — ${wo}${grund}.\n  ${HILFE}\n`);
  process.exit(1);
}

function git(...args) {
  return spawnSync("git", args, { cwd: process.cwd(), encoding: "utf-8" });
}

/**
 * Wo liegt `checks.mjs`? Zwei Orte, in dieser Reihenfolge.
 *
 * Das Nachbar-Muster aus `night.mjs` traegt hier nicht: Neben dieser Datei liegt
 * keine `checks.mjs`. Im Zielprojekt schreibt der Installer sie nach
 * `.claude/kit/` (dort per .gitignore ausgeschlossen), im Kit-Repo und seinem
 * CI-Checkout liegt sie unter `kit/`. Ein fester Pfad ginge in einer der beiden
 * Lagen schief — und weil ein nicht lauffaehiges Gate nicht durchlaesst, waere
 * das dort jeder Commit.
 */
async function ladeZusammenfassungPfad() {
  const orte = [
    join(__dirname, "..", ".claude", "kit", "checks.mjs"),
    join(__dirname, "..", "kit", "checks.mjs"),
  ];
  for (const ort of orte) {
    if (existsSync(ort)) return (await import(pathToFileURL(ort).href)).zusammenfassungPfad;
  }
  ab("checks.mjs liegt weder unter .claude/kit/ noch unter kit/ — bitte den Installer laufen lassen");
  return null;
}

/** Die Zusammenfassung, gepruft auf Form. */
function leseZusammenfassung(pfad) {
  if (!existsSync(pfad)) ab("die Pruef-Zusammenfassung fehlt");
  let daten;
  try {
    daten = JSON.parse(readFileSync(pfad, "utf-8"));
  } catch {
    ab("die Pruef-Zusammenfassung ist unlesbar");
  }
  // Ein gueltiges JSON ohne `hashes` stammt aus einer checks.mjs vor Issue #469.
  // Ohne diesen Zweig wuerde jede Datei einzeln als ungeprueft gemeldet, und das
  // genannte Heilkommando heilte nichts, solange die alte Datei liegt.
  if (!Array.isArray(daten.laufen) || daten.hashes === null || typeof daten.hashes !== "object") {
    ab("die Pruef-Zusammenfassung hat ein altes Format ohne hashes — bitte den Installer laufen lassen");
  }
  return daten;
}

/**
 * Was in den Commit geht, aus dem Index.
 *
 * `-z`, weil git Pfade mit Nicht-ASCII sonst quotet (`core.quotePath`) und die
 * Schluessel in `hashes` unquotiert sind. `--no-renames`, weil eine R-Zeile zwei
 * Pfade traegt: Ohne die Option braeuchte das Gate Sonderlogik, mit ihr erscheint
 * eine Umbenennung als Loeschung plus Neuanlage und faellt unter die zwei Regeln,
 * die es ohnehin hat.
 */
function indexEintraege() {
  const res = git("diff", "--cached", "--name-status", "-z", "--no-renames");
  if (res.status !== 0) ab(`git diff --cached schlug fehl: ${(res.stderr || "").trim()}`);
  const felder = res.stdout.split("\0");
  const eintraege = [];
  for (let i = 0; i + 1 < felder.length; i += 2) {
    if (felder[i]) eintraege.push({ status: felder[i], pfad: felder[i + 1] });
  }
  return eintraege;
}

/** Blob-Hash je gestagtem Pfad, so wie git ihn committen wird. */
function indexHashes() {
  const res = git("ls-files", "--stage", "-z");
  if (res.status !== 0) ab(`git ls-files --stage schlug fehl: ${(res.stderr || "").trim()}`);
  const hashes = new Map();
  for (const zeile of res.stdout.split("\0")) {
    if (!zeile) continue;
    // "<mode> <sha> <stage>\t<pfad>"
    const tab = zeile.indexOf("\t");
    if (tab < 0) continue;
    const teile = zeile.slice(0, tab).split(" ");
    hashes.set(zeile.slice(tab + 1), teile[1]);
  }
  return hashes;
}

function preCommit(zusammenfassungPfad) {
  const daten = leseZusammenfassung(zusammenfassungPfad(process.cwd()));

  const rot = daten.laufen.find((e) => e.ergebnis !== "gruen");
  if (rot) ab(`die Pruefung endete ${rot.ergebnis} (${rot.cmd})`);

  const geprueft = daten.hashes;
  const imIndex = indexHashes();
  for (const { status, pfad } of indexEintraege()) {
    const geloescht = status.startsWith("D");
    if (!(pfad in geprueft)) {
      ab(geloescht ? "Loeschung nicht geprueft" : "nicht geprueft", pfad);
    }
    if (geloescht) continue;
    if (geprueft[pfad] !== imIndex.get(pfad)) ab("nach der Pruefung geaendert", pfad);
  }
  return 0;
}

const [befehl] = process.argv.slice(2);
if (befehl !== "pre-commit") {
  process.stderr.write("gate.mjs: einziges Kommando ist 'pre-commit'.\n");
  process.exit(2);
}
process.exit(preCommit(await ladeZusammenfassungPfad()));
