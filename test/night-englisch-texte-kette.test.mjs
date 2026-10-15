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
// vom Dateianfang bis vor `formSicherstellen`, der zweite (#1492) von dort bis vor `mitMeldung`,
// der dritte (#1493) von `mitMeldung` bis zum Dateiende.

import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  TEXTE as KETTE_TEXTE, UNGEPRUEFT_PRAEFIX, ZIEL_UNPASSEND_PRAEFIX, budgetDefaultsZeile, istUngeprueftGrund,
  istZielUnpassendGrund, ketteAbhaengigkeiten, ketteAnbinden, offeneFragenGrund, planAusschluss, pruefungFehltGrund,
  stoppFragenGrund, waehleKettenKandidaten, wartendBeendet, zielAusschluss, KETTE_ZUSATZ, REVIEW_REST_ANKER, pushVermerk,
  umsetzungHaltGrund, beanspruchtGrund, kennzeichenZurueckGrund,
} from "../kit/night/kette.mjs";
import { KETTE_BUDGET_DEFAULTS } from "../kit/night/session.mjs";
import { ZUSTAND } from "../kit/night/grundlagen.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { deutschAmHelferVorbei, deutschImEnglischen } from "./helpers/quelltext-texte.mjs";
import { GLATT, fachplanKarte, jeStufe, ketteImProzess, paketBody, planAnlegen, planBody, planKarte } from "./helpers/kette-fixture.mjs";

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

    // Seit Plan #1645 (E3) haelt nur eine Zeile an, die ins Leere verweist.
    const plan = { id: "9", title: "[Plan] P", status: "backlog", labels: ["kit:night"], body: "Requirement: Issue #99\n" };
    assert.match(planAusschluss(plan, "kit:night", []),
      /^the line 'Requirement: Issue #99' points nowhere — it names no card of this board in the form 'Issue #N'/);
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
  assert.equal(uebersprungen[0].grund, "weder [Requirement] noch [Plan] — das Kennzeichen gilt an der fachlichen Anforderung oder am Plandokument");
});

// Seit #1471 geht der Zusatz ueber die Tabelle (test/night-session-prompt-en.test.mjs); die
// exportierte Konstante bleibt der deutsche Wortlaut.
test("[1491] KETTE_ZUSATZ bleibt der deutsche Wortlaut, auch in einem englischen Projekt", async () => {
  await inSprache("en", () => {
    assert.match(KETTE_ZUSATZ, /^Dieser Lauf ist unbeaufsichtigt/);
  });
});

// --- Keine deutsche Meldung am Texthelfer vorbei ------------------------------------------

// Nicht ueber die Tabelle laufen die Prompts an Sessions, die ein Modell liest und kein Mensch,
// ausser dem Zusatz der Stufen-Sessions (#1471); der erste Bereich traegt noch ABDECKUNG_ZUSATZ.
const KETTE_OHNE = [
  { von: "export const KETTE_ZUSATZ", bis: "// Der Anker des Halt-Kommentars" },
  { von: "export const ABDECKUNG_PROMPT", bis: "function kettenAusschluss" },
  { von: "export function korrekturPrompt", bis: "/** Der Text eines Abschnitts" },
];

// Vertragswerte im ersten Teil: die Lage `keine` aus `quelleLage` (Plan #1645, Issue #1647) ist
// ein interner Wert, den nur der Code liest, keine Meldung an den Menschen.
const LAGE_WERTE = ["keine"];

// Die Tabelle liegt seit Issue #1525 in kit/texte/; gescannt wird das Modul ohne sie.
test("[1491] der erste Teil der Kette gibt in einem englischen Projekt keine deutsche Meldung aus", () => {
  const bereich = { bis: "async function formSicherstellen", ohne: KETTE_OHNE };
  assert.deepEqual(deutschAmHelferVorbei("kit/night/kette.mjs", null, LAGE_WERTE, bereich), [],
    "kit/night/kette.mjs: deutsche Texte am Texthelfer vorbei");
  assert.deepEqual(deutschImEnglischen(KETTE_TEXTE), [], "kit/night/kette.mjs: deutsche Woerter in der englischen Tabelle");
});

