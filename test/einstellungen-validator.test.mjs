// Prüfung einer Konfiguration in kit/einstellungen.mjs (Issue #676, Plan #674 E4, E5, E18).
//
// Der Validator kennt genau die Schlüsselwörter, die das Schema benutzt. Ein neues
// Schlüsselwort im Schema, das er nicht kennt, soll hier auffallen — nicht erst, wenn
// die Oberfläche einen ungültigen Wert still speichert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { pruefeSchema, pruefe, zusatzregeln, vorgabeAus, aenderungAnwenden, THEMEN, SCHEMA, SCHLUESSELWOERTER } from "../kit/einstellungen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const VORLAGE = JSON.parse(readFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), "utf-8"));
const BESCHREIBEND = new Set(["description", "default", "title", "$schema", "defaults", "validationRules"]);

const fehler = (befunde) => befunde.filter((b) => b.art === "fehler");

// Je Schlüsselwort ein Schema, ein gültiger und ein ungültiger Wert.
const FAELLE = [
  ["type", { type: "string" }, "a", 5],
  ["enum", { enum: ["x", "y"] }, "x", "z"],
  ["pattern", { type: "string", pattern: "^claude-" }, "claude-opus-5", "--gefahr"],
  ["oneOf", { oneOf: [{ type: "string" }, { type: "number" }] }, 3, true],
  ["not", { not: { required: ["a"] } }, { b: 1 }, { a: 1 }],
  ["required", { type: "object", required: ["a"] }, { a: 1 }, {}],
  ["minItems", { type: "array", minItems: 1 }, [1], []],
  ["minProperties", { type: "object", minProperties: 1 }, { a: 1 }, {}],
  ["additionalProperties", { type: "object", additionalProperties: { type: "number" } }, { a: 1 }, { a: "x" }],
  ["properties", { type: "object", properties: { a: { type: "number" } } }, { a: 1 }, { a: "x" }],
  ["items", { type: "array", items: { type: "number" } }, [1, 2], [1, "x"]],
  ["minLength", { type: "string", minLength: 1 }, "a", ""],
  ["minimum", { type: "number", minimum: 1 }, 1, 0],
  ["exclusiveMinimum", { type: "number", exclusiveMinimum: 0 }, 0.5, 0],
  // Seit Issue #762: Die Marke der Gütemessung ist eine Zahl von 0 bis 100. Die
  // Obergrenze stand bis dahin nirgends im Schema und deshalb nicht im Validator.
  ["maximum", { type: "number", maximum: 100 }, 100, 120],
  ["uniqueItems", { type: "array", uniqueItems: true }, ["a", "b"], ["a", "a"]],
];

for (const [wort, schema, gut, schlecht] of FAELLE) {
  test(`[einstellungen-1] ${wort}: gültig und ungültig werden unterschieden`, () => {
    assert.deepEqual(fehler(pruefeSchema(gut, schema)), [], `${wort}: gültiger Wert abgewiesen`);
    const befunde = fehler(pruefeSchema(schlecht, schema));
    assert.ok(befunde.length > 0, `${wort}: ungültiger Wert durchgelassen`);
    assert.ok(befunde.every((b) => typeof b.grund === "string" && b.grund.length > 0), "jeder Befund trägt einen Grund");
  });
}

test("[einstellungen-1] der Validator kennt jedes Schlüsselwort, das das Schema benutzt", () => {
  const benutzt = new Set();
  const sammle = (knoten) => {
    if (Array.isArray(knoten)) return knoten.forEach(sammle);
    if (!knoten || typeof knoten !== "object") return;
    for (const [schluessel, wert] of Object.entries(knoten)) {
      if (["properties", "defaults", "validationRules"].includes(schluessel)) {
        if (schluessel === "properties") Object.values(wert).forEach(sammle);
        benutzt.add(schluessel);
        continue;
      }
      benutzt.add(schluessel);
      if (["items", "additionalProperties", "not"].includes(schluessel) || schluessel === "oneOf") sammle(wert);
    }
  };
  sammle(VORLAGE);
  const unbekannt = [...benutzt].filter((w) => !SCHLUESSELWOERTER.includes(w) && !BESCHREIBEND.has(w));
  assert.deepEqual(unbekannt, [], `unbekannte Schlüsselwörter: ${unbekannt.join(", ")}`);
  assert.equal(SCHLUESSELWOERTER.length, 16);
});

test("[einstellungen-1] das eingebettete Schema gleicht der Vorlage", () => {
  assert.deepEqual(SCHEMA, VORLAGE);
});

