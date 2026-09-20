// Die Stufenangabe in der Konfigurationspruefung (Issue #761, Plan #753,
// fachliche Quelle #738).
//
// Abschluss der Staffelung an der Einstellungs-Oberflaeche. Zwei Befunde, und sie
// sind bewusst von verschiedener Art:
//
// Eine `stufe` ausserhalb der drei Namen ist ein FEHLER. Das Schema-oneOf faengt
// sie bereits ab, meldet aber nur "passt auf keine der erlaubten Formen" — dieselbe
// Lage wie bei `night.stufen` (Issue #708, E21). Die Regel benennt das Feld und
// zeigt auf die Zeile des Eintrags; ohne sie suchte man in einer vierfach
// verzweigten Form nach dem Tippfehler.
//
// Eine Konfiguration, in der keine Pruefung die Paketstufe traegt, ist dagegen eine
// WARNUNG (einstellungen-13): Sie ist gueltig, und sie laesst sich speichern. Sie
// ist nur der Zustand, den der Start-Guard des Nacht-Runners abweist (Issue #760) —
// nachts hat die Umsetzung dann kein Gate. Wer sie am Bildschirm sieht, soll sie
// beheben koennen: Die Oberflaeche bearbeitet die Stufe nicht (Plan #753, E18),
// deshalb nennt die Meldung den Weg in die Config-Datei.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { pruefe, zusatzregeln, checkSetzen } from "../kit/einstellungen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const fehler = (befunde) => befunde.filter((b) => b.art === "fehler");

/** Eine Config, die ohne die geprueften Felder fehlerfrei durchlaeuft. */
const BASIS = { reviewModel: "claude-opus-5" };

// --- Die Stufennamen ------------------------------------------------------

test("[einstellungen-15] eine stufe ausserhalb der drei Namen ist ein Fehler am Pfad des Eintrags", () => {
  const b = zusatzregeln({ buildChecks: ["node --test", { cmd: "mvn verify", stufe: "abend" }] });
  const stufenBefunde = b.filter((x) => /stufe/.test(x.pfad));
  assert.equal(stufenBefunde.length, 1);
  assert.equal(stufenBefunde[0].pfad, "buildChecks[1].stufe");
  assert.equal(stufenBefunde[0].art, "fehler");
  assert.match(stufenBefunde[0].grund, /paket/);
  assert.match(stufenBefunde[0].grund, /push/);
  assert.match(stufenBefunde[0].grund, /merge/);
});

test("[einstellungen-15] eine stufe ausserhalb der drei Namen haelt das Speichern auf", () => {
  const config = { ...BASIS, buildChecks: [{ cmd: "mvn verify", stufe: "abend" }] };
  assert.ok(fehler(pruefe(config, null)).some((b) => b.pfad === "buildChecks[0].stufe"));
});

test("[einstellungen-15] die drei Stufennamen und ein fehlendes Feld gehen durch", () => {
  for (const stufe of ["paket", "push", "merge"]) {
    const b = zusatzregeln({ buildChecks: ["node --test", { cmd: "mvn verify", stufe }] });
    assert.deepEqual(b, [], `die Stufe '${stufe}' wurde beanstandet`);
  }
  // Der Bestand darf sich nicht ruehren: String-Form und Objekt ohne `stufe`.
  assert.deepEqual(zusatzregeln({ buildChecks: ["node --test", { cmd: "mvn verify" }] }), []);
});

// --- Die fehlende Paketstufe ---------------------------------------------

test("[einstellungen-15] traegt keine Pruefung die Paketstufe, ist das eine Warnung mit dem Weg in die Config-Datei", () => {
  const b = zusatzregeln({ buildChecks: [{ cmd: "mvn verify", stufe: "push" }, { cmd: "npx eslint .", stufe: "merge" }] });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks");
  assert.equal(b[0].art, "warnung");
  assert.match(b[0].grund, /paket/);
  assert.match(b[0].grund, /\.claude\/workflow\.config\.json/,
    "die Meldung nennt den Weg in die Config-Datei nicht");
});

