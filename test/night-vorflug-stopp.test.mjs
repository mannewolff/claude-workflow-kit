// Ungedeckte Wege rund um Vorflug und Prueflauf (Issue #1096).
//
// Ein echter Lauf von kit/night.mjs gegen ein Wegwerf-Repo mit lokalem Tracker, die
// Sessions und der Vorflug als Fakes. Geprueft wird das sichtbare Verhalten — Exit-Code,
// Protokollsatz, Ergebnisstand, Kommentar am Board —, nicht die Zeilen: Die Laufstand-Pakete
// aendern night.mjs rund um Vorflug und Prueflauf weiter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { KLAEREN_LABEL } from "../kit/night.mjs";
import {
  NUR_POSIX, VORFLUG_OK, run, board, mitProjekt, fachplan, sessions, stand, umgebung, pruefUmgebung,
} from "./helpers/kette-fixture.mjs";

const PRUEF_LABEL = "kit:pruefen";
const BUDGET = { label: PRUEF_LABEL, pruefungMin: 25, kostenUsd: 25 };
const HARTER_STOPP = "HARTER STOPP: die Vorflug-Session hat den Working Tree veraendert";

/** Ein Vorflug, der meldet wie VORFLUG_OK, aber vorher eine Datei in der Hauptkopie anlegt. */
const VORFLUG_MIT_REST = `echo rest > "$KIT_ROOT/vorflug-rest.txt"\n${VORFLUG_OK}`;

function mitPruefProjekt(fn, configZusatz = {}) {
  mitProjekt(fn, {}, "night-vorflug-stopp-", { pruefLauf: BUDGET, ...configZusatz });
}

// ============================================================
// Der harte Stopp im Vorflug
// ============================================================

test("[night-1096] eine Vorflug-Session, die den Working Tree veraendert, haelt den Lauf hart an", {
  ...NUR_POSIX,
  // Der Zweig in fuehreVorflug() ist ueber die Kommandozeile nicht erreichbar: Seine
  // einzigen Aufrufer sind die Kette und der Prueflauf, und beide sind von der Messung
  // ausgenommen (`args.kette || args.pruefen ? [] : gitReste()`, Issue #878 und #909).
  todo: "Issue #1096: kein Modus des Runners erreicht den harten Stopp im Vorflug — toter Zweig, siehe Abschlussbericht",
}, () => {
  const ergebnisse = [];
  for (const modus of [["--kette"], ["--pruefen"]]) {
    mitPruefProjekt((dir) => {
      const env = { ...umgebung(dir), NIGHT_VORFLUG_CMD: VORFLUG_MIT_REST };
      const res = run(dir, modus, env);
      ergebnisse.push({
        modus: modus.join(" "), status: res.status, stdout: res.stdout,
        abschluss: stand(dir).abschluss, sessions: sessions(env.logPfad).length,
      });
    });
  }
  const gestoppt = ergebnisse.filter((e) => e.status === 1 && e.stdout.includes(HARTER_STOPP));
  const uebersicht = ergebnisse.map((e) => e.modus + " -> Exit " + e.status).join(", ");
  assert.ok(gestoppt.length > 0, `kein Modus hielt an: ${uebersicht}`);
  for (const e of gestoppt) {
    assert.equal(e.abschluss, "harterStopp");
    assert.equal(e.sessions, 0, "nach dem Stopp darf keine Session starten");
  }
});

test("[night-1096] Gegenprobe: in der Kette bleibt derselbe Rest ohne Stopp", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const env = { ...umgebung(dir), NIGHT_VORFLUG_CMD: VORFLUG_MIT_REST };
    const res = run(dir, ["--kette"], env);

    assert.equal(res.status, 0, `die Kette haette regulaer enden muessen:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /Vorflug-Session startet/, "der Vorflug muss gelaufen sein");
    assert.doesNotMatch(res.stdout, /HARTER STOPP/, "die Kette misst den Arbeitsbaum im Vorflug nicht (Issue #878)");
    assert.ok(existsSync(join(dir, "vorflug-rest.txt")), "der Rest der Vorflug-Session liegt noch");
    assert.equal(stand(dir).abschluss, "regulaer");
  }, {}, "night-vorflug-kette-");
});

// ============================================================
// Der Prueflauf: Vorflug mit Problem, Zahlendeckel, alles uebersprungen
// ============================================================

test("[night-1096] meldet der Vorflug des Prueflaufs ein Problem, bekommt jeder Kandidat den Vermerk und behaelt sein Kennzeichen", NUR_POSIX, () => {
  mitPruefProjekt((dir) => {
    const a = fachplan(dir, "[Fachlich] Erste", PRUEF_LABEL, false);
    const b = fachplan(dir, "[Fachlich] Zweite", PRUEF_LABEL, false);
    const env = pruefUmgebung(dir);

    const res = run(dir, ["--pruefen"], env);

    assert.equal(res.status, 1, `ohne Reviewer muss der Prueflauf anhalten:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /Kein Reviewer konfiguriert/);
    for (const id of [a, b]) {
      const karte = board(dir, "issue", "get", id);
      assert.match(karte.body, /Pruefung nicht gestartet: Kein Reviewer konfiguriert/,
        `#${id}: der Vermerk aus pruefungNichtGestartet fehlt`);
      assert.ok(karte.labels.includes(PRUEF_LABEL), `#${id}: das Kennzeichen muss bleiben — es lief nichts`);
      assert.match(res.stdout, new RegExp(`#${id}: Kommentar 'Pruefung nicht gestartet' geschrieben, Kennzeichen bleibt\\.`));
    }
    assert.equal(sessions(env.logPfad).length, 0, "nach dem gescheiterten Vorflug startet keine Pruefung");
    assert.equal(stand(dir).abschluss, "harterStopp");
  }, { issueReview: { reviewers: [] } });
});