test("[einstellungen-1] ein unbekanntes Feld ist eine Warnung mit Pfad, kein Fehler", () => {
  const befunde = pruefeSchema({ codeHost: "local", issueTracker: "local", reviewModel: "claude-opus-5", erfunden: 1, night: { neuesFeld: true } });
  const unbekannt = befunde.filter((b) => b.art === "unbekannt").map((b) => b.pfad).sort();
  assert.deepEqual(unbekannt, ["erfunden", "night.neuesFeld"]);
  assert.deepEqual(fehler(befunde), []);
});

const REVIEW = {
  reviewers: [{ name: "opus", kind: "claude", model: "claude-opus-5" }, { name: "fable", kind: "claude", model: "claude-fable-5.1" }],
  pairs: { opus: ["fable"] },
};

test("[einstellungen-1] Zusatzregel: Zahl der Rollen ungleich reviewer", () => {
  // "architektur-bestand" steht im Rollenkatalog der Stufe plan — sonst traegt der Befund
  // auch die neue Katalog-Regel und die Zaehlung dieses Tests waere von ihr abhaengig.
  const b = zusatzregeln({ reviewStufen: { plan: { reviewer: 2, rollen: ["architektur-bestand"] } } });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "reviewStufen.plan.rollen");
});

test("Zusatzregel: ein Rollenname außerhalb des Katalogs ergibt einen Befund am Pfad seiner Zeile", () => {
  const b = zusatzregeln({ reviewStufen: { plan: { reviewer: 1, rollen: ["erfunden"] } } });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "reviewStufen.plan.rollen[0]");
  assert.match(b[0].grund, /erfunden/);
  assert.equal(b[0].art, "fehler");
});

test("Zusatzregel: ein Rollenname aus dem Katalog der eigenen Stufe ergibt keinen Befund", () => {
  const b = zusatzregeln({ reviewStufen: { fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] } } });
  assert.deepEqual(b, []);
});

test("Zusatzregel: ein Rollenname einer anderen Stufe zaehlt am eigenen Katalog nicht", () => {
  // "pruefbarkeit" gehoert zur Stufe issue, nicht zu plan — der Katalog ist je Stufe eigen.
  const b = zusatzregeln({ reviewStufen: { plan: { reviewer: 1, rollen: ["pruefbarkeit"] } } });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "reviewStufen.plan.rollen[0]");
});

test("[einstellungen-1] Zusatzregel: Name in pairs, der nicht in reviewers steht", () => {
  const b = zusatzregeln({ issueReview: { ...REVIEW, pairs: { opus: ["gpt-sol"] } } });
  assert.equal(b.length, 1);
  assert.match(b[0].grund, /gpt-sol/);
});

test("[einstellungen-1] Zusatzregel: Autor in seiner eigenen Paarliste", () => {
  const b = zusatzregeln({ issueReview: { ...REVIEW, pairs: { opus: ["opus"] } } });
  assert.ok(b.some((x) => /sich selbst/.test(x.grund)));
});

test("[einstellungen-1] Zusatzregel: areas, das nicht in checkAreas steht", () => {
  const b = zusatzregeln({ buildChecks: [{ cmd: "x", areas: ["backend"] }], checkAreas: { frontend: ["web/**"] } });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "buildChecks[0].areas");
  assert.deepEqual(zusatzregeln({ buildChecks: [{ cmd: "x", areas: ["frontend"] }], checkAreas: { frontend: ["web/**"] } }), []);
});

test("[einstellungen-13] Zusatzregel: ein Bereich in checkAreas ohne Muster ist eine Warnung am Pfad checkAreas.<name>", () => {
  const b = zusatzregeln({ checkAreas: { frontend: ["web/**"], backend: [] } });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "checkAreas.backend");
  assert.equal(b[0].art, "warnung");
  assert.ok(typeof b[0].grund === "string" && b[0].grund.length > 0);
});

test("[einstellungen-13] ein Bereich ohne Muster hält das Speichern nicht auf", () => {
  const config = { reviewModel: "claude-opus-5", checkAreas: { backend: [] } };
  const befunde = pruefe(config, null);
  assert.deepEqual(fehler(befunde), []);
  assert.ok(befunde.some((b) => b.art === "warnung" && b.pfad === "checkAreas.backend"));
});

