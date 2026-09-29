// Die Achse `nichtBeimAbschluss` in der Konfigurationspruefung (Issue #949, Plan #944,
// fachliche Quelle #938).
//
// Drei Befunde, und sie sind von verschiedener Art — aus demselben Grund wie bei der
// Stufenangabe (test/einstellungen-check-stufen.test.mjs):
//
// Ein unbekannter Wert und die Achse an einem `push`- oder `merge`-Eintrag sind FEHLER:
// beides sind Aussagen ueber die Config selbst, und `kit/checks.mjs` bricht bei beidem
// unbedingt ab (`pruefeNichtBeimAbschlussStufe`, die Werteliste in `checkForm`). Eine
// Konfiguration, die dort abbraeche, soll sich hier nicht speichern lassen.
//
// Eine Konfiguration, in der JEDER Paketstufen-Eintrag `nichtBeimAbschluss` oder einen
// `guete`-Block traegt, ist dagegen eine WARNUNG — dieselbe Art und derselbe Grund wie
// bei der Nachbarregel `regelPaketstufeFehlt`: Sie ist gueltig und laesst sich speichern,
// sie ist nur der Zustand, den der Start-Guard des Nacht-Runners abweist und den ein
// Abschlusslauf in `kit/checks.mjs` abbricht. Den Halt setzt nicht diese Datei.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pruefe, zusatzregeln, checkSetzen } from "../kit/einstellungen.mjs";

const fehler = (befunde) => befunde.filter((b) => b.art === "fehler");

/** Eine Config, die ohne die geprueften Felder fehlerfrei durchlaeuft. */
const BASIS = { reviewModel: "claude-opus-5" };

const GUETE = { muster: String.raw`(\d+)%`, marke: 80 };

// --- Die Werteliste -------------------------------------------------------

test("[einstellungen-16] die beiden Werte der Achse gehen durch", () => {
  for (const wert of ["zusammenspiel", "volleTestmenge"]) {
    const b = zusatzregeln({ buildChecks: ["node --test", { cmd: "mvn verify", nichtBeimAbschluss: wert }] });
    assert.deepEqual(b, [], `der Wert '${wert}' wurde beanstandet`);
  }
});

test("[einstellungen-16] ein unbekannter Wert ist ein Fehler am Pfad des Eintrags", () => {
  const b = zusatzregeln({ buildChecks: ["node --test", { cmd: "mvn verify", nichtBeimAbschluss: "abends" }] });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks[1].nichtBeimAbschluss");
  assert.equal(b[0].art, "fehler");
  assert.match(b[0].grund, /zusammenspiel/);
  assert.match(b[0].grund, /volleTestmenge/);
});

test("[einstellungen-16] ein unbekannter Wert haelt das Speichern auf", () => {
  const config = { ...BASIS, buildChecks: ["node --test", { cmd: "mvn verify", nichtBeimAbschluss: true }] };
  assert.ok(fehler(pruefe(config, null)).some((b) => b.pfad === "buildChecks[1].nichtBeimAbschluss"));
});

test("[einstellungen-16] ein Eintrag ohne das Feld bleibt unbeanstandet", () => {
  // Der Bestand darf sich nicht ruehren: String-Form und Objekt ohne die Achse.
  assert.deepEqual(zusatzregeln({ buildChecks: ["node --test", { cmd: "mvn verify" }] }), []);
});

// --- Die Achse gehoert an die Paketstufe ----------------------------------

test("[einstellungen-16] die Achse an einem push- oder merge-Eintrag ist ein Fehler", () => {
  for (const stufe of ["push", "merge"]) {
    const b = zusatzregeln({
      buildChecks: ["node --test", { cmd: "mvn verify", stufe, nichtBeimAbschluss: "zusammenspiel" }],
    });
    assert.equal(b.length, 1, `die Stufe '${stufe}' ergab ${b.length} Befunde`);
    assert.equal(b[0].pfad, "buildChecks[1].nichtBeimAbschluss");
    assert.equal(b[0].art, "fehler");
    assert.match(b[0].grund, new RegExp(stufe));
    assert.match(b[0].grund, /paket/);
  }
});

test("[einstellungen-16] die Achse an der Paketstufe geht durch — auch ausgeschrieben", () => {
  assert.deepEqual(zusatzregeln({
    buildChecks: ["node --test", { cmd: "mvn verify", stufe: "paket", nichtBeimAbschluss: "zusammenspiel" }],
  }), []);
});

