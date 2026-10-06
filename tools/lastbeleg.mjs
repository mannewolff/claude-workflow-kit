#!/usr/bin/env node
/**
 * lastbeleg.mjs — belegt wiederholbar, ob mehrere Projekte nebeneinander pruefen koennen,
 * ohne sich auszubremsen (Issue #1237, Plan #1199, E9, E10, E11; Kriterien 1 und 3 des
 * Fachplans #1198).
 *
 *   node tools/lastbeleg.mjs [--anzahl <n>] [--runden <n>] [--grenze-s <s>] [--referenz <datei>]
 *
 * Ein eigenes Werkzeug, keine Pflichtpruefung: Zehn volle Laeufe in jeder Pruefung waeren
 * selbst die Last, die beseitigt werden soll.
 *
 * ABLAUF:
 *   1. `--anzahl` Wegwerf-Worktrees desselben Stands (`HEAD` der Hauptkopie), jeder
 *      eingerichtet wie in `tools/frischer-checkout.mjs`: `installCommand`, dann
 *      `node tools/sync-blobs.mjs` — `.claude/kit/` und `node_modules` sind nicht versioniert.
 *   2. In jedem dieselbe Referenzaenderung uncommittet im Arbeitsbaum: eine Kommentarzeile in
 *      `--referenz`. Ohne sie saehe `checks.mjs` gegen `HEAD` ein leeres Paket.
 *   3. Je Runde startet in allen gleichzeitig `node .claude/kit/checks.mjs run --abschluss
 *      --frisch`. Jeder Lauf bekommt seinen eigenen Sperrpfad (`KIT_CHECKS_LOCK`): Gemessen
 *      wird das Nebeneinander, nicht das Anstellen an der rechnerweiten Sperre, die nach dem
 *      Beleg entfaellt (#1241).
 *   4. Je Lauf Dauer und Ergebnis, dazu `os.loadavg()` alle 5 s.
 *   5. Eine rote Testdatei faehrt danach einmal allein. Ist sie allein gruen, steht sie als
 *      Wackelpruefung im Protokoll — der Lauf bleibt rot (E11): benennen, nicht wiederholen.
 *
 * PROTOKOLL: `<tmpdir>/lastbeleg-<stempel>/protokoll.md` und `protokoll.json`, daneben die
 * Ausgabe jedes roten Laufs als `runde-<r>-lauf-<n>.log`.
 *
 * EXIT: 0 nur, wenn jeder Lauf jeder Runde gruen und nicht laenger als `--grenze-s` war.
 * Ein technischer Fehler (Anlegen, Einrichten, Starter) ist ebenfalls Exit 1.
 *
 * AUFRAEUMEN: Die Worktrees werden in jedem Ausgang abgebaut, auch nach einem Fehler und
 * nach SIGINT/SIGTERM.
 *
 * Starter, Uhr, Pause, Last und Worktrees sind injizierbar (E6); die Tests in
 * `test/tools-lastbeleg.test.mjs` laufen damit im selben Prozess.
 */

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VORGABEN = { anzahl: 10, runden: 1, grenzeS: 600, referenz: "kit/night/kette.mjs" };
const PROBE_MS = 5000;
const LAUF_KOMMANDO = "node .claude/kit/checks.mjs run --abschluss --frisch";
const MARKE = "// lastbeleg: Referenzaenderung, nur im Wegwerf-Worktree";

export const HILFE = `lastbeleg.mjs — zehn Abschlusslaeufe gleichzeitig, gemessen (Issue #1237)

Aufruf:
  node tools/lastbeleg.mjs [--anzahl <n>] [--runden <n>] [--grenze-s <s>] [--referenz <datei>]

Optionen:
  --anzahl <n>       Zahl der gleichzeitigen Laeufe, je in einem eigenen Worktree (Vorgabe ${VORGABEN.anzahl}).
  --runden <n>       Wie oft alle Laeufe nacheinander wiederholt werden (Vorgabe ${VORGABEN.runden}).
  --grenze-s <s>     Hoechstdauer eines Laufs in Sekunden; darueber ist der Beleg rot (Vorgabe ${VORGABEN.grenzeS}).
  --referenz <datei> Datei, in die jede Kopie dieselbe Kommentarzeile uncommittet setzt
                     (Vorgabe ${VORGABEN.referenz}).
  --help             Diese Hilfe.

Protokoll (Markdown und JSON) unter <tmpdir>/lastbeleg-<stempel>/.
Exit 0 nur, wenn jeder Lauf gruen und nicht laenger als --grenze-s war.`;

