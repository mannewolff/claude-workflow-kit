// Der Nachtlauf erkennt Kit-Labels unter beiden Namen (Issue #1425, Plan #1420 E3, E4, E7).
//
// Auf einem gemischten Board tragen alte Karten deutsche, neue englische Praefixe und
// Labels. Auswahl, Zurueckstellen, Ziel-Erkennung und Abnehmen behandeln beide gleich;
// abgenommen wird der Name, den die Karte traegt. Ein gesetzter Config-Wert fuer
// `night.kette.label`, `varianteBLabel` oder `pruefLauf.label` gilt unveraendert, erkannt
// werden er und beide Vorgabenamen (E7). Ohne gesetzten Wert nennt und setzt der Nachtlauf
// den Namen der Projektsprache (Issue #1429).

import { test } from "node:test";
import assert from "node:assert/strict";

import { kennzeichenName, ladeKetteBudget, ladePruefLaufBudget, pruefreihenVon, varianteVon, zielLabelName, zielVon } from "../kit/night/session.mjs";
import { UNGEPRUEFT_PRAEFIX, ZIEL_UNPASSEND_PRAEFIX, beanspruchen, beanspruchtGrund, istUngeprueftGrund, laeuftLabelName, pruefungFehltGrund,
  reviewFertigLabelName, waehleKettenKandidaten, zielAusschluss } from "../kit/night/kette.mjs";
import { ZUSTAND } from "../kit/night/grundlagen.mjs";
import { pruefLaufAusschluss, waehlePruefLaufKandidaten } from "../kit/night/tag.mjs";
import { GLATT, KETTE_LABEL, fachplanKarte, ketteImProzess } from "./helpers/kette-fixture.mjs";
import { BUDGET, pruefKarte, pruefLaufImProzess, pruefungGeprueft } from "./helpers/tag-fixture.mjs";

const KETTE = ladeKetteBudget({});
const entferntAn = (r, id) => r.aufrufe.filter((a) => a[1] === "label" && a[2] === "remove" && a[3] === id).map((a) => a[4]);

// --- kennzeichenName: gesetzter Wert und beide Vorgabenamen ---

test("kennzeichenName liefert den Namen, den die Karte traegt, unter jedem Namen der Sache", () => {
  assert.equal(kennzeichenName(["kit:check"], "kit:pruefen", "pruefen"), "kit:check");
  assert.equal(kennzeichenName(["kit:pruefen"], "kit:pruefen", "pruefen"), "kit:pruefen");
  assert.equal(kennzeichenName(["kit:carry-through"], "kit:durchziehen", "durchziehen"), "kit:carry-through");
  assert.equal(kennzeichenName(["review:done"], "kit:pruefen", "pruefen"), null);
  assert.equal(kennzeichenName(undefined, "kit:pruefen", "pruefen"), null);
});

test("E7: ein gesetzter Wert wird erkannt, die beiden Vorgabenamen ebenso", () => {
  assert.equal(kennzeichenName(["mein:pruefen"], "mein:pruefen", "pruefen"), "mein:pruefen");
  assert.equal(kennzeichenName(["kit:pruefen"], "mein:pruefen", "pruefen"), "kit:pruefen");
  assert.equal(kennzeichenName(["kit:check"], "mein:pruefen", "pruefen"), "kit:check");
  assert.equal(kennzeichenName(["fremd"], "mein:pruefen", "pruefen"), null);
});

test("ohne Sache gilt die Sache des gesetzten Namens", () => {
  assert.equal(kennzeichenName(["kit:check"], "kit:pruefen"), "kit:check");
  assert.equal(kennzeichenName(["eigenes"], "eigenes"), "eigenes");
  assert.equal(kennzeichenName(["anderes"], "eigenes"), null);
});

// --- Ziel-Erkennung ---

test("goal:* zaehlt wie ziel:*, kit:carry-through wie kit:durchziehen", () => {
  assert.equal(zielVon({ labels: ["goal:plan"] }, KETTE), "plan");
  assert.equal(zielVon({ labels: ["goal:packages"] }, KETTE), "pakete");
  assert.equal(zielVon({ labels: ["goal:implementation"] }, KETTE), "umsetzung");
  assert.equal(zielVon({ labels: ["goal:push-prepared", "ziel:plan"] }, KETTE), "push-vorbereitet");
  assert.equal(zielVon({ labels: ["kit:carry-through"] }, KETTE), "umsetzung");
  assert.equal(varianteVon({ labels: ["kit:carry-through"] }, KETTE), "B");
  assert.equal(varianteVon({ labels: ["goal:packages"] }, KETTE), "A");
  assert.equal(pruefreihenVon({ labels: ["planreview:2"] }), 2);
});

