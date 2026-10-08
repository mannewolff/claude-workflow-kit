// Ablauf-Pruefung: Ob eine abgebrochene Pruefung samt Enkel wirklich stirbt, auch wenn checks.mjs selbst ein Signal bekommt, zeigen nur echte Prozesse.
//
// Der Abbruch haengender Pruefungen und seine Weitergabe an die Prozessgruppen (Issue
// #1077; seit Issue #1212 aus `checks-haengen.test.mjs` herausgeloest). Die Grenze aus
// der Historie und ein Kommando unter der Grenze stehen dort.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checksMit, mitRepo, repoAnlegen, datei, eintrag, zusammenfassung, ausfuehrungen } from "./helpers/checks-repo.mjs";
import { CHECKS } from "./helpers/checks-ablauf.mjs";
import { helferAufruf, lebt } from "./helpers/haenger-aufruf.mjs";

// Ein Enkel: Das Skript startet einen Kindprozess, schreibt seine PID und wartet auf ihn.
const HAENGER = helferAufruf("enkel");

/** Wartet, bis `pruefung()` zutrifft; nach `ms` scheitert es mit `befund`. */
async function warteAuf(pruefung, ms, befund) {
  const ende = Date.now() + ms;
  while (!pruefung()) {
    if (Date.now() > ende) assert.fail(befund);
    await new Promise((weiter) => setTimeout(weiter, 50));
  }
}

/** Die PID, die der Enkel geschrieben hat, oder `null`, solange sie fehlt. */
function enkelPid(dir) {
  const pidDatei = join(dir, "enkel.pid");
  if (!existsSync(pidDatei)) return null;
  const text = readFileSync(pidDatei, "utf-8").trim();
  return text === "" ? null : Number(text);
}

const FRIST_MS = 60_000;
const UMGEBUNG = {
  KIT_CHECKS_HAENGEN_VORGABE_MS: "1500",
  KIT_CHECKS_HAENGEN_MINDEST_MS: "1500",
  KIT_CHECKS_HAENGEN_FRIST_MS: "500",
};

function runMit(dir, env = {}) {
  return checksMit(dir, { env }, "run");
}

test("ein haengendes Kommando wird abgebrochen und als haengend rot gemeldet, samt Enkel", { timeout: FRIST_MS }, async () => {
  await mitRepo({ config: { buildChecks: [{ cmd: HAENGER }] } }, async (dir) => {
    datei(dir, "src/x.txt");
    const start = Date.now();
    const res = await runMit(dir, UMGEBUNG);
    const dauer = Date.now() - start;

    assert.equal(res.status, 1, `run haette rot enden muessen: ${res.stdout}${res.stderr}`);
    assert.ok(dauer < 30_000, `run brauchte ${dauer} ms — Grenze 1,5 s plus Frist 0,5 s`);

    const lauf = eintrag(zusammenfassung(dir).laufen, HAENGER);
    assert.equal(lauf.ergebnis, "rot");
    assert.equal(lauf.haengend?.grenzeMs, 1500, `haengend fehlt: ${JSON.stringify(lauf)}`);
    assert.match(res.stdout, /haengend: nach 1\.5 s Grenze abgebrochen/);
    const zeilen = zusammenfassung(dir).berichtszeilen.join("\n");
    assert.match(zeilen, /gelaufen: .*haenger\.mjs" enkel → rot, .* — haengend: nach 1\.5 s Grenze abgebrochen/);

    const pid = Number(readFileSync(join(dir, "enkel.pid"), "utf-8").trim());
    assert.ok(pid > 0, "der Enkel hat seine PID nicht geschrieben");
    // Der Enkel stirbt am Signal, abgeraeumt wird er danach: Unter Last lebt er beim Ende von
    // `run` noch kurz. Darum wird begrenzt gewartet und nicht sofort geprueft (Issue #1212).
    await warteAuf(() => !lebt(pid), 5_000, `der Enkel ${pid} lebt noch`);

    // Das Protokoll fuehrt das Kommando maskiert (`kommandoMaskieren`): Unter Windows
    // traegt es Backslashes, und jeder steht dort verdoppelt (Issue #1144).
    const maskiert = HAENGER.replaceAll("\\", "\\\\");
    const protokoll = ausfuehrungen(dir).map((z) => z.split("\t")).filter((spalten) => spalten[1] === maskiert);
    assert.equal(protokoll.at(-1)?.[2], "rot", "das Protokoll fuehrt den Abbruch als rot");
  });
});

test("wird checks.mjs selbst beendet, endet die laufende Pruefung samt Enkel mit", async () => {
  // Die Pruefungen laufen in eigenen Prozessgruppen; ohne Weitergabe liefen sie nach dem
  // Abbruch des Aufrufers verwaist weiter — etwa wenn der Nacht-Runner eine Session an
  // ihrer Gruppe beendet.
  const dir = repoAnlegen({ config: { buildChecks: [{ cmd: HAENGER }] } });
  try {
    datei(dir, "src/x.txt");
    const kind = spawn(process.execPath, [CHECKS, "run"], { cwd: dir, stdio: "ignore" });
    await warteAuf(() => enkelPid(dir) !== null, 30_000, "der Enkel startete nicht");
    const pid = enkelPid(dir);
    const ende = new Promise((weiter) => kind.once("exit", weiter));
    // checks.mjs reicht SIGTERM an die Gruppen seiner Pruefungen weiter.
    kind.kill("SIGTERM");
    await ende;
    await warteAuf(() => !lebt(pid), 5_000, `der Enkel ${pid} lebt nach dem Ende von checks.mjs noch`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