const ZAHL_OPTIONEN = { "--anzahl": "anzahl", "--runden": "runden", "--grenze-s": "grenzeS" };

/** Liest die Kommandozeile; ein unbekannter Schalter oder ein Wert ohne Sinn wirft. */
export function argumenteLesen(argv) {
  const opt = { ...VORGABEN, hilfe: false };
  const rest = [...argv];
  while (rest.length > 0) {
    const name = rest.shift();
    if (name === "--help" || name === "-h") {
      opt.hilfe = true;
    } else if (name in ZAHL_OPTIONEN) {
      const wert = Number(rest.shift());
      if (!Number.isInteger(wert) || wert < 1) throw new Error(`${name} erwartet eine ganze Zahl ab 1`);
      opt[ZAHL_OPTIONEN[name]] = wert;
    } else if (name === "--referenz") {
      const wert = rest.shift();
      if (!wert) throw new Error("--referenz erwartet einen Pfad");
      opt.referenz = wert;
    } else {
      throw new Error(`unbekannter Schalter ${name}`);
    }
  }
  return opt;
}

/**
 * Die roten Testdateien einer `checks.mjs`-Ausgabe, relativ zum Worktree und je einmal.
 * Gelesen werden die Zeilen, mit denen `node --test` ein Rot meldet: `✖` (spec), `not ok`
 * (TAP) und `test at` (Ort des Fehlschlags).
 */
