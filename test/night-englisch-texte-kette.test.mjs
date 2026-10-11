// Meldungen des Nacht-Runners zweisprachig, Gruppe kit/night/kette.mjs (Plan #1420 E13/E14).
//
// Die Kette traegt ihre Texte an den Menschen in einer Tabelle TEXTE { de, en } und gibt sie
// ueber den Texthelfer aus kit/board/namen.mjs aus:
//   - Paritaet: dieselben Schluessel und Platzhalter in beiden Sprachen.
//   - Englische Stichproben: ein englisches Projekt sieht die englische Form; der Grund eines
//     Zeitbudget-Abbruchs beginnt in der Form der Vorlage am Plan #1420 (`Time budget`).
//   - Die deutschen Wortlaut-Tests der Kette (test/night-kette-*.test.mjs) bleiben, wie sie
//     sind, und laufen mit der Vorgabe Deutsch.
//
// Das Paket #1449 ist in drei Teile geschnitten. Der erste (#1491) deckt kit/night/kette.mjs
// vom Dateianfang bis vor `formSicherstellen`; die Teile #1492 und #1493 ergaenzen diese Datei.

import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  TEXTE as KETTE_TEXTE, UNGEPRUEFT_PRAEFIX, ZIEL_UNPASSEND_PRAEFIX, budgetDefaultsZeile, istUngeprueftGrund,
  istZielUnpassendGrund, ketteAbhaengigkeiten, ketteAnbinden, offeneFragenGrund, planAusschluss, pruefungFehltGrund,
  stoppFragenGrund, waehleKettenKandidaten, wartendBeendet, zielAusschluss, KETTE_ZUSATZ,
} from "../kit/night/kette.mjs";
import { KETTE_BUDGET_DEFAULTS } from "../kit/night/session.mjs";
import { ZUSTAND } from "../kit/night/grundlagen.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { deutschAmHelferVorbei, deutschImEnglischen } from "./helpers/quelltext-texte.mjs";

/** Fuehrt `fn` mit der Prozesssprache `sprache` aus und vergisst sie danach wieder. */
async function inSprache(sprache, fn) {
  spracheFestlegen(sprache);
  try {
    return await fn();
  } finally {
    spracheFestlegen(null);
  }
}

/** Faengt die Protokollzeilen von `log` ab, solange `fn` laeuft. */
async function mitProtokoll(fn) {
  const zeilen = [];
  const schreiben = process.stdout.write;
  process.stdout.write = (chunk) => {
    zeilen.push(String(chunk));
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = schreiben;
  }
  return zeilen.join("");
}

/** Fuehrt `fn` mit der Config `config` im Zustand des Runners aus. */
async function mitConfig(config, fn) {
  const vorher = ZUSTAND.config;
  ZUSTAND.config = config;
  try {
    return await fn();
  } finally {
    ZUSTAND.config = vorher;
  }
}

after(() => ketteAbhaengigkeiten());

// --- kit/night/kette.mjs, Teil 1: bis vor formSicherstellen (Issue #1491) -----------------

test("[1491] die Texttabelle der Kette hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(KETTE_TEXTE), []);
  assert.ok(Object.keys(KETTE_TEXTE.de).length >= 40, "die Tabelle traegt die Meldungen des ersten Teils");
});

test("[1491] englisch: Fehler der Anbindung und der Abhaengigkeiten", async () => {
  await inSprache("en", () => {
    assert.throws(() => ketteAnbinden({ quer: () => {} }), { message: "ketteAnbinden knows no hook 'quer'" });
    assert.throws(() => ketteAbhaengigkeiten({ quer: () => {} }), { message: "ketteAbhaengigkeiten knows no dependency 'quer'" });
  });
});

test("[1491] englisch: die Protokollzeile zu den Budgets aus den Defaults", async () => {
  await inSprache("en", () => {
    const felder = Object.keys(KETTE_BUDGET_DEFAULTS);
    assert.equal(budgetDefaultsZeile({ planMin: 30 }, ["planMin"]), "Budget of the chain from the defaults: planMin=30");
    assert.match(budgetDefaultsZeile(KETTE_BUDGET_DEFAULTS, felder),
      /^Budget of the chain from the defaults: .+ — night\.kette in \.claude\/workflow\.config\.json is missing or sets no field\.$/);
  });
});

test("[1491] englisch: die Pruefung fehlt — Grund in der Projektsprache, erkannt in beiden", async () => {
  await mitConfig({ language: "en" }, () => inSprache("en", () => {
    const { praefix, text } = pruefungFehltGrund("5", "kit:night");
    assert.equal(praefix, "unchecked: label 'review:done' missing");
    assert.equal(text, "unchecked: label 'review:done' missing — have it checked with /issue-review #5, which sets review:done; "
      + "the label kit:night stays on");
    assert.ok(istUngeprueftGrund(text));
  }));
  assert.ok(istUngeprueftGrund(`${UNGEPRUEFT_PRAEFIX} — irgendwas`), "der deutsche Grund wird auch erkannt");
  assert.ok(istUngeprueftGrund("unchecked: label 'review:fertig' missing — x"), "der englische Satz mit deutschem Label");
  assert.ok(!istUngeprueftGrund("is in ready, not in Backlog"));
});

test("[1491] englisch: Stopp-Fragen und Fragen an den PO", async () => {
  await inSprache("en", () => {
    assert.equal(stoppFragenGrund("kein Abschnitt"), "no section ## Open questions");
    assert.equal(stoppFragenGrund("## Offene Fragen\n\n"), "section ## Open questions is empty");
    assert.equal(stoppFragenGrund("## Offene Fragen\n- Wer entscheidet?\n"), "open stop question: - Wer entscheidet?");
    assert.equal(offeneFragenGrund("## Offene Fragen an den PO\n- Wie viele?\n"), "open question to the PO: - Wie viele?");
  });
});

