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
// pattern, minItems, minProperties, additionalProperties, properties, items. Alles
// andere (enum, minLength, minimum, uniqueItems) ignoriert er; er ist damit
// nachsichtiger als ein echter Validator, aber fuer die hier belegten Aussagen genau
// scharf genug: Jede negative Aussage haengt an einem der unterstuetzten
// Schluesselwoerter.
//
// Seit Issue #432 traegt die Datei ausserdem die Regel des Reviewer-Paares: genau
// eines von reviewModel (Claude-Subagent) und reviewCommand (fremde CLI, Prompt
// ueber stdin) ist gesetzt. Dafuer kam 'pattern' hinzu — ohne es bliebe die
// ^claude--Regel fuer reviewModel unbelegt.
//
// Seit Issue #438 traegt sie den spec-Block. Dafuer kam 'minProperties' hinzu — ohne
// es bliebe die Aussage 'ein leeres bereiche wird abgewiesen' unbelegt.

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

/** minProperties, required, properties und additionalProperties. */
function pruefeObjekt(teilschema, wert, pfad) {
  const fehler = [];
  if (typeof teilschema.minProperties === "number"
      && Object.keys(wert).length < teilschema.minProperties) {
    fehler.push(`${pfad}: braucht mindestens ${teilschema.minProperties} Eintraege`);
  }
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
  if (typeof teilschema.pattern === "string" && typeof wert === "string"
      && !new RegExp(teilschema.pattern).test(wert)) {
    fehler.push(`${pfad}: passt nicht auf '${teilschema.pattern}'`);
  }
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
  assert.deepEqual(pruefe({ type: "object", minProperties: 1 }, { a: 1 }), [], "minProperties erfuellt");
  assert.equal(pruefe({ type: "object", minProperties: 1 }, {}).length, 1, "minProperties weist das leere Objekt ab");
  assert.deepEqual(pruefe({ type: "string", pattern: "^claude-" }, "claude-opus-5"), [], "pattern trifft");
  assert.equal(pruefe({ type: "string", pattern: "^claude-" }, "gpt-5").length, 1, "pattern trifft nicht");
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

const beispielConfig = JSON.parse(
  readFileSync(join(repoRoot, "templates", "workflow.config.json"), "utf-8")
);

test("eine Bestandsconfig mit reiner String-Liste bleibt gueltig", () => {
  // Die Bestandsform ist buildChecks als flache Liste von Kommandozeilen. Sie muss
  // ohne jede Aenderung gueltig bleiben — jedes Projekt da draussen fuehrt sie.
  // Konstruiert aus der ausgelieferten Vorlage, damit der Test die echte Config
  // trifft und nicht ein erfundenes Beispiel.
  const bestand = {
    ...beispielConfig,
    buildChecks: beispielConfig.buildChecks.map((e) => (typeof e === "string" ? e : e.cmd)),
  };
  assert.deepEqual(pruefe(schema, bestand), []);
});

test("die ausgelieferte Beispiel-Config zeigt beide Formen nebeneinander (Issue #425)", () => {
  // Die Vorlage ist der einzige Ort, an dem ein Nutzer die Objektform zu sehen
  // bekommt, ohne die Doku zu lesen. Nur die zugeordnete Form zu zeigen waere
  // irrefuehrend: dass ein blosser String weiterhin gilt, ist die halbe Aussage.
  assert.deepEqual(pruefe(schema, beispielConfig), []);

  const strings = beispielConfig.buildChecks.filter((e) => typeof e === "string");
  const objekte = beispielConfig.buildChecks.filter((e) => istObjekt(e) && e.areas);
  assert.ok(strings.length > 0, "die nicht zugeordnete Form fehlt in der Vorlage");
  assert.ok(objekte.length > 0, "die zugeordnete Form fehlt in der Vorlage");

  // Ein Bereichsname ohne Eintrag in checkAreas laesst checks.mjs abbrechen — in
  // einer Datei, die zum Abschreiben gedacht ist, waere das der teuerste Tippfehler.
  const bekannt = new Set(Object.keys(beispielConfig.checkAreas ?? {}));
  assert.ok(bekannt.size > 0, "checkAreas fehlt in der Vorlage");
  for (const eintrag of objekte) {
    for (const name of eintrag.areas) {
      assert.ok(bekannt.has(name), `'${eintrag.cmd}' zeigt auf unbekannten Bereich '${name}'`);
    }
  }
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

// --- spec: der Schalter fuer das beschriebene Verhalten (Issue #438) ---

// Der Block selbst ist der Schalter, sein Feld 'seit' der Zeitpunkt. Gebaut aus der
// ausgelieferten Vorlage, damit die Faelle eine echte Config treffen und sich nur im
// spec-Block unterscheiden.
function configMitSpec(spec) {
  return { ...beispielConfig, spec };
}

const gueltigerSpec = {
  seit: "2026-09-02",
  bereiche: { kit: ["kit/**"], skills: [".claude/skills/**"] },
};

test("spec: der Block ist im Schema definiert und die Wurzel bleibt geschlossen", () => {
  // Ohne diese Zusicherung bestuenden die Faelle unten auch ganz ohne spec-Block: Der
  // Validator hat zu einem fehlenden Teilschema nichts zu beanstanden — und ein Block,
  // der in der geschlossenen Wurzel nicht eingetragen ist, macht jede Config schemawidrig.
  assert.ok(schema.properties.spec, "spec ist im Schema definiert");
  assert.equal(schema.additionalProperties, false, "die Wurzel bleibt geschlossen");
});

test("spec: eine Config mit gueltigem Block validiert", () => {
  assert.deepEqual(pruefe(schema, configMitSpec(gueltigerSpec)), []);
});

test("spec: die optionalen Felder testPattern und testGlobs sind gueltig", () => {
  assert.deepEqual(
    pruefe(schema, configMitSpec({ ...gueltigerSpec, testPattern: String.raw`\[<ID>\]`, testGlobs: ["test/**"] })),
    []
  );
});

test("spec: seit im falschen Format ist ungueltig", () => {
  // Das Gate vergleicht Kalendertage — ein '2.9.2026' waere kein Tag, den es lesen kann.
  assert.notDeepEqual(pruefe(schema, configMitSpec({ ...gueltigerSpec, seit: "2.9.2026" })), []);
});

test("spec: ein leeres bereiche ist ungueltig", () => {
  assert.notDeepEqual(pruefe(schema, configMitSpec({ ...gueltigerSpec, bereiche: {} })), []);
});

test("spec: ein Bereich mit leerem Muster-Array ist ungueltig", () => {
  // Anders als bei checkAreas, wo ein Bereich ohne Muster schlicht nichts erfasst: hier
  // waere er ein Bereich, den das Gate nie zuordnen kann.
  assert.notDeepEqual(pruefe(schema, configMitSpec({ ...gueltigerSpec, bereiche: { kit: [] } })), []);
});

test("spec: ein unbekannter Schluessel im Block ist ungueltig", () => {
  // Insbesondere 'enabled': Der Block selbst ist der Schalter, ein Bool haette einen
  // Aus-Zustand — und den gibt es nicht.
  assert.notDeepEqual(pruefe(schema, configMitSpec({ ...gueltigerSpec, enabled: true })), []);
});

test("spec: die Pflichtfelder seit und bereiche fehlen nicht ungestraft", () => {
  assert.notDeepEqual(pruefe(schema, configMitSpec({ bereiche: gueltigerSpec.bereiche })), []);
  assert.notDeepEqual(pruefe(schema, configMitSpec({ seit: gueltigerSpec.seit })), []);
});

test("spec: der defaults-Block traegt keinen spec-Eintrag", () => {
  // Ein Default schaltete jeden Installer-Lauf ein — das Vorhandensein IST der Schalter.
  assert.ok(schema.defaults, "der defaults-Block ist da");
  assert.ok(!("spec" in schema.defaults), "defaults traegt kein spec");
});

test("spec: die description warnt vor der Wirkungslosigkeit und nennt die Teamweit-Formel", () => {
  // JSON kennt keine Kommentare — die description ist der einzige Ort, an dem die Lage
  // im Schema selbst steht: eingeschaltet durch Vorhandensein, kein Weg zurueck, und bis
  // zur Ausbaustufe 4 ohne Wirkung. Genau daraus entstand bei checkAreas eine Falle.
  const text = schema.properties.spec.description;
  assert.ok(text, "spec hat eine description");
  assert.match(text, /ACHTUNG/, "der Warnton folgt dem ACHTUNG-Satz an buildChecks");
  assert.match(text, /keine Wirkung/, "die description sagt, dass der Block noch nichts bewirkt");
  assert.match(text, /enabled/, "die description sagt, dass es kein enabled gibt");
  assert.ok(
    text.endsWith("Gilt teamweit; ein abweichender Wert in workflow.config.local.json wird ignoriert."),
    "die description endet mit der Standardformel der Top-Level-Felder"
  );
});

// --- Das Reviewer-Paar: genau eines von reviewModel und reviewCommand (Issue #432) ---

// Gebaut aus der ausgelieferten Vorlage, damit die Faelle eine echte Config treffen
// und sich nur im Reviewer-Paar unterscheiden. Beide Felder fliegen erst raus, dann
// setzt der Aufruf, was er belegen will — sonst schleppte jeder Fall das reviewModel
// der Vorlage mit und die Aussage waere eine andere.
function configMitReviewer(felder) {
  const { reviewModel, reviewCommand, ...rest } = beispielConfig;
  return { ...rest, ...felder };
}

test("Reviewer-Paar: reviewModel allein ist gueltig", () => {
  assert.deepEqual(pruefe(schema, configMitReviewer({ reviewModel: "claude-opus-5" })), []);
});

test("Reviewer-Paar: reviewCommand allein ist gueltig", () => {
  assert.deepEqual(pruefe(schema, configMitReviewer({ reviewCommand: "codex exec --model gpt-5" })), []);
});

test("Reviewer-Paar: beide Felder zusammen sind ungueltig", () => {
  // Sonst braeuchte es eine Vorrangregel — welcher Reviewer laeuft dann?
  assert.notDeepEqual(
    pruefe(schema, configMitReviewer({ reviewModel: "claude-opus-5", reviewCommand: "codex exec --model gpt-5" })),
    []
  );
});

test("Reviewer-Paar: keines der beiden Felder ist ungueltig", () => {
  // Ein fehlendes Feld ist unter der Oder-Regel ein Fehler, kein Default-Fall: Der
  // defaults-Block ist die Installer-Vorgabe, keine Laufzeit-Auffuellung.
  assert.notDeepEqual(pruefe(schema, configMitReviewer({})), []);
});

test("Reviewer-Paar: reviewModel muss weiterhin auf ^claude- passen", () => {
  // Die Oder-Regel loest die Modell-Regel nicht ab: Wer reviewModel waehlt, waehlt
  // den Claude-Subagent. Eine fremde CLI gehoert nach reviewCommand.
  assert.notDeepEqual(pruefe(schema, configMitReviewer({ reviewModel: "gpt-5.6-sol" })), []);
});

test("die ausgelieferte Vorlage bleibt unter der neuen Regel gueltig", () => {
  // Der Default traegt weiterhin einen Claude-Reviewer, damit ein neues Projekt ohne
  // Zusatzangabe startet.
  assert.deepEqual(pruefe(schema, beispielConfig), []);
  assert.ok(beispielConfig.reviewModel?.startsWith("claude-"), "die Vorlage traegt einen Claude-Reviewer");
  assert.ok(!("reviewCommand" in beispielConfig), "die Vorlage setzt kein reviewCommand daneben");
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