// --- kit/night/kette.mjs, Teil 2: formSicherstellen bis vor mitMeldung (Issue #1492) -------

test("[1492] die Texttabelle traegt die Meldungen des zweiten Teils, in beiden Sprachen gleich gebaut", () => {
  assert.deepEqual(pruefeParitaet(KETTE_TEXTE), []);
  assert.ok(Object.keys(KETTE_TEXTE.de).length >= 110, "die Tabelle traegt die Meldungen des zweiten Teils");
});

test("[1492] englisch: Push-Vermerk und Grund der angehaltenen Umsetzung", async () => {
  await inSprache("en", () => {
    assert.equal(pushVermerk({ comments: [] }, "Issue #7"),
      "Night run: package waits for a push (Issue #7). After `push main` it can be pulled to Ready.");
    assert.deepEqual(umsetzungHaltGrund({ angehalten: ["3", "4"], haltArten: { 4: "geschuetzt" } }), {
      grund: "Stage umsetzung: #3 stops at a stop question; #4 stops at a protected file", haltArt: "klaeren",
    });
  });
  assert.equal(pushVermerk({ comments: [] }, "Issue #7"),
    "Nachtlauf: Paket wartet auf einen Push (Issue #7). Nach `push main` kann es nach Ready gezogen werden.");
});

test("[1492] englisch: die Protokollzeilen der Stufen review und pakete und der Formpruefung", async () => {
  const r = await inSprache("en", () => ketteImProzess({ karten: [fachplanKarte("1")], config: { language: "en" }, sitzung: GLATT }));
  assert.equal(r.code, 0, r.ausgabe);
  const plan = r.lauf.einheiten.find((e) => e.id === "1").stufen.plan.id;
  assert.ok(r.ausgabe.includes(`  Form check #${plan} green.`), r.ausgabe);
  assert.match(r.ausgabe, new RegExp(`  Stage review: /issue-review #${plan} \\(budget \\d+ min\\)\\.`));
  assert.match(r.ausgabe, new RegExp(`  Review #${plan} done, marker set\\.`));
  assert.match(r.ausgabe, new RegExp(`  Stage pakete: /issues #${plan} \\(budget \\d+ min\\)\\.`));
  assert.match(r.ausgabe, new RegExp(`  Packages from plan #${plan}: #\\d+`));
});

test("[1492] englisch: der Vermerk einer abgebrochenen Review-Stufe", async () => {
  const befunde = (s) => {
    const id = /^\/issue-review #(\d+)/.exec(s.prompt)[1];
    s.board("issue", "comment", id, "--text", "Fund 1 (opus, WICHTIG): Kriterium 3 fehlt.");
  };
  const r = await inSprache("en", () => ketteImProzess({
    karten: [fachplanKarte("1")], config: { language: "en" },
    sitzung: jeStufe({ plan: planAnlegen(), review: (s) => { befunde(s); return { zeilen: [JSON.stringify({ type: "system", subtype: "init" })], ohneResult: true, ende: 3 }; } }),
  }));
  const plan = r.lauf.einheiten.find((e) => e.id === "1").stufen.plan.id;
  const vermerk = r.karte(plan).comments.map((c) => c.body).find((b) => b.startsWith(REVIEW_REST_ANKER));
  assert.ok(vermerk, r.ausgabe);
  assert.ok(vermerk.includes("stage review: The check ran, its findings are a comment on this document."), vermerk);
  assert.ok(vermerk.includes(`Way forward: run /issue-review #${plan} by hand.`), vermerk);
  assert.ok(r.ausgabe.includes(`  Review #${plan} aborted, findings without incorporation — note '${REVIEW_REST_ANKER}' written on plan #${plan}.`),
    r.ausgabe);
});