test("[night-1096] mehr Kandidaten als --max: die ueberzaehligen bleiben liegen, ohne Session und mit Kennzeichen", NUR_POSIX, () => {
  mitPruefProjekt((dir) => {
    const erste = fachplan(dir, "[Fachlich] Erste", PRUEF_LABEL, false);
    const zweite = fachplan(dir, "[Fachlich] Zweite", PRUEF_LABEL, false);
    const dritte = fachplan(dir, "[Fachlich] Dritte", PRUEF_LABEL, false);
    const env = pruefUmgebung(dir);

    const res = run(dir, ["--pruefen", "--max", "1"], env);

    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(sessions(env.logPfad).length, 1, "nur der eine Kandidat unter dem Deckel bekommt eine Session");
    const lauf = stand(dir);
    const einheit = (id) => lauf.einheiten.find((e) => e.id === id);
    assert.notEqual(einheit(erste).ausgang, "liegengeblieben", "die erste Karte lief");
    for (const id of [zweite, dritte]) {
      assert.equal(einheit(id).ausgang, "liegengeblieben");
      assert.equal(einheit(id).grund, "ueber --max 1, bleibt liegen");
      assert.match(res.stdout, new RegExp(`#${id} .*: liegengeblieben — ueber --max 1, bleibt liegen`));
      assert.ok(board(dir, "issue", "get", id).labels.includes(PRUEF_LABEL),
        `#${id}: eine liegengebliebene Karte behaelt ihr Kennzeichen`);
    }
    assert.match(res.stdout, /Prueflauf beendet: .* 2 liegengeblieben\./);
  });
});

test("[night-1096] sind alle Kandidaten uebersprungen, nennt das Laufende sie und es startet keine Session", NUR_POSIX, () => {
  mitPruefProjekt((dir) => {
    const plan = board(dir, "issue", "create", "--title", "[Plan] Ein Weg", "--body", "## Ziel\n\nEin Weg.\n");
    const planId = String(plan.id);
    board(dir, "issue", "label", "add", planId, PRUEF_LABEL);
    const klaeren = fachplan(dir, "[Fachlich] Wartet auf Antwort", PRUEF_LABEL, false);
    board(dir, "issue", "label", "add", klaeren, KLAEREN_LABEL);
    const env = pruefUmgebung(dir);

    const res = run(dir, ["--pruefen"], env);

    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(sessions(env.logPfad).length, 0, "eine uebersprungene Karte bekommt keine Session");
    assert.match(res.stdout, new RegExp(`#${planId} .*-> uebersprungen \\(traegt \\[Plan\\]`));
    assert.match(res.stdout, new RegExp(`#${klaeren} .*-> uebersprungen \\(traegt ${KLAEREN_LABEL}`));
    const satz = `Nichts zu pruefen: alle 2 gekennzeichneten Karten mit dem Label '${PRUEF_LABEL}' wurden uebersprungen`;
    assert.ok(res.stdout.includes(satz), `die Zusammenfassung fehlt:\n${res.stdout}`);
    const lauf = stand(dir);
    assert.equal(lauf.abschluss, "regulaer");
    assert.ok(lauf.noWorkReason.startsWith(satz), "der Grund steht auch am Ergebnisstand");
    for (const id of [planId, klaeren]) {
      assert.equal(lauf.einheiten.find((e) => e.id === id).ausgang, "uebersprungen");
      assert.ok(board(dir, "issue", "get", id).labels.includes(PRUEF_LABEL), `#${id}: das Kennzeichen bleibt`);
    }
  });
});