test("[einstellungen-13] nurFehler lässt eine Warnung durch — oneOf und not zählen sie nicht", () => {
  // `not` trifft nur, wenn das Teilschema fehlerfrei ist. Ein unbekanntes Feld ist eine
  // Warnung; wenn `nurFehler` sie zählte, kippte das Ergebnis dieser Prüfung.
  const schema = { not: { type: "object", properties: { a: { type: "number" } }, additionalProperties: false } };
  assert.ok(fehler(pruefeSchema({ a: 1, fremd: 2 }, schema)).length > 0, "die ausgeschlossene Form wird erkannt");
});

test("[einstellungen-13] vorgabeAus liefert den default des Schemas und sonst undefined", () => {
  assert.equal(vorgabeAus("codeHost"), SCHEMA.properties.codeHost.default);
  assert.equal(vorgabeAus("night.kette.label"), SCHEMA.properties.night.properties.kette.properties.label.default);
  assert.equal(vorgabeAus("checkAreas"), undefined);
  assert.equal(vorgabeAus("gibtEsNicht"), undefined);
  assert.equal(vorgabeAus("night.gibtEsNicht.tiefer"), undefined);
});

test("[einstellungen-8] Zusatzregel: Stufe mit modell und kommando wird mit Pfad night.stufen.<stufe> abgewiesen", () => {
  const b = zusatzregeln({ night: { modelle: ["claude-opus-5"], stufen: { mittel: { modell: "claude-opus-5", kommando: "mein-runner" } } } });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "night.stufen.mittel");
  assert.match(b[0].grund, /modell/);
  assert.match(b[0].grund, /kommando/);
});

test("[einstellungen-8] Zusatzregel: Stufe ohne modell und ohne kommando wird mit Pfad night.stufen.<stufe> abgewiesen", () => {
  const b = zusatzregeln({ night: { stufen: { mittel: {} } } });
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "night.stufen.mittel");
  assert.match(b[0].grund, /modell/);
  assert.match(b[0].grund, /kommando/);
});

test("[einstellungen-8] Zusatzregel: ein Stufen-modell, das nicht in night.modelle steht, wird mit Pfad night.stufen.<stufe>.modell abgewiesen", () => {
  const config = { night: { modelle: ["claude-opus-5", "claude-sonnet-5"], stufen: { leicht: { modell: "claude-haiku-4" } } } };
  const b = zusatzregeln(config);
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "night.stufen.leicht.modell");
});

test("[einstellungen-8] eine Config mit night.modelle und night.stufen.leicht.modell wird ohne Fehler angenommen, ein fremdes Modell meldet genau einen Fehler", () => {
  const basis = { reviewModel: "claude-opus-5" };
  const gueltig = { ...basis, night: { modelle: ["claude-opus-5", "claude-sonnet-5"], stufen: { leicht: { modell: "claude-sonnet-5" } } } };
  assert.deepEqual(fehler(pruefe(gueltig, null)), []);
  const ungueltig = { ...basis, night: { modelle: ["claude-opus-5", "claude-sonnet-5"], stufen: { leicht: { modell: "claude-haiku-4" } } } };
  const b = fehler(pruefe(ungueltig, null));
  assert.equal(b.length, 1);
  assert.equal(b[0].pfad, "night.stufen.leicht.modell");
});

test("[einstellungen-8] eine Stufe mit kommando und name geht ohne Fehler durch, auch wenn kommando nicht mit claude- beginnt", () => {
  const config = { reviewModel: "claude-opus-5", night: { stufen: { mittel: { kommando: "mein-runner", name: "Mein Runner" } } } };
  assert.deepEqual(fehler(pruefe(config, null)), []);
});

test("[einstellungen-8] night.stufenRegel als Text geht ohne Fehler durch, ein fehlendes Feld ist kein Befund", () => {
  assert.deepEqual(fehler(pruefe({ reviewModel: "claude-opus-5", night: { stufenRegel: "eigene Regel" } }, null)), []);
  assert.deepEqual(fehler(pruefe({ reviewModel: "claude-opus-5", night: {} }, null)), []);
});

test("[einstellungen-1] geprüft wird am gemischten Wert aus Team- und persönlicher Datei", () => {
  const team = { codeHost: "local", issueTracker: "local", reviewModel: "claude-opus-5" };
  assert.ok(fehler(pruefe(team, { reviewModel: "gpt-5" })).some((b) => b.pfad === "reviewModel"));
  assert.deepEqual(fehler(pruefe(team, { reviewModel: "claude-sonnet-5" })), []);
});

