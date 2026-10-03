// Eine haengende Pruefung wird abgebrochen (Issue #1077).
//
// In der Nacht zum 30.09.2026 hing im Abschlusslauf von #1069 ein Test 30 Minuten lang.
// `checks.mjs` vermerkte die Obergrenze nur und wartete, bis das Werkzeug der Session
// aufgab. Jetzt hat jede Pruefung eine Abbruchgrenze: das Fuenffache des Medians ihrer
// gruenen Laeufe, mindestens drei Minuten, ohne Historie 15 Minuten. Wer sie reisst,
// wird mit seiner ganzen Prozessgruppe beendet und steht als haengend rot da.
//
// Die Tests setzen Mindestwert, Vorgabe und Abbruchfrist ueber die Umgebung herab —
// wie `KIT_CHECKS_PRUEFDAUER_OBERGRENZE_MS` —, damit niemand Minuten schlafen muss.

import "./helpers/checks-sperre.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKS, mitRepo, repoAnlegen, datei, eintrag, zusammenfassung, ausfuehrungen } from "./helpers/checks-repo.mjs";
import {
  haengeGrenzeMs, HAENGEN_FAKTOR, HAENGEN_MINDEST_MS, HAENGEN_VORGABE_MS,
} from "../kit/checks.mjs";

// --- Die Grenze aus der Historie -------------------------------------------

const zeile = (cmd, ergebnis, dauerMs) => ({ cmd, ergebnis, dauerMs });

test("ohne Historie gilt die Vorgabe", () => {
  assert.equal(haengeGrenzeMs("npm test", [], {}), HAENGEN_VORGABE_MS);
  assert.equal(haengeGrenzeMs("npm test", [zeile("anderes", "gruen", 1000)], {}), HAENGEN_VORGABE_MS);
});

test("rote Laeufe zaehlen nicht zur Historie", () => {
  assert.equal(haengeGrenzeMs("npm test", [zeile("npm test", "rot", 9_000_000)], {}), HAENGEN_VORGABE_MS);
});

test("mit Historie gilt das Vielfache des Medians der gruenen Laeufe", () => {
  const min = (s) => s * 60_000;
  const zeilen = [4, 5, 6].map((m) => zeile("npm test", "gruen", min(m)));
  assert.equal(haengeGrenzeMs("npm test", zeilen, {}), HAENGEN_FAKTOR * min(5));
});

test("die Grenze faellt nie unter den Mindestwert", () => {
  const zeilen = [1000, 2000, 3000].map((ms) => zeile("npm test", "gruen", ms));
  assert.equal(haengeGrenzeMs("npm test", zeilen, {}), HAENGEN_MINDEST_MS);
});

test("Mindestwert und Vorgabe lassen sich ueber die Umgebung herabsetzen", () => {
  const env = { KIT_CHECKS_HAENGEN_MINDEST_MS: "100", KIT_CHECKS_HAENGEN_VORGABE_MS: "200" };
  assert.equal(haengeGrenzeMs("x", [], env), 200);
  assert.equal(haengeGrenzeMs("x", [zeile("x", "gruen", 10)], env), 100);
  assert.equal(haengeGrenzeMs("x", [], { KIT_CHECKS_HAENGEN_VORGABE_MS: "keine Zahl" }), HAENGEN_VORGABE_MS);
});

// --- Der Abbruch im echten Lauf ----------------------------------------------

const FRIST_MS = 60_000;
const UMGEBUNG = {
  KIT_CHECKS_HAENGEN_VORGABE_MS: "1500",
  KIT_CHECKS_HAENGEN_MINDEST_MS: "1500",
  KIT_CHECKS_HAENGEN_FRIST_MS: "500",
};

