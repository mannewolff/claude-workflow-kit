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
// Geprueft wird mit dem Mini-Validator aus helpers/mini-validator.mjs statt mit ajv
// (entschieden am 2026-09-01): Das Repo fuehrt heute keinen Schema-Validator, und das
// Kit liefert seine Werkzeuge bewusst abhaengigkeitsfrei aus. Er stand bis Issue #439
// hier in der Datei und ist in die Hilfsdatei gezogen, weil der Installer-Test fuer
// den spec-Block dieselbe Aussage belegt und dieselbe Funktion braucht. Sein
// Selbsttest ist hier geblieben — er misst weiterhin genau dieses eine Exemplar.
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

import { pruefe, istObjekt } from "./helpers/mini-validator.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const schema = JSON.parse(
  readFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), "utf-8")
);
const eintragSchema = schema.properties.buildChecks.items;

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

// --- spec: der Schalter fuer Spec-Driven Development (Issue #438) ---

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

test("spec: die description nennt Einschalten ohne Rueckweg, die Tracker-Grenze und die Teamweit-Formel", () => {
  // JSON kennt keine Kommentare — die description ist der einzige Ort, an dem die Lage
  // im Schema selbst steht: eingeschaltet durch Vorhandensein und kein Weg zurueck. Der
  // fruehere Satz "bis Ausbaustufe 4 ohne Wirkung" ist seit spec.mjs ueberholt (Issue #675).
  const text = schema.properties.spec.description;
  assert.ok(text, "spec hat eine description");
  assert.match(text, /ACHTUNG/, "die Tracker-Grenze steht als ACHTUNG-Satz");
  assert.match(text, /enabled/, "die description sagt, dass es kein enabled gibt");
  // Seit Issue #461 (A19) traegt der Block nicht auf jedem Tracker. Wer die Lage nur
  // im Plan festhaelt, laesst denjenigen im Regen, der die Config vor sich hat.
  assert.match(text, /github und gitlab/, "die description nennt die ausgeschlossenen Tracker nicht");
  assert.match(text, /toolbox und local/, "die description nennt die moeglichen Tracker nicht");
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

// --- night.modelle (Issue #664) ---
//
// Der Nacht-Runner soll das Modell einer Karte uebernehmen koennen. Ohne eine Liste
// erlaubter Namen wanderte ein Wert aus einem Issue-Body unbesehen in `argv` — ein Paket
// mit `Empfohlenes Modell: --dangerously-skip-permissions` waere ein Angriff ueber eine
// Karte. Das `pattern` faengt das schon bei der Config-Pruefung ab, nicht erst zur
// Laufzeit: Was das Schema verhindert, muss der Runner nicht erklaeren.
//
// Die Liste ist GEORDNET, absteigend nach Staerke. Das ist keine Kosmetik — `/issues`
// leitet daraus ab, welcher Name das staerkste und welcher das schnellste Modell
// benennt, und nachts fragt niemand nach.

const configMitModellen = (modelle) => ({ ...beispielConfig, night: { modelle } });

test("night.modelle: eine Liste von Modellnamen ist gueltig", () => {
  assert.deepEqual(pruefe(schema, configMitModellen(["claude-opus-5", "claude-sonnet-5"])), []);
});

test("night.modelle: ein Eintrag mit fuehrendem Bindestrich faellt durch", () => {
  // Der eigentliche Zweck des Feldes. Ein Wert, der als Flag gelesen wuerde, darf gar
  // nicht erst in die Config kommen.
  assert.notDeepEqual(pruefe(schema, configMitModellen(["--dangerously-skip-permissions"])), []);
});

test("night.modelle: ein Eintrag, der keine Zeichenkette ist, faellt durch", () => {
  assert.notDeepEqual(pruefe(schema, configMitModellen([{ name: "claude-opus-5" }])), []);
  assert.notDeepEqual(pruefe(schema, configMitModellen([5])), []);
});

test("night.modelle: die Feldbeschreibung nennt die Ordnung nach Staerke", () => {
  const feld = schema.properties.night.properties.modelle;
  assert.ok(feld, "das Feld night.modelle fehlt im Schema");
  assert.match(feld.description, /St(ä|ae)rke/i, "die Ordnung nach Staerke steht nicht in der Beschreibung");
  assert.match(feld.description, /schnellste/i, "dass der letzte Eintrag das schnellste Modell ist, steht nicht da");
});

test("night: die Blockbeschreibung nennt die Umsetzungsnacht nicht mehr als blocklos", () => {
  // Sie tat es, solange nur die Kette einen Block brauchte. Mit night.modelle stimmt der
  // Satz nicht mehr — und eine Beschreibung, die das Gegenteil behauptet, ist schlechter
  // als keine.
  assert.doesNotMatch(
    schema.properties.night.description,
    /Umsetzungsnacht braucht keinen Block/,
    "die Beschreibung behauptet weiterhin, die Umsetzungsnacht brauche keinen Block",
  );
});

test("night.modelle: die ausgelieferte Vorlage traegt die Liste", () => {
  assert.deepEqual(pruefe(schema, beispielConfig), [], "die Vorlage bleibt gueltig");
  assert.ok(Array.isArray(beispielConfig.night?.modelle), "templates/workflow.config.json fuehrt night.modelle nicht");
  assert.equal(beispielConfig.night.modelle.length, 2, "zwei Eintraege erwartet");
  assert.ok(
    beispielConfig.night.modelle.every((m) => typeof m === "string" && m.startsWith("claude-")),
    "die Vorlage traegt nur Claude-Namen",
  );
});

// --- Das Schema als Quelle der Einstellungs-Referenz (Issue #675, Plan #674 E17) ---
//
// Oberfläche und Dokumentation zeigen die Beschreibungen wortgleich. Ein Fehler hier
// erschiene an beiden Orten zugleich — deshalb gelten für sie die Regeln der Doku.

/** Alle Properties mit ihrem Pfad, rekursiv bis in items und additionalProperties. */
function alleProperties(knoten, pfad = "", out = []) {
  if (!istObjekt(knoten)) return out;
  for (const [name, kind] of Object.entries(knoten.properties ?? {})) {
    const p = pfad ? `${pfad}.${name}` : name;
    out.push([p, kind]);
    alleProperties(kind, p, out);
  }
  if (istObjekt(knoten.items)) alleProperties(knoten.items, `${pfad}[]`, out);
  for (const variante of knoten.oneOf ?? []) alleProperties(variante, pfad, out);
  if (istObjekt(knoten.additionalProperties)) alleProperties(knoten.additionalProperties, `${pfad}.*`, out);
  return out;
}

/** Alle description-Texte des Schemas, einschliesslich Wurzel und items. */
function alleBeschreibungen(knoten, out = []) {
  if (Array.isArray(knoten)) { for (const k of knoten) alleBeschreibungen(k, out); return out; }
  if (!istObjekt(knoten)) return out;
  if (typeof knoten.description === "string") out.push(knoten.description);
  for (const [schluessel, wert] of Object.entries(knoten)) {
    if (schluessel !== "defaults" && schluessel !== "validationRules") alleBeschreibungen(wert, out);
  }
  return out;
}

test("jede Property im Schema traegt eine nicht leere description", () => {
  const ohne = alleProperties(schema).filter(([, kind]) => typeof kind.description !== "string" || kind.description.trim() === "").map(([p]) => p);
  assert.deepEqual(ohne, [], `ohne description: ${ohne.join(", ")}`);
});

test("keine description ist transliteriert oder verweist auf ein Issue", () => {
  // Bezeichner in Anfuehrungszeichen oder Backticks bleiben, wie sie heissen
  // ('vollstaendigkeit-pruefbarkeit' ist ein Rollenname, kein Text).
  const WOERTER = /\b\w*(fuer|ueber|koennen|wuerde|pruef|schluessel|geaendert|ausfuehr)\w*/i;
  const funde = [];
  for (const text of alleBeschreibungen(schema)) {
    const ohneBezeichner = text.replaceAll(/'[^']*'|`[^`]*`|"[^"]*"/g, "");
    const wort = ohneBezeichner.match(WOERTER);
    if (wort) funde.push(`transliteriert '${wort[0]}': ${text.slice(0, 60)}…`);
    if (/Issue #/.test(text)) funde.push(`Issue-Verweis: ${text.slice(0, 60)}…`);
  }
  assert.deepEqual(funde, []);
});

test("keine description traegt die ueberholten Warnungen", () => {
  const alle = alleBeschreibungen(schema).join("\n");
  for (const satz of [/noch nicht verstanden/, /erst mit dem Folgepaket/, /Ausbaustufe 4/]) {
    assert.doesNotMatch(alle, satz);
  }
});

test("validationRules fuehrt fuer issueTracker dieselben Werte wie das enum", () => {
  const regel = schema.validationRules.find((r) => r.field === "issueTracker");
  assert.ok(regel, "keine validationRule fuer issueTracker");
  assert.deepEqual([...regel.allowed].sort(), [...schema.properties.issueTracker.enum].sort());
});