test("[1492] englisch: die uebersprungene Karte in der Form der Vorlage und ihr Hinweis-Kommentar", async () => {
  const r = await inSprache("en", () => ketteImProzess({
    karten: [fachplanKarte("1", { labels: ["kit:night"] })], config: { language: "en" },
  }));
  assert.ok(r.ausgabe.includes("  #1 [Fachlich] Ein Anliegen -> skipped (unchecked: label 'review:done' missing — "), r.ausgabe);
  assert.ok(r.ausgabe.includes("  #1: note comment written, label stays."), r.ausgabe);
  const kommentar = r.karte("1").comments.at(-1).body;
  assert.ok(kommentar.startsWith("## Chain not started: check missing\n\nunchecked: label 'review:done' missing"), kommentar);
});

test("[1492] englisch: der Zeitbudget-Grund der Umsetzung beginnt in der Form der Vorlage", () => {
  assert.match(KETTE_TEXTE.en.umsetzungZeitbudget, /^Time budget /);
  assert.match(KETTE_TEXTE.de.umsetzungZeitbudget, /^Zeitbudget /);
});

// Vertragswerte (E14) im zweiten Teil: der Anker der Testhinweise, den Skill und Vorlage
// woertlich nennen, und das Ergebnis `nicht-vorbereitet` der Vorbereitung.
const KETTE_VERTRAG = ["## Testhinweise der Formpruefung", "## Pruefstand der Kette", "nicht-vorbereitet", ...LAGE_WERTE];

test("[1492] der zweite Teil der Kette gibt in einem englischen Projekt keine deutsche Meldung aus", () => {
  const bereich = { bis: "async function mitMeldung", ohne: KETTE_OHNE };
  assert.deepEqual(deutschAmHelferVorbei("kit/night/kette.mjs", null, KETTE_VERTRAG, bereich), [],
    "kit/night/kette.mjs: deutsche Texte am Texthelfer vorbei");
  assert.deepEqual(deutschImEnglischen(KETTE_TEXTE), [], "kit/night/kette.mjs: deutsche Woerter in der englischen Tabelle");
});

// --- kit/night/kette.mjs, Teil 3: ab mitMeldung bis zum Dateiende (Issue #1493) ------------

test("[1493] die Texttabelle traegt die Meldungen des dritten Teils, in beiden Sprachen gleich gebaut", () => {
  assert.deepEqual(pruefeParitaet(KETTE_TEXTE), []);
  assert.ok(Object.keys(KETTE_TEXTE.de).length >= 180, "die Tabelle traegt die Meldungen des dritten Teils");
});

/** Die Laufstaende, die die Kette an `id` schrieb, in Folge. */
const staendeVon = (r, id) => r.journal.filter((z) => z.art === "stand" && z.karte === id).map((z) => z.text);