test("[einstellungen-16] die Achse an einem push-Eintrag haelt das Speichern auf", () => {
  const config = { ...BASIS, buildChecks: ["node --test", { cmd: "mvn verify", stufe: "push", nichtBeimAbschluss: "zusammenspiel" }] };
  assert.ok(fehler(pruefe(config, null)).some((b) => b.pfad === "buildChecks[1].nichtBeimAbschluss"));
});

// --- Das leere Gate des Abschlusses ---------------------------------------

test("[einstellungen-16] traegt jeder Paketstufen-Eintrag die Achse, ist das eine Warnung mit dem Weg in die Config-Datei", () => {
  const b = zusatzregeln({
    buildChecks: [
      { cmd: "mvn verify", nichtBeimAbschluss: "zusammenspiel" },
      { cmd: "mvn -Ppitest verify", guete: GUETE },
      { cmd: "npx eslint .", stufe: "push" },
    ],
  });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks");
  assert.equal(b[0].art, "warnung");
  assert.match(b[0].grund, /nichtBeimAbschluss/);
  assert.match(b[0].grund, /\.claude\/workflow\.config\.json/,
    "die Meldung nennt den Weg in die Config-Datei nicht");
});

test("[einstellungen-16] das leere Gate haelt das Speichern nicht auf", () => {
  const config = { ...BASIS, buildChecks: [{ cmd: "mvn verify", nichtBeimAbschluss: "volleTestmenge" }] };
  const befunde = pruefe(config, null);
  assert.deepEqual(fehler(befunde), []);
  assert.ok(befunde.some((b) => b.art === "warnung" && b.pfad === "buildChecks"));
});

test("[einstellungen-16] ein einziger tragender Eintrag genuegt — in jeder seiner Formen", () => {
  for (const eintrag of ["node --test", { cmd: "node --test" }, { cmd: "node --test", stufe: "paket" }]) {
    const b = zusatzregeln({
      buildChecks: [eintrag, { cmd: "mvn verify", nichtBeimAbschluss: "zusammenspiel" }],
    });
    assert.deepEqual(b, [], `die Form ${JSON.stringify(eintrag)} wurde nicht als tragender Eintrag gezaehlt`);
  }
});

test("[einstellungen-16] ohne Paketstufen-Eintrag entsteht keine Warnung ueber das Abschluss-Gate", () => {
  // Diese Config hatte nie ein Gate — dazu steht die Warnung der Nachbarregel bereit,
  // und zwei Meldungen ueber denselben Zustand waeren eine zu viel.
  const b = zusatzregeln({ buildChecks: [{ cmd: "mvn verify", stufe: "push" }] });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks");
  assert.match(b[0].grund, /keine Prüfung trägt die Stufe/);
  assert.deepEqual(zusatzregeln({ buildChecks: [] }), []);
  assert.deepEqual(zusatzregeln({ checkAreas: { frontend: ["web/**"] } }), []);
});

// --- Die Oberflaeche bearbeitet die Achse nicht ---------------------------

test("[einstellungen-16] checkSetzen laesst ein vorhandenes nichtBeimAbschluss-Feld stehen", () => {
  // "Ergaenzen statt neu bauen": Ein Feld, das der Redaktor nicht zeigt, darf er beim
  // Speichern nicht verlieren — sonst liefe die Pruefung stillschweigend wieder mit.
  const eintrag = { cmd: "mvn verify", areas: ["backend"], nichtBeimAbschluss: "zusammenspiel" };
  assert.deepEqual(checkSetzen(eintrag, { cmd: "mvn -q verify" }),
    { cmd: "mvn -q verify", areas: ["backend"], nichtBeimAbschluss: "zusammenspiel" });
  assert.deepEqual(checkSetzen(eintrag, { areas: ["backend", "frontend"] }),
    { cmd: "mvn verify", areas: ["backend", "frontend"], nichtBeimAbschluss: "zusammenspiel" });
  assert.deepEqual(checkSetzen(eintrag, { laufart: "immer" }),
    { cmd: "mvn verify", always: true, nichtBeimAbschluss: "zusammenspiel" });
  assert.deepEqual(checkSetzen(eintrag, { laufart: "offen" }),
    { cmd: "mvn verify", nichtBeimAbschluss: "zusammenspiel" });
  // Unveraendert heisst unveraendert: dieselbe Zeile, kein Diff in der Datei.
  assert.equal(checkSetzen(eintrag, { cmd: "mvn verify" }), eintrag);
});
