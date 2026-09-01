// Tests fuer die Config-Form bereichsbezogener Pruefungen (Issue #422).
//
// Ein buildChecks-Eintrag darf drei Formen haben: der blosse Kommandostring (nicht
// zugeordnet, laeuft immer), { cmd, areas } (laeuft, wenn der Bereich beruehrt ist)
// und { cmd, always: true } (entschieden immer laufend). String und always:true
// verhalten sich gleich, bedeuten aber Verschiedenes — vergessen gegen entschieden.
//
// Das Schema ist bewusst streng: 'areas' zusammen mit 'always' braeuchte eine
// Vorrangregel, die niemand liest, und ein leeres 'areas' passierte jede
// Laufzeitpruefung und liefe nie — genau die still nie laufende Pruefung, die dieses
// Vorhaben verhindern soll. Was das Schema verhindert, muss die Laufzeit nicht
// erklaeren.
//
// Geprueft wird mit dem Mini-Validator unten statt mit ajv (entschieden am
// 2026-09-01): Das Repo fuehrt heute keinen Schema-Validator, und das Kit liefert
// seine Werkzeuge bewusst abhaengigkeitsfrei aus. Der Validator kennt nur die
// Schluesselwoerter, die dieses Schema hier braucht — type, oneOf, required, not,
// minItems, additionalProperties, properties, items. Alles andere (pattern, enum,
// minLength, minimum, uniqueItems) ignoriert er; er ist damit nachsichtiger als ein
// echter Validator, aber fuer die hier belegten Aussagen genau scharf genug: Jede
// negative Aussage haengt an einem der unterstuetzten Schluesselwoerter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const schema = JSON.parse(
  readFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), "utf-8")
);
const eintragSchema = schema.properties.buildChecks.items;

// --- Mini-Validator ---

const istObjekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);

function typPasst(typ, wert) {
  switch (typ) {
    case "object": return istObjekt(wert);
    case "array": return Array.isArray(wert);
    case "string": return typeof wert === "string";
    case "boolean": return typeof wert === "boolean";
    case "integer": return Number.isInteger(wert);
    case "number": return typeof wert === "number";
    default: return true;
  }
}

/** minItems und items. */
function pruefeArray(teilschema, wert, pfad) {
  const fehler = [];
  if (typeof teilschema.minItems === "number" && wert.length < teilschema.minItems) {
    fehler.push(`${pfad}: braucht mindestens ${teilschema.minItems} Eintraege`);
  }
  if (teilschema.items) {
    wert.forEach((el, i) => fehler.push(...pruefe(teilschema.items, el, `${pfad}[${i}]`)));
  }
  return fehler;
}

/** required, properties und additionalProperties. */
function pruefeObjekt(teilschema, wert, pfad) {
  const fehler = [];
  for (const name of teilschema.required || []) {
    if (!(name in wert)) fehler.push(`${pfad}: Pflichtfeld '${name}' fehlt`);
  }
  for (const [name, teilwert] of Object.entries(wert)) {
    const feldschema = teilschema.properties?.[name] ?? teilschema.additionalProperties;
    if (istObjekt(feldschema)) {
      fehler.push(...pruefe(feldschema, teilwert, `${pfad}.${name}`));
    } else if (feldschema === false) {
      fehler.push(`${pfad}: unbekanntes Feld '${name}'`);
    }
  }
  return fehler;
}

/** Liefert die Liste der Verstoesse; leer heisst gueltig. */
function pruefe(teilschema, wert, pfad = "$") {
  if (!istObjekt(teilschema)) return [];
  if (teilschema.type && !typPasst(teilschema.type, wert)) {
    // Passt schon der Typ nicht, sagen Folgepruefungen nichts mehr aus.
    return [`${pfad}: erwartet Typ '${teilschema.type}'`];
  }

  const fehler = [];
  if (Array.isArray(teilschema.oneOf)) {
    const treffer = teilschema.oneOf.filter((zweig) => pruefe(zweig, wert, pfad).length === 0);
    if (treffer.length !== 1) fehler.push(`${pfad}: oneOf traf ${treffer.length} Zweige statt genau einen`);
  }
  if (istObjekt(teilschema.not) && pruefe(teilschema.not, wert, pfad).length === 0) {
    fehler.push(`${pfad}: verbotene Kombination (not) trifft zu`);
  }
  if (Array.isArray(wert)) fehler.push(...pruefeArray(teilschema, wert, pfad));
  if (istObjekt(wert)) fehler.push(...pruefeObjekt(teilschema, wert, pfad));
  return fehler;
}