test("[einstellungen-1] ein gespeicherter ungültiger Wert trägt denselben Grund wie eine Änderung auf ihn", () => {
  const geladen = pruefe({ codeHost: "svn", issueTracker: "local", reviewModel: "claude-opus-5" }, null);
  const geaendert = pruefe({ codeHost: "local", issueTracker: "local", reviewModel: "claude-opus-5" }, null, [{ pfad: "codeHost", wert: "svn" }]);
  const grund = (liste) => liste.find((b) => b.pfad === "codeHost")?.grund;
  assert.ok(grund(geladen));
  assert.equal(grund(geaendert), grund(geladen));
});

test("[einstellungen-1] jedes Wurzelfeld des Schemas außer version hat genau ein Thema", () => {
  const felder = Object.keys(VORLAGE.properties).filter((f) => f !== "version").sort();
  assert.deepEqual(Object.keys(THEMEN).sort(), felder);
});

test("[einstellungen-14] eine Config ohne aufwand-Block ist gültig", () => {
  assert.deepEqual(fehler(pruefe({ codeHost: "local", issueTracker: "local", reviewModel: "claude-opus-5" }, null)), []);
});

test("[einstellungen-14] aufwand.laeufe außerhalb ganzer Zahlen über null wird mit Pfad abgewiesen, 1 und 10 sind gültig", () => {
  const laeufeBefunde = (laeufe) => fehler(pruefeSchema({ aufwand: { laeufe } })).filter((b) => b.pfad === "aufwand.laeufe");
  for (const schlecht of [0, -1, 2.5, "10"]) {
    assert.ok(laeufeBefunde(schlecht).length > 0, `laeufe ${JSON.stringify(schlecht)} nicht abgewiesen`);
  }
  for (const gut of [1, 10]) {
    assert.deepEqual(laeufeBefunde(gut), []);
  }
});

test("[einstellungen-14] jede der drei Anteil-Schwellen außerhalb von 0 bis 1 wird mit Pfad abgewiesen, 0, 0,5 und 1 sind gültig", () => {
  // Seit Issue #824 stehen die Grenzen am Feld des Schemas statt in einer Zusatzregel;
  // die Aussage ist dieselbe, geprüft wird sie über `pruefeSchema`.
  const felder = ["pruefungAnteil", "werkzeugAnteil", "schreibkostenAnteil"];
  for (const feld of felder) {
    const befunde = (wert) => fehler(pruefeSchema({ aufwand: { schwellen: { [feld]: wert } } })).filter((b) => b.pfad === `aufwand.schwellen.${feld}`);
    for (const schlecht of [-0.1, 1.1, 2]) {
      assert.ok(befunde(schlecht).length > 0, `${feld}=${schlecht} nicht abgewiesen`);
    }
    for (const gut of [0, 0.5, 1]) {
      assert.deepEqual(befunde(gut), [], `${feld}=${gut}`);
    }
  }
});

test("[einstellungen-14] aufwand.schwellen.eingrenzungOhneWirkung als Nicht-Boolean wird mit Pfad abgewiesen", () => {
  const befunde = (wert) => fehler(pruefeSchema({ aufwand: { schwellen: { eingrenzungOhneWirkung: wert } } })).filter((b) => b.pfad === "aufwand.schwellen.eingrenzungOhneWirkung");
  assert.ok(befunde("ja").length > 0);
  assert.ok(befunde(1).length > 0);
  assert.deepEqual(befunde(true), []);
  assert.deepEqual(befunde(false), []);
});

test("[einstellungen-14] ein unbekanntes Feld in aufwand ist eine Warnung mit Pfad, kein Fehler", () => {
  const befunde = pruefeSchema({ aufwand: { erfunden: 1 } });
  assert.ok(befunde.some((b) => b.art === "unbekannt" && b.pfad === "aufwand.erfunden"));
  assert.deepEqual(fehler(befunde).filter((b) => b.pfad === "aufwand.erfunden"), []);
});

test("[einstellungen-14] aufwand steht nicht in der Allowlist für persönliche Abweichungen", () => {
  const basis = { reviewModel: "claude-opus-5" };
  const r = aenderungAnwenden(basis, {}, { ebene: "persoenlich", aenderungen: [{ pfad: "aufwand", wert: { laeufe: 3 } }] });
  assert.equal(r.ok, false);
  assert.match(r.grund, /aufwand/);
});

test("[einstellungen-14] ein aufwand-Block mit laeufe: 3 ändert nur laeufe, die Vorgaben der Schwellen bleiben unberührt", () => {
  const config = { codeHost: "local", issueTracker: "local", reviewModel: "claude-opus-5", aufwand: { laeufe: 3 } };
  assert.deepEqual(fehler(pruefe(config, null)), []);
});

