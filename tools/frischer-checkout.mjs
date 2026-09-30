#!/usr/bin/env node
/**
 * frischer-checkout.mjs — faehrt die Suite in einem frischen Checkout des Stands, der
 * hinausgeht, und meldet je Testdatei, was dort fehlt (Issue #1038, Plan #1035).
 *
 * ANLASS: Am 2026-09-04 lief die CI nach einem Push rot, obwohl alle lokalen Pruefungen
 * gruen waren (#472): `skills-releaseweg` las die installierte Kopie eines Skills unter
 * `.claude/`, die nicht versioniert ist und in jedem frischen Checkout fehlt. Die
 * Gegenprobe im frischen Clone (Idee #475) fand den Fehler in einer Minute; #1012 macht
 * daraus eine Pruefung, bevor gepusht wird.
 *
 *   node tools/frischer-checkout.mjs
 *
 * ABLAUF: Der Stand des AUFRUFENDEN Baums (`git rev-parse HEAD` dort, nicht der der
 * Hauptkopie) kommt per `worktreeAnlegen(… spiegeln: false)` in einen Worktree unter dem
 * Temp-Verzeichnis, samt den unkommittierten Aenderungen (`git diff HEAD --binary` per
 * `git apply`) und den ungetrackten, nicht ignorierten Dateien. Dann laeuft das
 * `installCommand` der Config des frischen Stands und danach `node --test` ohne
 * Dateimuster, wie in der CI. Der Worktree wird in jedem Ausgang wieder abgebaut.
 *
 * ZWEI SIGNALE (A2):
 *   - rot im frischen Checkout: Jeder rote Test ist ein Fund (E3, kein Referenzlauf —
 *     Vergleichsbasis ist der gruene Prueflauf unmittelbar davor). Die Meldung nennt die
 *     Pfade, die der Test gesucht hat und die im aufrufenden Baum liegen, dazu die Pfade
 *     aus `ERR_MODULE_NOT_FOUND`.
 *   - still falsch: Eine gruene Testdatei hat einen Pfad gesucht, der im frischen Stand
 *     fehlt und im aufrufenden Baum liegt. Das verraet nur die Spur, die
 *     `frischer-checkout-spur.mjs` ueber `NODE_OPTIONS=--import` in jedem Prozess schreibt.
 *
 * REPORTER (E2): Die Fehlschlaege je Test liest das Werkzeug nicht aus der Konsole, sondern
 * aus einer eigenen Reporter-Datei. Der Reporter ist der Default-Export DIESER Datei
 * (`--test-reporter=<file-URL>`): kleiner als ein TAP-Parser, und die Ereignisse von
 * `node:test` aendern sich zwischen Node-Versionen seltener als deren Konsolenform.
 *
 * GRENZEN:
 *   - E4: Gespurt werden nur `fs`-Zugriffe. Ein fehlender statischer Import macht den Test
 *     rot und steht mit Pfad in der Meldung; ein in `try/catch` gekapselter dynamischer
 *     Import dagegen bleibt unsichtbar.
 *   - E5: Ein Kindprozess, den ein Test mit einer eigenen, leeren Umgebung startet, verliert
 *     `NODE_OPTIONS`. Sein Ergebnis zaehlt ueber den Exit-Status der Testdatei weiter mit,
 *     seine Dateizugriffe fehlen in der Spur.
 *
 * AUSNAHMELISTE (E9): Ein Pfad kommt nur auf `AUSNAHMEN`, wenn er bestimmungsgemaess
 * unversioniert und optional ist, also auch im Arbeitsverzeichnis fehlen darf — nie, um
 * eine echte Abhaengigkeit zum Schweigen zu bringen. Die behebt man, indem der Test auf
 * die Quelle umgestellt wird.
 *
 * AUSGABE: Ohne Fund genau eine Zeile, Exit 0. Mit Fund ein Block je Testdatei, Exit 1.
 * Ein technischer Fehler (Anlegen, `git apply`, Installation, Suite ohne Reporter-Ergebnis)
 * ist ebenfalls Exit 1 mit Grund: nie gruen ohne Messung (#964). Eine eigene Zeitgrenze
 * gibt es nicht. Die Fehlermerkmale von `checks.mjs` kommen in der Ausgabe nicht vor, sonst
 * griffen sie doppelt.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { vergleicheText, worktreeAnlegen, worktreeEntfernen, worktreesAufraeumen } from "../kit/night.mjs";

/** Pfade, die bestimmungsgemaess fehlen duerfen, je mit Grund (E9). */
export const AUSNAHMEN = {
  ".claude/workflow.config.local.json": "maschinenspezifisch, optional",
  // `sync-blobs --check` fragt nur, ob die Dogfooding-Kopien da sind, und ueberspringt
  // sie still, wenn nicht — so wie in jedem Klon vor dem ersten `sync-blobs` (Issue #1039).
  ".claude/kit": "Dogfooding-Kopie, fehlt vor dem ersten sync-blobs; --check ueberspringt sie dann",
  ".claude/skills": "Dogfooding-Kopie, fehlt vor dem ersten sync-blobs; --check ueberspringt sie dann",
};

