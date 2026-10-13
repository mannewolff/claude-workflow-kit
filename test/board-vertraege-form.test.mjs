// Teil vertraege: der Unterabschnitt `### Verträge` im Plan und Gate P14 (Issue #1612, Plan
// #1611 E1 bis E4, E14). Ein Plan, der etwas festlegt, das das andere Repo des Paars liest oder
// schreibt, fuehrt die Festlegung als Vertrag in fester Form; P14 prueft die Form und verlangt
// fuer jeden offenen Vertrag eine Frage unter `## Offene Fragen`. Die festen Woerter gelten nur
// in der Projektsprache (E3); ohne `vertragsRepos` in der Config prueft P14 nichts (E2).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { TEXTE, vertraegeLesen, pruefeVertraege } from "../kit/board/vertraege.mjs";
import { VERTRAG, UEBERSCHRIFTEN, pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { zerlegeAbschnitte } from "../kit/board/dokumente.mjs";
import { pruefePlan } from "../kit/board/geschuetzt.mjs";
import { pruefeForm } from "../kit/board/testhinweise.mjs";

afterEach(() => spracheFestlegen(null));

const REPOS = [{ name: "kanban-kit", url: "https://example.org/kanban-kit.git" }];

/** Ein Plan mit den sechs Pflichtabschnitten, `vertraege` am Ende der Entscheidungen. */
function plan(vertraege, fragen = "- Keine.") {
  return [
    "Plan-Modell: claude-opus-5-5",
    "",
    "## Ziel",
    "Ein Ziel.",
    "",
    "## Betroffene Bereiche",
    "- `kit/board/vertraege.mjs`",
    "",
    "## Architektonische Entscheidungen",
    "- E1: Eine Frage. Gewählt: a. Verworfen: b. Grund: c. Rückbau: d.",
    "",
    vertraege,
    "",
    "## Geplante Aenderungen",
    "- Schritt 1",
    "",
    "## Offene Fragen",
    fragen,
    "",
    "## Verifizierung",
    "- `node --test`",
  ].join("\n");
}

const abschnitteVon = (body) => zerlegeAbschnitte(body).abschnitte;
const p14 = (body, optionen = { vertragsRepos: REPOS }) => pruefeVertraege(abschnitteVon(body), optionen);

const V_STIMMT = [
  "### Verträge",
  "- V1: Die Laufkennung heißt `Run-ID:` — kanban-kit, liest",
  "  Gebauter Stand: kanban-kit@0123456789ab, src/lauf.ts:12",
  "  Abgleich: stimmt",
].join("\n");

const vertrag = (n, abgleich, extra = []) => [
  `- V${n}: Das Label heißt \`run:running\` — kanban-kit, schreibt`,
  "  Gebauter Stand: kanban-kit@0123456789ab, src/labels.ts:7",
  `  Abgleich: ${abgleich}`,
  ...extra,
].join("\n");

const ZWEI_OFFEN = ["### Verträge", vertrag(1, "weicht ab"), vertrag(2, "fehlt")].join("\n");

test("Feld vertragsRepos gesetzt und `### Verträge` fehlt: P14", () => {
  const v = p14(plan(""));
  assert.equal(v.length, 1);
  assert.equal(v[0].gate, "P14");
  assert.match(v[0].meldung, /### Verträge/);
});

test("Feld vertragsRepos nicht gesetzt: kein P14, auch ohne Unterabschnitt", () => {
  assert.deepEqual(p14(plan(""), {}), []);
  assert.deepEqual(p14(plan(""), { vertragsRepos: [] }), []);
  assert.deepEqual(p14(plan(ZWEI_OFFEN), {}), []);
});

test("`Abgleich: weicht ab` ohne `Entschieden:` und `- Keine.` unter Offene Fragen: P14", () => {
  const v = p14(plan(["### Verträge", vertrag(1, "weicht ab")].join("\n")));
  assert.equal(v.length, 1);
  assert.equal(v[0].gate, "P14");
  assert.match(v[0].meldung, /V1/);
});

test("die Frage nennt V1 und V2: kein P14", () => {
  assert.deepEqual(p14(plan(ZWEI_OFFEN, "- Die Verträge V1 und V2 weichen ab: Plan anpassen oder kanban-kit nachziehen?")), []);
});

test("die Frage nennt nur V1 von zwei offenen: P14, die Meldung nennt V2", () => {
  const v = p14(plan(ZWEI_OFFEN, "- Vertrag V1 weicht ab: wie weiter?"));
  assert.equal(v.length, 1);
  assert.match(v[0].meldung, /V2/);
});

test("die Meldung zu (d) nennt die offenen V-Nummern und verbietet Abgleich zu aendern und Entschieden einzutragen", () => {
  const [{ meldung }] = p14(plan(ZWEI_OFFEN));
  assert.match(meldung, /V1, V2/);
  assert.match(meldung, /## Offene Fragen/);
  assert.match(meldung, /`Abgleich:`/);
  assert.match(meldung, /`Entschieden:`/);
  assert.match(meldung, /nicht geändert/);
  assert.match(meldung, /keine Zeile `Entschieden:`/);
});

test("`Abgleich: stimmt`: kein P14", () => {
  assert.deepEqual(p14(plan(V_STIMMT)), []);
});

test("`vom Projekt vorgelegt` mit `nicht prüfbar`: P14", () => {
  const body = plan([
    "### Verträge",
    "- V1: Die Laufkennung heißt `Run-ID:` — kanban-kit, liest",
    "  Gebauter Stand: nicht prüfbar: Klon scheiterte",
    "  Abgleich: vom Projekt vorgelegt",
    "  Wortlaut: `Run-ID: <id>`",
    "  Vorgelegt laut Fachplan: „Das Kit legt die Laufkennung vor.“",
  ].join("\n"));
  const v = p14(body);
  assert.equal(v.length, 1);
  assert.match(v[0].meldung, /fehlt, geprüft/);
});

test("`vom Projekt vorgelegt` ohne `Wortlaut:` und Zitat: P14", () => {
  const body = plan([
    "### Verträge",
    "- V1: Die Laufkennung heißt `Run-ID:` — kanban-kit, liest",
    "  Gebauter Stand: fehlt, geprüft kanban-kit@0123456789ab",
    "  Abgleich: vom Projekt vorgelegt",
  ].join("\n"));
  const v = p14(body);
  assert.equal(v.length, 1);
  assert.match(v[0].meldung, /Wortlaut:/);
  assert.match(v[0].meldung, /Vorgelegt laut Fachplan:/);
});

test("`vom Projekt vorgelegt` mit `fehlt, geprüft`, `Wortlaut:` und Zitat: kein P14", () => {
  const body = plan([
    "### Verträge",
    "- V1: Die Laufkennung heißt `Run-ID:` — kanban-kit, liest",
    "  Gebauter Stand: fehlt, geprüft kanban-kit@0123456789ab",
    "  Abgleich: vom Projekt vorgelegt",
    "  Wortlaut: `Run-ID: <id>`",
    "  Vorgelegt laut Fachplan: „Das Kit legt die Laufkennung vor.“",
  ].join("\n"));
  assert.deepEqual(p14(body), []);
});

test("`Entschieden:` gesetzt: kein P14, auch bei `- Keine.` unter Offene Fragen", () => {
  const body = plan(["### Verträge", vertrag(1, "weicht ab", [
    "  Entschieden: 2026-10-13, Plan angepasst — der Plan übernimmt den Namen des Kits.",
  ])].join("\n"));
  assert.deepEqual(p14(body), []);
});

test("Leerform `- Kein Vertrag.` bei gesetztem Feld: kein P14", () => {
  assert.deepEqual(p14(plan("### Verträge\n- Kein Vertrag. Nichts wird mit kanban-kit geteilt.")), []);
});

test("leerer Unterabschnitt ohne Leerform: P14", () => {
  const v = p14(plan("### Verträge\n"));
  assert.equal(v.length, 1);
  assert.match(v[0].meldung, /- Kein Vertrag\./);
});

test("Repo-Name nicht in vertragsRepos: P14 mit den bekannten Namen", () => {
  const body = plan(V_STIMMT.replace("— kanban-kit, liest", "— anderes-repo, liest"));
  const v = p14(body);
  assert.equal(v.length, 1);
  assert.match(v[0].meldung, /anderes-repo/);
  assert.match(v[0].meldung, /kanban-kit/);
});

test("Eintrag ohne `Gebauter Stand:` oder mit unbekanntem Abgleich-Wert: P14", () => {
  const ohneStand = plan(V_STIMMT.replace(/\n {2}Gebauter Stand:[^\n]*/, ""));
  assert.match(p14(ohneStand)[0].meldung, /Gebauter Stand:/);
  const unbekannt = plan(V_STIMMT.replace("Abgleich: stimmt", "Abgleich: passt schon"));
  assert.match(p14(unbekannt)[0].meldung, /passt schon/);
});

test("Eintrag ohne Richtung `liest` oder `schreibt`: P14", () => {
  const body = plan(V_STIMMT.replace("— kanban-kit, liest", "— kanban-kit"));
  assert.equal(p14(body).length, 1);
});

test("vertraegeLesen liefert die V-Eintraege mit ihren Zeilen", () => {
  const eintraege = vertraegeLesen(abschnitteVon(plan(ZWEI_OFFEN)));
  assert.deepEqual(eintraege.map((e) => e.nummer), [1, 2]);
  assert.equal(eintraege[0].repo, "kanban-kit");
  assert.equal(eintraege[0].richtung, "schreibt");
  assert.equal(eintraege[0].abgleich, "weicht ab");
  assert.equal(eintraege[1].abgleich, "fehlt");
  assert.equal(eintraege[0].gebauterStand, "kanban-kit@0123456789ab, src/labels.ts:7");
  assert.equal(eintraege[0].entschieden, null);
});

test("englisches Projekt: englische Werte einschliesslich `missing, checked` und `- No contract.`", () => {
  spracheFestlegen("en");
  const englisch = [
    "### Contracts",
    "- V1: The run id is called `Run-ID:` — kanban-kit, reads",
    "  Built state: kanban-kit@0123456789ab, src/run.ts:12",
    "  Match: matches",
    "- V2: The label is called `run:running` — kanban-kit, writes",
    "  Built state: missing, checked kanban-kit@0123456789ab",
    "  Match: proposed by the project",
    "  Wording: `run:running`",
    "  Proposed per requirement: \"The kit proposes the label.\"",
    "- V3: The marker is called `Log:` — kanban-kit, reads",
    "  Built state: not checkable: clone failed",
    "  Match: not checkable",
    "  Decided: 2026-10-13, deviation accepted — kanban-kit follows later.",
  ].join("\n");
  assert.deepEqual(p14(plan(englisch)), []);
  assert.deepEqual(p14(plan("### Contracts\n- No contract.")), []);

  const offen = p14(plan(["### Contracts", "- V1: The label — kanban-kit, writes", "  Built state: kanban-kit@0123456789ab, a.ts:1", "  Match: differs"].join("\n")));
  assert.equal(offen.length, 1);
  assert.match(offen[0].meldung, /V1/);
  assert.match(offen[0].meldung, /`Match:`/);
  assert.match(offen[0].meldung, /`Decided:`/);
});

test("englisches Projekt nimmt deutsche Werte nicht an (nur die Projektsprache)", () => {
  spracheFestlegen("en");
  const v = p14(plan(V_STIMMT));
  assert.ok(v.length >= 1);
  assert.ok(v.every((x) => x.gate === "P14"));
});

test("VERTRAG fuehrt alle festen Woerter der Form je Sprache", () => {
  assert.deepEqual({ ...UEBERSCHRIFTEN.vertraege }, { de: "Verträge", en: "Contracts" });
  assert.deepEqual({ ...VERTRAG.gebauterStand }, { de: "Gebauter Stand:", en: "Built state:" });
  assert.deepEqual({ ...VERTRAG.abgleich }, { de: "Abgleich:", en: "Match:" });
  assert.deepEqual({ ...VERTRAG.stimmt }, { de: "stimmt", en: "matches" });
  assert.deepEqual({ ...VERTRAG.weichtAb }, { de: "weicht ab", en: "differs" });
  assert.deepEqual({ ...VERTRAG.fehlt }, { de: "fehlt", en: "missing" });
  assert.deepEqual({ ...VERTRAG.nichtPruefbar }, { de: "nicht prüfbar", en: "not checkable" });
  assert.deepEqual({ ...VERTRAG.vorgelegt }, { de: "vom Projekt vorgelegt", en: "proposed by the project" });
  assert.deepEqual({ ...VERTRAG.standFehlt }, { de: "fehlt, geprüft", en: "missing, checked" });
  assert.deepEqual({ ...VERTRAG.standNichtPruefbar }, { de: "nicht prüfbar:", en: "not checkable:" });
  assert.deepEqual({ ...VERTRAG.liest }, { de: "liest", en: "reads" });
  assert.deepEqual({ ...VERTRAG.schreibt }, { de: "schreibt", en: "writes" });
  assert.deepEqual({ ...VERTRAG.keinVertrag }, { de: "- Kein Vertrag.", en: "- No contract." });
  for (const sache of ["wortlaut", "vorgelegtLaut", "installiert", "entschieden", "planAngepasst", "repoZiehtNach", "abweichungAngenommen"]) {
    assert.ok(VERTRAG[sache]?.de && VERTRAG[sache]?.en, sache);
  }
});

test("die Texttabelle hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
});

test("pruefePlan haengt P14 an, wenn vertragsRepos gesetzt ist", () => {
  const abschnitte = abschnitteVon(plan(""));
  const gates = (v) => v.map((x) => x.gate);
  assert.ok(!gates(pruefePlan(["Plan-Modell: x"], abschnitte, [])).includes("P14"));
  assert.ok(gates(pruefePlan(["Plan-Modell: x"], abschnitte, [], { vertragsRepos: REPOS })).includes("P14"));
});

test("pruefeForm (issue check-form) reicht config.vertragsRepos durch", () => {
  const body = plan(ZWEI_OFFEN);
  const ohne = pruefeForm(body, "[Plan] Probe", {});
  assert.ok(!ohne.verstoesse.some((v) => v.gate === "P14"));
  const mit = pruefeForm(body, "[Plan] Probe", { vertragsRepos: REPOS });
  assert.equal(mit.ok, false);
  assert.deepEqual(mit.verstoesse.filter((v) => v.gate === "P14").length, 1);
});
