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
// vollstaendig; die Teile fuer die Werkzeuge befunde und worktree ergaenzen diese Datei.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { TEXTE as WIRKSAMKEIT_TEXTE, befundText, kandidatenText, zahlform } from "../kit/wirksamkeit.mjs";
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
