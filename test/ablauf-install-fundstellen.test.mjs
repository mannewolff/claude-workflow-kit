// Ablauf-Pruefung: Ob das Update die Stellen nennt, die der Mensch selbst aendern muss, zeigt nur der Installer als Programm in einem Wegwerf-Projekt.
//
// Update nennt die Stellen, die der Mensch selbst aendern muss (Issue #1570, Plan #1548 E11,
// Fachplan #1527 Kriterium 11).
//
// Was das Update nicht selbst umschreibt, nennt es: Es durchsucht lesend `.claude/settings.json`,
// `.claude/settings.local.json`, die `scripts` der `package.json` und die Ausgabe von
// `crontab -l` nach den alten Namen, nennt jede Fundstelle mit altem und neuem Namen und gibt
// danach immer die vollstaendige Tabelle alt → neu aus. Geaendert wird dabei nichts.
//
// `crontab -l` ist im Test eine Attrappe vorn im PATH — der Test liest nie den echten Zeitplan
// der Maschine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, realpathSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { altnamenFunde } from "../install.mjs";

const INSTALLER = join(dirname(fileURLToPath(import.meta.url)), "..", "install.mjs");

// Bestehendes Projekt: keine Sprachfrage. Projektlokal, GitHub, Build-Dienst ja, Schutz nein,
// danach die Vorgaben (wie PROJEKT_GITHUB_BESTAND in ablauf-install-flow.test.mjs).
const BESTAND = ["projekt", "github", "j", "n", "github", "", "", "", "", "", "", ""];
const BESTAND_EN = ["project", "github", "y", "n", "github", "", "", "", "", "", "", ""];

function mitProjekt(praefix, fn) {
  const wurzel = realpathSync(mkdtempSync(join(tmpdir(), praefix)));
  const projekt = join(wurzel, "projekt");
  for (const d of [projekt, join(wurzel, "home"), join(wurzel, "bin")]) mkdirSync(d, { recursive: true });
  try {
    fn({ wurzel, projekt });
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
}

/** Eine crontab-Attrappe: gibt `ausgabe` aus und endet mit `status`. */
function crontabAttrappe(wurzel, ausgabe, status = 0) {
  const datei = join(wurzel, "bin", "crontab");
  writeFileSync(datei, `#!/bin/sh\n[ "$1" = "-l" ] || exit 9\ncat <<'ENDE'\n${ausgabe}\nENDE\nexit ${status}\n`);
  chmodSync(datei, 0o755);
}

function installiere({ wurzel, projekt }, antworten) {
  const res = spawnSync(process.execPath, [INSTALLER], {
    cwd: projekt,
    input: antworten.join("\n") + "\n",
    encoding: "utf-8",
    env: {
      ...process.env,
      KIT_INSTALL_TTY: "",
      HOME: join(wurzel, "home"),
      USERPROFILE: join(wurzel, "home"),
      PATH: `${join(wurzel, "bin")}${delimiter}${process.env.PATH}`,
    },
  });
  return { ...res, alles: `${res.stdout}\n${res.stderr}` };
}

function schreibe(projekt, pfad, inhalt) {
  mkdirSync(dirname(join(projekt, pfad)), { recursive: true });
  writeFileSync(join(projekt, pfad), typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt, null, 2) + "\n");
}

const SETTINGS_LOCAL = {
  sandbox: { excludedCommands: ["node .claude/kit/board.mjs*", "node .claude/kit/befunde.mjs*"] },
};

