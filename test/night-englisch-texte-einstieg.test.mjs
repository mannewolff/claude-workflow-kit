// Ablauf-Pruefung: --help antwortet und der Dry-Run meldet in der Projektsprache — das zeigt nur ein Start des Einstiegs als Programm.
//
// Meldungen des Nacht-Runners zweisprachig (Plan #1420 E13/E14).
//
// Jedes Modul der Gruppe traegt seine Texte an den Menschen in einer Tabelle TEXTE { de, en }
// und gibt sie ueber den Texthelfer aus kit/board/namen.mjs aus:
//   - Paritaet: je Tabelle dieselben Schluessel und Platzhalter in beiden Sprachen.
//   - Englische Stichproben: ein englisches Projekt sieht die englische Form; die Zeilen, die
//     kanban-kit aus dem Textprotokoll liest, stehen in der Form der Vorlage am Plan #1420.
//   - Die deutschen Wortlaut-Tests der Gruppe bleiben, wie sie sind, und laufen mit der
//     Vorgabe Deutsch.
//
// Der erste Teil (#1484) deckt den Einstieg kit/night.mjs; kit/night/laufvariablen.mjs gibt
// nichts an den Menschen aus und hat darum keine Tabelle. Der zweite Teil (#1485) deckt
// kit/night/grundlagen.mjs, der dritte (#1486) kit/night/laufstand.mjs und kit/night/tag.mjs.
// Fuer die ganze Gruppe weist der Quelltext-Scan am Ende nach, dass keine deutsche Meldung
// mehr am Texthelfer vorbei ausgegeben wird.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { TEXTE as EINSTIEG_TEXTE } from "../kit/night.mjs";
import {
  TEXTE as GRUNDLAGEN_TEXTE, grundOhneArbeit, resteText, sicherheitsnetzGrund, boardFehlertext,
} from "../kit/night/grundlagen.mjs";
import {
  TEXTE as LAUFSTAND_TEXTE, nightStandLaden, standSetzen, anhaltenVermerken, LAUF_KONTEXT,
} from "../kit/night/laufstand.mjs";
import { TEXTE as TAG_TEXTE, pruefLaufAusschluss, pruefLaufStand, pruefLaufRestText } from "../kit/night/tag.mjs";
import { LETZTES_PROTOKOLL, ZUSTAND } from "../kit/night/grundlagen.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { mitProjekt } from "./helpers/laufstand-attrappe.mjs";
import { lfAttribute } from "./helpers/zeilenenden.mjs";
import { DEUTSCHE_WOERTER, deutschAmHelferVorbei, deutschImEnglischen, literale } from "./helpers/quelltext-texte.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

