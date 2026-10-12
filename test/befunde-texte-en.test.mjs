// Ablauf-Pruefung: Ob ein englisches Projekt ohne Repo-Kontext nur englische Meldungen sieht, belegt nur ein echter Prozess aus den verteilten Dateien.
//
// Meldungen zweisprachig, Gruppe wirksamkeit, befunde, worktree (Plan #1420 E13/E14).
//
// Jedes Werkzeug der Gruppe traegt seine Texte an den Menschen in einer Tabelle TEXTE { de, en }
// und gibt sie ueber den Texthelfer aus kit/board/namen.mjs aus:
//   - Paritaet: dieselben Schluessel und Platzhalter in beiden Sprachen.
//   - Englische Stichproben: ein englisches Projekt sieht die englische Form.
//   - Die deutschen Wortlaut-Tests (test/wirksamkeit-*.test.mjs, test/ablauf-wirksamkeit-*.test.mjs
//     und die der anderen Werkzeuge) bleiben, wie sie sind, und laufen mit der Vorgabe Deutsch.
// Vertrag bleibt (E14): die Feldnamen der JSON-Ausgaben, die Zustandswerte einer Pruefung im
// Stand (`nicht gelaufen`, `beanstandet`, `gewackelt`, `nie beanstandet`), die Ausloeserarten
// aus dem Protokoll (`ohne-bereich`, `ohne-zuordnung`), die Schwellen-
// schluessel und das Praefix `Verschoben nach ` der Board-Verlaufszeile, das der Adapter liefert.
//
// Das Paket #1453 ist in drei Teile geschnitten. Der erste (#1497) deckt kit/wirksamkeit.mjs
// vollstaendig, der zweite (#1498) kit/befunde.mjs (seit #1559 kit/findings.mjs), der dritte (#1499) kit/worktree.mjs.
// Fuer befunde bleiben dazu Vertrag (E14): die Artnamen, die Marken, die Formwoerter des
// Fundblocks (`Gegenprobe:`, `— geprueft, bestaetigt`, `— nicht geprueft`, `Art:`), die
// Angaben-Schluessel, die Vorschlagsstaende und die Werte des Vergleichsstands.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { TEXTE as WIRKSAMKEIT_TEXTE, befundText, kandidatenText, zahlform } from "../kit/wirksamkeit.mjs";
import { TEXTE as BEFUNDE_TEXTE, aufrufen as befundeAufrufen } from "../kit/findings.mjs";
import { TEXTE as WORKTREE_TEXTE } from "../kit/worktree.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { mitProjekt, zeile, bewegung, moved, auswerten, wirksamkeit, bericht } from "./helpers/wirksamkeit-fixture.mjs";
import { deutschAmHelferVorbei, deutschImEnglischen } from "./helpers/quelltext-texte.mjs";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..", "kit");

afterEach(() => spracheFestlegen(null));

// --- kit/wirksamkeit.mjs (Issue #1497) --------------------------------------------------

/**
 * Ein Stand, der moeglichst viele Texte ausloest: eine nie beanstandete Pruefung ueber der
 * Schwelle, eine mit Wacklern, eine aus einem einzigen Lauftag, eine nicht mehr
 * vorgeschriebene, eine nicht gelaufene, Abschlusslaeufe mit Karte und Auslassung, Bereiche
 * mit Sonderzeilen und teuren Dateien, fehlerhafte Zeilen und eine Ruecklaeuferquote ueber der
 * Schwelle.
 */
function vollerStand() {
  const zeilen = [];
  for (let i = 0; i < 12; i++) zeilen.push(zeile({ tage: 1 + (i % 3), cmd: "npm test", dauerMs: 40_000, anlass: "abschluss", lauf: `l${i}`, karte: String(10 + (i % 2)), ausloeser: "bereiche", bereiche: ["kit"] }));
  for (let i = 0; i < 3; i++) {
    zeilen.push(zeile({ tage: 2, cmd: "npx eslint .", ergebnis: "rot", anlass: "paket", lauf: `w${i}` }) + "\t\t\t\t\terstlauf");
    zeilen.push(zeile({ tage: 2, cmd: "npx eslint .", ergebnis: "gruen", anlass: "paket", lauf: `w${i}` }) + "\t\t\t\t\twiederholung");
  }
  zeilen.push(zeile({ tage: 1, cmd: "alt-pruefung", ergebnis: "rot", ausloeser: "ohne-zuordnung", dateien: ["neu.txt"] }));
  zeilen.push(zeile({ tage: 1, cmd: "npm run e2e", anlass: "push", ausloeser: "unbekannte-art" }));
  zeilen.push("kaputt");
  return {
    zeilen,
    config: { buildChecks: ["npm test", "npx eslint .", "nie-gelaufen", { cmd: "npm run e2e", nichtBeimAbschluss: "Zusammenspiel" }] },
    bewegungen: Array.from({ length: 11 }, (_, i) => bewegung({ tage: 1, id: String(i + 1) })).concat(["kaputt"]),
    board: {
      verlaeufe: Object.fromEntries(Array.from({ length: 10 }, (_, i) =>
        [String(i + 1), [moved(3, "In review"), moved(2, "In progress"), moved(1, "Irgendwo")]])),
    },
    zuschnitt: {
      ausgabe: {
        bereiche: [{ name: "kit", nennend: 1, von: 2, hervorgehoben: true, kopplungsgrund: "gekoppelt" }, { name: "docs", nennend: 1, von: 2, hervorgehoben: false }],
        inventar: { dateien: 5, ohneTreffer: 2, freigestellt: [{ pfad: "LICENSE", grund: "Text" }], ohneZuordnung: ["neu.txt"] },
      },
    },
  };
}

