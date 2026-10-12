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
// Seit Plan #1548 (E6-E8) entfallen die deutschen Dateien befunde.mjs (Issue #1559), aufwand.mjs
// und wirksamkeit.mjs (Issue #1560): Der Code steht in der englischen Datei, und ihre deutschen
// Namen werden mit Hinweis auf den englischen abgewiesen.
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
import { aufrufen as aufwand } from "../kit/effort.mjs";
import { aufrufen as wirksamkeit } from "../kit/effectiveness.mjs";
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

// --- settings.mjs ----------------------------------------------------------------

// Der Code der Einstellungs-Oberflaeche steht seit Issue #1563 (Plan #1548 E6) in
// kit/settings.mjs; die deutsche Datei entfaellt ohne Weiterleitung. Die Oberflaeche kennt
// keine deutschen Befehls- oder Optionsnamen, die abzuweisen waeren: --port, --version und
// --help waren schon englisch.
test("settings.mjs: kit/einstellungen.mjs gibt es nicht mehr", () => {
  assert.equal(existsSync(join(KIT, "einstellungen.mjs")), false);
});

test("settings.mjs: --version und die Hilfe nennen settings.mjs, die Hilfe ist englisch, auch in einem deutschen Projekt", () => {
  const dir = leeresProjekt("settings-en-");
  try {
    const version = knoten("settings.mjs", ["--version"], { cwd: dir, env: { ...process.env, HOME: dir } });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /^settings\.mjs \(claude-workflow-kit v\d+\.\d+\.\d+\)\n$/);
    const hilfe = knoten("settings.mjs", ["--help"], { cwd: dir, env: { ...process.env, HOME: dir } });
    assert.equal(hilfe.status, 0, hilfe.stderr);
    assert.match(hilfe.stdout, /^settings\.mjs — maintain the settings of the claude-workflow-kit$/m);
    assert.match(hilfe.stdout, /node settings\.mjs \[folder\] \[--port <n>\]/);
    assert.doesNotMatch(hilfe.stdout, /einstellungen\.mjs|Nutzung|Oberfläche/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- checks.mjs ------------------------------------------------------------------

// Seit Issue #1564 (Plan #1548 E5, E7) nimmt checks.mjs nur die englischen Namen an; ein
// deutscher Befehl, eine deutsche Option und der getippte Stufenwert `paket` enden mit Exit 1
// und nennen den englischen Namen. Der Config-Wert `buildChecks[].stufe: paket` bleibt.
test("checks.mjs: deutsche Befehle, Optionen und der Stufenwert paket enden mit Exit 1 und nennen den englischen Namen", () => {
  const faelle = [
    [["bereiche"], "'bereiche'", "'areas'"],
    [["plan", "--stufe", "push"], "'--stufe'", "'--stage'"],
    [["plan", "--bereich", "x"], "'--bereich'", "'--area'"],
    [["plan", "--abschluss", "5"], "'--abschluss'", "'--finish'"],
    [["run", "--frisch"], "'--frisch'", "'--fresh'"],
    [["run", "--wiederholen"], "'--wiederholen'", "'--retry'"],
    [["plan", "--stage", "paket"], "'paket'", "'package'"],
  ];
  for (const [args, alt, neu] of faelle) {
    const res = checks(args, { cwd: repoRoot });
    assert.equal(res.status, 1, `${args.join(" ")}: ${res.stdout}`);
    assert.ok(res.stderr.includes(alt) && res.stderr.includes(neu), `${args.join(" ")}: ${res.stderr}`);
  }
});

test("checks.mjs: --stage package faehrt die Paketstufe, und areas antwortet", () => {
  const paket = checks(["plan", "--stage", "package"], { cwd: repoRoot });
  assert.equal(paket.status, 0, paket.stderr);
  assert.deepEqual(paket, checks(["plan"], { cwd: repoRoot }));
  const bereiche = checks(["areas"], { cwd: repoRoot });
  assert.equal(bereiche.status, 0, bereiche.stderr);
  assert.ok(JSON.parse(bereiche.stdout));
});

test("checks.mjs: die Hilfe ist englisch, auch in einem deutschen Projekt, und nennt den Stufenwert package", () => {
  const res = knoten("checks.mjs", ["--help"], { cwd: repoRoot });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^checks\.mjs \(claude-workflow-kit v[^)]+\) — due checks$/m);
  assert.ok(res.stdout.includes("package | push | merge"), res.stdout);
  assert.doesNotMatch(res.stdout, /faellige Pruefungen|--stufe|--abschluss|bereiche\n/);
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

// --- effort.mjs und effectiveness.mjs ---------------------------------------------

// Der Code steht seit Issue #1560 (Plan #1548 E6) in kit/effort.mjs und kit/effectiveness.mjs;
// die deutschen Dateien entfallen ohne Weiterleitung, und die deutschen Namen werden mit
// Hinweis abgewiesen (E8).
test("effort.mjs und effectiveness.mjs: kit/aufwand.mjs und kit/wirksamkeit.mjs gibt es nicht mehr", () => {
  assert.equal(existsSync(join(KIT, "aufwand.mjs")), false);
  assert.equal(existsSync(join(KIT, "wirksamkeit.mjs")), false);
});

test("effort.mjs: deutsche Unterkommandos und --laeufe enden mit Exit 1 und nennen den englischen Namen", () => {
  const dir = leeresProjekt("aufwand-en-");
  try {
    const faelle = [
      [["auswerten"], "'auswerten'", "'evaluate'"],
      [["befund"], "'befund'", "'finding'"],
      [["auskunft", "x.jsonl"], "'auskunft'", "'info'"],
      [["evaluate", "--laeufe", "3"], "'--laeufe'", "'--runs'"],
    ];
    for (const [argv, alt, neu] of faelle) {
      const res = aufwand(argv, { cwd: dir });
      assert.equal(res.status, 1, argv.join(" "));
      const ausgabe = res.stdout + res.stderr;
      assert.ok(ausgabe.includes(alt) && ausgabe.includes(neu), `${argv.join(" ")}: ${ausgabe}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("effort.mjs: evaluate --runs, finding und info laufen unter den englischen Namen", () => {
  const dir = leeresProjekt("aufwand-en-lauf-");
  try {
    const auswertung = aufwand(["evaluate", "--runs", "3"], { cwd: dir });
    assert.equal(auswertung.status, 0, auswertung.stdout + auswertung.stderr);
    assert.equal(JSON.parse(auswertung.stdout).fehler, undefined);
    const befund = aufwand(["finding"], { cwd: dir });
    assert.equal(befund.status, 0, befund.stderr);
    const auskunft = aufwand(["info"], { cwd: dir });
    assert.equal(auskunft.status, 1);
    assert.match(auskunft.stderr, /'info'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("effectiveness.mjs: deutsche Unterkommandos und --fenster enden mit Exit 1 und nennen den englischen Namen", () => {
  const dir = leeresProjekt("wirksamkeit-en-");
  try {
    const faelle = [
      [["auswerten"], "'auswerten'", "'evaluate'"],
      [["befund"], "'befund'", "'finding'"],
      [["kandidaten"], "'kandidaten'", "'candidates'"],
      [["evaluate", "--fenster", "3"], "'--fenster'", "'--window'"],
    ];
    for (const [argv, alt, neu] of faelle) {
      const res = wirksamkeit(argv, { cwd: dir });
      assert.equal(res.status, 1, argv.join(" "));
      const ausgabe = res.stdout + res.stderr;
      assert.ok(ausgabe.includes(alt) && ausgabe.includes(neu), `${argv.join(" ")}: ${ausgabe}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("effort.mjs und effectiveness.mjs: die Hilfe ist englisch, auch in einem deutschen Projekt", () => {
  const dir = leeresProjekt("auswertungen-en-hilfe-");
  try {
    const aufwandHilfe = aufwand(["--help"], { cwd: dir }).stdout;
    assert.match(aufwandHilfe, /^effort\.mjs \(claude-workflow-kit v[^)]+\) — Process effort$/m);
    assert.match(aufwandHilfe, /node effort\.mjs evaluate \[--runs <n>\]/);
    assert.match(aufwandHilfe, /node effort\.mjs info <transcript…>/);
    assert.doesNotMatch(aufwandHilfe, /aufwand\.mjs|auswerten|--laeufe|Liest/);
    const wirksamkeitHilfe = wirksamkeit(["--help"], { cwd: dir }).stdout;
    assert.match(wirksamkeitHilfe, /^effectiveness\.mjs \(claude-workflow-kit v[^)]+\) — Effectiveness of the checks$/m);
    assert.match(wirksamkeitHilfe, /node effectiveness\.mjs evaluate \[--window <days>\]/);
    assert.doesNotMatch(wirksamkeitHilfe, /wirksamkeit\.mjs|auswerten|--fenster|Liest/);
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

// Seit Issue #1564 (Plan #1548 E5, E7) nimmt worktree.mjs nur die englischen Namen an,
// auch fuer die Werte von --result und --fetch.
test("worktree.mjs: deutsche Unterkommandos, Optionen und Werte enden mit Exit 1 und nennen den englischen Namen", () => {
  const repo = leeresProjekt("worktree-en-");
  try {
    writeFileSync(join(repo, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n");
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "t@example.invalid");
    git(repo, "config", "user.name", "T");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "Anfang");
    const fehlt = join(repo, "gibtsnicht");
    const faelle = [
      [["anlegen"], "'anlegen'", "'create'"],
      [["entfernen", fehlt], "'entfernen'", "'remove'"],
      [["im", repo, "--", process.execPath, "-e", "0"], "'im'", "'in'"],
      [["nachziehen-pruefen"], "'nachziehen-pruefen'", "'catch-up-check'"],
      [["rueckweg", fehlt], "'rueckweg'", "'return'"],
      [["vorbereitung-festhalten", fehlt], "'vorbereitung-festhalten'", "'record-preparation'"],
      [["vorbereitung-pruefen"], "'vorbereitung-pruefen'", "'check-preparation'"],
      [["create", "--praefix", "x"], "'--praefix'", "'--prefix'"],
      [["record-preparation", fehlt, "--ergebnis", "green"], "'--ergebnis'", "'--result'"],
      [["record-preparation", fehlt, "--result", "green", "--offen", "a"], "'--offen'", "'--open'"],
      [["check-preparation", "--verwerfen"], "'--verwerfen'", "'--discard'"],
      [["record-preparation", fehlt, "--result", "gruen"], "'gruen'", "'green'"],
      [["record-preparation", fehlt, "--result", "gruen-offen"], "'gruen-offen'", "'green-open'"],
      [["record-preparation", fehlt, "--result", "rot"], "'rot'", "'red'"],
      [["record-preparation", fehlt, "--result", "green", "--fetch", "fehlgeschlagen"], "'fehlgeschlagen'", "'failed'"],
    ];
    for (const [args, alt, neu] of faelle) {
      const res = knoten("worktree.mjs", args, { cwd: repo });
      assert.equal(res.status, 1, `${args.join(" ")}: ${res.stdout}`);
      const { ok, fehler } = JSON.parse(res.stdout.trim().split("\n").at(-1));
      assert.equal(ok, false);
      assert.ok(fehler.includes(alt) && fehler.includes(neu), `${args.join(" ")}: ${fehler}`);
    }
    assert.equal(existsSync(join(repo, ".claude", "push-vorbereitung.json")), false, "keine Abweisung hat etwas festgehalten");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("worktree.mjs: ein unbekannter Wert von --result oder --fetch nennt die englischen Werte", () => {
  const repo = leeresProjekt("worktree-en-wert-");
  try {
    git(repo, "init", "-q", "-b", "main");
    for (const [args, erwartet] of [
      [["record-preparation", repo, "--result", "nix"], /green, green-open, red/],
      [["record-preparation", repo, "--result", "green", "--fetch", "nix"], /ok, failed/],
    ]) {
      const res = knoten("worktree.mjs", args, { cwd: repo });
      assert.equal(res.status, 1, res.stdout);
      assert.match(JSON.parse(res.stdout.trim().split("\n").at(-1)).fehler, erwartet);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("worktree.mjs: die Hilfe ist englisch, auch in einem deutschen Projekt, und die Texttabelle traegt keine", async () => {
  const res = knoten("worktree.mjs", ["--help"], { cwd: repoRoot });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^worktree\.mjs \(claude-workflow-kit v[^)]+\) — worktree for the release skills$/m);
  assert.ok(res.stdout.includes("--result <green|green-open|red>"), res.stdout);
  assert.ok(res.stdout.includes("--fetch <ok|failed>"), res.stdout);
  assert.doesNotMatch(res.stdout, /anlegen|gruen|fehlgeschlagen/);
  const { TEXTE } = await import("../kit/texte/worktree.mjs");
  assert.equal(Object.hasOwn(TEXTE.de, "hilfe"), false);
  assert.equal(Object.hasOwn(TEXTE.en, "hilfe"), false);
});

test("worktree.mjs: create --prefix legt den Worktree unter dem Praefix an", () => {
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

test("Der Installer legt findings.mjs, effort.mjs und effectiveness.mjs byteweise wie die Quelle ab, settings.mjs und die deutschen Dateien nicht", () => {
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
    for (const datei of ["aufwand.mjs", "wirksamkeit.mjs"]) {
      assert.equal(existsSync(join(dir, ".claude", "kit", datei)), false, `${datei} entfaellt (Issue #1560)`);
    }
    // Die drei laufen im Zielprojekt aus ihrem eigenen Code.
    for (const datei of ["findings.mjs", "effort.mjs", "effectiveness.mjs"]) {
      const version = spawnSync(process.execPath, [join(dir, ".claude", "kit", datei), "--version"], { encoding: "utf-8" });
      assert.equal(version.status, 0, `${datei}: ${version.stderr}`);
      assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/, datei);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
