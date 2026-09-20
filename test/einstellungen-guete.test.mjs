// Die Guetemessung in der Konfigurationspruefung (Issue #764, Plan #753,
// fachliche Quelle #738).
//
// Vier Regeln, die das Schema nicht ausdruecken kann, weil sie Aussagen ueber die
// Liste oder ueber zwei Felder zusammen sind: hoechstens eine Messung, keine
// Messung erst zur Freigabe, eine Marke innerhalb von 0 bis 100, ein Muster mit
// genau einer Gruppe. Dieselben Grenzen faehrt `kit/checks.mjs` zur Laufzeit als
// Abbruch (Issue #763) — hier stehen sie vor dem Speichern, damit man sie sieht,
// bevor ein Nachtlauf daran haengt.
//
// Jeder Befund nennt seinen Pfad (Plan #753, E18): Die Oberflaeche bearbeitet den
// guete-Block nicht, und ein Befund ohne Ort erschiene unbehebbar.
//
// Dazu die Teamweit-Formel (E16): `guete` steht INNERHALB von `buildChecks`, und
// `buildChecks` steht nicht in der Allowlist der persoenlichen Datei — die Marke
// erbt das. Gesichert wird das hier mit einem Test und nicht mit einer zweiten
// Sperre, die eine zweite Stelle fuer dieselbe Entscheidung waere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  abgeleitet, mergeWorkflowConfig, persoenlichErlaubt, pruefe, SEITEN_BAUSTEINE, zusatzregeln,
} from "../kit/einstellungen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const fehler = (befunde) => befunde.filter((b) => b.art === "fehler");
const amPfad = (befunde, pfad) => befunde.filter((b) => b.pfad === pfad);

/** Eine Config, die ohne die geprueften Felder fehlerfrei durchlaeuft. */
const BASIS = { reviewModel: "claude-opus-5" };

const MUSTER = String.raw`\((\d+)%\)`;
const GUETE = { muster: MUSTER, marke: 80 };
const MESSUNG = { cmd: "mvn -Ppitest verify", always: true, guete: GUETE };

/** Die Befunde zur Guetemessung, ohne die Regeln der Nachbarfelder. */
function guetebefunde(buildChecks) {
  return zusatzregeln({ buildChecks }).filter((b) => /guete|stufe/.test(b.pfad));
}

// --- Regel 1: hoechstens eine Guetemessung --------------------------------

