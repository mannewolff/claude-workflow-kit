// Namenspaare der Einstellungen kit/board/config-namen.mjs (Issue #1434, Plan #1420 E9–E11):
// jeder Schluessel und jeder Wert einer festen Aufzaehlung des Schemas hat einen deutschen und
// einen englischen Namen; normalisiereConfig bildet beim Einlesen auf die deutschen ab,
// benenneUm stellt eine Config auf eine Sprache um.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ENTFALLEN, SCHLUESSEL, WERTE, normalisiereConfig, benenneUm, benenneWieVorlage, mitEnglischenNamen } from "../kit/board/config-namen.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "templates", "workflow.config.schema.json"), "utf8"));

// Alle Pfade des Schemas in der Schreibweise der Tabelle: `a.b`, Listeneintraege als `a[]`.
// Nur `properties` sind Einstellungsnamen; was unter `additionalProperties` steht (Bereichsnamen
// in checkAreas, Autoren in issueReview.pairs), waehlt der Mensch selbst.
function schemaPfade(knoten, pfad = "", pfade = new Set(), aufzaehlungen = new Map()) {
  if (!knoten || typeof knoten !== "object") return { pfade, aufzaehlungen };
  if (Array.isArray(knoten.enum) && pfad) {
    const werte = aufzaehlungen.get(pfad) ?? new Set();
    for (const w of knoten.enum) if (typeof w === "string") werte.add(w);
    aufzaehlungen.set(pfad, werte);
  }
  for (const [name, kind] of Object.entries(knoten.properties ?? {})) {
    const kindPfad = pfad ? `${pfad}.${name}` : name;
    pfade.add(kindPfad);
    schemaPfade(kind, kindPfad, pfade, aufzaehlungen);
  }
  if (knoten.items) schemaPfade(knoten.items, `${pfad}[]`, pfade, aufzaehlungen);
  for (const art of ["oneOf", "anyOf", "allOf"]) {
    for (const zweig of knoten[art] ?? []) schemaPfade(zweig, pfad, pfade, aufzaehlungen);
  }
  return { pfade, aufzaehlungen };
}

const { pfade: SCHEMA_PFADE, aufzaehlungen: SCHEMA_WERTE } = schemaPfade(schema);

test("Abdeckung: jeder Pfad des Schemas hat einen Eintrag, auch schon englische Namen (E10)", () => {
  const fehlend = [...SCHEMA_PFADE].filter((p) => !Object.hasOwn(SCHLUESSEL, p));
  assert.deepEqual(fehlend, []);
  assert.ok(SCHEMA_PFADE.size > 80, `nur ${SCHEMA_PFADE.size} Pfade gefunden`);
});

test("Abdeckung: die Tabelle nennt keinen Pfad, den das Schema nicht kennt", () => {
  const fremd = Object.keys(SCHLUESSEL).filter((p) => !SCHEMA_PFADE.has(p));
  assert.deepEqual(fremd, []);
});

test("Abdeckung: jeder Wert einer festen Aufzaehlung hat einen Eintrag (E11)", () => {
  const fehlend = [];
  for (const [pfad, werte] of SCHEMA_WERTE) {
    for (const w of werte) if (!Object.hasOwn(WERTE[pfad] ?? {}, w)) fehlend.push(`${pfad}: ${w}`);
  }
  assert.deepEqual(fehlend, []);
  const fremd = [];
  for (const [pfad, werte] of Object.entries(WERTE)) {
    for (const w of Object.keys(werte)) if (!SCHEMA_WERTE.get(pfad)?.has(w)) fremd.push(`${pfad}: ${w}`);
  }
  assert.deepEqual(fremd, []);
});

// Jeder Name einer Ebene darf nur zu einem deutschen Namen gehoeren.
function pruefeEindeutig(ebene, paare) {
  const namen = new Map();
  for (const [de, en] of paare) {
    for (const n of new Set([de, en])) {
      assert.ok(!namen.has(n) || namen.get(n) === de, `${ebene}: "${n}" doppelt vergeben`);
      namen.set(n, de);
    }
  }
}

test("Eindeutigkeit: kein englischer Name trifft einen anderen Namen derselben Ebene", () => {
  const ebenen = new Map();
  for (const [pfad, en] of Object.entries(SCHLUESSEL)) {
    const trenner = pfad.lastIndexOf(".");
    const eltern = trenner < 0 ? "Wurzel" : pfad.slice(0, trenner);
    ebenen.set(eltern, [...(ebenen.get(eltern) ?? []), [pfad.slice(trenner + 1), en]]);
  }
  for (const [eltern, paare] of ebenen) pruefeEindeutig(eltern, paare);
  for (const [pfad, werte] of Object.entries(WERTE)) pruefeEindeutig(pfad, Object.entries(werte));
});