const PRAEFIX = "frisch";
const MODUL_FEHLT = /Cannot find module '([^']+)'/g;

/**
 * Reporter fuer `node --test`: eine JSON-Zeile je Ereignis, das die Auswertung braucht,
 * und zum Schluss `ende` — fehlt sie, ist die Suite nicht bis zum Ende gelaufen.
 */
export default async function* reporter(quelle) {
  for await (const { type, data } of quelle) {
    if (type === "test:pass") {
      yield `${JSON.stringify({ typ: "pass", datei: data.file ?? null })}\n`;
    } else if (type === "test:fail") {
      const fehler = data.details?.error;
      // Eine Suite, die nur an ihren Untertests scheitert, ist kein eigener Befund.
      if (fehler?.failureType === "subtestsFailed") continue;
      const ursache = fehler?.cause ?? fehler;
      const text = String(ursache?.stack ?? ursache?.message ?? ursache ?? "");
      yield `${JSON.stringify({ typ: "fail", datei: data.file ?? null, name: data.name, fehler: text })}\n`;
    } else if (type === "test:stderr" && data.message.includes("Cannot find module")) {
      yield `${JSON.stringify({ typ: "stderr", datei: data.file ?? null, text: data.message })}\n`;
    }
  }
  yield `${JSON.stringify({ typ: "ende" })}\n`;
}

class TechnischerFehler extends Error {}

/**
 * Ein git-Aufruf; scheitert er, ist das ein technischer Fehler. `roh` liefert stdout als
 * Buffer: Ein Diff traegt Dateien in beliebiger Kodierung und geht unveraendert an `git apply`.
 */
function git(cwd, args, { eingabe, roh = false } = {}) {
  // PATH-Aufloesung bewusst, wie in kit/night.mjs (S4036, Issue #183).
  const res = spawnSync("git", args, { cwd, input: eingabe, maxBuffer: 1 << 30 });
  if (res.status !== 0) {
    const meldung = `${res.stderr ?? ""}${res.stdout ?? ""}${res.error ?? ""}`.trim();
    throw new TechnischerFehler(`git ${args.join(" ")} schlug fehl: ${meldung}`);
  }
  return roh ? res.stdout : res.stdout.toString("utf-8");
}

/** Pfad relativ zu `wurzel` mit `/`, oder `null`, wenn er nicht darunter liegt. */
function unter(wurzeln, pfad) {
  let echt = pfad;
  try {
    echt = realpathSync(pfad);
  } catch { /* fehlt — dann gilt die Schreibweise, wie sie kam */ }
  for (const wurzel of wurzeln) {
    for (const p of [echt, pfad]) {
      const rel = relative(wurzel, p);
      if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
    }
  }
  return null;
}

