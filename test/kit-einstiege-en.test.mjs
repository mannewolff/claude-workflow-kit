// Ablauf-Pruefung: die Einstiegsdateien, kit/worktree.mjs und der Installer sind nur als
// Prozess beobachtbar.
//
// Englische Namen der Kit-Werkzeuge (Issue #1462, Plan #1420 E18).
//
// Die Werkzeugdateien mit deutschem Namen bekommen englische Einstiegsdateien, die die
// Quelle mit denselben Argumenten aufrufen; die deutschen Unterkommandos und Optionen von
// night, checks, befunde, worktree und wirksamkeit bekommen englische Namen dazu. Die alten
// Namen bleiben gueltig — Hooks, Sandbox-Ausnahmen und Projekte nennen sie.
//
// Geprueft wird die Gleichheit mit dem deutschen Aufruf, nicht ein bestimmtes Ergebnis.
// Wo ein Aufruf etwas veraendern wuerde, vergleicht der Test eine Abweisung, die erst NACH
// dem Einlesen faellt: Ein unbekannter Name scheiterte vorher mit `Unbekanntes Argument`
// und gliche dem deutschen Aufruf darum nicht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { aufrufen as checks } from "../kit/checks.mjs";
import { aufrufen as befunde } from "../kit/findings.mjs";
import { aufrufen as wirksamkeit } from "../kit/wirksamkeit.mjs";
import { parseArgs, grundlagenAnbinden } from "../kit/night/grundlagen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(repoRoot, "kit");

function knoten(datei, args, optionen = {}) {
  const res = spawnSync(process.execPath, [join(KIT, datei), ...args], { encoding: "utf-8", ...optionen });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function leeresProjekt(praefix) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), "{\"codeHost\":\"local\",\"issueTracker\":\"local\"}\n");
  return dir;
}

// --- Einstiegsdateien ----------------------------------------------------------

const EINSTIEGE = [
  ["effort.mjs", "aufwand.mjs", [["--version"], ["--help"], ["gibtsnicht"]]],
  ["effectiveness.mjs", "wirksamkeit.mjs", [["--version"], ["--help"], ["gibtsnicht"]]],
  ["settings.mjs", "einstellungen.mjs", [["--version"], ["--help"]]],
];