export function roteTestdateien(ausgabe) {
  const dateien = new Set();
  for (const zeile of ausgabe.split(/\r?\n/)) {
    if (!/✖|^\s*not ok\b|^\s*test at /.test(zeile)) continue;
    for (const [, datei] of zeile.matchAll(/(?:^|[\s/'"(])(test\/[\w./-]+?\.test\.mjs)/g)) dateien.add(datei);
  }
  return [...dateien];
}

function stempelVon(ms) {
  return `${new Date(ms).toISOString().replaceAll(/\D/g, "").slice(0, 14)}-${process.pid}`;
}

function installCommandVon(wt) {
  try {
    const cfg = JSON.parse(readFileSync(join(wt, ".claude", "workflow.config.json"), "utf-8"));
    return (cfg.installCommand || "").trim();
  } catch {
    return "";
  }
}

/** Einrichten wie im frischen Checkout, dann die Referenzaenderung setzen. */
async function einrichten(wt, referenz, starter) {
  const kommandos = [installCommandVon(wt), "node tools/sync-blobs.mjs"].filter(Boolean);
  for (const cmd of kommandos) {
    const { code, ausgabe } = await starter({ art: "einrichten", cwd: wt, cmd, env: process.env });
    if (code !== 0) {
      const ende = (ausgabe || "").trim().split(/\r?\n/).slice(-10).join("\n");
      const zusatz = ende ? "\n" + ende : "";
      throw new Error(`Einrichten von ${wt}: '${cmd}' endete mit ${code}${zusatz}`);
    }
  }
  const datei = join(wt, referenz);
  if (!existsSync(datei)) throw new Error(`Referenzdatei fehlt im Worktree: ${referenz}`);
  appendFileSync(datei, `\n${MARKE}\n`);
}

/** Tastet die Last ab, bis `fertig` sich erfuellt: eine Probe sofort, dann je Pause eine. */
async function lastAbtasten(abh, fertig) {
  const proben = [abh.last()];
  let ende = false;
  const beendet = fertig.then(() => { ende = true; });
  for (;;) {
    await Promise.race([abh.schlaf(PROBE_MS), beendet]);
    if (ende) break;
    proben.push(abh.last());
  }
  const summe = proben.reduce((s, p) => s + p, 0);
  return { hoechst: Math.max(...proben), mittel: summe / proben.length, proben: proben.length };
}

/** Ein Lauf: Dauer und Ergebnis; bei Rot die Testdateien, die allein gruen sind. */
async function einLauf({ wt, nr, runde, verzeichnis, opt, abh }) {
  const start = abh.jetzt();
  const env = { ...process.env, KIT_CHECKS_LOCK: join(verzeichnis, `sperre-lauf-${nr}.lock`) };
  delete env.NODE_TEST_CONTEXT;
  const { code, ausgabe } = await abh.starter({ art: "lauf", cwd: wt, cmd: LAUF_KOMMANDO, env });
  const dauerS = Math.round((abh.jetzt() - start) / 100) / 10;
  const lauf = { lauf: nr, dauerS, ergebnis: code === 0 ? "gruen" : "rot", ueberGrenze: dauerS > opt.grenzeS };
  if (code === 0) return { lauf, wackel: [] };

  writeFileSync(join(verzeichnis, `runde-${runde}-lauf-${nr}.log`), ausgabe ?? "");
  const wackel = [];
  for (const datei of roteTestdateien(ausgabe ?? "")) {
    const allein = await abh.starter({ art: "allein", cwd: wt, cmd: `node --test ${datei}`, env });
    if (allein.code === 0) wackel.push({ runde, lauf: nr, datei });
  }
  return { lauf, wackel };
}

async function eineRunde({ worktrees, runde, verzeichnis, opt, abh }) {
  const alle = Promise.all(worktrees.map((wt, i) => einLauf({ wt, nr: i + 1, runde, verzeichnis, opt, abh })));
  const [ergebnisse, last] = await Promise.all([alle, lastAbtasten(abh, alle.catch(() => {}))]);
  for (const { lauf } of ergebnisse) {
    abh.ausgabe(`Runde ${runde}, Lauf ${lauf.lauf}: ${lauf.ergebnis}, ${lauf.dauerS.toFixed(1)} s${lauf.ueberGrenze ? " (ueber der Grenze)" : ""}`);
  }
  return { runde, last, laeufe: ergebnisse.map((e) => e.lauf), wackel: ergebnisse.flatMap((e) => e.wackel) };
}

function laufText(lauf, grenzeS) {
  return lauf.ueberGrenze ? `${lauf.ergebnis}, ueber der Grenze von ${grenzeS} s` : lauf.ergebnis;
}

function markdown(p) {
  const zeilen = [
    `# Lastbeleg ${p.stempel}`,
    "",
    `- Stand: ${p.stand}`,
    `- Anzahl: ${p.anzahl}, Runden: ${p.runden.length}, Grenze: ${p.grenzeS} s, Referenz: ${p.referenz}`,
    "",
  ];
  for (const r of p.runden) {
    zeilen.push(`## Runde ${r.runde}`, "", `Last: Hoechstwert ${r.last.hoechst.toFixed(2)}, Mittelwert ${r.last.mittel.toFixed(2)} (${r.last.proben} Proben)`, "");
    zeilen.push("| Lauf | Dauer | Ergebnis |", "|---|---|---|");
    for (const l of r.laeufe) zeilen.push(`| ${l.lauf} | ${l.dauerS.toFixed(1)} s | ${laufText(l, p.grenzeS)} |`);
    zeilen.push("");
  }
  zeilen.push("## Wackelpruefungen", "");
  if (p.wackelpruefungen.length === 0) zeilen.push("keine");
  for (const w of p.wackelpruefungen) zeilen.push(`- Runde ${w.runde}, Lauf ${w.lauf}: ${w.datei}`);
  zeilen.push("", `Ergebnis: ${p.ergebnis}`);
  return `${zeilen.join("\n")}\n`;
}

/**
 * Faehrt den Beleg. `opt`: `{ anzahl, runden, grenzeS, referenz, repoRoot }`. `abh`: `{ starter,
 * jetzt, schlaf, last, worktree: { anlegen, entfernen }, stand, ablage, ausgabe }`, dazu
 * optional `angelegt` (ein Set, das der Aufrufer fuer den Abbau bei einem Signal mitliest).
 * Liefert `{ exitCode, verzeichnis, fehler? }` und wirft nicht.
 */
export async function lastbeleg(opt, abh) {
  const stempel = stempelVon(abh.jetzt());
  const verzeichnis = join(abh.ablage, `lastbeleg-${stempel}`);
  const angelegt = abh.angelegt ?? new Set();
  try {
    mkdirSync(verzeichnis, { recursive: true });
    const worktrees = [];
    for (let nr = 1; nr <= opt.anzahl; nr++) {
      const wt = abh.worktree.anlegen(nr, stempel);
      angelegt.add(wt);
      worktrees.push(wt);
    }
    await Promise.all(worktrees.map((wt) => einrichten(wt, opt.referenz, abh.starter)));

    const runden = [];
    for (let runde = 1; runde <= opt.runden; runde++) {
      runden.push(await eineRunde({ worktrees, runde, verzeichnis, opt, abh }));
    }
    const wackelpruefungen = runden.flatMap((r) => r.wackel);
    const rot = runden.some((r) => r.laeufe.some((l) => l.ergebnis !== "gruen" || l.ueberGrenze));
    const protokoll = {
      stempel, stand: abh.stand(), anzahl: opt.anzahl, grenzeS: opt.grenzeS, referenz: opt.referenz,
      ergebnis: rot ? "rot" : "gruen",
      runden: runden.map(({ runde, last, laeufe }) => ({ runde, last, laeufe })),
      wackelpruefungen,
    };
    writeFileSync(join(verzeichnis, "protokoll.json"), `${JSON.stringify(protokoll, null, 2)}\n`);
    writeFileSync(join(verzeichnis, "protokoll.md"), markdown(protokoll));
    abh.ausgabe(`Lastbeleg: ${protokoll.ergebnis} — Protokoll ${join(verzeichnis, "protokoll.md")}`);
    return { exitCode: rot ? 1 : 0, verzeichnis };
  } catch (fehler) {
    const text = String(fehler?.message ?? fehler);
    abh.ausgabe(`Lastbeleg: technischer Fehler — ${text}`);
    return { exitCode: 1, verzeichnis, fehler: text };
  } finally {
    for (const wt of angelegt) abh.worktree.entfernen(wt);
    angelegt.clear();
  }
}

// --- Echte Abhaengigkeiten ----------------------------------------------------

function git(cwd, args) {
  // PATH-Aufloesung bewusst, wie in tools/frischer-checkout.mjs.
  return spawnSync("git", args, { cwd, encoding: "utf-8" });
}

function hauptkopie() {
  const res = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (res.status !== 0) throw new Error(`kein Git-Repository: ${(res.stderr || "").trim()}`);
  return res.stdout.trim();
}

/** Ein Kommando ueber die Shell, ohne Zeitgrenze; stdout und stderr zusammen. */
function starter({ cwd, cmd, env }) {
  return new Promise((aufloesen) => {
    const kind = spawn(cmd, { cwd, env, shell: true });
    const teile = [];
    kind.stdout.on("data", (d) => teile.push(d));
    kind.stderr.on("data", (d) => teile.push(d));
    kind.on("error", (e) => teile.push(Buffer.from(String(e))));
    kind.on("close", (code, signal) => aufloesen({ code: code ?? `Signal ${signal}`, ausgabe: Buffer.concat(teile).toString("utf-8") }));
  });
}

function echteWorktrees(repoRoot) {
  return {
    anlegen: (nr, stempel) => {
      const pfad = join(tmpdir(), `lastbeleg-wt-${stempel}-${nr}`);
      const res = git(repoRoot, ["worktree", "add", "--detach", pfad, "HEAD"]);
      if (res.status !== 0) throw new Error(`git worktree add schlug fehl: ${(res.stderr || res.stdout || "").trim()}`);
      return pfad;
    },
    entfernen: (pfad) => {
      git(repoRoot, ["worktree", "remove", "--force", pfad]);
      rmSync(pfad, { recursive: true, force: true });
      git(repoRoot, ["worktree", "prune"]);
    },
  };
}

async function main() {
  let opt;
  try {
    opt = argumenteLesen(process.argv.slice(2));
  } catch (fehler) {
    console.error(`lastbeleg: ${fehler.message}\n\n${HILFE}`);
    return 2;
  }
  if (opt.hilfe) {
    console.log(HILFE);
    return 0;
  }
  const repoRoot = hauptkopie();
  const worktree = echteWorktrees(repoRoot);
  const angelegt = new Set();
  // Bei einem Abbruch baut der Handler ab, was steht; die Kindprozesse erhalten das Signal
  // aus dem Terminal selbst.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      for (const wt of angelegt) worktree.entfernen(wt);
      process.exit(130);
    });
  }
  const ergebnis = await lastbeleg({ ...opt, repoRoot }, {
    starter,
    jetzt: Date.now,
    schlaf: (ms) => new Promise((r) => { setTimeout(r, ms).unref(); }),
    last: () => loadavg()[0],
    worktree,
    stand: () => git(repoRoot, ["rev-parse", "HEAD"]).stdout.trim(),
    ablage: tmpdir(),
    ausgabe: (zeile) => console.log(zeile),
    angelegt,
  });
  return ergebnis.exitCode;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