test("Tabelle: die Namen aus E11 und einige Schluessel", () => {
  assert.equal(WERTE.pushPruefung.lokal, "local");
  assert.equal(WERTE["pushPruefung.ort"].buildDienst, "buildService");
  assert.equal(WERTE["buildChecks[].stufe"].paket, "package");
  assert.equal(SCHLUESSEL.pushPruefung, "pushCheck");
  assert.equal(SCHLUESSEL["night.kette"], "chain");
  assert.equal(SCHLUESSEL.codeHost, "codeHost");
  assert.equal(SCHLUESSEL.language, "language");
  assert.equal(SCHLUESSEL.vertragsRepos, "contractRepos");
  assert.equal(SCHLUESSEL["vertragsRepos[].name"], "name");
  assert.equal(SCHLUESSEL["vertragsRepos[].url"], "url");
  assert.equal(SCHLUESSEL["vertragsRepos[].zweig"], "branch");
});

// Eine deutsche Config, die moeglichst viele Formen beruehrt.
const DEUTSCH = {
  language: "de",
  codeHost: "github",
  buildChecks: [
    "npm test",
    { cmd: "npm run lint", areas: ["frontend"], stufe: "push" },
    { cmd: "npx stryker", always: true, stufe: "paket", nichtBeimAbschluss: "volleTestmenge", guete: { muster: "x", marke: "y" } },
    { cmd: "tools/hinweis.mjs", art: "hinweis", gleichzeitig: true },
  ],
  checkAreas: { frontend: ["src/ui/**"], lokal: ["lokal/**"] },
  ohnePruefung: [{ muster: "docs/**", grund: "nur Text" }],
  pushPruefung: { ort: "buildDienst", zweig: "pruefung" },
  issueReview: { reviewers: [{ name: "fable", kind: "claude", model: "claude-fable-5-1" }], pairs: { stufe: ["fable"] } },
  night: {
    kette: { label: "kit:night", paketeMin: 30, uebergaenge: { planReview: true } },
    stand: { labels: { laeuft: "lauf:laeuft" } },
    stufen: { schwer: { modell: "claude-opus-5-5", effort: "high" } },
  },
};

test("benenneUm: deutsch nach englisch, frei gewaehlte Namen und Werte bleiben", () => {
  const { config, umbenannt } = benenneUm(DEUTSCH, "en");
  assert.equal(config.pushCheck.location, "buildService");
  assert.equal(config.pushCheck.branch, "pruefung");
  assert.equal(config.buildChecks[0], "npm test");
  assert.equal(config.buildChecks[1].stage, "push");
  assert.equal(config.buildChecks[2].stage, "package");
  assert.deepEqual(config.checkAreas, DEUTSCH.checkAreas);
  assert.deepEqual(config.issueReview.pairs, { stufe: ["fable"] });
  assert.equal(config.night.chain.label, "kit:night");
  assert.equal(config.night.status.labels.running, "lauf:laeuft");
  assert.ok(!("kette" in config.night));
  assert.ok(umbenannt.some((u) => u.von === "kette" && u.nach === "chain"));
  assert.ok(umbenannt.some((u) => u.art === "wert" && u.von === "buildDienst" && u.nach === "buildService"));
  assert.ok(!umbenannt.some((u) => u.von === "codeHost"), "gleiche Namen sind keine Umbenennung");
});

test("benenneUm: Hin- und Rueckweg ergeben das Original, die Eingabe bleibt unberuehrt", () => {
  const vorher = structuredClone(DEUTSCH);
  const englisch = benenneUm(DEUTSCH, "en").config;
  assert.deepEqual(DEUTSCH, vorher);
  const zurueck = benenneUm(englisch, "de");
  assert.deepEqual(zurueck.config, DEUTSCH);
  assert.ok(zurueck.umbenannt.length > 0);
  assert.deepEqual(benenneUm(zurueck.config, "en").config, englisch);
});

test("benenneUm: dieselbe Sprache benennt nichts um", () => {
  const { config, umbenannt } = benenneUm(DEUTSCH, "de");
  assert.deepEqual(config, DEUTSCH);
  assert.deepEqual(umbenannt, []);
});