test("[1493] englisch: der Laufstand in den Wortformen der Vorlage, Ziel und Protokoll englisch", async () => {
  const karte = fachplanKarte("1", { labels: ["kit:night", "review:done", "goal:packages"] });
  const r = await inSprache("en", () => ketteImProzess({ karten: [karte], config: { language: "en" }, sitzung: GLATT }));
  assert.equal(r.code, 0, r.ausgabe);
  const plan = r.lauf.einheiten.find((e) => e.id === "1").stufen.plan.id;
  const staende = staendeVon(r, "1");
  assert.match(staende[0], /^Run accepted at .+, preflight check running/);
  assert.match(staende[1], /^Goal: packages\n\nlast started: plan started for #1 at \d{4}-/, staende[1]);
  const letzter = staende.at(-1);
  assert.ok(letzter.startsWith("done up to packages\nNext: Pull the packages to Ready.\n\nGoal: packages\n\n"), letzter);
  assert.match(letzter, new RegExp(`last started: coverage started for #${plan} at `));
  assert.match(letzter, new RegExp(`last finished: coverage finished for #${plan} at `));
  assert.doesNotMatch(staende.join("\n"), /zuletzt|begonnen|fertig|für #|Ziel:|Als Nächstes/);
  assert.ok(r.ausgabe.includes("Chain 1/3: Issue #1 — [Fachlich] Ein Anliegen"), r.ausgabe);
  assert.ok(r.ausgabe.includes("  Goal packages reached after abdeckung — the chain ends here."), r.ausgabe);
  assert.match(r.ausgabe, /Night chain finished: 1 finished, 0 incomplete, 0 stopped, 0 aborted, 0 skipped, 0 pending, 0 package\(s\) not started\./);
  assert.match(r.ausgabe, /Morning ritual: /);
});

test("[1493] ein englischer Laufstand-Eintrag zaehlt wie ein deutscher als vorhandenes Ergebnis", async () => {
  const markiert = planBody().replace("Plan-Modell: fixture-modell", "Plan-Modell: fixture-modell\nPlan-Review: opus (2026-09-28, Nachtlauf)");
  const pakete = ["3", "4"].map((id, i) => ({
    id, title: `Paket ${i + 1}`, status: "in_review", labels: [], body: paketBody("2", "1", { n: i + 1, aufgabe: `Paket ${i + 1}.` }),
  }));
  for (const [sprache, eintrag] of [["en", "last finished: coverage finished for #2 at 2026-09-28T03:05:00.000Z"],
    ["de", "zuletzt abgeschlossen: abdeckung fertig für #2 um 2026-09-28T03:05:00.000Z"]]) {
    const karte = fachplanKarte("1", { labels: ["kit:night", "review:fertig", "ziel:pakete"] });
    karte.comments = [{ body: `## Laufstand\n\n${eintrag}` }];
    const r = await inSprache("en", () => ketteImProzess({
      karten: [karte, planKarte("2", "1", { body: markiert }), ...pakete], config: { language: "en" }, sitzung: GLATT,
    }));
    assert.equal(r.code, 0, r.ausgabe);
    assert.ok(r.ausgabe.includes("  Stage abdeckung: result is there — no session, the stage counts as finished."), `${sprache}: ${r.ausgabe}`);
    assert.equal(r.sitzungen.length, 0, sprache);
  }
});

test("[1493] englisch: die Gruende des Beanspruchens und des zurueckgenommenen Kennzeichens", async () => {
  await inSprache("en", () => {
    assert.equal(beanspruchtGrund("dort/1/x"), "already claimed by a running runner (dort/1/x)");
    assert.equal(kennzeichenZurueckGrund(), "start marker withdrawn after the run began");
  });
  assert.equal(beanspruchtGrund("dort/1/x"), "bereits von einem laufenden Runner beansprucht (dort/1/x)");
  assert.equal(kennzeichenZurueckGrund(), "Startkennzeichen nach Laufbeginn zurückgenommen");
});

test("[1493] englisch: der Wartetext an der Projektgrenze in der Form der Vorlage", async () => {
  const karte = fachplanKarte("1", { labels: ["kit:night", "review:done", "goal:packages"] });
  const r = await inSprache("en", () => ketteImProzess({
    karten: [karte], config: { language: "en" }, kette: { uebergaenge: { paketeAbdeckung: false } }, sitzung: GLATT,
  }));
  const letzter = staendeVon(r, "1").at(-1);
  assert.ok(letzter.startsWith("waiting: transition paketeAbdeckung not enabled in project — continue with kit:night\n\n"
    + "Goal: packages\nLimit: packages\n"), letzter);
});

test("[1493] die ganze Kette gibt in einem englischen Projekt keine deutsche Meldung aus", () => {
  assert.deepEqual(deutschAmHelferVorbei("kit/night/kette.mjs", null, KETTE_VERTRAG, { ohne: KETTE_OHNE }), [],
    "kit/night/kette.mjs: deutsche Texte am Texthelfer vorbei");
  assert.deepEqual(deutschImEnglischen(KETTE_TEXTE), [], "kit/night/kette.mjs: deutsche Woerter in der englischen Tabelle");
});
