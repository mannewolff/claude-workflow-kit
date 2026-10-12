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

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TEXTE, pruefe, projektZustand, vorschau, zusatzregeln, checkSetzen } from "../kit/einstellungen.mjs";
import { projekt } from "./helpers/einstellungen-fixture.mjs";

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

// --- Das Feld abschlussBereiche (Issue #1532, Plan #1529, E7) -------------
//
// Dieselben vier Regeln, an denen `pruefeAbschlussBereiche` in kit/checks.mjs den Lauf beim
// Start abbricht. Alle vier sind darum FEHLER: Eine Config, die dort abbraeche, soll sich hier
// nicht speichern lassen.

const BEREICHE = { kit: ["kit/**"], nacht: ["kit/night.mjs"], doku: ["docs/**"] };

/** Ein Eintrag mit der Achse und Bereichen, der ohne abschlussBereiche fehlerfrei durchlaeuft. */
const NACHT = { cmd: "node --test test/ablauf-night-*.test.mjs", areas: ["kit", "nacht"], nichtBeimAbschluss: "zusammenspiel" };

const mitFeld = (eintrag) => ({ checkAreas: BEREICHE, buildChecks: ["node --test", eintrag] });
const amFeld = (befunde) => befunde.filter((b) => b.pfad === "buildChecks[1].abschlussBereiche");

test("[einstellungen-abschlussBereiche] ein gueltiges Feld geht durch — mit areas, mit always und ohne areas", () => {
  for (const eintrag of [
    { ...NACHT, abschlussBereiche: ["nacht"] },
    { cmd: "x", always: true, nichtBeimAbschluss: "zusammenspiel", abschlussBereiche: ["doku"] },
    { cmd: "x", nichtBeimAbschluss: "volleTestmenge", abschlussBereiche: ["kit", "doku"] },
  ]) {
    assert.deepEqual(zusatzregeln(mitFeld(eintrag)), [], JSON.stringify(eintrag));
  }
});

test("[einstellungen-abschlussBereiche] (a) ohne nichtBeimAbschluss ist ein Fehler am Feld", () => {
  const { nichtBeimAbschluss: _achse, ...ohneAchse } = NACHT;
  const b = amFeld(zusatzregeln(mitFeld({ ...ohneAchse, abschlussBereiche: ["nacht"] })));
  assert.equal(b.length, 1, JSON.stringify(b));
  assert.equal(b[0].art, "fehler");
  assert.match(b[0].grund, /nichtBeimAbschluss/);
  assert.match(b[0].grund, /\.claude\/workflow\.config\.json/);
});

test("[einstellungen-abschlussBereiche] (b) keine nicht leere Liste von Namen ist ein Fehler am Feld", () => {
  for (const wert of [[], "nacht", ["nacht", 3], {}]) {
    const b = amFeld(zusatzregeln(mitFeld({ ...NACHT, abschlussBereiche: wert })));
    assert.equal(b.length, 1, `${JSON.stringify(wert)}: ${JSON.stringify(b)}`);
    assert.equal(b[0].art, "fehler");
    assert.match(b[0].grund, /Liste/);
  }
});

test("[einstellungen-abschlussBereiche] (c) ein unbekannter Bereich ist ein Fehler und nennt den Namen", () => {
  const b = amFeld(zusatzregeln(mitFeld({ ...NACHT, abschlussBereiche: ["nacht", "nachtlauf"] })));
  assert.equal(b.length, 1, JSON.stringify(b));
  assert.equal(b[0].art, "fehler");
  assert.match(b[0].grund, /'nachtlauf'/);
  assert.doesNotMatch(b[0].grund, /'nacht'/);
});