test("E7: ein gesetztes varianteBLabel gilt, die beiden Vorgabenamen ebenso", () => {
  const budget = ladeKetteBudget({ night: { kette: { varianteBLabel: "mein:durch" } } });
  for (const label of ["mein:durch", "kit:durchziehen", "kit:carry-through"]) {
    assert.equal(zielVon({ labels: [label] }, budget), "umsetzung", label);
  }
  assert.equal(zielVon({ labels: ["fremd"] }, budget), null);
});

test("zielAusschluss zaehlt deutsche und englische Ziel-Labels zusammen", () => {
  const fach = (...labels) => ({ id: "1", title: "[Requirement] Anliegen", labels: [KETTE_LABEL, ...labels] });
  const grund = zielAusschluss(fach("goal:plan", "ziel:pakete"), "fachplan", null);
  assert.ok(grund?.startsWith(ZIEL_UNPASSEND_PRAEFIX), grund);
  assert.match(grund, /goal:plan, ziel:pakete/);
  assert.match(zielAusschluss(fach("goal:plan", "goal:wasauchimmer"), "fachplan", null), /mehr als ein Ziel/);
  assert.equal(zielAusschluss(fach("goal:plan"), "fachplan", null), null);
  const plan = { id: "2", title: "[Plan] Weg", labels: [KETTE_LABEL, "goal:plan"] };
  assert.match(zielAusschluss(plan, "plan", null), /goal:plan an einem Plandokument/);
});

// --- Auswahl der Kette auf einem gemischten Board ---

const gemischt = () => [
  { id: "10", title: "[Fachlich] Alt", status: "backlog", body: "", labels: [KETTE_LABEL, "review:fertig", "ziel:plan"] },
  { id: "11", title: "[Requirement] Neu", status: "backlog", body: "", labels: [KETTE_LABEL, "review:done", "goal:plan"] },
  { id: "12", title: "[Requirement] Ungeprueft", status: "backlog", body: "", labels: [KETTE_LABEL, "goal:plan"] },
  { id: "13", title: "[Requirement] Klaeren", status: "backlog", body: "", labels: [KETTE_LABEL, "review:done", "kit:clarify"] },
];

test("Auswahl der Kette: deutsche und englische Karten gleich, Zurueckstellen unter beiden Namen", () => {
  const r = waehleKettenKandidaten(gemischt(), KETTE_LABEL, 5);
  assert.deepEqual(r.kandidaten.map((a) => a.karte.id), ["10", "11"]);
  const gruende = Object.fromEntries(r.uebersprungen.map((u) => [u.id, u.grund]));
  assert.match(gruende["12"], /^ungeprueft/);
  assert.match(gruende["13"], /kit:klaeren/);
});

test("E7: ein gesetztes Kettenlabel waehlt seine Karten und die mit einem Vorgabenamen", () => {
  const karten = [
    { id: "20", title: "[Requirement] Eigenes", status: "backlog", body: "", labels: ["mein:nacht", "review:done"] },
    { id: "21", title: "[Fachlich] Vorgabe", status: "backlog", body: "", labels: [KETTE_LABEL, "review:fertig"] },
    { id: "22", title: "[Fachlich] Ohne", status: "backlog", body: "", labels: ["review:fertig"] },
  ];
  const r = waehleKettenKandidaten(karten, "mein:nacht", 5, { sache: "night" });
  assert.deepEqual(r.kandidaten.map((a) => a.karte.id), ["20", "21"]);
});

// --- Auswahl des Prueflaufs ---