test("benenneUm: die Kurzform von pushPruefung", () => {
  assert.deepEqual(benenneUm({ pushPruefung: "lokal" }, "en").config, { pushCheck: "local" });
  assert.deepEqual(benenneUm({ pushCheck: "local" }, "de").config, { pushPruefung: "lokal" });
});

test("normalisiereConfig: englische Schluessel und Werte werden deutsch (E9)", () => {
  const englisch = benenneUm(DEUTSCH, "en").config;
  const { config, hinweise } = normalisiereConfig(englisch);
  assert.deepEqual(config, DEUTSCH);
  assert.deepEqual(hinweise, []);
});

test("normalisiereConfig: frei gewaehlte Werte bleiben unveraendert", () => {
  const roh = { mainBranch: "local", checkAreas: { package: ["a/**"] }, buildChecks: ["local"], night: { modelle: ["claude-x"] } };
  assert.deepEqual(normalisiereConfig(roh).config, roh);
});

test("normalisiereConfig: Werte nur dort, wo die Aufzaehlung steht", () => {
  // codeHost kennt "local" schon als eigenen Namen; nur pushPruefung kennt "lokal".
  const { config } = normalisiereConfig({ codeHost: "local", pushCheck: "local" });
  assert.deepEqual(config, { codeHost: "local", pushPruefung: "lokal" });
});

test("normalisiereConfig: unbekannte Schluessel bleiben, wie sie sind", () => {
  const roh = { unbekannt: { chain: 1 }, night: { fremd: true } };
  assert.deepEqual(normalisiereConfig(roh).config, roh);
});

// Ein entfallener Schalter wird ohne Fehler gelesen und wirkt nicht mehr (Issue #1726, Plan #1710 A11).
test("ENTFALLEN: toolbox.ideaStored ist entfallen und steht nicht mehr in der Tabelle", () => {
  assert.deepEqual([...ENTFALLEN], ["toolbox.ideaStored"]);
  assert.ok(Object.isFrozen(ENTFALLEN));
  assert.equal(SCHLUESSEL["toolbox.ideaStored"], undefined);
});

test("normalisiereConfig: ein entfallener Pfad wird beim Lesen gestrichen", () => {
  const roh = { toolbox: { ideaStored: true, host: "h" } };
  const { config, hinweise } = normalisiereConfig(roh);
  assert.deepEqual(config, { toolbox: { host: "h" } });
  assert.deepEqual(hinweise, []);
  assert.deepEqual(roh, { toolbox: { ideaStored: true, host: "h" } }, "die Eingabe bleibt unberuehrt");
});

test("normalisiereConfig: ohne den Elternteil oder mit fremdem Wert dort gibt es nichts zu streichen", () => {
  assert.deepEqual(normalisiereConfig({ mainBranch: "main" }).config, { mainBranch: "main" });
  assert.deepEqual(normalisiereConfig({ toolbox: "kaputt" }).config, { toolbox: "kaputt" });
  assert.deepEqual(normalisiereConfig({ toolbox: { ideaStored: false } }).config, { toolbox: {} });
});

test("normalisiereConfig: beide Namen in der Datei — es gilt der englische, gleich in welcher Sprache (A13, E5)", () => {
  const { config, hinweise } = normalisiereConfig({ vorgeschichte: false, history: true });
  assert.deepEqual(config, { vorgeschichte: true });
  assert.equal(hinweise.length, 1);
  assert.match(hinweise[0], /Doppelung/);
  assert.match(hinweise[0], /"vorgeschichte"/);
  assert.match(hinweise[0], /es gilt "history", der englische Name/);

  const de = normalisiereConfig({ language: "de", night: { kette: { planMin: 1 }, chain: { planMin: 2 } } });
  assert.deepEqual(de.config, { language: "de", night: { kette: { planMin: 2 } } });
  assert.match(de.hinweise[0], /night\.kette/);
  assert.match(de.hinweise[0], /night\.chain/);

  const en = normalisiereConfig({ language: "en", night: { chain: { planMin: 2 }, kette: { planMin: 1 } } });
  assert.deepEqual(en.config, { language: "en", night: { kette: { planMin: 2 } } });
  assert.equal(en.hinweise.length, 1);
});

test("normalisiereConfig: die Projektsprache aus dem Aufruf aendert den Vorrang nicht", () => {
  const { config } = normalisiereConfig({ reviewLesegrenze: 1, reviewReadLimit: 2 }, { sprache: "de" });
  assert.deepEqual(config, { reviewLesegrenze: 2 });
});