test("[einstellungen-16] ein zweiter guete-Block ist ein Fehler am Pfad des zweiten Eintrags", () => {
  const b = guetebefunde([MESSUNG, { cmd: "npx stryker run", always: true, guete: GUETE }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks[1].guete");
  assert.equal(b[0].art, "fehler");
  assert.match(b[0].grund, /ein/i, "die Meldung sagt nicht, dass nur ein Eintrag messen darf");
});

test("[einstellungen-16] eine einzige Guetemessung geht durch", () => {
  assert.deepEqual(zusatzregeln({ buildChecks: ["node --test", MESSUNG] }), []);
});

// --- Regel 2: nicht zusammen mit stufe merge ------------------------------

test("[einstellungen-16] eine Guetemessung mit stufe 'merge' ist ein Fehler am Pfad der Stufe", () => {
  const b = guetebefunde([{ ...MESSUNG, stufe: "merge" }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks[0].stufe");
  assert.equal(b[0].art, "fehler");
  assert.match(b[0].grund, /paket/, "die Meldung nennt die zulaessigen Stufen nicht");
  assert.match(b[0].grund, /push/, "die Meldung nennt die zulaessigen Stufen nicht");
});

test("[einstellungen-16] paket und push vertragen sich mit der Guetemessung", () => {
  for (const stufe of ["paket", "push"]) {
    assert.deepEqual(guetebefunde(["node --test", { ...MESSUNG, stufe }]), [],
      `die Stufe '${stufe}' wurde beanstandet`);
  }
});

// --- Regel 3: die Marke liegt zwischen 0 und 100 --------------------------

test("[einstellungen-16] eine Marke ausserhalb 0 bis 100 ist ein Fehler am Pfad der Marke", () => {
  for (const marke of [120, -1]) {
    const b = guetebefunde([{ ...MESSUNG, guete: { ...GUETE, marke } }]);
    assert.equal(b.length, 1, `die Marke ${marke} wurde nicht beanstandet`);
    assert.equal(b[0].pfad, "buildChecks[0].guete.marke");
    assert.equal(b[0].art, "fehler");
    assert.match(b[0].grund, /0/);
    assert.match(b[0].grund, /100/);
  }
});

test("[einstellungen-16] die Raender 0 und 100 sind erlaubt", () => {
  for (const marke of [0, 100]) {
    assert.deepEqual(guetebefunde([{ ...MESSUNG, guete: { ...GUETE, marke } }]), [],
      `die Marke ${marke} wurde beanstandet`);
  }
});

// --- Regel 4: das Muster hat genau eine Gruppe ----------------------------

test("[einstellungen-16] ein Muster mit zwei Gruppen ist ein Fehler am Pfad des Musters", () => {
  const b = guetebefunde([{ ...MESSUNG, guete: { ...GUETE, muster: String.raw`(\d+) von (\d+)` } }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks[0].guete.muster");
  assert.equal(b[0].art, "fehler");
  assert.match(b[0].grund, /2|zwei/, "die Meldung nennt die gefundene Zahl der Gruppen nicht");
});

test("[einstellungen-16] ein Muster ohne Gruppe ist ebenso ein Fehler", () => {
  const b = guetebefunde([{ ...MESSUNG, guete: { ...GUETE, muster: String.raw`\d+%` } }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks[0].guete.muster");
  assert.match(b[0].grund, /Gruppe/);
});

test("[einstellungen-16] eine Gruppe ohne Fang zaehlt nicht mit", () => {
  // (?: ...) faengt nichts — das Muster hat weiterhin genau eine Gruppe.
  assert.deepEqual(guetebefunde([{ ...MESSUNG, guete: { ...GUETE, muster: String.raw`(?:score )((\d+))` } }]).length, 1,
    "eine geschachtelte zweite Gruppe faengt und muss auffallen");
  assert.deepEqual(guetebefunde([{ ...MESSUNG, guete: { ...GUETE, muster: String.raw`(?:score )(\d+)` } }]), []);
});

test("[einstellungen-16] ein Muster, das kein regulaerer Ausdruck ist, faellt hier auf", () => {
  // checks.mjs faengt es zur Laufzeit noch einmal ab (Issue #763) — aber erst,
  // wenn die Messung laeuft. Hier steht es vor dem Speichern.
  const b = guetebefunde([{ ...MESSUNG, guete: { ...GUETE, muster: "(unvollstaendig" } }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks[0].guete.muster");
  assert.match(b[0].grund, /Ausdruck/);
});

// --- Die Befunde halten das Speichern auf ---------------------------------

test("[einstellungen-16] jede der vier Regeln haelt das Speichern auf", () => {
  const faelle = [
    [MESSUNG, { cmd: "npx stryker run", always: true, guete: GUETE }],
    [{ ...MESSUNG, stufe: "merge" }],
    [{ ...MESSUNG, guete: { ...GUETE, marke: 120 } }],
    [{ ...MESSUNG, guete: { ...GUETE, muster: String.raw`(\d+) von (\d+)` } }],
  ];
  for (const buildChecks of faelle) {
    const befunde = fehler(pruefe({ ...BASIS, buildChecks }, null));
    assert.ok(befunde.some((b) => /buildChecks\[\d+\]/.test(b.pfad)),
      `kein Fehler fuer ${JSON.stringify(buildChecks)}`);
  }
});

test("[einstellungen-16] ein Projekt ohne Guetemessung bleibt unberuehrt", () => {
  assert.deepEqual(zusatzregeln({ buildChecks: ["node --test", { cmd: "mvn verify", stufe: "merge" }] }), []);
});

// --- Die Teamweit-Formel (E16) --------------------------------------------

test("[einstellungen-16] eine persoenliche Datei kann die Marke nicht abweichend setzen", () => {
  const team = { ...BASIS, buildChecks: [MESSUNG] };
  const lokal = { buildChecks: [{ ...MESSUNG, guete: { ...GUETE, marke: 10 } }] };
  const { config, ignored } = mergeWorkflowConfig(team, lokal);
  assert.deepEqual(config.buildChecks, [MESSUNG], "die persoenliche Marke hat sich durchgesetzt");
  assert.ok(ignored.includes("buildChecks"), "die verworfene Abweichung wird nicht ausgewiesen");
  // Keine zweite Sperre, aber auch kein Schlupfloch: weder der Block selbst noch
  // sein Traeger darf persoenlich abweichen.
  assert.equal(persoenlichErlaubt("buildChecks"), false);
  assert.equal(persoenlichErlaubt("buildChecks.guete"), false);
});

// --- Die Anzeige im Teil „Pruefungen" -------------------------------------

test("[einstellungen-16] Marke und Stufe der Guetemessung stehen in der abgeleiteten Anzeige des Teils", () => {
  const anzeige = abgeleitet({ buildChecks: ["node --test", MESSUNG], checkAreas: {} }, "m4").guete;
  assert.deepEqual(anzeige, { cmd: MESSUNG.cmd, marke: 80, stufe: "paket" });
});

test("[einstellungen-16] die Stufe der Anzeige ist die gelesene, nicht die geschriebene", () => {
  const anzeige = abgeleitet({ buildChecks: [{ ...MESSUNG, stufe: "push" }] }, "m4").guete;
  assert.equal(anzeige.stufe, "push");
  assert.equal(abgeleitet({ buildChecks: ["node --test"] }, "m4").guete, null);
});

test("[einstellungen-16] der Redaktor der Pruefungen zeigt Marke und Stufe an", () => {
  const baustein = SEITEN_BAUSTEINE.redaktorPruefkommandos;
  assert.match(baustein, /abgeleitetVon\(teil\)\.guete/, "der Redaktor liest die Anzeige nicht aus der Vorschau");
  assert.match(baustein, /Marke/, "die Marke erscheint nicht in der Oberflaeche");
  assert.match(baustein, /Stufe/, "die Stufe erscheint nicht in der Oberflaeche");
});

// --- Der Ernstfall: die Config dieses Projekts ----------------------------

test("[einstellungen-16] die Konfiguration dieses Projekts laeuft ohne Guete-Fehler durch", () => {
  // Echte Daten statt Fixture. Die Datei ist Installer-Ausgabe und nicht
  // versioniert — in CI fehlt sie, dann hat dieser Test nichts zu messen.
  const teamPfad = join(repoRoot, ".claude", "workflow.config.json");
  if (!existsSync(teamPfad)) return;
  const team = JSON.parse(readFileSync(teamPfad, "utf-8"));
  const lokalPfad = join(repoRoot, ".claude", "workflow.config.local.json");
  const lokal = existsSync(lokalPfad) ? JSON.parse(readFileSync(lokalPfad, "utf-8")) : null;
  assert.deepEqual(amPfad(fehler(pruefe(team, lokal)), "buildChecks"), []);
  assert.deepEqual(fehler(pruefe(team, lokal)).filter((b) => /guete/.test(b.pfad)), []);
});