// --- Pflichtfelder eines Reviewers (Issue #816) -----------------------------
//
// `validateReviewers` in kit/board.mjs bricht bei einem leeren Namen, einem claude-Reviewer
// ohne `model` und einem command-Reviewer ohne `command` hart ab — ausdrücklich, damit ein
// Tippfehler nicht zu einem unsichtbaren Ein-Reviewer-Lauf wird. Ohne dieselbe Regel hier
// speichert die Oberfläche eine Config, an der `/issue-review` danach scheitert.

const REVIEWER_BASIS = { codeHost: "local", issueTracker: "local", reviewModel: "claude-opus-5" };
const mitReviewern = (reviewers) => pruefe({ ...REVIEWER_BASIS, issueReview: { reviewers } }, null);
const anPfad = (befunde, pfad) => fehler(befunde).filter((b) => b.pfad === pfad);

test("[einstellungen-22] ein claude-Reviewer ohne model ergibt einen Fehler an .model", () => {
  const befunde = mitReviewern([{ name: "neu", kind: "claude" }]);
  assert.equal(anPfad(befunde, "issueReview.reviewers[0].model").length, 1, JSON.stringify(befunde));
  assert.match(anPfad(befunde, "issueReview.reviewers[0].model")[0].grund, /model/);
});

test("[einstellungen-22] ein command-Reviewer ohne command ergibt einen Fehler an .command", () => {
  const befunde = mitReviewern([{ name: "x", kind: "command" }]);
  assert.equal(anPfad(befunde, "issueReview.reviewers[0].command").length, 1, JSON.stringify(befunde));
  assert.match(anPfad(befunde, "issueReview.reviewers[0].command")[0].grund, /command/);
});

test("[einstellungen-22] ein leerer Name ergibt einen Fehler an .name", () => {
  const befunde = mitReviewern([{ name: "", kind: "claude", model: "claude-opus-5" }]);
  assert.equal(anPfad(befunde, "issueReview.reviewers[0].name").length, 1, JSON.stringify(befunde));
});

test("[einstellungen-22] der Pfad nennt die Zeile, nicht nur die Liste", () => {
  const befunde = mitReviewern([
    { name: "gut", kind: "claude", model: "claude-opus-5" },
    { name: "ohne", kind: "command" },
  ]);
  assert.deepEqual(fehler(befunde).map((b) => b.pfad), ["issueReview.reviewers[1].command"]);
});

test("[einstellungen-22] eine vollständige Reviewer-Liste bleibt ohne Befund", () => {
  assert.deepEqual(fehler(mitReviewern([
    { name: "opus", kind: "claude", model: "claude-opus-5" },
    { name: "gpt", kind: "command", command: "codex exec" },
  ])), []);
  // Auch ein Block ohne reviewers darf nichts melden — die Regel liest nur, was dasteht.
  assert.deepEqual(fehler(pruefe(REVIEWER_BASIS, null)), []);
});

test("[einstellungen-22] die Regel trifft genau die drei Fälle, an denen validateReviewers abbricht", () => {
  // Der Quelltext von kit/board.mjs ist hier das Maß: Jede Bedingung, an der er `fail` ruft,
  // hat hier ihren Befund. Läuft die Liste dort auseinander, fällt es an dieser Stelle auf —
  // sonst speichert die Oberfläche eine Config, die der Nachtlauf danach nicht mehr lädt.
  const quelle = readFileSync(join(repoRoot, "kit", "board.mjs"), "utf-8");
  const rumpf = quelle.slice(quelle.indexOf("function validateReviewers(")).split("\n}")[0];
  assert.match(rumpf, /typeof r\.name !== "string" \|\| !r\.name/, "board.mjs prüft den Namen nicht mehr so");
  assert.match(rumpf, /r\.kind === "claude" && !r\.model/, "board.mjs prüft das Modell nicht mehr so");
  assert.match(rumpf, /r\.kind === "command" && !r\.command/, "board.mjs prüft das Kommando nicht mehr so");
  for (const [reviewer, feld] of [
    [{ name: "", kind: "claude", model: "m" }, "name"],
    [{ name: "a", kind: "claude" }, "model"],
    [{ name: "a", kind: "command" }, "command"],
  ]) {
    assert.equal(anPfad(mitReviewern([reviewer]), `issueReview.reviewers[0].${feld}`).length, 1, `${feld} wird nicht gemeldet`);
  }
});