test("[1497] die Texttabelle von wirksamkeit.mjs hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(WIRKSAMKEIT_TEXTE), []);
  assert.ok(Object.keys(WIRKSAMKEIT_TEXTE.de).length > 60, "die Tabelle traegt die Texte des Moduls");
});

test("[1497] die englische Haelfte der Tabelle traegt keine deutschen Woerter", () => {
  assert.deepEqual(deutschImEnglischen(WIRKSAMKEIT_TEXTE), []);
});

test("[1497] jeder deutsche Text von wirksamkeit.mjs geht ueber den Texthelfer", () => {
  assert.deepEqual(deutschAmHelferVorbei("kit/wirksamkeit.mjs", WIRKSAMKEIT_TEXTE, ["nicht gelaufen", "Verschoben nach ", "ohne-bereich", "ohne-zuordnung"]), []);
});

test("[1497] englisch: Bericht, Befund und Reparaturkandidaten", () => {
  spracheFestlegen("en");
  mitProjekt(vollerStand(), (dir) => {
    const e = auswerten(dir);
    const md = bericht(dir);
    assert.match(md, /^# Effectiveness of the checks$/m);
    assert.match(md, /^## Checks$/m);
    assert.match(md, /^\| Command \| State \| Runs \| Findings \| Flaky \| Duration \| Run days \|$/m);
    assert.match(md, /\| `npm test` \| run, never flagged \| 12 \|/);
    assert.match(md, /\| `nie-gelaufen` \| not run \| 0 \|/);
    assert.match(md, /^Repair candidate: `npx eslint \.` — 3 flaky runs in the time window \(from 3\)\.$/m);
    assert.match(md, /^## Mean check time per card$/m);
    assert.match(md, /^## Areas$/m);
    assert.match(md, /yes — forced by coupling: gekoppelt/);
    assert.match(md, /^### Inventory$/m);
    assert.match(md, /^## Return rate$/m);
    assert.match(md, /^Of 10 cards that came to 'In review' in the window, 10 moves went back into work — return rate 100 %\.$/m);
    assert.match(md, /^## Findings$/m);
    assert.match(md, /^## Measurement limit$/m);
    assert.match(md, /Trigger unknown/);
    assert.match(md, /before recording/);

    assert.equal(e.pruefungen.find((p) => p.cmd === "npm test").zustand, "nie beanstandet", "der Zustand im Stand bleibt Vertrag (E14)");
    assert.equal(e.pruefungen.find((p) => p.cmd === "nie-gelaufen").zustand, "nicht gelaufen");
    assert.deepEqual(e.befund.map((b) => b.schwelle), ["nieBeanstandet", "ruecklaufquote"], "die Schwellenschluessel bleiben Vertrag");
    assert.match(e.befund[0].text, /^The check 'npm test' ran 12 times \(on 3 run days, 8 min 0 s\) and did not flag anything a single time\.$/);
    assert.match(befundText(e), /^Evaluation of .+, window 30 days since .+\.\n- The check/);
    assert.equal(kandidatenText(e), "Repair candidate: npx eslint . — 3 flaky runs in the time window\n");
  });
  assert.equal(zahlform(12345.5, 1), "12,345.5");
});

test("[1497] englisch: Vermerke der Quote, des Zuschnitts und der Config", () => {
  spracheFestlegen("en");
  mitProjekt({ zeilen: null, config: { issueTracker: "local" }, zuschnitt: { ausgabe: {} } }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.ruecklauf.grund, "the tracker 'local' keeps no history (only a synthetic CREATED entry, never a move)");
    assert.equal(e.bereiche.vermerk, "the output carries no list 'bereiche'");
    const md = bericht(dir);
    assert.match(md, /^There is no execution log \(\.claude\/ausfuehrungen\.tsv is missing\) — no check carries a measured run\.$/m);
    assert.match(md, /^The return rate does not apply: the tracker 'local'/m);
  });
  mitProjekt({ zeilen: [], bewegungen: [bewegung({ tage: 1 })], board: { exit: 3, stderr: "kaputt" } }, (dir) => {
    assert.equal(auswerten(dir).ruecklauf.grund, "the history call of the board failed: kaputt");
  });
});

test("[1497] englisch: Hilfe und Fehler nennen die englischen Befehlsnamen", () => {
  spracheFestlegen("en");
  mitProjekt({}, (dir) => {
    const hilfe = wirksamkeit(dir, "--help").stdout;
    assert.match(hilfe, /— Effectiveness of the checks/);
    assert.match(hilfe, /node wirksamkeit\.mjs evaluate \[--window <days>\]/);
    assert.match(hilfe, /^candidates /m);
    assert.match(wirksamkeit(dir, "finding", "x").stderr, /^Error: 'finding' takes no arguments, got 'x'\.$/m);
    assert.match(wirksamkeit(dir, "candidates", "x").stderr, /^Error: 'candidates' takes no arguments, got 'x'\.$/m);
    assert.match(wirksamkeit(dir, "gibtsnicht").stderr, /^Error: Unknown command: 'gibtsnicht'\. Expected: evaluate, finding or candidates$/m);
    const falsch = JSON.parse(wirksamkeit(dir, "evaluate", "--window", "0").stdout);
    assert.deepEqual(Object.keys(falsch), ["ok", "fehler"], "Feldnamen der Fehlerausgabe bleiben Vertrag");
    assert.equal(falsch.fehler, "--window expects a whole number greater than zero, got '0'.");
    assert.equal(JSON.parse(wirksamkeit(dir, "evaluate", "--zuviel").stdout).fehler, "Unknown argument: '--zuviel'");
  });
});

test("[1497] die deutsche Vorgabe bleibt: ohne Spracheinstellung spricht der Bericht Deutsch", () => {
  spracheFestlegen("de");
  mitProjekt(vollerStand(), (dir) => {
    auswerten(dir);
    assert.match(bericht(dir), /^# Wirksamkeit der Pruefungen$/m);
    assert.match(bericht(dir), /^Reparaturkandidat: `npx eslint \.` — 3 Wackler im Zeitfenster \(ab 3\)\.$/m);
  });
  assert.equal(zahlform(12345.5, 1), "12.345,5");
});

/**
 * Die festen Bruchstuecke der deutschen Texte, die im Englischen nicht vorkommen: Was davon in
 * einer Ausgabe steht, ist eine deutsche Meldung. Kurze Bruchstuecke sagen nichts ueber die
 * Sprache und bleiben aussen vor.
 */
function deutscheBruchstuecke() {
  const englisch = Object.values(WIRKSAMKEIT_TEXTE.en).join("\n");
  const stuecke = new Set();
  for (const wert of Object.values(WIRKSAMKEIT_TEXTE.de)) {
    for (const teil of wert.split(/\{[A-Za-z_]\w*\}|\n/)) {
      const t = teil.trim();
      if (t.length >= 8 && !englisch.includes(t)) stuecke.add(t);
    }
  }
  return [...stuecke];
}

/** Die Textwerte eines JSON-Stands ohne die Vertragswerte (E14): Zustaende und Schwellenschluessel. */
function freitexte(wert, schluessel = null) {
  if (["zustand", "schwelle", "status"].includes(schluessel)) return [];
  if (typeof wert === "string") return [wert];
  if (Array.isArray(wert)) return wert.flatMap((w) => freitexte(w));
  if (wert && typeof wert === "object") return Object.entries(wert).flatMap(([k, w]) => freitexte(w, k));
  return [];
}

test("[1497] ein englisches Projekt sieht keine deutsche Meldung — echter Prozess, nur die verteilten Dateien", () => {
  const stand = vollerStand();
  mitProjekt({ ...stand, config: { ...stand.config, language: "en", issueTracker: "local" } }, (dir) => {
    const kit = join(dir, ".claude", "kit");
    mkdirSync(kit, { recursive: true });
    copyFileSync(join(KIT, "wirksamkeit.mjs"), join(kit, "wirksamkeit.mjs"));
    cpSync(join(KIT, "board"), join(kit, "board"), { recursive: true });
    cpSync(join(KIT, "texte"), join(kit, "texte"), { recursive: true });

    const cli = (...args) => spawnSync(process.execPath, [join(kit, "wirksamkeit.mjs"), ...args], { cwd: dir, encoding: "utf-8" });
    const auswertung = cli("auswerten");
    assert.equal(auswertung.status, 0, auswertung.stderr);
    const ausgaben = [
      freitexte(JSON.parse(auswertung.stdout)).join("\n"), bericht(dir), cli("befund").stdout, cli("kandidaten").stdout,
      cli("--help").stdout, cli("befund", "x").stderr, cli("kandidaten", "x").stderr, cli("unbekannt").stderr,
      cli("auswerten", "--fenster", "x").stdout, cli("auswerten", "--zuviel").stdout,
    ];
    assert.match(bericht(dir), /^# Effectiveness of the checks$/m, "ohne Repo-Kontext laeuft der Bericht englisch");
    const alles = ausgaben.join("\n");
    const gefunden = deutscheBruchstuecke().filter((s) => alles.includes(s));
    assert.deepEqual(gefunden, [], "deutsche Meldung in einem englischen Projekt");
  });
});

// --- kit/findings.mjs (Issue #1498) ------------------------------------------------------

// Ein Befunde-Kommentar von /issue-review mit englischem Kopf und ohne Reviewer-Kopf: Er loest
// die Meldung `keine-pruefer`, die Angabe `reviewer-kopf` und eine fremde Art aus.
const FUNDTEXT = [
  "## Plan-Review, Round 1",
  "",
  "#### WICHTIG",
  "**Missing case**",
  "Gegenprobe: a line in kit/x.mjs — geprueft, bestaetigt",
  "Art: luecke",
  "Uebernahme: uebernommen",
  "",
  "**Second one**",
  "Art: erfunden",
  "",
].join("\n");

/** Eine Protokollzeile, wie `buchen` sie schreibt — sieben Spalten, Art in Spalte 5. */
function befundeZeile(art, { stufe = "plan", vergleich = "-" } = {}) {
  return `2026-09-22T00:00:00.000Z\t${stufe}\t797\treviewer\t${art}\tWICHTIG\t${vergleich}`;
}

/** Ein Wegwerf-Projekt mit Fundtext, Protokoll und optional Vorschlagsstand und Config. */
function mitBefundeProjekt({ protokoll = [], vorschlaege = null, config = null } = {}, fn) {
  const dir = mkdtempSync(join(tmpdir(), "befunde-en-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, "funde.md"), FUNDTEXT);
  if (protokoll.length > 0) writeFileSync(join(dir, ".claude", "befunde.tsv"), protokoll.map((z) => `${z}\n`).join(""));
  if (vorschlaege) writeFileSync(join(dir, ".claude", "befunde-vorschlaege.json"), JSON.stringify(vorschlaege));
  if (config) writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `findings.mjs` im selben Prozess mit einem Stub-Adapter, der jeden Aufruf samt Datei festhaelt. */
function befunde(dir, argv, aufrufe = []) {
  const board = (args) => {
    const i = args.findIndex((a) => a === "--body-file" || a === "--text-file");
    aufrufe.push({ args, text: i === -1 ? null : readFileSync(args[i + 1], "utf-8") });
    return { status: 0, stdout: `${JSON.stringify({ id: "812" })}\n`, stderr: "" };
  };
  return befundeAufrufen(argv, { cwd: dir, board, jetzt: () => new Date("2026-10-11T12:00:00.000Z") });
}

test("[1498] die Texttabelle von findings.mjs hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(BEFUNDE_TEXTE), []);
  assert.ok(Object.keys(BEFUNDE_TEXTE.de).length > 80, "die Tabelle traegt die Texte des Moduls");
});

test("[1498] die englische Haelfte der Tabelle von findings.mjs traegt keine deutschen Woerter", () => {
  assert.deepEqual(deutschImEnglischen(BEFUNDE_TEXTE), []);
});

// Die Tabelle liegt seit Issue #1524 in kit/texte/; gescannt wird das Modul ohne sie.
test("[1498] jeder deutsche Text von findings.mjs geht ueber den Texthelfer", () => {
  assert.deepEqual(deutschAmHelferVorbei("kit/findings.mjs", null,
    ["nicht", "— nicht geprueft", "keine-pruefer", "nicht-vergleichbar", "(?:nicht gefunden|not found)", "karte-fehlt"]), []);
});

test("[1498] englisch: arten erklaert, pruefen meldet — Artnamen, Angaben und Formwoerter bleiben Vertrag", () => {
  spracheFestlegen("en");
  mitBefundeProjekt({}, (dir) => {
    const liste = JSON.parse(befunde(dir, ["kinds"]).stdout);
    assert.equal(liste.arten[3].name, "luecke", "die Artnamen bleiben Vertrag");
    assert.equal(liste.arten[3].erklaerung, "A case, step or area needed for the goal is missing entirely.");

    const geprueft = JSON.parse(befunde(dir, ["check", "--file", "funde.md"]).stdout);
    assert.deepEqual(geprueft.meldungen.map((m) => m.angabe), ["keine-pruefer"]);
    assert.match(geprueft.meldungen[0].meldung, /^The text carries not a single reviewer head '### Reviewer <n>: <role>, <model>'/);
    const meldung = (angabe, fund) => geprueft.eintraege.find((e) => e.angabe === angabe && e.fund === fund).meldung;
    assert.equal(meldung("stand", 2), "The state of the counter-check is missing — expected is '— geprueft, bestaetigt' or '— nicht geprueft' at the end of the line.");
    assert.equal(meldung("art", 2), "The kind 'erfunden' is not in the list; valid are the names from 'findings kinds'.");
    assert.match(meldung("reviewer-kopf", 1), /books the role as 'unbekannt'\.$/);
  });
});

test("[1498] englisch: die Idee am Board traegt englisches Praefix, Kopf und Text", () => {
  spracheFestlegen("en");
  mitBefundeProjekt({ protokoll: [befundeZeile("form"), befundeZeile("form"), befundeZeile("form")] }, (dir) => {
    const aufrufe = [];
    const ergebnis = JSON.parse(befunde(dir, ["suggest", "--kind", "form"], aufrufe).stdout);
    assert.equal(ergebnis.titel, "[Idea] Machine check for defect kind form?");
    const body = aufrufe[0].text;
    assert.match(body, /^## Context$/m);
    assert.match(body, /^Author-Model: kit\/findings\.mjs$/m);
    assert.match(body, /^\| Time \| Stage \| Card \| Role \| Severity \|$/m);
    assert.match(body, /^Not all findings of this kind can be caught by the same check\.$/m);
    assert.match(body, /`node \.claude\/kit\/findings\.mjs suggest --rejected form`/);
  });
  mitBefundeProjekt({}, (dir) => {
    assert.equal(JSON.parse(befunde(dir, ["suggest", "--kind", "luecke"]).stdout).grund,
      "'luecke' is a judgement kind — a review judges it, a machine check does not catch it. No suggestion is created.");
    assert.equal(JSON.parse(befunde(dir, ["suggest", "--kind", "form"]).stdout).grund,
      "0 occurrences above the zero point 0 do not reach the threshold 3.");
  });
});

test("[1498] englisch: Bericht und Befund; der Vorschlagsstand im Stand bleibt Vertrag", () => {
  spracheFestlegen("en");
  const protokoll = [befundeZeile("form"), befundeZeile("form"), befundeZeile("form"), befundeZeile("luecke", { stufe: "code", vergleich: "nicht-vergleichbar" })];
  mitBefundeProjekt({ protokoll, vorschlaege: { form: { karte: "812", stand: "offen", zaehlerstand: 3, nullpunkt: 0 } } }, (dir) => {
    const stand = JSON.parse(befunde(dir, ["evaluate"]).stdout);
    assert.deepEqual(stand.arten.find((a) => a.art === "form").vorschlag, { stand: "offen", karte: "812", ideaId: null });
    assert.equal(stand.befund[0].text, "`luecke`: 1 occurrences (code 1) — no suggestion (judgement kind).");
    assert.equal(stand.befund[1].text, "`form`: 3 occurrences (plan 3), threshold 3 reached — suggestion open (#812).");
    assert.equal(stand.befund[2].text, "Stage `code`: 0 on a state with green required checks, 1 marked as `nicht-vergleichbar`.");
    const md = readFileSync(join(dir, ".claude", "befunde.md"), "utf-8");
    assert.match(md, /^# Findings of the model reviews$/m);
    assert.match(md, /^\| Kind \| Occurrences \| fachlich \| plan \| issue \| code \| code green \| code not comparable \|/m);
    assert.match(md, /\| `form` \| 3 \| 0 \| 3 \| 0 \| 0 \| 0 \| 0 \| 3 \| yes \| suggestion open \(#812\) \|/);
    assert.match(md, /^## Stage code$/m);
    assert.match(befunde(dir, ["finding"]).stdout, /^Findings of the model reviews — evaluation of 2026-10-11T12:00:00\.000Z: 4 occurrences in 2 kinds, threshold 3\.\n- `luecke`/);
  });
});

test("[1498] englisch: Hilfe und Fehler nennen die englischen Befehlsnamen", () => {
  spracheFestlegen("en");
  mitBefundeProjekt({}, (dir) => {
    const hilfe = befunde(dir, ["--help"]).stdout;
    assert.match(hilfe, /— form and kinds of findings/);
    assert.match(hilfe, /node findings\.mjs record --file <path> --stage <requirement\|plan\|issue\|code> --card <n>/);
    const fehler = (argv) => JSON.parse(befunde(dir, argv).stdout);
    assert.deepEqual(Object.keys(fehler(["kinds", "x"])), ["ok", "fehler"], "Feldnamen der Fehlerausgabe bleiben Vertrag");
    assert.equal(fehler(["kinds", "x"]).fehler, "'kinds' takes no arguments, got 'x'.");
    assert.equal(fehler(["check"]).fehler, "'check' needs --file <path>.");
    assert.equal(fehler(["record", "--file", "f", "--stage", "x", "--card", "1"]).fehler, "Unknown stage: 'x'. Expected: requirement, plan, issue, code.");
    assert.equal(fehler(["suggest", "--kind", "x"]).fehler, "Unknown kind: 'x'. Valid are the names from 'findings kinds'.");
    assert.equal(fehler(["check", "--file", "fehlt.md"]).fehler, "File not readable: fehlt.md (ENOENT).");
    assert.equal(fehler(["gibtsnicht"]).fehler, "Unknown command: 'gibtsnicht'. Expected: kinds, check, record, suggest, evaluate or finding.");
    assert.equal(befunde(dir, ["finding", "x"]).stderr, "Error: 'finding' takes no arguments, got 'x'.\n");
  });
});

test("[1498] die deutsche Vorgabe bleibt: Idee, Befund und Meldung sprechen Deutsch, das Praefix ist englisch (Issue #1552)", () => {
  spracheFestlegen("de");
  mitBefundeProjekt({ protokoll: [befundeZeile("form"), befundeZeile("form"), befundeZeile("form")] }, (dir) => {
    assert.equal(JSON.parse(befunde(dir, ["suggest", "--kind", "form"]).stdout).titel, "[Idea] Maschinelle Pruefung fuer Mangel-Art form?");
    befunde(dir, ["evaluate"]);
    assert.match(befunde(dir, ["finding"]).stdout, /^Befunde der Modell-Pruefungen — Auswertung vom .+: 3 Vorkommen in 1 Art, Schwelle 3\.$/m);
    assert.equal(JSON.parse(befunde(dir, ["kinds", "x"]).stdout).fehler, "'kinds' nimmt keine Argumente, bekam 'x'.");
  });
});

/** Die festen Bruchstuecke der deutschen Texte von findings.mjs, die im Englischen nicht vorkommen. */
function deutscheBefundeBruchstuecke() {
  const englisch = Object.values(BEFUNDE_TEXTE.en).join("\n");
  const stuecke = new Set();
  for (const wert of Object.values(BEFUNDE_TEXTE.de)) {
    for (const teil of wert.split(/\{[A-Za-z_]\w*\}|\n/)) {
      const t = teil.trim();
      if (t.length >= 8 && !englisch.includes(t)) stuecke.add(t);
    }
  }
  return [...stuecke];
}

test("[1498] ein englisches Projekt sieht von findings.mjs keine deutsche Meldung — echter Prozess, nur die verteilten Dateien", () => {
  const protokoll = [befundeZeile("form"), befundeZeile("form"), befundeZeile("form"), befundeZeile("luecke", { stufe: "code", vergleich: "nicht-vergleichbar" }), "kaputt"];
  mitBefundeProjekt({ protokoll, vorschlaege: { form: { karte: "812", stand: "offen", zaehlerstand: 3, nullpunkt: 0 } }, config: { language: "en", issueTracker: "local" } }, (dir) => {
    const kit = join(dir, ".claude", "kit");
    mkdirSync(kit, { recursive: true });
    copyFileSync(join(KIT, "findings.mjs"), join(kit, "findings.mjs"));
    cpSync(join(KIT, "board"), join(kit, "board"), { recursive: true });
    cpSync(join(KIT, "texte"), join(kit, "texte"), { recursive: true });

    const cli = (...args) => spawnSync(process.execPath, [join(kit, "findings.mjs"), ...args], { cwd: dir, encoding: "utf-8" });
    const auswertung = cli("evaluate");
    assert.equal(auswertung.status, 0, auswertung.stderr);
    const ausgaben = [
      freitexte(JSON.parse(auswertung.stdout)).join("\n"), readFileSync(join(dir, ".claude", "befunde.md"), "utf-8"), cli("finding").stdout,
      cli("kinds").stdout, cli("check", "--file", "funde.md").stdout, cli("suggest", "--kind", "luecke").stdout,
      cli("--help").stdout, cli("finding", "x").stderr, cli("kinds", "x").stdout, cli("unbekannt").stdout, cli("unbekannt").stderr,
      cli("record", "--file", "funde.md", "--stage", "code", "--card", "1").stdout,
    ];
    const alles = ausgaben.join("\n");
    assert.match(alles, /^# Findings of the model reviews$/m, "ohne Repo-Kontext laeuft der Bericht englisch");
    assert.match(alles, /checks\.mjs is not next to findings\.mjs/, "der fehlende Nachbar meldet sich englisch");
    const gefunden = deutscheBefundeBruchstuecke().filter((s) => alles.includes(s));
    assert.deepEqual(gefunden, [], "deutsche Meldung in einem englischen Projekt");
  });
});

// --- kit/worktree.mjs (Issue #1499) -----------------------------------------------------

// Fuer worktree bleiben dazu Vertrag (E14): die Feldnamen der JSON-Ausgaben, die Werte von
// --ergebnis (`gruen`, `gruen-offen`, `rot`) und --fetch (`ok`, `fehlgeschlagen`), die Namen
// der Referenz und der Dateien unter `.claude/`. Was night/kitstand.mjs meldet, traegt dessen
// eigene Tabelle (Issue #1490).

const WORKTREE = join(KIT, "worktree.mjs");

/** Ein Wegwerf-Repo mit einem Commit und einer Config; `git` fehlt, wenn `repo` falsch ist. */
function mitWorktreeProjekt({ config = { language: "en", issueTracker: "local" }, repo = true } = {}, fn) {
  const dir = mkdtempSync(join(tmpdir(), "worktree-en-"));
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(config));
  const git = (...a) => {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  };
  if (repo) {
    writeFileSync(join(dir, ".gitignore"), ".claude/*\n!.claude/workflow.config.json\n");
    writeFileSync(join(dir, "VERSION"), "1.0.0\n");
    git("init", "-q");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "T");
    git("add", "-A");
    git("commit", "-q", "-m", "erster");
  }
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Startet `werkzeug` im Projekt; liefert stdout, stderr, Exitcode und das JSON der letzten Zeile. */
function worktree(dir, werkzeug, ...args) {
  const res = spawnSync(process.execPath, [werkzeug, ...args], { cwd: dir, encoding: "utf-8" });
  const letzte = res.stdout.split("\n").findLast((z) => z.trim() !== "") ?? "";
  let stand = null;
  try {
    stand = JSON.parse(letzte);
  } catch { /* keine JSON-Zeile, etwa bei der Hilfe */ }
  return { ...res, stand };
}

test("[1499] die Texttabelle von worktree.mjs hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(WORKTREE_TEXTE), []);
  assert.ok(Object.keys(WORKTREE_TEXTE.de).length >= 12, "die Tabelle traegt die Texte des Moduls");
});

test("[1499] die englische Haelfte der Tabelle von worktree.mjs traegt keine deutschen Woerter", () => {
  assert.deepEqual(deutschImEnglischen(WORKTREE_TEXTE), []);
});

test("[1499] jeder deutsche Text von worktree.mjs geht ueber den Texthelfer", () => {
  assert.deepEqual(deutschAmHelferVorbei("kit/worktree.mjs", null), []);
});

test("[1499] englisch: die Hilfe nennt die englischen Unterkommandos und Optionen", () => {
  mitWorktreeProjekt({ repo: false }, (dir) => {
    const hilfe = worktree(dir, WORKTREE, "--help").stdout;
    assert.match(hilfe, /— worktree for the release skills$/m);
    assert.match(hilfe, /^ {2}create \[--prefix <p>\] \[--ref <ref>\] \[--issue <n>\]/m);
    assert.match(hilfe, /^ {2}record-preparation <path> --result <gruen\|gruen-offen\|rot>$/m, "die Werte von --result bleiben Vertrag");
    assert.match(hilfe, /^ {2}check-preparation \[--discard\]/m);
    assert.match(hilfe, /^ {2}in <path> -- <command> \[arguments\]/m);
    assert.match(hilfe, /^The last line of the output is always JSON/m);
  });
});

test("[1499] englisch: die Fehler von worktree.mjs; die Feldnamen bleiben Vertrag", () => {
  mitWorktreeProjekt({}, (dir) => {
    const fehler = (...args) => {
      const res = worktree(dir, WORKTREE, ...args);
      assert.equal(res.status, 1, `${args.join(" ")} haette scheitern muessen: ${res.stdout}`);
      assert.deepEqual(Object.keys(res.stand), ["ok", "fehler"], "Feldnamen der Fehlerausgabe bleiben Vertrag");
      return res.stand.fehler;
    };
    assert.equal(fehler("remove"), "remove needs the path of the worktree");
    assert.equal(fehler("return"), "return needs the path of the worktree");
    assert.equal(fehler("record-preparation"), "record-preparation needs the path of the worktree");
    assert.equal(fehler("record-preparation", dir), "record-preparation needs --result <gruen|gruen-offen|rot>");
    assert.equal(fehler("in", dir), "in needs <path> -- <command> [arguments]");
    assert.equal(fehler("in", join(dir, "fehlt"), "--", "x"), `in: '${join(dir, "fehlt")}' is not a directory`);
    assert.match(fehler("in", dir, "--", "gibt-es-nicht-1499"), /^in: 'gibt-es-nicht-1499' could not be started \(/);
    assert.equal(fehler("gibtsnicht"),
      "unknown command 'gibtsnicht' — known are create, remove, in, catch-up-check, return, record-preparation, check-preparation");
  });
  mitWorktreeProjekt({ repo: false }, (dir) => {
    assert.match(worktree(dir, WORKTREE, "catch-up-check").stand.fehler, /^not a git repo: /);
  });
});

test("[1499] englisch: ein rotes installCommand meldet Kommando und Exit-Code", () => {
  const config = { language: "en", issueTracker: "local", installCommand: `"${process.execPath}" -e "process.exit(3)"` };
  mitWorktreeProjekt({ config }, (dir) => {
    const { status, stand } = worktree(dir, WORKTREE, "create", "--prefix", "wt1499");
    assert.equal(status, 1);
    assert.match(stand.fehler, /^installCommand '.+process\.exit\(3\)"' ended with exit code 3 — the worktree was torn down again$/);
  });
});

test("[1499] die deutsche Vorgabe bleibt: ohne Spracheinstellung spricht worktree.mjs Deutsch", () => {
  mitWorktreeProjekt({ config: {} }, (dir) => {
    assert.match(worktree(dir, WORKTREE, "--help").stdout, /— Worktree fuer die Release-Skills$/m);
    assert.equal(worktree(dir, WORKTREE, "entfernen").stand.fehler, "entfernen braucht den Pfad des Worktrees");
    assert.match(worktree(dir, WORKTREE, "gibtsnicht").stand.fehler, /^unbekanntes Kommando 'gibtsnicht' — bekannt sind anlegen, entfernen, im,/);
  });
});

/** Die festen Bruchstuecke der deutschen Texte von worktree.mjs, die im Englischen nicht vorkommen. */
function deutscheWorktreeBruchstuecke() {
  const englisch = Object.values(WORKTREE_TEXTE.en).join("\n");
  const stuecke = new Set();
  for (const wert of Object.values(WORKTREE_TEXTE.de)) {
    for (const teil of wert.split(/\{[A-Za-z_]\w*\}|\n/)) {
      const t = teil.trim();
      if (t.length >= 8 && !englisch.includes(t)) stuecke.add(t);
    }
  }
  return [...stuecke];
}

test("[1499] ein englisches Projekt sieht von worktree.mjs keine deutsche Meldung — echter Prozess, nur die verteilten Dateien", () => {
  const config = { language: "en", issueTracker: "local", installCommand: `"${process.execPath}" -e "process.exit(3)"` };
  mitWorktreeProjekt({ config }, (dir) => {
    const kit = join(dir, ".claude", "kit");
    mkdirSync(kit, { recursive: true });
    copyFileSync(WORKTREE, join(kit, "worktree.mjs"));
    cpSync(join(KIT, "night"), join(kit, "night"), { recursive: true });
    cpSync(join(KIT, "board"), join(kit, "board"), { recursive: true });
    cpSync(join(KIT, "texte"), join(kit, "texte"), { recursive: true });
    const werkzeug = join(kit, "worktree.mjs");

    const ausgaben = [
      ["--help"], ["anlegen", "--praefix", "wt1499"], ["entfernen"], ["rueckweg"], ["vorbereitung-festhalten"],
      ["vorbereitung-festhalten", dir], ["im", dir], ["im", join(dir, "fehlt"), "--", "x"],
      ["im", dir, "--", "gibt-es-nicht-1499"], ["unbekannt"],
    ].map((args) => {
      const res = worktree(dir, werkzeug, ...args);
      return `${res.stdout}\n${res.stderr}`;
    });
    const alles = ausgaben.join("\n");
    assert.match(alles, /— worktree for the release skills$/m, "ohne Repo-Kontext laeuft die Hilfe englisch");
    assert.match(alles, /the worktree was torn down again/, "der rote Installationslauf meldet sich englisch");
    const gefunden = deutscheWorktreeBruchstuecke().filter((s) => alles.includes(s));
    assert.deepEqual(gefunden, [], "deutsche Meldung in einem englischen Projekt");
  });
});