function sekunden(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Uebertraegt die unkommittierten Aenderungen des aufrufenden Baums in den Worktree. */
function unkommittiertUebertragen(referenz, frisch) {
  const diff = git(referenz, ["diff", "HEAD", "--binary"], { roh: true });
  if (diff.length > 0) git(frisch, ["apply", "--whitespace=nowarn"], { eingabe: diff });
  const ungetrackt = git(referenz, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  for (const datei of ungetrackt) {
    const ziel = join(frisch, datei);
    mkdirSync(dirname(ziel), { recursive: true });
    copyFileSync(join(referenz, datei), ziel);
  }
}

/** `Exit-Code n` oder `Signal s` eines `spawnSync`-Ergebnisses. */
function endeVon(res) {
  return res.status === null ? `Signal ${res.signal}` : `Exit-Code ${res.status}`;
}

/** Die letzten zehn Zeilen der Ausgabe als Folgezeilen eines Grundes, oder nichts. */
function ausgabeEnde(res) {
  const ausgabe = `${res.stdout || ""}${res.stderr || ""}${res.error ? String(res.error) : ""}`.trim();
  return ausgabe ? "\n" + ausgabe.split("\n").slice(-10).join("\n") : "";
}

/** Das `installCommand` der versionierten Config des frischen Stands, falls gesetzt. */
function installieren(frisch) {
  let kommando = "";
  try {
    const cfg = JSON.parse(readFileSync(join(frisch, ".claude", "workflow.config.json"), "utf-8"));
    kommando = (cfg.installCommand || "").trim();
  } catch { /* keine Config heisst: nichts zu installieren */ }
  if (!kommando) return;
  const res = spawnSync(kommando, { cwd: frisch, encoding: "utf-8", shell: true, maxBuffer: 1 << 30 });
  if (res.status === 0) return;
  throw new TechnischerFehler(`installCommand '${kommando}' endete mit ${endeVon(res)}${ausgabeEnde(res)}`);
}

/** Die Umgebung der Suite nach E7. */
function suiteUmgebung(frisch, spurdatei) {
  const spur = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "frischer-checkout-spur.mjs")).href;
  const env = { ...process.env };
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import ${spur}`].filter(Boolean).join(" ");
  env.KIT_CHECKOUT_SPUR = spurdatei;
  env.KIT_CHECKOUT_WURZEL = frisch;
  env.KIT_CHECKOUT_TESTDATEI = "";
  // Startet ein Test dieses Werkzeug, erbte `node --test` sonst den Kind-Modus seines
  // eigenen Runners und berichtete dorthin statt an den Reporter.
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function zeilenAus(datei) {
  if (!existsSync(datei)) return [];
  return readFileSync(datei, "utf-8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
}

function merke(karte, datei, wert) {
  if (!karte.has(datei)) karte.set(datei, new Set());
  karte.get(datei).add(wert);
}

/**
 * Liest die Reporter-Zeilen: alle Testdateien, die roten Tests je Datei (`null` fuer eine
 * Datei, die ausserhalb eines Tests scheiterte) und die Pfade aus `ERR_MODULE_NOT_FOUND`.
 */
function ergebnisse(frisch, reporterZeilen) {
  const wurzeln = [realpathSync(frisch), frisch];
  const dateien = new Set();
  const rot = new Map();
  const module = new Map();
  const modulPfade = (datei, text) => {
    for (const [, pfad] of text.matchAll(MODUL_FEHLT)) merke(module, datei, unter(wurzeln, pfad) ?? pfad);
  };
  for (const z of reporterZeilen) {
    if (!z.datei) continue;
    const datei = unter(wurzeln, resolve(frisch, z.datei)) ?? z.datei;
    if (z.typ === "pass") dateien.add(datei);
    if (z.typ === "fail") {
      dateien.add(datei);
      merke(rot, datei, z.name === datei || z.name === z.datei ? null : z.name);
      modulPfade(datei, z.fehler);
    }
    if (z.typ === "stderr") modulPfade(datei, z.text);
  }
  return { dateien, rot, module };
}

/** Wertet Reporter und Spur aus: Befunde je Testdatei und die Zahl der Testdateien. */
function auswerten({ frisch, referenz, reporterZeilen, spurZeilen }) {
  const { dateien, rot, module } = ergebnisse(frisch, reporterZeilen);
  const gesucht = new Map();
  for (const { datei, pfad } of spurZeilen) {
    if (datei && existsSync(join(referenz, pfad))) merke(gesucht, datei, pfad);
  }

  const befunde = [];
  for (const [datei, namen] of rot) {
    const tests = [...namen].filter(Boolean).map((n) => `"${n}"`);
    const welche = tests.length ? ` (Test ${tests.join(", ")})` : "";
    const fehlt = [...new Set([...(gesucht.get(datei) ?? []), ...(module.get(datei) ?? [])])].sort(vergleicheText);
    befunde.push([`- ${datei}: rot im frischen Checkout${welche}`, ...fehlt.map((p) => `  fehlt im frischen Stand: ${p}`)].join("\n"));
  }
  for (const [datei, pfade] of gesucht) {
    if (rot.has(datei)) continue;
    const still = [...pfade].filter((p) => !(p in AUSNAHMEN)).sort(vergleicheText);
    if (still.length) befunde.push(`- ${datei}: gruen im frischen Checkout, suchte aber: ${still.join(", ")}`);
  }
  return { befunde, testdateien: dateien.size };
}

function suiteFahren(frisch, ablage) {
  const reporterDatei = join(ablage, "reporter.jsonl");
  const spurdatei = join(ablage, "spur.jsonl");
  const res = spawnSync(
    process.execPath,
    ["--test", `--test-reporter=${import.meta.url}`, `--test-reporter-destination=${reporterDatei}`],
    { cwd: frisch, env: suiteUmgebung(frisch, spurdatei), encoding: "utf-8", maxBuffer: 1 << 30 },
  );
  const reporterZeilen = zeilenAus(reporterDatei);
  if (!reporterZeilen.some((z) => z.typ === "ende")) {
    throw new TechnischerFehler(`node --test endete mit ${endeVon(res)} ohne Reporter-Ergebnis${ausgabeEnde(res)}`);
  }
  if (res.status !== 0 && !reporterZeilen.some((z) => z.typ === "fail")) {
    throw new TechnischerFehler(`node --test endete mit ${endeVon(res)}, ohne einen roten Test zu melden${ausgabeEnde(res)}`);
  }
  return { reporterZeilen, spurZeilen: zeilenAus(spurdatei) };
}

async function main() {
  const start = Date.now();
  let frisch = null;
  let hauptkopie = null;
  let ablage = null;
  try {
    const referenz = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
    const hash = git(referenz, ["rev-parse", "HEAD"]).trim();
    const erste = git(referenz, ["worktree", "list", "--porcelain"]).split("\n").find((z) => z.startsWith("worktree "));
    if (!erste) throw new TechnischerFehler("git worktree list nennt keine Hauptkopie");
    hauptkopie = erste.slice("worktree ".length).trim();

    worktreesAufraeumen(hauptkopie, PRAEFIX);
    const stempel = `${new Date().toISOString().replaceAll(/\D/g, "").slice(0, 14)}-${process.pid}`;
    try {
      frisch = worktreeAnlegen({ repoRoot: hauptkopie, praefix: PRAEFIX, ref: hash, stempel, spiegeln: false });
    } catch (fehler) {
      throw new TechnischerFehler(fehler.message);
    }
    unkommittiertUebertragen(referenz, frisch);
    const angelegt = Date.now();

    installieren(frisch);
    const installiert = Date.now();

    ablage = mkdtempSync(join(tmpdir(), "frischer-checkout-ablage-"));
    const { reporterZeilen, spurZeilen } = suiteFahren(frisch, ablage);
    const fertig = Date.now();

    const { befunde, testdateien } = auswerten({ frisch, referenz, reporterZeilen, spurZeilen });
    if (befunde.length) {
      console.log(`Frischer Checkout: ${befunde.length} Befund(e) — der Stand haengt an Dateien, die nicht versioniert sind.`);
      for (const b of befunde) console.log(b);
      return 1;
    }
    const teile = `Anlegen ${sekunden(angelegt - start)}, Installation ${sekunden(installiert - angelegt)}, Suite ${sekunden(fertig - installiert)}`;
    console.log(`Frischer Checkout: gruen — ${testdateien} Testdatei${testdateien === 1 ? "" : "en"}, ${sekunden(fertig - start)} (${teile})`);
    return 0;
  } catch (fehler) {
    const grund = fehler instanceof TechnischerFehler ? fehler.message : String(fehler?.stack ?? fehler);
    console.log(`Frischer Checkout: technischer Fehler — ${grund}`);
    return 1;
  } finally {
    if (frisch) worktreeEntfernen(frisch, hauptkopie);
    if (ablage) rmSync(ablage, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
