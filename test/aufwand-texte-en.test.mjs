// Ablauf-Pruefung: Ob ein englisches Projekt ohne Repo-Kontext nur englische Meldungen sieht, belegt nur ein echter Prozess aus den verteilten Dateien.
//
// Meldungen zweisprachig: kit/aufwand.mjs und kit/preise.mjs (Issue #1452, Plan #1420 E13/E14).
//
// aufwand.mjs traegt seine Texte in einer Tabelle `{ de, en }` und gibt sie ueber den
// Texthelfer aus kit/board/namen.mjs aus. Hier steht, was das Paket zusaetzlich zu den
// deutschen Wortlaut-Tests verlangt:
//
//   - Paritaet: je Sprache dieselben Schluessel und Platzhalter.
//   - Englische Stichproben: Bericht, Befund, Auskunft, Hilfe und Fehler.
//   - Ein englisches Projekt sieht keine deutsche Meldung — geprueft an einem echten Prozess
//     aus einem Wegwerf-Verzeichnis, in dem nur die verteilten Dateien liegen.
//   - Der Maschinenvertrag (E14) bleibt: Feldnamen und Vokabular des Ergebnisstands.
//
// preise.mjs ist reine Pflegedatei ohne eine einzige Ausgabe an Menschen; ihr Test belegt,
// dass das so bleibt — eine Ausgabe dort ginge an der Texttabelle vorbei.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { TEXTE, aufrufen, befundText, berichtText, zahlform } from "../kit/aufwand.mjs";
import * as preise from "../kit/preise.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { mitProjekt, lauf, einheit, pruefstand, bericht } from "./helpers/aufwand-fixture.mjs";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..", "kit");

afterEach(() => spracheFestlegen(null));

/**
 * Ein Stand, der moeglichst viele Texte ausloest: Befunde ueber allen vier Schwellen, eine
 * Einheit ohne Preissatz, eine ohne Zeiten, ein unvollstaendiger Lauf, Auskunftszeiten.
 */
function vollerStand() {
  return [
    lauf("2026-09-02-100000", {
      complete: false,
      abschluss: "abgebrochen",
      zielUmsetzungMin: 1,
      einheiten: [
        einheit(1, {
          umsetzung: true,
          auskunft: { ms: 90_000, aufrufe: 4 },
          zeiten: { dauerMs: 600_000, nachdenkenMs: 100_000, werkzeugMs: 450_000 },
          pruefung: pruefstand({ laufen: [{ cmd: "node --test", ergebnis: "gruen", dauerMs: 90_000 }, { cmd: "npx eslint .", ergebnis: "gruen", dauerMs: 1_000 }] }),
        }),
        einheit(2, { modell: "fremd-modell", umsetzung: false, zeitlimitBeendet: true, wartendBeendet: true }),
        einheit(3, { zeiten: null, effort: "high", eingabeTokens: null, ausgabeTokens: null, cacheErzeugtTokens: null, cacheGelesenTokens: null }),
      ],
    }),
    lauf("2026-09-01-100000", { einheiten: [einheit(4, { stufeVerwendet: undefined, endStatus: "backlog" })] }),
  ];
}

test("[1452] die Texttabelle von aufwand.mjs hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
  assert.ok(Object.keys(TEXTE.de).length > 50, "die Tabelle traegt die Texte des Moduls");
});

test("[1452] preise.mjs gibt nichts an Menschen aus: keine Konsole, keine Texte", () => {
  const quelle = readFileSync(join(KIT, "preise.mjs"), "utf-8");
  assert.doesNotMatch(quelle, /process\.(stdout|stderr)|console\./, "eine Ausgabe in preise.mjs ginge an der Texttabelle vorbei");
  const texte = Object.entries(preise).filter(([, wert]) => typeof wert === "string");
  assert.deepEqual(texte.map(([name]) => name).sort(), ["KIT_VERSION", "PREISE_STAND"], "nur Stand und Version sind Text");
});