for (const [einstieg, quelle, aufrufe] of EINSTIEGE) {
  test(`kit/${einstieg} liefert dieselbe Ausgabe und denselben Exitcode wie kit/${quelle}`, () => {
    const dir = leeresProjekt("einstieg-en-");
    try {
      for (const args of aufrufe) {
        const soll = knoten(quelle, args, { cwd: dir });
        const ist = knoten(einstieg, args, { cwd: dir });
        assert.deepEqual(ist, soll, `${einstieg} ${args.join(" ")}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// --- checks.mjs ------------------------------------------------------------------

test("checks.mjs: areas gleicht bereiche", () => {
  assert.deepEqual(checks(["areas"], { cwd: repoRoot }), checks(["bereiche"], { cwd: repoRoot }));
});

test("checks.mjs: --stage, --area, --finish, --fresh und --retry gleichen den deutschen Optionen", () => {
  const paare = [
    [["plan", "--finish", "5", "--stage", "push"], ["plan", "--abschluss", "5", "--stufe", "push"]],
    [["plan", "--finish", "--area", "x"], ["plan", "--abschluss", "--bereich", "x"]],
    [["plan", "--fresh", "--stage", "nix"], ["plan", "--frisch", "--stufe", "nix"]],
    [["plan", "--retry", "--stage", "nix"], ["plan", "--wiederholen", "--stufe", "nix"]],
  ];
  for (const [en, de] of paare) {
    const soll = checks(de, { cwd: repoRoot });
    assert.equal(soll.status, 1, `${de.join(" ")}: ${soll.stderr}`);
    assert.doesNotMatch(soll.stderr, /Unbekanntes Argument/);
    assert.deepEqual(checks(en, { cwd: repoRoot }), soll, en.join(" "));
  }
});

// --- findings.mjs ----------------------------------------------------------------

// Der Code steht seit Issue #1559 (Plan #1548 E6) in kit/findings.mjs; die deutsche Datei
// entfaellt ohne Weiterleitung, und die deutschen Namen werden mit Hinweis abgewiesen.
test("findings.mjs: kit/befunde.mjs gibt es nicht mehr", () => {
  assert.equal(existsSync(join(KIT, "befunde.mjs")), false);
});

test("findings.mjs: deutsche Unterkommandos, Optionen und Stufenwerte enden mit Exit 1 und nennen den englischen Namen", () => {
  const dir = leeresProjekt("befunde-en-");
  try {
    const datei = join(dir, "funde.md");
    writeFileSync(datei, "Keine Funde.\n");
    const faelle = [
      [["arten"], "'arten'", "'kinds'"],
      [["pruefen", "--file", datei], "'pruefen'", "'check'"],
      [["buchen"], "'buchen'", "'record'"],
      [["vorschlag"], "'vorschlag'", "'suggest'"],
      [["auswerten"], "'auswerten'", "'evaluate'"],
      [["befund"], "'befund'", "'finding'"],
      [["check", "--datei", datei], "'--datei'", "'--file'"],
      [["record", "--file", datei, "--stufe", "plan", "--card", "1"], "'--stufe'", "'--stage'"],
      [["record", "--file", datei, "--stage", "plan", "--karte", "1"], "'--karte'", "'--card'"],
      [["suggest", "--art", "form"], "'--art'", "'--kind'"],
      [["suggest", "--abgelehnt", "form"], "'--abgelehnt'", "'--rejected'"],
      [["record", "--file", datei, "--stage", "fachlich", "--card", "1"], "'fachlich'", "'requirement'"],
    ];
    for (const [argv, alt, neu] of faelle) {
      const res = befunde(argv, { cwd: dir });
      assert.equal(res.status, 1, argv.join(" "));
      const ausgabe = res.stdout + res.stderr;
      assert.ok(ausgabe.includes(alt) && ausgabe.includes(neu), `${argv.join(" ")}: ${ausgabe}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findings.mjs: --stage requirement bucht unter der internen Stufe fachlich", () => {
  const dir = leeresProjekt("befunde-en-stufe-");
  try {
    const datei = join(dir, ".claude", "funde.md");
    writeFileSync(datei, "#### WICHTIG\n\n**Fund**\nGegenprobe: Beobachtung. — geprueft, bestaetigt\nArt: luecke\nUebernahme: uebernommen\n");
    const res = befunde(["record", "--file", datei, "--stage", "requirement", "--card", "7"], { cwd: dir });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const zeile = readFileSync(join(dir, ".claude", "befunde.tsv"), "utf-8").trim();
    assert.equal(zeile.split("\t")[1], "fachlich");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findings.mjs: die Hilfe ist englisch, auch in einem deutschen Projekt", () => {
  const dir = leeresProjekt("befunde-en-hilfe-");
  try {
    const hilfe = befunde(["--help"], { cwd: dir }).stdout;
    assert.match(hilfe, /^findings\.mjs \(claude-workflow-kit v[^)]+\) — form and kinds of findings$/m);
    assert.match(hilfe, /node findings\.mjs record --file <path> --stage <requirement\|plan\|issue\|code> --card <n>/);
    assert.doesNotMatch(hilfe, /befunde\.mjs|Mangel-Arten|--datei/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- wirksamkeit.mjs -------------------------------------------------------------

test("wirksamkeit.mjs: evaluate, finding, candidates und --window gleichen den deutschen Namen", () => {
  const dir = leeresProjekt("wirksamkeit-en-");
  try {
    const paare = [
      [["evaluate", "--window", "0"], ["auswerten", "--fenster", "0"]],
      [["finding", "x"], ["befund", "x"]],
      [["candidates", "x"], ["kandidaten", "x"]],
    ];
    for (const [en, de] of paare) {
      const soll = wirksamkeit(de, { cwd: dir });
      assert.doesNotMatch(soll.stdout + soll.stderr, /Unbekannte[rs]? (Argument|Befehl)/, de.join(" "));
      assert.deepEqual(wirksamkeit(en, { cwd: dir }), soll, en.join(" "));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- night.mjs -------------------------------------------------------------------

// Ein Abbruch des Parsers wirft, statt den Testprozess zu beenden (wie in
// test/night-grundlagen-argumente.test.mjs).
grundlagenAnbinden({ laufAbbrechen: (grund) => { throw new Error(grund); } });

function nachtArgs(argv) {
  const schreiben = process.stderr.write;
  process.stderr.write = () => true;
  try {
    return parseArgs(argv);
  } finally {
    process.stderr.write = schreiben;
  }
}

test("night.mjs: --chain gleicht --kette, --check gleicht --pruefen", () => {
  assert.deepEqual(nachtArgs(["--chain"]), nachtArgs(["--kette"]));
  assert.deepEqual(nachtArgs(["--check"]), nachtArgs(["--pruefen"]));
});

// --- worktree.mjs ----------------------------------------------------------------

function git(cwd, ...a) {
  const res = spawnSync("git", a, { cwd, encoding: "utf-8" });
  assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
}

test("worktree.mjs: die englischen Unterkommandos und Optionen gleichen den deutschen", () => {
  const repo = leeresProjekt("worktree-en-");
  try {
    writeFileSync(join(repo, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n");
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "t@example.invalid");
    git(repo, "config", "user.name", "T");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "Anfang");
    const fehlt = join(repo, "gibtsnicht");
    const paare = [
      [["remove"], ["entfernen"]],
      [["return"], ["rueckweg"]],
      [["catch-up-check"], ["nachziehen-pruefen"]],
      [["record-preparation", fehlt], ["vorbereitung-festhalten", fehlt]],
      [["record-preparation", fehlt, "--result", "nix", "--open", "a", "--fetch", "ok"],
        ["vorbereitung-festhalten", fehlt, "--ergebnis", "nix", "--offen", "a", "--fetch", "ok"]],
      [["check-preparation", "--discard"], ["vorbereitung-pruefen", "--verwerfen"]],
      [["in", repo, "--", process.execPath, "-e", "process.exit(3)"], ["im", repo, "--", process.execPath, "-e", "process.exit(3)"]],
    ];
    for (const [en, de] of paare) {
      const soll = knoten("worktree.mjs", de, { cwd: repo });
      assert.doesNotMatch(soll.stdout, /unbekanntes Kommando/, de.join(" "));
      assert.deepEqual(knoten("worktree.mjs", en, { cwd: repo }), soll, en.join(" "));
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("worktree.mjs: create --prefix legt den Worktree unter dem Praefix an wie anlegen --praefix", () => {
  const repo = leeresProjekt("worktree-en-anlegen-");
  try {
    writeFileSync(join(repo, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n");
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "t@example.invalid");
    git(repo, "config", "user.name", "T");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "Anfang");
    const res = knoten("worktree.mjs", ["create", "--prefix", "probe", "--issue", "7"], { cwd: repo });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const stand = JSON.parse(res.stdout.trim().split("\n").at(-1));
    assert.equal(stand.praefix, "probe");
    assert.ok(existsSync(stand.pfad), stand.pfad);
    const weg = knoten("worktree.mjs", ["remove", stand.pfad], { cwd: repo });
    assert.equal(weg.status, 0, weg.stdout + weg.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// --- Installer -------------------------------------------------------------------

// Der kuerzeste Weg durch die Fragen wie in test/ablauf-install-checks-blob.test.mjs.
const PROJEKT_GITHUB = ["", "projekt", "github", "j", "n", "github", "", "", "", "", "", ""];

test("Der Installer legt findings.mjs, effort.mjs und effectiveness.mjs byteweise wie die Quelle ab, settings.mjs und befunde.mjs nicht", () => {
  const dir = mkdtempSync(join(tmpdir(), "install-einstiege-en-"));
  mkdirSync(join(dir, "home"), { recursive: true });
  try {
    const res = spawnSync(process.execPath, [join(repoRoot, "install.mjs")], {
      cwd: dir,
      input: PROJEKT_GITHUB.join("\n") + "\n",
      encoding: "utf-8",
      env: { ...process.env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") },
    });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    for (const datei of ["findings.mjs", "effort.mjs", "effectiveness.mjs"]) {
      const ziel = join(dir, ".claude", "kit", datei);
      assert.ok(existsSync(ziel), `${datei} wurde nicht ausgeliefert`);
      assert.ok(readFileSync(ziel).equals(readFileSync(join(KIT, datei))), `${datei} weicht von der Quelle ab`);
    }
    // Die Einstellungsoberflaeche ist Download, nicht Installation (RELEASING.md): Ein
    // Einstieg ohne die Datei daneben liefe ins Leere.
    assert.equal(existsSync(join(dir, ".claude", "kit", "settings.mjs")), false);
    assert.equal(existsSync(join(dir, ".claude", "kit", "befunde.mjs")), false, "die deutsche Datei entfaellt (Issue #1559)");
    // findings.mjs laeuft im Zielprojekt aus seinem eigenen Code.
    const version = spawnSync(process.execPath, [join(dir, ".claude", "kit", "findings.mjs"), "--version"], { encoding: "utf-8" });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