test("normalisiereConfig: Doppelung in einem Listeneintrag nennt die Position", () => {
  const { config, hinweise } = normalisiereConfig({ buildChecks: [{ cmd: "a", stufe: "push", stage: "merge" }] });
  assert.deepEqual(config, { buildChecks: [{ cmd: "a", stufe: "merge" }] });
  assert.match(hinweise[0], /buildChecks\[0\]\.stufe/);
});

test("normalisiereConfig: Leeres und Fremdes", () => {
  assert.deepEqual(normalisiereConfig({}), { config: {}, hinweise: [] });
  assert.deepEqual(normalisiereConfig(undefined), { config: undefined, hinweise: [] });
  assert.deepEqual(normalisiereConfig(null), { config: null, hinweise: [] });
});

// --- Englische Schluessel, Werte wie in der Datei (Issue #1725, Plan #1710 A2, A3, E1) ---

test("benenneUm mit werte: wie-vorlage benennt nur Schluessel um, \"paket\" bleibt", () => {
  const { config, umbenannt } = benenneUm({ buildChecks: [{ cmd: "a", stufe: "paket" }], pushPruefung: "lokal" }, "en", { werte: "wie-vorlage" });
  assert.deepEqual(config, { buildChecks: [{ cmd: "a", stage: "paket" }], pushCheck: "lokal" });
  assert.ok(umbenannt.every((u) => u.art === "schluessel"));
  assert.deepEqual(benenneUm(DEUTSCH, "en", { werte: "wie-vorlage" }).config.night.tiers, { hard: { model: "claude-opus-5-5", effort: "high" } });
  assert.equal(benenneUm(DEUTSCH, "en", { werte: "wie-vorlage" }).config.pushCheck.location, "buildDienst");
});

test("benenneUm: ohne Option bleiben Werte uebersetzt wie bisher", () => {
  assert.deepEqual(benenneUm({ buildChecks: [{ stufe: "paket" }] }, "en").config, { buildChecks: [{ stage: "package" }] });
});

test("mitEnglischenNamen: alle bekannten Schluessel englisch, Werte unveraendert, sprache wird language (A3)", () => {
  const roh = { sprache: "de", vorgeschichte: true, buildChecks: [{ stufe: "paket" }] };
  const vorher = structuredClone(roh);
  assert.deepEqual(mitEnglischenNamen(roh), { language: "de", history: true, buildChecks: [{ stage: "paket" }] });
  assert.deepEqual(roh, vorher, "die Eingabe bleibt unberuehrt");
});

test("mitEnglischenNamen: englische Datei bleibt, frei gewaehlte Namen bleiben, language schlaegt sprache", () => {
  const englisch = benenneUm(DEUTSCH, "en", { werte: "wie-vorlage" }).config;
  assert.deepEqual(mitEnglischenNamen(englisch), englisch);
  assert.deepEqual(mitEnglischenNamen(DEUTSCH).checkAreas, DEUTSCH.checkAreas);
  assert.deepEqual(mitEnglischenNamen({ language: "en", sprache: "de" }), { language: "en" });
  assert.equal(mitEnglischenNamen(undefined), undefined);
});

test("benenneWieVorlage: schreibt englische Schluessel auch in einem deutschen Projekt", () => {
  const vorlage = { language: "de", vorgeschichte: true, night: { kette: { label: "k" } }, buildChecks: [{ cmd: "t", stufe: "paket" }] };
  const config = normalisiereConfig(vorlage).config;
  config.vertragsRepos = [];
  config.buildChecks.push({ cmd: "u", stufe: "push" });
  assert.deepEqual(benenneWieVorlage(config, vorlage, "de"), {
    language: "de",
    history: true,
    night: { chain: { label: "k" } },
    buildChecks: [{ cmd: "t", stage: "paket" }, { cmd: "u", stage: "push" }],
    contractRepos: [],
  });
});

test("benenneWieVorlage mit werte: wie-vorlage — Werte der Datei bleiben, neue werden englisch", () => {
  const vorlage = { buildChecks: [{ cmd: "t", stufe: "paket" }], pushPruefung: { ort: "buildDienst" } };
  const config = normalisiereConfig(vorlage).config;
  config.buildChecks.push({ cmd: "u", stufe: "paket" });
  assert.deepEqual(benenneWieVorlage(config, vorlage, "de", { werte: "wie-vorlage" }), {
    buildChecks: [{ cmd: "t", stage: "paket" }, { cmd: "u", stage: "package" }],
    pushCheck: { location: "buildDienst" },
  });
});