test("[1452] englische Stichproben: Bericht, Zahlform und Befund", () => {
  spracheFestlegen("en");
  mitProjekt({ laeufe: vollerStand() }, (dir) => {
    const res = aufrufen(["auswerten"], { cwd: dir, jetzt: () => new Date("2026-09-03T08:00:00Z") });
    assert.equal(res.status, 0, res.stderr);
    const md = bericht(dir);
    assert.match(md, /^# Process effort$/m);
    assert.match(md, /^Evaluation of 2026-09-03T08:00:00\.000Z\.$/m);
    assert.match(md, /^## Time$/m);
    assert.match(md, /^\| Item \| Value \| Basis \|$/m);
    assert.match(md, /^## Findings$/m);
    assert.match(md, /percent/);
    assert.match(md, /across 2 runs/);
    assert.match(md, /not regularly completed \(abgebrochen\)/, "das Vokabular des Ergebnisstands bleibt unuebersetzt (E14)");

    const e = JSON.parse(res.stdout);
    assert.ok(e.befund.length > 0, "der Stand loest Befunde aus");
    assert.ok(e.befund.every((b) => /^[A-Z]/.test(b.text) && !/Pruef|Prozent|Laeufe/.test(b.text)), e.befund.map((b) => b.text).join("\n"));
    assert.deepEqual(Object.keys(e.befund[0]).sort(), ["grenze", "laeufe", "schwelle", "text", "wert"], "Feldnamen bleiben Vertrag");
    assert.match(befundText(e), /^Evaluation of 2026-09-03T08:00:00\.000Z across 2 runs to 2026-09-02-100000\.\n- /);
  });
  assert.equal(zahlform(12345.5, 1), "12,345.5");
  assert.equal(zahlform(-1234567, 0), "-1,234,567");
});

test("[1452] englische Stichproben: leerer Bericht, Auskunft, Hilfe und Fehler", () => {
  spracheFestlegen("en");
  assert.match(berichtText({ laeufe: { einbezogen: 0, unlesbar: [] }, erzeugtAm: "x", dauerMs: 3 }),
    /There is no result state — nothing to evaluate\./);
  mitProjekt({ laeufe: [] }, (dir) => {
    const auskunft = aufrufen(["auskunft", "fehlt.jsonl"], { cwd: dir });
    assert.equal(auskunft.status, 1);
    assert.match(auskunft.stdout, /^fehlt\.jsonl: not readable \(ENOENT\) — not measured$/m);
    assert.match(auskunft.stdout, /^Total: not measured \(1 not measured\)$/m);

    assert.match(aufrufen(["--help"], { cwd: dir }).stdout, /Process effort/);
    assert.match(aufrufen(["befund", "--zuviel"], { cwd: dir }).stderr, /^Error: 'befund' takes no arguments, got '--zuviel'\.$/m);
    assert.match(aufrufen(["gibtsnicht"], { cwd: dir }).stderr, /^Error: Unknown command: 'gibtsnicht'/m);
    const falsch = JSON.parse(aufrufen(["auswerten", "--laeufe", "0"], { cwd: dir }).stdout);
    assert.deepEqual(Object.keys(falsch), ["ok", "fehler"], "Feldnamen der Fehlerausgabe bleiben Vertrag");
    assert.match(falsch.fehler, /^--laeufe expects a whole number greater than zero/);
  });
});

test("[1452] die deutsche Vorgabe bleibt: ohne Spracheinstellung spricht der Bericht Deutsch", () => {
  spracheFestlegen("de");
  mitProjekt({ laeufe: vollerStand() }, (dir) => {
    assert.equal(aufrufen(["auswerten"], { cwd: dir }).status, 0);
    assert.match(bericht(dir), /^# Aufwand des Prozesses$/m);
  });
  assert.equal(zahlform(12345.5, 1), "12.345,5");
});

/**
 * Die festen Bruchstuecke der deutschen Texte, die im Englischen nicht vorkommen: Was davon
 * in einer Ausgabe steht, ist eine deutsche Meldung. Kurze Bruchstuecke ("min", "| ---")
 * sagen nichts ueber die Sprache und bleiben aussen vor.
 */
function deutscheBruchstuecke() {
  const englisch = Object.values(TEXTE.en).join("\n");
  const stuecke = new Set();
  for (const wert of Object.values(TEXTE.de)) {
    for (const teil of wert.split(/\{[A-Za-z_]\w*\}|\n/)) {
      const t = teil.trim();
      if (t.length >= 8 && !englisch.includes(t)) stuecke.add(t);
    }
  }
  return [...stuecke];
}

/**
 * Die Textwerte eines JSON-Stands. Feldnamen sind Vertrag (E14) und zaehlen nicht; ebenso die
 * Werte unter `schwelle`, `nichtBestimmbar` und `zeitart` — sie nennen Schwellen und Zeitarten
 * mit ihrem Schluessel, nicht in Worten.
 */
function freitexte(wert, schluessel = null) {
  if (["schwelle", "nichtBestimmbar", "zeitart"].includes(schluessel)) return [];
  if (typeof wert === "string") return [wert];
  if (Array.isArray(wert)) return wert.flatMap((w) => freitexte(w));
  if (wert && typeof wert === "object") return Object.entries(wert).flatMap(([k, w]) => freitexte(w, k));
  return [];
}

test("[1452] ein englisches Projekt sieht keine deutsche Meldung — echter Prozess, nur die verteilten Dateien", () => {
  mitProjekt({ laeufe: vollerStand(), config: { language: "en" } }, (dir) => {
    const kit = join(dir, ".claude", "kit");
    mkdirSync(kit, { recursive: true });
    copyFileSync(join(KIT, "aufwand.mjs"), join(kit, "aufwand.mjs"));
    copyFileSync(join(KIT, "preise.mjs"), join(kit, "preise.mjs"));
    cpSync(join(KIT, "board"), join(kit, "board"), { recursive: true });
    writeFileSync(join(dir, "kaputt.jsonl"), "kein json\n", "utf-8");

    const aufwand = join(kit, "aufwand.mjs");
    const cli = (...args) => spawnSync(process.execPath, [aufwand, ...args], { cwd: dir, encoding: "utf-8" });
    const auswerten = cli("auswerten");
    assert.equal(auswerten.status, 0, auswerten.stderr);
    const ausgaben = [
      freitexte(JSON.parse(auswerten.stdout)).join("\n"), bericht(dir), cli("befund").stdout, cli("--help").stdout,
      cli("auskunft", "fehlt.jsonl", "kaputt.jsonl").stdout, cli("auskunft").stderr,
      cli("befund", "x").stderr, cli("unbekannt").stderr, cli("auswerten", "--laeufe", "x").stdout,
    ];
    assert.match(bericht(dir), /^# Process effort$/m, "ohne Repo-Kontext laeuft der Bericht englisch");
    const alles = ausgaben.join("\n");
    const gefunden = deutscheBruchstuecke().filter((s) => alles.includes(s));
    assert.deepEqual(gefunden, [], "deutsche Meldung in einem englischen Projekt");
  });
});