test("[1570] das Update nennt Sandbox-Ausnahme, Paket-Skript und Zeitplan mit altem und neuem Namen", () => {
  mitProjekt("install-fundstellen-", (u) => {
    schreibe(u.projekt, ".claude/workflow.config.json", { sprache: "de", codeHost: "github", issueTracker: "github" });
    schreibe(u.projekt, ".claude/settings.local.json", SETTINGS_LOCAL);
    const vorher = readFileSync(join(u.projekt, ".claude", "settings.local.json"), "utf-8");
    schreibe(u.projekt, "package.json", { name: "p", scripts: { nacht: "node .claude/kit/night.mjs --kette", test: "node --test" } });
    const paketVorher = readFileSync(join(u.projekt, "package.json"), "utf-8");
    crontabAttrappe(u.wurzel, "0 2 * * * cd /p && node .claude/kit/night.mjs --waechter");

    const res = installiere(u, BESTAND);
    assert.equal(res.status, 0, res.alles);
    const ausgabe = res.stdout;
    const kopf = ausgabe.indexOf("Selbst zu ändern");
    assert.ok(kopf >= 0, `Schlussmeldung fehlt:\n${ausgabe}`);
    const schluss = ausgabe.slice(kopf);

    assert.match(schluss, /\.claude\/settings\.local\.json: sandbox\.excludedCommands\[1\]: befunde\.mjs → findings\.mjs/);
    assert.match(schluss, /package\.json: scripts\.nacht: --kette → --chain/);
    assert.match(schluss, /crontab -l, Zeile 1: --waechter → --watcher/);
    assert.doesNotMatch(schluss, /excludedCommands\[0\]/, "die englische Ausnahme ist keine Fundstelle");

    // Danach immer die vollstaendige Tabelle und der Satz zu den Orten ausserhalb.
    const tabelle = schluss.slice(schluss.indexOf("alt → neu"));
    for (const zeile of [
      "aufwand.mjs → effort.mjs",
      "wirksamkeit.mjs → effectiveness.mjs",
      "einstellungen.mjs → settings.mjs",
      "befunde.mjs → findings.mjs",
      "--pruefen → --check (night.mjs)",
      "board.mjs sitzung → board.mjs session",
      "board.mjs issue melden → board.mjs issue report",
      "board.mjs hook bash-pruefen → board.mjs hook bash-check",
      "board.mjs code protection einrichten → board.mjs code protection setup",
      "--teil → --part (board.mjs)",
      "--state laeuft → --state running (board.mjs)",
    ]) assert.ok(tabelle.includes(zeile), `Tabellenzeile fehlt: ${zeile}\n${tabelle}`);
    assert.match(tabelle, /Zeitpläne und eigene Skripte außerhalb dieser Orte/);

    assert.equal(readFileSync(join(u.projekt, ".claude", "settings.local.json"), "utf-8"), vorher, "settings.local.json bleibt unveraendert");
    assert.equal(readFileSync(join(u.projekt, "package.json"), "utf-8"), paketVorher, "package.json bleibt unveraendert");
  });
});

test("[1570] ohne Fundstelle und ohne Zeitplan: die Meldung sagt es, die Tabelle steht trotzdem, englisch im englischen Projekt", () => {
  mitProjekt("install-fundstellen-leer-", (u) => {
    schreibe(u.projekt, ".claude/workflow.config.json", { language: "en", codeHost: "github", issueTracker: "github" });
    crontabAttrappe(u.wurzel, "no crontab for nutzer", 1);

    const res = installiere(u, BESTAND_EN);
    assert.equal(res.status, 0, res.alles);
    const kopf = res.stdout.indexOf("To change yourself");
    assert.ok(kopf >= 0, `Schlussmeldung fehlt:\n${res.stdout}`);
    const schluss = res.stdout.slice(kopf);
    assert.match(schluss, /No occurrence/);
    assert.doesNotMatch(schluss, /crontab -l, line/);
    assert.ok(schluss.includes("aufwand.mjs → effort.mjs"));
    assert.match(schluss, /schedules and your own scripts outside these places/i);
  });
});

test("[1570] Fundstellen in einer Zeichenkette: der laengere Name gewinnt, Optionen nur am passenden Kommando", () => {
  assert.deepEqual(altnamenFunde("x", "node .claude/kit/board.mjs sitzung melden --complete"), [
    { ort: "x", alt: "board.mjs sitzung melden", neu: "board.mjs session report" },
  ]);
  assert.deepEqual(altnamenFunde("x", "node .claude/kit/board.mjs issue list --spalte ready"), [
    { ort: "x", alt: "--spalte", neu: "--column" },
  ]);
  assert.deepEqual(altnamenFunde("x", "node .claude/kit/board.mjs issue run-state 3 --zustand laeuft"), [
    { ort: "x", alt: "--zustand laeuft", neu: "--state running" },
  ]);
  assert.deepEqual(altnamenFunde("x", "rsync --teil a b && node night.mjs --chain"), [], "--teil ohne board.mjs, --chain ist neu");
  assert.deepEqual(altnamenFunde("x", "node .claude/kit/settings.mjs; node .claude/kit/einstellungen.mjs"), [
    { ort: "x", alt: "einstellungen.mjs", neu: "settings.mjs" },
  ]);
});