function runMit(dir, env = {}) {
  return spawnSync(process.execPath, [CHECKS, "run"], {
    cwd: dir, encoding: "utf-8", timeout: FRIST_MS, killSignal: "SIGKILL",
    env: { ...process.env, ...env },
  });
}

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Die Kommandos rufen ein Node-Skript statt POSIX-Shellsyntax auf: Unter Windows
// laeuft jede Pruefung ueber `cmd.exe`, das `&`, `$!` und `;` nicht kennt (Issue #1127).
const HELFER = join(dirname(fileURLToPath(import.meta.url)), "helpers", "haenger.mjs");
const helferAufruf = (...args) => [process.execPath, HELFER].map((p) => `"${p}"`).concat(args).join(" ");

// Ein Enkel: Das Skript startet einen Kindprozess, schreibt seine PID und wartet auf ihn.
const HAENGER = helferAufruf("enkel");
const KURZ = helferAufruf("warte", "200");

test("ein haengendes Kommando wird abgebrochen und als haengend rot gemeldet, samt Enkel", () => {
  mitRepo({ config: { buildChecks: [{ cmd: HAENGER }] } }, (dir) => {
    datei(dir, "src/x.txt");
    const start = Date.now();
    const res = runMit(dir, UMGEBUNG);
    const dauer = Date.now() - start;

    assert.equal(res.signal, null, `run selbst hing ${FRIST_MS} ms`);
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
    assert.equal(lebt(pid), false, `der Enkel ${pid} lebt noch`);

    const protokoll = ausfuehrungen(dir).map((z) => z.split("\t")).filter((spalten) => spalten[1] === HAENGER);
    assert.equal(protokoll.at(-1)?.[2], "rot", "das Protokoll fuehrt den Abbruch als rot");
  });
});

test("ein Kommando unter der Grenze bleibt unberuehrt", () => {
  mitRepo({ config: { buildChecks: [{ cmd: KURZ }] } }, (dir) => {
    datei(dir, "src/x.txt");
    const res = runMit(dir, UMGEBUNG);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const lauf = eintrag(zusammenfassung(dir).laufen, KURZ);
    assert.equal(lauf.ergebnis, "gruen");
    assert.equal(lauf.haengend, undefined);
    assert.ok(!existsSync(join(dir, "enkel.pid")));
  });
});

test("wird checks.mjs selbst beendet, endet die laufende Pruefung samt Enkel mit", async () => {
  // Die Pruefungen laufen in eigenen Prozessgruppen; ohne Weitergabe liefen sie nach dem
  // Abbruch des Aufrufers verwaist weiter — etwa wenn der Nacht-Runner eine Session an
  // ihrer Gruppe beendet. `repoAnlegen` statt `mitRepo`: Der Test wartet asynchron, und
  // `mitRepo` raeumte das Verzeichnis sofort nach dem synchronen Aufruf ab.
  const dir = repoAnlegen({ config: { buildChecks: [{ cmd: HAENGER }] } });
  try {
    datei(dir, "src/x.txt");
    const kind = spawn(process.execPath, [CHECKS, "run"], { cwd: dir, stdio: "ignore" });
    const pidDatei = join(dir, "enkel.pid");
    const beginn = Date.now();
    while (!existsSync(pidDatei) || readFileSync(pidDatei, "utf-8").trim() === "") {
      assert.ok(Date.now() - beginn < 30_000, "der Enkel startete nicht");
      await new Promise((weiter) => setTimeout(weiter, 50));
    }
    const pid = Number(readFileSync(pidDatei, "utf-8").trim());
    const ende = new Promise((weiter) => kind.once("exit", weiter));
    // Windows kennt kein abfangbares SIGTERM — `kind.kill` waere dort ein harter Abbruch
    // ohne Handler. Dort beendet der Aufrufer den ganzen Baum, und genau das ist die
    // Zusage dieses Tests auf der Plattform. Auf POSIX reicht checks.mjs SIGTERM weiter.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(kind.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      kind.kill("SIGTERM");
    }
    await ende;
    await new Promise((weiter) => setTimeout(weiter, 300));
    assert.equal(lebt(pid), false, `der Enkel ${pid} lebt nach dem Ende von checks.mjs noch`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