test("Prueflauf: kit:check zaehlt wie kit:pruefen, auch neben einem gesetzten Wert", () => {
  const karten = [
    { id: "30", title: "[Fachlich] Alt", labels: ["kit:pruefen"] },
    { id: "31", title: "[Requirement] Neu", labels: ["kit:check"] },
    { id: "32", title: "[Requirement] Eigenes", labels: ["mein:pruefen"] },
    { id: "33", title: "[Requirement] Klaeren", labels: ["kit:check", "kit:clarify"] },
  ];
  const vorgabe = waehlePruefLaufKandidaten(karten, ladePruefLaufBudget({}).label, null);
  assert.deepEqual(vorgabe.kandidaten.map((k) => k.id), ["30", "31"]);
  assert.match(vorgabe.uebersprungen[0].grund, /kit:(klaeren|clarify)/);
  const gesetzt = waehlePruefLaufKandidaten(karten, "mein:pruefen", null, { sache: "pruefen" });
  assert.deepEqual(gesetzt.kandidaten.map((k) => k.id), ["30", "31", "32"]);
  assert.equal(pruefLaufAusschluss(karten[1], "kit:pruefen"), null);
});

// --- Abnehmen nimmt den Namen ab, den die Karte traegt ---

test("Kette: der Start nimmt goal:* und das Kettenlabel unter ihrem Namen ab", async () => {
  const F = "1";
  const r = await ketteImProzess({ karten: [fachplanKarte(F, { titel: "[Requirement] Neu", labels: [KETTE_LABEL, "review:done", "goal:plan"] })], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(entferntAn(r, F), [KETTE_LABEL, "goal:plan"]);
  assert.match(r.ausgabe, /Ziel plan/);
  assert.ok(r.karte(F).labels.includes("review:done"), "fremde Labels bleiben");
});

test("E7: Kette mit gesetztem Kettenlabel nimmt den Vorgabenamen ab, den die Karte traegt", async () => {
  const F = "1";
  const r = await ketteImProzess({
    karten: [fachplanKarte(F, { labels: [KETTE_LABEL, "review:fertig", "ziel:plan"] })],
    kette: { label: "mein:nacht" }, sitzung: GLATT,
  });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(entferntAn(r, F), [KETTE_LABEL, "ziel:plan"]);
  assert.ok(!r.aufrufe.some((a) => a.join(" ") === `issue label remove ${F} mein:nacht`), "ein Name abgenommen, den die Karte nicht traegt");
});

test("Prueflauf: kit:check und review:done werden unter ihrem Namen abgenommen", async () => {
  const karte = pruefKarte(1, { titel: "[Requirement] Neu", labels: ["kit:check", "review:done"] });
  const r = await pruefLaufImProzess({ karten: [karte], sitzung: pruefungGeprueft });
  assert.equal(r.code, 0, r.ausgabe);
  assert.deepEqual(entferntAn(r, "1").slice(0, 2), ["kit:check", "review:done"]);
  assert.ok(!entferntAn(r, "1").includes(BUDGET.label), "der deutsche Name wurde abgenommen, die Karte traegt den englischen");
});

// --- Laufstand: run:running zaehlt wie lauf:laeuft ---

test("Beanspruchen: eine Karte mit run:running und lebender Lauf-ID wird ausgelassen", () => {
  const halter = `hier/${process.pid}/halter`;
  const karte = {
    id: "10", title: "[Requirement] Die Wurzel", body: "Ziel", labels: ["run:running"],
    comments: [{ body: `## Laufstand\n\nLauf angenommen\n\nLauf-ID: ${halter}\nStand: ${new Date().toISOString()}\n` }],
  };
  const geschrieben = [];
  const r = beanspruchen([{ karte, art: "fachlich", F: "10" }], {
    lesen: () => structuredClone(karte), schreiben: (...a) => geschrieben.push(a), warten: () => {},
    laufId: "hier/1/ich", host: "hier", abgeben: () => {},
  });
  assert.deepEqual(r.beansprucht, []);
  assert.deepEqual(r.abgegeben, [{ id: "10", title: karte.title, grund: beanspruchtGrund(halter) }]);
  assert.deepEqual(geschrieben, [], "kein Schreiben an einer belegten Wurzel");
});

// --- Geschrieben wird der Name der Projektsprache (Issue #1429, Plan #1420 E4, E7) ---
//
// Ohne Config-Wert haengt die Vorgabe an der Projektsprache; ein gesetzter Wert gilt
// unveraendert. Was der Nachtlauf nach aussen nennt oder abnimmt, wenn die Karte keinen
// Namen traegt, ist dieser Name.

const EN = { language: "en" };

/** Fuehrt `fn` mit einer Projektsprache im Prozesszustand des Nachtlaufs aus. */
function mitConfig(config, fn) {
  const vorher = ZUSTAND.config;
  ZUSTAND.config = config;
  try {
    return fn();
  } finally {
    ZUSTAND.config = vorher;
  }
}

test("englisches Projekt: Vorgaben der Kennzeichen heissen englisch, kit:night bleibt", () => {
  const kette = ladeKetteBudget(EN);
  assert.equal(kette.label, "kit:night");
  assert.equal(kette.varianteBLabel, "kit:carry-through");
  assert.equal(ladePruefLaufBudget(EN).label, "kit:check");
  assert.equal(ladePruefLaufBudget({ sprache: "en" }).label, "kit:check", "der deutsche Altname des Felds gilt ebenso");
});

test("deutsches Projekt: die Vorgaben bleiben deutsch", () => {
  for (const config of [{}, { language: "de" }, { language: "fr" }]) {
    assert.equal(ladeKetteBudget(config).varianteBLabel, "kit:durchziehen");
    assert.equal(ladePruefLaufBudget(config).label, "kit:pruefen");
  }
});

test("E7: ein gesetzter Config-Wert gilt woertlich, auch im englischen Projekt", () => {
  const kette = ladeKetteBudget({ ...EN, night: { kette: { label: "mein:nacht", varianteBLabel: "kit:durchziehen" } } });
  assert.equal(kette.label, "mein:nacht");
  assert.equal(kette.varianteBLabel, "kit:durchziehen");
  assert.equal(ladePruefLaufBudget({ ...EN, pruefLauf: { label: "kit:pruefen" } }).label, "kit:pruefen");
  assert.equal(laeuftLabelName({ ...EN, night: { stand: { labels: { laeuft: "lauf:laeuft" } } } }), "lauf:laeuft");
});

test("Ziel-Labels heissen in der Projektsprache goal:* oder ziel:*", () => {
  assert.equal(zielLabelName("plan", EN), "goal:plan");
  assert.equal(zielLabelName("pakete", EN), "goal:packages");
  assert.equal(zielLabelName("umsetzung", EN), "goal:implementation");
  assert.equal(zielLabelName("push-vorbereitet", EN), "goal:push-prepared");
  assert.equal(zielLabelName("pakete", {}), "ziel:pakete");
  assert.throws(() => zielLabelName("irgendwas", EN), /unbekanntes Ziel/);
});

test("Laufstand: run:running im englischen, lauf:laeuft im deutschen Projekt", () => {
  assert.equal(laeuftLabelName(EN), "run:running");
  assert.equal(laeuftLabelName({}), "lauf:laeuft");
  assert.equal(laeuftLabelName(undefined), "lauf:laeuft");
});

test("englisches Projekt: der Grund fuer eine ungepruefte Karte nennt review:done", () => {
  const g = mitConfig(EN, () => pruefungFehltGrund("7", "kit:night"));
  assert.match(g.text, /Label 'review:done' fehlt/);
  assert.match(g.schritt, /das setzt review:done;/);
  assert.doesNotMatch(g.text, /review:fertig/);
  assert.ok(istUngeprueftGrund(g.text), "der englische Grund wird als ungeprueft erkannt");
  assert.equal(reviewFertigLabelName(EN), "review:done");
});

test("deutsches Projekt: der Grund nennt weiter review:fertig", () => {
  const g = mitConfig({}, () => pruefungFehltGrund("7", "kit:night"));
  assert.ok(g.text.startsWith(UNGEPRUEFT_PRAEFIX), g.text);
  assert.match(g.text, /review:fertig/);
  assert.ok(istUngeprueftGrund(g.text));
  assert.equal(reviewFertigLabelName({}), "review:fertig");
});

test("englisches Projekt: die Auswahl der Kette lehnt eine ungepruefte Karte mit review:done ab", () => {
  const karten = [{ id: "40", title: "[Requirement] Neu", status: "backlog", body: "", labels: [KETTE_LABEL] }];
  const r = mitConfig(EN, () => waehleKettenKandidaten(karten, KETTE_LABEL, 5));
  assert.match(r.uebersprungen[0].grund, /Label 'review:done' fehlt/);
});