test("[einstellungen-15] die fehlende Paketstufe haelt das Speichern nicht auf", () => {
  const config = { ...BASIS, buildChecks: [{ cmd: "mvn verify", stufe: "push" }] };
  const befunde = pruefe(config, null);
  assert.deepEqual(fehler(befunde), []);
  assert.ok(befunde.some((b) => b.art === "warnung" && b.pfad === "buildChecks"));
});

test("[einstellungen-15] ein einziger Eintrag der Paketstufe genuegt — in jeder seiner Formen", () => {
  for (const eintrag of ["node --test", { cmd: "node --test" }, { cmd: "node --test", stufe: "paket" }]) {
    const b = zusatzregeln({ buildChecks: [eintrag, { cmd: "mvn verify", stufe: "merge" }] });
    assert.deepEqual(b, [], `die Form ${JSON.stringify(eintrag)} wurde nicht als Paketstufe gezaehlt`);
  }
});

test("[einstellungen-15] ohne buildChecks-Liste entsteht keine Warnung ueber die Paketstufe", () => {
  // Eine Config ganz ohne Pflichtpruefungen ist eine andere Aussage als eine, deren
  // Pruefungen alle spaeter laufen — fuer sie steht die Rueckfrage beim Leeren bereit.
  assert.deepEqual(zusatzregeln({ checkAreas: { frontend: ["web/**"] } }), []);
  assert.deepEqual(zusatzregeln({ buildChecks: [] }), []);
});

// --- Die Oberflaeche bearbeitet die Stufe nicht ---------------------------

test("[einstellungen-15] checkSetzen laesst ein vorhandenes stufe-Feld stehen", () => {
  // "Ergaenzen statt neu bauen": Der Redaktor zeigt Kommando, Laufart und Bereiche.
  // Ein Feld, das er nicht zeigt, darf er beim Speichern nicht verlieren.
  const eintrag = { cmd: "mvn verify", areas: ["backend"], stufe: "push" };
  assert.deepEqual(checkSetzen(eintrag, { cmd: "mvn -q verify" }), { cmd: "mvn -q verify", areas: ["backend"], stufe: "push" });
  assert.deepEqual(checkSetzen(eintrag, { areas: ["backend", "frontend"] }), { cmd: "mvn verify", areas: ["backend", "frontend"], stufe: "push" });
  assert.deepEqual(checkSetzen(eintrag, { laufart: "immer" }), { cmd: "mvn verify", always: true, stufe: "push" });
  assert.deepEqual(checkSetzen(eintrag, { laufart: "offen" }), { cmd: "mvn verify", stufe: "push" });
  // Unveraendert heisst unveraendert: dieselbe Zeile, kein Diff in der Datei.
  assert.equal(checkSetzen(eintrag, { cmd: "mvn verify" }), eintrag);
});

// --- Der Ernstfall: die Config dieses Projekts ----------------------------

test("[einstellungen-15] die Konfiguration dieses Projekts laeuft ohne Fehler durch", () => {
  // Echte Daten statt Fixture: Eine selbstgebaute Config prueft die eigene Annahme.
  // Die Datei ist Installer-Ausgabe und nicht versioniert — in CI fehlt sie, dann
  // hat dieser Test nichts zu messen.
  const teamPfad = join(repoRoot, ".claude", "workflow.config.json");
  if (!existsSync(teamPfad)) return;
  const lokalPfad = join(repoRoot, ".claude", "workflow.config.local.json");
  const team = JSON.parse(readFileSync(teamPfad, "utf-8"));
  const lokal = existsSync(lokalPfad) ? JSON.parse(readFileSync(lokalPfad, "utf-8")) : null;
  const befunde = pruefe(team, lokal);
  assert.deepEqual(fehler(befunde), [], "die eigene Config traegt Fehler");
  assert.ok(!befunde.some((b) => b.pfad === "buildChecks" && b.art === "warnung"),
    "die eigene Config traegt keine Pruefung der Paketstufe");
});