function laufe(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function hilfeIn(config) {
  const dir = mkdtempSync(join(tmpdir(), "night-englisch-hilfe-"));
  try {
    if (config) {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config));
    }
    return laufe(dir, process.execPath, [NIGHT, "--help"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Ein Projekt mit lokalem Tracker in der Sprache `language`, alles committet. */
function projekt(language) {
  const dir = mkdtempSync(join(tmpdir(), "night-englisch-"));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  cpSync(join(repoRoot, "kit", "board"), join(dir, ".claude", "kit", "board"), { recursive: true });
  cpSync(join(repoRoot, "kit", "texte"), join(dir, ".claude", "kit", "texte"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    language,
    codeHost: "local",
    issueTracker: "local",
    buildChecks: ["true"],
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), ".claude/night-run-*.log\n.claude/night-ergebnis-*.json\n.claude/night-*\n");
  lfAttribute(join(dir, ".gitattributes"));
  return dir;
}

function board(dir, ...cliArgs) {
  const res = laufe(dir, process.execPath, [join(dir, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function committen(dir) {
  for (const a of [["init", "-q"], ["config", "user.email", "test@example.invalid"], ["config", "user.name", "Night Test"],
    ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    const res = laufe(dir, "git", a);
    assert.equal(res.status, 0, `git ${a.join(" ")} schlug fehl: ${res.stderr}`);
  }
}

// --- kit/night.mjs (Issue #1484) ----------------------------------------------------------

test("[1484] die Texttabelle des Einstiegs hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(EINSTIEG_TEXTE), []);
  assert.ok(Object.keys(EINSTIEG_TEXTE.de).length >= 40, "die Tabelle traegt die Meldungen des Einstiegs");
});

test("[1484] englisch: --help antwortet englisch und nennt dieselben Vorgaben und Flags", () => {
  // Die deutsche Hilfe haelt test/night-grundlagen-argumente.test.mjs an DEFAULT_MODEL und
  // DEFAULT_LABEL; die englische nennt dieselben Werte.
  const DEFAULT_MODEL = /sonst night\.modell, sonst (\S+)\)/.exec(EINSTIEG_TEXTE.de.hilfe)[1];
  const DEFAULT_LABEL = /\(Default (\S+)\); --label none/.exec(EINSTIEG_TEXTE.de.hilfe)[1];
  const res = hilfeIn({ language: "en" });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^Night runner:/);
  assert.ok(res.stdout.includes(`otherwise night.modell, otherwise ${DEFAULT_MODEL})`), "die Hilfe nennt ein anderes Vorgabemodell");
  assert.ok(res.stdout.includes(`(default ${DEFAULT_LABEL}); --label none`), "die Hilfe nennt ein anderes Vorgabelabel");
  for (const flag of ["--chain", "--check", "--max", "--model", "--timeout-min", "--dry-run", "--yolo", "--no-checks-ok",
    "--label", "--verbose", "--version", "--help"]) {
    assert.match(res.stdout, new RegExp(`^[ \\t]+${flag}[\\s,]`, "m"), `die Hilfe nennt ${flag} nicht als Option`);
  }
  for (const deutsch of ["Aufruf", "Pruefung", "Beispiele", "unbeaufsichtigt", "Ketten"]) {
    assert.ok(!res.stdout.includes(deutsch), `die englische Hilfe enthaelt "${deutsch}"`);
  }
});

test("[1484] ohne Spracheinstellung bleibt die Hilfe deutsch", () => {
  const res = hilfeIn({ issueTracker: "local" });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^Nacht-Runner:/);
});

test("[1484] englisch: Start, Dry-Run und Ende stehen in der Form der kanban-kit-Vorlage", () => {
  const dir = projekt("en");
  try {
    committen(dir);
    const ohneLabel = board(dir, "issue", "create", "--title", "Without label", "--body", "## Dependencies\nNone.");
    const anforderung = board(dir, "issue", "create", "--title", "[Requirement] Customer self-service", "--body", "## Goal\nStory.");
    const paket = board(dir, "issue", "create", "--title", "Package", "--body", "## Dependencies\nNone.");
    for (const i of [ohneLabel, anforderung, paket]) board(dir, "issue", "move", String(i.id), "ready");
    for (const i of [anforderung, paket]) board(dir, "issue", "label", "add", String(i.id), "kit:nightrun");
    laufe(dir, "git", ["add", "-A"]);
    laufe(dir, "git", ["commit", "-q", "-m", "issues"]);

    const res = laufe(dir, process.execPath, [NIGHT, "--dry-run"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    const aus = res.stdout;
    assert.match(aus, /Night runner starting \(mode implementation, max 10 sessions, model \S+ \([^)]+\), label kit:nightrun, DRY-RUN\)/);
    assert.ok(aus.includes(`#${ohneLabel.id} Without label -> skipped (no label 'kit:nightrun')`), aus);
    assert.ok(aus.includes(`#${anforderung.id} [Requirement] Customer self-service -> would go to Backlog (requirement, not implemented)`), aus);
    assert.match(aus, new RegExp(`#${paket.id} Package -> session 1, model \\S+ \\((card|run)\\)`));
    assert.ok(aus.includes("Dry run finished: 1 session(s) would start."), aus);
    for (const deutsch of ["Nacht-Runner startet", "Dry-Run beendet", "uebersprungen (kein Label", "wuerde ins Backlog"]) {
      assert.ok(!aus.includes(deutsch), `die englische Ausgabe enthaelt "${deutsch}"`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1484] englisch: ein Paket ueber --max bleibt liegen, in der Form der Vorlage", () => {
  const dir = projekt("en");
  try {
    committen(dir);
    const ids = ["One", "Two"].map((t) => board(dir, "issue", "create", "--title", t, "--body", "## Dependencies\nNone.").id);
    for (const id of ids) {
      board(dir, "issue", "move", String(id), "ready");
      board(dir, "issue", "label", "add", String(id), "kit:nightrun");
    }
    laufe(dir, "git", ["add", "-A"]);
    laufe(dir, "git", ["commit", "-q", "-m", "issues"]);
    const res = laufe(dir, process.execPath, [NIGHT, "--dry-run", "--max", "1"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);
    assert.ok(res.stdout.includes(`#${ids[1]} Two -> over --max 1, would remain pending`), res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1484] englisch: ein unsauberer Baum haelt den Lauf mit englischer Meldung an", () => {
  const dir = projekt("en");
  try {
    committen(dir);
    writeFileSync(join(dir, "rest.txt"), "x");
    const res = laufe(dir, process.execPath, [NIGHT, "--dry-run"]);
    assert.notEqual(res.status, 0);
    assert.ok((res.stdout + res.stderr).includes("Working tree is not clean. Please commit or clean up, then restart."),
      res.stdout + res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- kit/night/grundlagen.mjs (Issue #1485) -----------------------------------------------

/** Fuehrt `fn` mit der Prozesssprache `sprache` aus und vergisst sie danach wieder. */
function inSprache(sprache, fn) {
  spracheFestlegen(sprache);
  try {
    return fn();
  } finally {
    spracheFestlegen(null);
  }
}

test("[1485] die Texttabelle der Grundlagen hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(GRUNDLAGEN_TEXTE), []);
  assert.ok(Object.keys(GRUNDLAGEN_TEXTE.de).length >= 30, "die Tabelle traegt die Meldungen der Grundlagen");
});

test("[1485] englisch: die Saetze eines Laufs ohne Arbeit, Ready leer in der Form der Vorlage", () => {
  inSprache("en", () => {
    assert.equal(grundOhneArbeit("readyLeer", {}), "Ready is empty — nothing to do.");
    assert.equal(grundOhneArbeit("keinLabel", { anzahl: 3, label: "kit:nightrun" }),
      "None of the 3 cards in Ready carries the label 'kit:nightrun' — nothing to do.");
    assert.match(grundOhneArbeit("ketteKeinLabel", { label: "kit:night" }), /^No chain to run:/);
    assert.match(grundOhneArbeit("pruefLaufKeinLabel", { label: "kit:check" }), /^Nothing to check:/);
    assert.match(grundOhneArbeit("gibtEsNicht", {}), /please report\.$/);
  });
});

test("[1485] englisch: Reste, Sicherheitsnetz und Board-Fehler", () => {
  inSprache("en", () => {
    assert.equal(resteText([]), "no uncommitted leftovers");
    assert.equal(resteText(["a", "b"]), "uncommitted leftovers: a | b");
    assert.match(resteText(Array.from({ length: 12 }, (_, i) => `d${i}`)), /^12 uncommitted leftovers, the first ten: d0 \| /);
    assert.match(sicherheitsnetzGrund({}, ""), /^No reason could be determined/);
    assert.match(sicherheitsnetzGrund({}, "HARD STOP: x"), /^HARD STOP: x \(The handover anchor was missing/);
    assert.equal(boardFehlertext(["issue", "list"], { signal: "SIGTERM", stderr: "weg" }),
      "board.mjs issue list failed (signal SIGTERM): weg");
  });
});

test("[1485] englisch: ein unbekanntes Argument endet mit Error: statt Fehler:", () => {
  const dir = mkdtempSync(join(tmpdir(), "night-englisch-argument-"));
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({ language: "en" }));
    const res = laufe(dir, process.execPath, [NIGHT, "--gibt-es-nicht"]);
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("Error: Unknown argument: --gibt-es-nicht — see --help"), res.stderr);
    assert.ok(!res.stderr.includes("Fehler:"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1485] ohne Spracheinstellung bleibt ein unbekanntes Argument deutsch", () => {
  const dir = mkdtempSync(join(tmpdir(), "night-deutsch-argument-"));
  try {
    const res = laufe(dir, process.execPath, [NIGHT, "--gibt-es-nicht"]);
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("Fehler: Unbekanntes Argument: --gibt-es-nicht — siehe --help"), res.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- kit/night/laufstand.mjs und kit/night/tag.mjs (Issue #1486) -------------------------

/** Wie `inSprache`, fuer eine asynchrone Funktion. */
async function inSpracheAsync(sprache, fn) {
  spracheFestlegen(sprache);
  try {
    return await fn();
  } finally {
    spracheFestlegen(null);
  }
}

const LAUF = "2026-10-01-010000";

test("[1486] die Texttabellen von Laufstand und Prueflauf haben in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(LAUFSTAND_TEXTE), []);
  assert.deepEqual(pruefeParitaet(TAG_TEXTE), []);
  assert.ok(Object.keys(LAUFSTAND_TEXTE.de).length >= 20, "die Tabelle traegt die Meldungen des Laufstands");
  assert.ok(Object.keys(TAG_TEXTE.de).length >= 30, "die Tabelle traegt die Meldungen des Prueflaufs");
});

test("[1486] englisch: die Abweisung eines unbrauchbaren night.stand", () => {
  inSprache("en", () => {
    assert.equal(nightStandLaden({ night: { stand: { fristMin: 0 } } }).fehler,
      "night.stand.fristMin must be a number greater than 0, is 0.");
    assert.match(nightStandLaden({ night: { stand: { fristMin: 5, pauseMin: 5 } } }).fehler,
      /^night\.stand\.pauseMin \(5\) must be smaller than night\.stand\.fristMin \(5\) — /);
  });
});

test("[1486] englisch: der Laufstand traegt die Kopfzeilen unter den englischen Markern", async () => {
  await inSpracheAsync("en", () => mitProjekt(({ dir, staende }) => {
    LETZTES_PROTOKOLL.set("7", ".claude/protokolle/x/7-umsetzung.log");
    standSetzen("7", "laeuft", "accepted", { lauf: LAUF, repoRoot: dir, position: { k: 2, n: 3 } });
    const text = staende()[0].text;
    assert.match(text, /^Log: \.claude\/protokolle\/x\/7-umsetzung\.log$/m);
    assert.match(text, /^Run-ID: \S+\/\d+\/2026-10-01-010000$/m);
    assert.match(text, /^Updated: \S+$/m);
    assert.match(text, /^Position: 2 of 3$/m);
    for (const deutsch of ["Lauf-ID:", "Stand:", "Protokoll:", " von "]) assert.ok(!text.includes(deutsch), text);
  }));
});

test("[1486] englisch: das Anhalten vermerkt die laufende und die naechsten Karten englisch", async () => {
  await inSpracheAsync("en", () => mitProjekt(({ staende }) => {
    ZUSTAND.LAUF_STEMPEL = LAUF;
    Object.assign(LAUF_KONTEXT, { karte: "7", kandidaten: () => ["7", "8"] });
    anhaltenVermerken("board silent");
    const [laufend, naechste] = staende();
    assert.match(laufend.text, /^aborted, environment error at \S+: board silent/);
    assert.match(naechste.text, /^not started: the run stopped at \S+ — board silent/);
  }));
});

test("[1486] englisch: Ausschluss, Laufstand und Rest-Vermerk des Prueflaufs", () => {
  inSprache("en", () => {
    const karte = (title, labels = ["kit:pruefen"]) => ({ id: 1, title, labels });
    assert.equal(pruefLaufAusschluss(karte("[Fachlich] X", []), "kit:pruefen"), "does not carry the marker kit:pruefen");
    assert.match(pruefLaufAusschluss(karte("[Plan] X"), "kit:pruefen"), /^carries \[Plan\] — the check run applies only to requirements/);
    assert.match(pruefLaufAusschluss(karte("Paket"), "kit:pruefen"), /^carries no \[Requirement\] — /);
    assert.match(pruefLaufStand({ ausgang: "geprueft" }).text, /^Check finished: geprueft at \S+$/);
    assert.match(pruefLaufStand({ ausgang: "klaeren", frage: "Which?" }).text, /\n\nPending decision: Which\?$/);
    assert.match(pruefLaufStand({ ausgang: "unvollstaendig", schritt: "befunde" }).text,
      /^Check finished: unvollstaendig at \S+, step reached: befunde\n\nno reason$/);
  });
});

test("[1486] englisch: der Rest-Vermerk einer abgebrochenen Pruefung", () => {
  const text = inSprache("en", () => pruefLaufRestText("5", "Time budget: x", "befunde", "2026-10-01-010000"));
  assert.match(text, /^## Check incomplete\n\nCheck run 2026-10-01-010000: /);
  assert.ok(text.includes("(Time budget: x)"), text);
  assert.ok(text.includes("step reached: befunde."), text);
  assert.ok(text.endsWith("Way forward: run /issue-review #5 by hand.\n"), text);
});

// --- Die ganze Gruppe: keine deutsche Meldung am Texthelfer vorbei (Issue #1486) ----------

const GRUPPE = [
  ["kit/night.mjs", EINSTIEG_TEXTE],
  ["kit/night/laufvariablen.mjs", null],
  ["kit/night/grundlagen.mjs", GRUNDLAGEN_TEXTE],
  ["kit/night/laufstand.mjs", LAUFSTAND_TEXTE],
  ["kit/night/tag.mjs", TAG_TEXTE],
];

// Die Tabellen der Teile unter kit/night/ liegen seit Issue #1525 in kit/texte/; nur der Einstieg traegt
// seine noch selbst.
test("[1486] die Gruppe gibt in einem englischen Projekt keine deutsche Meldung aus", () => {
  for (const [datei, tabelle] of GRUPPE) {
    assert.deepEqual(deutschAmHelferVorbei(datei, datei.startsWith("kit/night/") ? null : tabelle), [], `${datei}: deutsche Texte am Texthelfer vorbei`);
    assert.deepEqual(deutschImEnglischen(tabelle), [], `${datei}: deutsche Woerter in der englischen Tabelle`);
  }
});

test("[1486] der Quelltext-Scan findet einen deutschen Satz am Texthelfer vorbei", () => {
  const funde = literale('// "kein Fund"\nlog(`Lauf ${x ? "nicht da" : y} fertig`); const r = /der/;')
    .filter((l) => DEUTSCHE_WOERTER.test(l));
  assert.deepEqual(funde, ["nicht da", "Lauf   fertig"]);
});