test("[1491] englisch: die Gruende der Auswahl", async () => {
  await mitConfig({ language: "en" }, () => inSprache("en", () => {
    const karten = [
      { id: "1", title: "[Fachlich] A", status: "ready", labels: ["kit:night"] },
      { id: "2", title: "Paket", status: "backlog", labels: ["kit:night"] },
      { id: "3", title: "[Fachlich] B", status: "backlog", labels: ["kit:night", "kit:klaeren", "review:fertig"] },
      { id: "4", title: "[Fachlich] C", status: "backlog", labels: ["kit:night", "review:fertig"],
        body: "## Offene Fragen an den PO\n- Wie viele?\n" },
    ];
    const { uebersprungen } = waehleKettenKandidaten(karten, "kit:night", 5);
    const grund = Object.fromEntries(uebersprungen.map((u) => [u.id, u.grund]));
    assert.equal(grund["1"], "is in ready, not in Backlog");
    assert.equal(grund["2"], "neither [Requirement] nor [Plan] — the marker applies on the requirement or on the plan document");
    assert.equal(grund["3"], "carries kit:clarify — the answer to the stop question must first be on the requirement, then remove the label");
    assert.equal(grund["4"], "open question to the PO: - Wie viele?; answer the questions in the body and set "
      + "'## Open questions for the PO' to 'Keine'");

    const plan = { id: "9", title: "[Plan] P", status: "backlog", labels: ["kit:night"], body: "" };
    assert.match(planAusschluss(plan, "kit:night", []),
      /^the requirement origin is not recognizable — the line 'Requirement: Issue #N' is missing in the plan/);
  }));
});

test("[1491] englisch: unpassende Ziel- und Pruefer-Einstellungen", async () => {
  await mitConfig({ language: "en" }, () => inSprache("en", () => {
    const fach = (...labels) => ({ id: "1", title: "[Fachlich] A", labels });
    const mehr = zielAusschluss(fach("ziel:plan", "ziel:pakete"), "fachplan", null);
    assert.equal(mehr, "unsuitable setting: more than one goal (ziel:plan, ziel:pakete) — remove all but one; the card keeps its labels");
    assert.ok(istZielUnpassendGrund(mehr));
    assert.equal(zielAusschluss(fach("planreview:1", "planreview:2"), "fachplan", null),
      "unsuitable setting: planreview:1 and planreview:2 at the same time — remove one; the card keeps its labels");
    assert.match(zielAusschluss(fach("planreview:2"), "fachplan", { id: "2", body: "Plan-Review: fable (2026-10-06)\n" }),
      /^unsuitable setting: planreview:2, but plan #2 is already checked — /);
  }));
  assert.ok(istZielUnpassendGrund(`${ZIEL_UNPASSEND_PRAEFIX}x`), "der deutsche Grund wird auch erkannt");
  assert.ok(!istZielUnpassendGrund("is in ready, not in Backlog"));
});

test("[1491] englisch: die Zeile einer Stufe, deren Schlusstext nach Warten klang", async () => {
  const protokoll = await inSprache("en", () => mitProtokoll(() => {
    assert.equal(wartendBeendet("plan", "Ich warte auf den Lauf im Hintergrund und melde mich, sobald er fertig ist.", "5", () => true), false);
  }));
  assert.ok(protokoll.includes("  Stage plan: final text sounded like waiting, but the result is there — the session counts as finished."),
    protokoll);
});

test("[1491] ohne Spracheinstellung bleiben die Gruende der Kette deutsch", () => {
  assert.equal(stoppFragenGrund("## Offene Fragen\n- Wer?\n"), "offene Stopp-Frage: - Wer?");
  assert.equal(budgetDefaultsZeile({ planMin: 30 }, ["planMin"]), "Budget der Kette aus den Defaults: planMin=30");
  const { uebersprungen } = waehleKettenKandidaten([{ id: "2", title: "Paket", status: "backlog", labels: ["kit:night"] }], "kit:night", 5);
  assert.equal(uebersprungen[0].grund, "weder [Fachlich] noch [Plan] — das Kennzeichen gilt an der fachlichen Anforderung oder am Plandokument");
});

test("[1491] die Prompts an Sessions bleiben unveraendert", async () => {
  await inSprache("en", () => {
    assert.match(KETTE_ZUSATZ, /^Dieser Lauf ist unbeaufsichtigt/);
  });
});

// --- Keine deutsche Meldung am Texthelfer vorbei ------------------------------------------

// Nicht ueber die Tabelle laufen die Prompts an Sessions, die ein Modell liest und kein Mensch;
// sie stellt ein Paket der Stufe 4 um (#1471).
const KETTE_OHNE = [
  { von: "export const KETTE_ZUSATZ", bis: "// Der Anker des Halt-Kommentars" },
  { von: "export const ABDECKUNG_PROMPT", bis: "function kettenAusschluss" },
  { von: "export function korrekturPrompt", bis: "/** Der Text eines Abschnitts" },
];

test("[1491] der erste Teil der Kette gibt in einem englischen Projekt keine deutsche Meldung aus", () => {
  const bereich = { bis: "async function formSicherstellen", ohne: KETTE_OHNE };
  assert.deepEqual(deutschAmHelferVorbei("kit/night/kette.mjs", KETTE_TEXTE, [], bereich), [],
    "kit/night/kette.mjs: deutsche Texte am Texthelfer vorbei");
  assert.deepEqual(deutschImEnglischen(KETTE_TEXTE), [], "kit/night/kette.mjs: deutsche Woerter in der englischen Tabelle");
});