// Der Validator ist selbst Pruefgegenstand: Eine Funktion, die immer [] liefert,
// wuerde jede positive Aussage unten bestehen lassen. Die negativen Aussagen sind
// die eigentliche Absicherung — diese hier decken sein Grundverhalten ab.
test("Mini-Validator: erkennt falsche Typen, Pflichtfelder und unbekannte Felder", () => {
  const s = { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false };
  assert.deepEqual(pruefe(s, { a: "x" }), []);
  assert.equal(pruefe(s, { a: 1 }).length, 1, "falscher Typ");
  assert.equal(pruefe(s, {}).length, 1, "fehlendes Pflichtfeld");
  assert.equal(pruefe(s, { a: "x", b: 1 }).length, 1, "unbekanntes Feld");
  assert.equal(pruefe({ type: "array", minItems: 1 }, []).length, 1, "minItems");
  assert.equal(pruefe({ not: { required: ["a"] } }, { a: 1 }).length, 1, "not");
});

// --- Die drei gueltigen Formen ---

test("buildChecks: die String-Form bleibt gueltig", () => {
  assert.deepEqual(pruefe(eintragSchema, "npx eslint kit tools test install.mjs"), []);
});

test("buildChecks: die Objektform mit areas ist gueltig", () => {
  assert.deepEqual(pruefe(eintragSchema, { cmd: "mvn -pl backend verify", areas: ["backend"] }), []);
});

test("buildChecks: die Objektform mit always ist gueltig", () => {
  assert.deepEqual(pruefe(eintragSchema, { cmd: "node --test", always: true }), []);
});

test("buildChecks: ein Objekt nur mit cmd ist gueltig und bedeutet dasselbe wie die String-Form", () => {
  assert.deepEqual(pruefe(eintragSchema, { cmd: "node --test" }), []);
});

// --- Was das Schema ausschliesst ---

test("buildChecks: ein Objekt ohne cmd ist ungueltig", () => {
  assert.notDeepEqual(pruefe(eintragSchema, { areas: ["backend"] }), []);
});

test("buildChecks: areas zusammen mit always ist ungueltig", () => {
  // Sonst braeuchte es eine Vorrangregel, die niemand liest.
  assert.notDeepEqual(pruefe(eintragSchema, { cmd: "node --test", areas: ["backend"], always: true }), []);
});

test("buildChecks: ein leeres areas-Array ist ungueltig", () => {
  // Es passierte jede Laufzeitpruefung und liefe nie — die still nie laufende Pruefung.
  assert.notDeepEqual(pruefe(eintragSchema, { cmd: "node --test", areas: [] }), []);
});

test("buildChecks: unbekannte Felder in der Objektform sind ungueltig", () => {
  assert.notDeepEqual(pruefe(eintragSchema, { cmd: "node --test", area: ["backend"] }), []);
});

// --- Bestand ---

test("eine Bestandsconfig mit reiner String-Liste bleibt gueltig", () => {
  // Die ausgelieferte Beispiel-Config ist die Bestandsform: buildChecks als flache
  // Liste von Kommandozeilen. Sie muss ohne jede Aenderung gueltig bleiben.
  const bestand = JSON.parse(
    readFileSync(join(repoRoot, "templates", "workflow.config.json"), "utf-8")
  );
  assert.ok(
    bestand.buildChecks.every((e) => typeof e === "string"),
    "Vorbedingung: die Beispiel-Config ist eine reine String-Liste"
  );
  assert.deepEqual(pruefe(schema, bestand), []);
});

// --- checkAreas ---

test("checkAreas: Bereichsnamen auf Pfadmuster sind gueltig", () => {
  const areasSchema = schema.properties.checkAreas;
  // Ohne diese Zusicherung bestuende der Test auch ganz ohne checkAreas-Block:
  // Der Validator hat zu einem fehlenden Teilschema nichts zu beanstanden.
  assert.ok(areasSchema, "checkAreas ist im Schema definiert");
  assert.deepEqual(pruefe(areasSchema, { backend: ["backend/**"], frontend: ["web/**", "shared/**"] }), []);
});

test("checkAreas: ein Bereich, dessen Wert kein Muster-Array ist, ist ungueltig", () => {
  assert.notDeepEqual(pruefe(schema.properties.checkAreas, { backend: "backend/**" }), []);
});

// --- Doku im Schema ---

test("die description-Felder nennen die drei Formen und den Unterschied String/always", () => {
  // JSON kennt keine Kommentare — die description-Felder sind der einzige Ort, an dem
  // die Bedeutung der Formen im Schema selbst steht.
  for (const [name, text] of [
    ["buildChecks.items", eintragSchema.description],
    ["checkAreas", schema.properties.checkAreas.description],
  ]) {
    assert.ok(text, `${name} hat eine description`);
    for (const begriff of ["areas", "always", "cmd"]) {
      assert.match(text, new RegExp(begriff), `${name} nennt '${begriff}'`);
    }
    assert.match(text, /entschieden/, `${name} benennt den Unterschied vergessen/entschieden`);
  }
});