test("[einstellungen-abschlussBereiche] (d) ein Bereich ausserhalb von areas ist ein Fehler — nicht bei always und ohne areas", () => {
  const b = amFeld(zusatzregeln(mitFeld({ ...NACHT, abschlussBereiche: ["doku"] })));
  assert.equal(b.length, 1, JSON.stringify(b));
  assert.equal(b[0].art, "fehler");
  assert.match(b[0].grund, /'doku'/);
  assert.match(b[0].grund, /areas/);
  const { areas: _areas, ...ohneAreas } = NACHT;
  assert.deepEqual(zusatzregeln(mitFeld({ ...ohneAreas, abschlussBereiche: ["doku"] })), []);
  assert.deepEqual(zusatzregeln(mitFeld({ ...ohneAreas, always: true, abschlussBereiche: ["doku"] })), []);
});

test("[einstellungen-abschlussBereiche] ein fehlerhaftes Feld haelt das Speichern auf", () => {
  const config = { ...BASIS, ...mitFeld({ ...NACHT, abschlussBereiche: ["unbekannt"] }) };
  assert.ok(fehler(pruefe(config, null)).some((b) => b.pfad === "buildChecks[1].abschlussBereiche"));
});

test("[einstellungen-abschlussBereiche] ein Eintrag mit abschlussBereiche traegt das Gate des Abschlusses nicht", () => {
  // `pruefeAbschlussGate` zaehlt ihn weiter als nicht tragend: Er laeuft beim Abschluss nur
  // bei direkter Beruehrung, und ein Gate, das davon abhaengt, ist keines.
  const b = zusatzregeln({ checkAreas: BEREICHE, buildChecks: [{ ...NACHT, abschlussBereiche: ["nacht"] }] });
  assert.equal(b.length, 1, JSON.stringify(b));
  assert.equal(b[0].pfad, "buildChecks");
  assert.equal(b[0].art, "warnung");
});

test("[einstellungen-abschlussBereiche] die Befundtexte stehen auf Deutsch und Englisch, unter dem englischen Feldnamen", () => {
  for (const schluessel of ["regel.abschlussBereicheOhneAchse", "regel.abschlussBereicheForm", "regel.abschlussBereicheFremd", "regel.abschlussBereicheAusserhalb"]) {
    assert.match(TEXTE.de[schluessel] ?? "", /abschlussBereiche/, `${schluessel} fehlt auf Deutsch`);
    assert.match(TEXTE.en[schluessel] ?? "", /completionAreas/, `${schluessel} fehlt auf Englisch`);
    assert.doesNotMatch(TEXTE.en[schluessel], /abschlussBereiche/, `${schluessel} nennt auf Englisch den deutschen Namen`);
  }
});

test("[einstellungen-abschlussBereiche] ein englisches Projekt bekommt den Befund auf Englisch", () => {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-abschluss-"));
  const home = mkdtempSync(join(tmpdir(), "einstellungen-abschluss-home-"));
  try {
    const team = { ...BASIS, language: "en", checkAreas: BEREICHE, buildChecks: ["node --test", NACHT] };
    const pfad = projekt(wurzel, "en", { team, stand: "1.0.0" });
    const eigen = { name: "en", pfad };
    const optionen = { home, eigenerStand: "99.0.0" };
    const res = vorschau(eigen, {
      hashes: projektZustand(eigen, optionen).hashes,
      ebene: "team",
      teil: "m4",
      aenderungen: [{ pfad: "buildChecks", wert: ["node --test", { ...NACHT, abschlussBereiche: ["doku"] }] }],
    }, optionen);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const b = amFeld(res.body.befunde);
    assert.equal(b.length, 1, JSON.stringify(res.body.befunde));
    assert.match(b[0].grund, /completionAreas/);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("[einstellungen-abschlussBereiche] checkSetzen laesst abschlussBereiche stehen — die Oberflaeche bearbeitet es nicht", () => {
  const eintrag = { ...NACHT, abschlussBereiche: ["nacht"] };
  assert.deepEqual(checkSetzen(eintrag, { cmd: "node --test" }), { ...eintrag, cmd: "node --test" });
  assert.deepEqual(checkSetzen(eintrag, { areas: ["nacht"] }), { ...eintrag, areas: ["nacht"] });
  assert.equal(checkSetzen(eintrag, { cmd: eintrag.cmd }), eintrag);
});
