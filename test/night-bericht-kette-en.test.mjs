// Berichte des Nacht-Runners zweisprachig, Gruppe kit/night/bericht.mjs und
// kit/night/abhaengigkeiten.mjs (Plan #1420 E13/E14; Issue #1450).
//
// Beide Module tragen ihre Texte an den Menschen in einer Tabelle TEXTE { de, en } und geben
// sie ueber den Texthelfer aus kit/board/namen.mjs aus:
//   - Paritaet: dieselben Schluessel und Platzhalter in beiden Sprachen.
//   - Englische Stichproben je Modul: Nacht- und Vorbereitungsbericht, Pruefzeilen, Prueflaeufe,
//     die Ausgaenge als Anzeige, der Abhaengigkeitsblock samt DOKUMENT_SATZ_ERST.
//   - Die deutschen Wortlaut-Tests (test/night-bericht-*.test.mjs,
//     test/night-abhaengigkeiten-*.test.mjs) bleiben, wie sie sind, und laufen mit der Vorgabe
//     Deutsch.
// Vertrag bleibt (E14): die Zustaende und Ergebnisse des Pruefstands, die Ausgaenge im
// Ergebnisstand, das Feld `dokument` des Befunds und die exportierten deutschen Konstanten.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  TEXTE as BERICHT_TEXTE, BERICHT_ANKER, BERICHT_SCHLUSS, berichtBauen, pruefBericht, prueflaufZeilen,
  vorbereitungsBericht, berichtSchreiben, berichtAbhaengigkeiten,
} from "../kit/night/bericht.mjs";
import {
  TEXTE as ABH_TEXTE, abhaengigkeitenAbhaengigkeiten, abhaengigkeitsBefund, abhaengigkeitsBlock, kreisLogZeile,
} from "../kit/night/abhaengigkeiten.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { DEUTSCHE_WOERTER, deutschAmHelferVorbei, deutschImEnglischen } from "./helpers/quelltext-texte.mjs";

afterEach(() => {
  spracheFestlegen(null);
  berichtAbhaengigkeiten();
  abhaengigkeitenAbhaengigkeiten();
});

/** Fuehrt `fn` mit der Prozesssprache `sprache` aus. */
function inSprache(sprache, fn) {
  spracheFestlegen(sprache);
  try {
    return fn();
  } finally {
    spracheFestlegen(null);
  }
}

/** Faengt die Protokollzeilen von `log` ab, solange `fn` laeuft. */
function mitProtokoll(fn) {
  const zeilen = [];
  const schreiben = process.stdout.write;
  process.stdout.write = (chunk) => {
    zeilen.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = schreiben;
  }
  return zeilen.join("");
}

test("[1450] die Texttabellen beider Module haben in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(BERICHT_TEXTE), []);
  assert.deepEqual(pruefeParitaet(ABH_TEXTE), []);
  assert.ok(Object.keys(BERICHT_TEXTE.de).length >= 80, "die Tabelle traegt die Meldungen des Berichts");
  assert.ok(Object.keys(ABH_TEXTE.de).length >= 8, "die Tabelle traegt die Meldungen der Abhaengigkeiten");
});

// --- kit/night/bericht.mjs -------------------------------------------------------------

/** Eine Ketten-Einheit unter Variante B mit allen Bloecken des Berichts. */
function einheitB() {
  return {
    id: "7", ausgang: "angehalten", grund: "stage umsetzung: #13 stops at a stop question", variante: "B", ziel: "packages",
    projektgrenze: true,
    stufen: {
      plan: { id: "12", dauerMs: 90000, kennzahlen: { kostenUsd: 2.5 }, korrekturrunden: 1 }, review: { marker: true },
      pakete: { ids: ["13", "14"], nichtZuordenbar: ["15"], korrekturrunden: 0 },
      umsetzung: {
        umgesetzt: [{ id: "14", stufe: "mittel", stufeVerwendet: "schwer", modell: "opus", effort: "high" }],
        angehalten: ["13"], haltArten: { 13: "klaeren" },
        festgefahren: [{ id: "16", pruefung: "npm test", versuche: 3, fehler: "boom" }],
        nichtBegonnen: [{ id: "17", grund: "waits", mensch: true, unmet: [] }, { id: "18", grund: "x", unmet: ["17"] }],
        ursprung: {
          vorher: { 12: "backlog", 7: "backlog" },
          auswertung: {
            plan: "12",
            dokumente: [{ id: "12", art: "plan", spalte: "in_review", aktion: "wandert" }, { id: "7", art: "fachlich", spalte: "backlog", aktion: "bleibt", grund: "open packages" }],
            fehlend: [{ id: "13", titel: "P1", spalte: "backlog" }],
          },
        },
      },
    },
    ueberholt: ["9"], ueberholtUnbestaetigt: [{ id: "10", grund: "no answer" }], abdeckungSchrieb: true,
    kostenUsd: 3.25, kostenUnbekannt: 0,
  };
}

const PAKETE = [
  { id: "13", title: "P1", status: "backlog", body: "## Context\n\nSitzungsumfang: reisst — big.\n" },
  { id: "14", title: "P2", status: "in_review", body: "## Context\n\nPlan: Issue #12\n" },
];

const PAKET_EINHEITEN = [
  { id: "14", dauerMs: 300000, prueflaeufe: { arbeit: { anzahl: 2, volle: 1, volleNoetig: 0 }, abschluss: { anzahl: 1, dauerMs: 60000 } },
    pruefung: { wartezeitMs: 4000, ohneZuordnung: ["a.mjs"], hinweise: [{ zeilen: ["b.mjs: long"] }], gewackelt: [{ cmd: "npm test" }] } },
  { id: "16", dauerMs: 1200000, ausgang: "festgefahren", festgefahren: { pruefung: "npm test", versuche: 3, zeitgrenzeMs: 1800000 }, pruefung: {} },
];

function englischerBericht() {
  const start = new Date("2026-10-11T22:00:00.000Z");
  return inSprache("en", () => berichtBauen(einheitB(), {
    plan: { id: "12", title: "[Plan] X", body: "Plan-Review: opus (2026-10-11)\n" }, pakete: PAKETE,
    einarbeitung: "## Incorporation, Round 1\n\n- F2: rejected — reason.", abdeckung: null, budget: { kostenUsd: 50 },
    start, stempel: "s", jetzt: start.getTime() + 30 * 60000, einheiten: PAKET_EINHEITEN, kitStand: null,
  }));
}

test("[1450] englisch: der Nachtbericht in allen Bloecken", () => {
  const text = englischerBericht();
  assert.ok(text.startsWith("## Night report, chain s\n\n### Outcome\n\nstopped — stage umsetzung: #13 stops at a stop question\n"), text);
  assert.ok(text.includes("stopped at the project boundary, not at the goal packages"), text);
  assert.ok(text.includes("waits for human step #17 — depending on it: #18"), text);
  assert.ok(text.includes("### Stages\n\n- Order: requirement #7\n- Variant: B\n- Goal: packages\n"), text);
  assert.ok(text.includes("- Plan #12 ([Plan] X): duration 1.5 min, cost of the last session 2.50 $, correction rounds 1, "
    + "reviewer opus (2026-10-11), marker set."), text);
  assert.ok(text.includes("- Packages (2, correction rounds 0): #13 P1, #14 P2."), text);
  assert.ok(text.includes("- Not assignable (without 'Plan: Issue #12'): #15."), text);
  assert.ok(text.includes("- Probably over the session time limit: #13"), text);
  assert.ok(text.includes("### Implementation\n\n- implemented: #14 P2 (task level mittel, via level schwer, model opus, effort high)."), text);
  assert.ok(text.includes("- halted: #13 P1."), text);
  assert.ok(text.includes("- stuck: #16 (npm test, 3 attempts: boom)."), text);
  assert.ok(text.includes("- not started: #17 (waits), #18 (x)."), text);
  assert.ok(text.includes("Check runs and target mark:\n- Issue #14: duration 5.0 min, check runs 2 (full 1, group runs 0), "
    + "completion attempts 1, last completion 4.0 s, completion waiting time in total 1.0 min"), text);
  assert.ok(text.includes("- Issue #14: unassigned: a.mjs"), text);
  assert.ok(text.includes("- Issue #14: note: b.mjs: long"), text);
  assert.ok(text.includes("- Issue #16: stuck at npm test (3 attempts), run time 20.0 min, time limit 30.0 min, saved time (estimate) 10.0 min"), text);
  assert.ok(text.includes("- Flaky: npm test — 1 case(s) (issue #14)"), text);
  assert.ok(text.includes("- 1 of 2 packages under 10 minutes."), text);
  assert.ok(text.includes("### Origin documents\n\n- Plan #12: moved to In review.\n- Requirement #7: stays in Backlog — open packages.\n"
    + "- missing packages:\n  - #13 P1 in Backlog: halted at a stop question\n"), text);
  assert.ok(text.includes("### Decisions of the night\n\n- None.\n"), text);
  assert.ok(text.includes("### Rejected findings\n\n- F2: rejected — reason.\n"), text);
  assert.ok(text.includes("### Coverage against the requirement\n\nNo coverage: the chain did not reach the stage abdeckung.\n\n"
    + "Note: the coverage session wrote to the board although it was only meant to read."), text);
  assert.ok(text.includes("### Key figures\n\n- Packages reached: yes\n- Duration of the chain: 30.0 min from 2026-10-11T22:00:00.000Z\n"
    + "- Decisions: 0\n- Stop questions: 1\n- Cost: 3.25 $ of 50 $\n- kostenUnbekannt: 0\n"), text);
  assert.ok(text.includes("### Open stop question\n\nstage umsetzung: #13 stops at a stop question\n"), text);
  assert.ok(text.includes("### Superseded\n\n- Plan #9\n"), text);
  assert.ok(text.includes("### Superseded, not confirmed\n\n- Plan #10 — no answer\n"), text);
  assert.ok(text.trimEnd().endsWith("This report is history. A decision becomes binding for the next chain only as a sentence in the requirement."), text);
});

test("[1450] englisch: im Nachtbericht steht kein deutsches Wort aus dem Kit", () => {
  // Was die Fixture selbst traegt (Titel, Gruende, Stufen- und Vertragswerte), ist englisch
  // oder ein Vertragswort; jedes deutsche Wort darin kaeme aus dem Kit.
  const zeilen = englischerBericht().split("\n").filter((z) => DEUTSCHE_WOERTER.test(z));
  assert.deepEqual(zeilen, []);
});

test("[1450] englisch: die Ausgaenge als Anzeige, der Ergebnisstand bleibt", () => {
  const ausgang = (a) => inSprache("en", () => berichtBauen({ ausgang: a }, { stempel: "s" }).split("\n")[4]);
  assert.equal(ausgang("fertig"), "finished");
  assert.equal(ausgang("unvollstaendig"), "incomplete");
  assert.equal(ausgang("abgebrochen"), "aborted");
  assert.equal(ausgang("uebersprungen"), "skipped");
  assert.equal(ausgang("liegengeblieben"), "pending");
  assert.equal(ausgang("etwasNeues"), "etwasNeues", "ein unbekannter Ausgang erscheint, wie er ist");
  assert.equal(berichtBauen({ ausgang: "angehalten" }, { stempel: "s" }).split("\n")[4], "angehalten", "deutsch wie bisher");
});

test("[1450] englisch: die Pruefzeilen der Sessions", () => {
  const pruefungen = [
    { id: "1", zustand: "ungeprueft" },
    { id: "2", zustand: "leeresPaket" },
    { id: "3", zustand: "rot", rotesKommando: "npm test", rotesErgebnis: "rot" },
    { id: "4", zustand: "geprueft", laufen: [{ cmd: "npm test", ergebnis: "gruen", grund: "area" }], ausgelassen: [],
      guete: { anteil: 80, marke: 70, grund: "enough" } },
    { id: "5", zustand: "nachgeprueft", nachweisFremd: true, nachweisGrund: "x", laufen: [], ausgelassen: [] },
  ];
  const zeilen = inSprache("en", () => pruefBericht(pruefungen));
  assert.equal(zeilen[0], "Checks of the sessions:");
  assert.equal(zeilen[1], "  Issue #1: unchecked — the session ran no check.");
  assert.equal(zeilen[2], "  Issue #2: empty package — no check, because nothing was changed.");
  assert.equal(zeilen[3], "  Issue #3: red — npm test ended rot.");
  assert.equal(zeilen[4], "  Issue #4: ran: npm test -> gruen (area) | skipped: none");
  assert.equal(zeilen[5], "  Issue #4: quality: 80 % reached, mark 70 % — enough");
  assert.equal(zeilen[6], "  Issue #5: rechecked — the evidence did not belong to the commit (x), recheck green.");
  assert.equal(zeilen[7], "  Sum: 5 session(s) — 1 with check, 1 rechecked, 1 without change, 1 unchecked, 1 red; "
    + "1 check(s) ran (0 of them red), 0 skipped.");
  assert.deepEqual(inSprache("en", () => pruefBericht([])).slice(0, 2),
    ["Checks: no implementation round ran.", "Check runs and target mark: no implementation measured."]);
  assert.deepEqual(inSprache("en", () => prueflaufZeilen([{ id: "1", pruefung: {} }])).slice(1, 2), ["- Issue #1: duration 0.0 min, check runs not measured"]);
});

test("[1450] englisch: der Bericht der Vorbereitung", () => {
  const text = inSprache("en", () => vorbereitungsBericht(null, {
    ergebnis: "rot", commit: "abc", basis: "def", origin: "ghi", releaseDateien: true, version: "4.2.0", fetch: "fehlgeschlagen",
    zeitpunkt: "t", pakete: ["1"], offen: [], rot: { pruefung: "npm test", karten: ["1"], hinweis: "h" },
  }, { stempel: "s" }));
  assert.ok(text.startsWith("## Night report, chain s — preparation\n\n### Result\n\nred\n"), text);
  assert.ok(text.includes("### Checked state\n\n- Commit: abc (base def, origin/main state ghi)\n"
    + "- Version note and change note: ready (v4.2.0)\n- Comparison with origin: failed, checked against the existing state\n"), text);
  assert.ok(text.includes("### Packages in the state\n\n#1\n\n### Open checks\n\n- none\n"), text);
  assert.ok(text.includes("### Red check\n\n- Check: npm test\n- Causers: #1\n- Note: h\n"), text);
  assert.ok(text.includes("The message applies to the whole state and is also in .claude/push-vorbereitung.json. Nothing was pushed."), text);
  const nicht = inSprache("en", () => vorbereitungsBericht(null, { ergebnis: "nicht-vorbereitet", grund: "no packages" }, { stempel: "s" }));
  assert.ok(nicht.includes("### Result\n\nnot prepared — no packages\n"), nicht);
});

test("[1450] englisch: die Protokollzeilen beim Schreiben des Berichts", () => {
  berichtAbhaengigkeiten({ boardRoh: () => ({ status: 0 }) });
  const protokoll = mitProtokoll(() => inSprache("en", () => berichtSchreiben("7", "x", { stempel: "s" })));
  assert.ok(protokoll.includes("  Night report published as a comment on #7."), protokoll);
});

test("[1450] die exportierten Konstanten bleiben deutsch, ohne Spracheinstellung bleibt der Bericht deutsch", () => {
  assert.equal(BERICHT_ANKER, "## Nachtbericht, Kette");
  assert.match(BERICHT_SCHLUSS, /^Dieser Bericht ist Verlauf\./);
  const text = berichtBauen({ ausgang: "fertig" }, { stempel: "s" });
  assert.ok(text.startsWith("## Nachtbericht, Kette s\n\n### Ausgang\n\nfertig\n"), text);
  assert.ok(text.trimEnd().endsWith(BERICHT_SCHLUSS));
});

// --- kit/night/abhaengigkeiten.mjs -------------------------------------------------------

function boardMit(karten) {
  abhaengigkeitenAbhaengigkeiten({
    board: (...a) => (a[1] === "list" ? karten.filter((k) => k.status === a[3]) : karten.find((k) => String(k.id) === a[2])),
    boardRoh: (...a) => {
      const k = karten.find((x) => String(x.id) === a[2]);
      return k ? { status: 0, json: k } : { status: 1, json: null };
    },
  });
}

test("[1450] englisch: der Abhaengigkeitsblock mit DOKUMENT_SATZ_ERST und den Kreisen", () => {
  boardMit([
    { id: 7, title: "Package", body: "## Dependencies\nIssue #5\nIssue #8", status: "backlog" },
    { id: 5, title: "[Fachlich] A requirement", body: "", status: "backlog" },
    { id: 6, title: "[Plan] A plan", body: "", status: "in_review" },
    { id: 8, title: "Loop", body: "## Dependencies\nIssue #9", status: "backlog" },
    { id: 9, title: "Loop back", body: "## Dependencies\nIssue #8", status: "backlog" },
  ]);
  const erfuellt = { has: (n) => n === 6, add: () => {} };
  const befund = inSprache("en", () => abhaengigkeitsBefund({ id: 7 }, "## Dependencies\nIssue #5\nThe frame is in #6.\nIssue #8", erfuellt));
  assert.equal(befund.abhaengigkeiten[0].dokument, "[Fachlich]", "das Feld bleibt Vertrag");
  const block = inSprache("en", () => abhaengigkeitsBlock(befund)).split("\n");
  assert.equal(block[0], "Dependencies as the night run reads them:");
  assert.equal(block[1], "- #5 ([Fachlich] A requirement): unfulfilled, from a reference line: „Issue #5“ — document ([Requirement]), "
    + "not a work package: a requirement or idea is only done when its packages are done.");
  assert.match(block[2], /^- #6 \(\[Plan\] A plan\): fulfilled, from explanatory text: .* — document \(\[Plan\]\), not a work package: a plan document is never done by implementation\.$/);
  assert.equal(block[4], "Cycle: #8 -> #9 -> #8 — this package waits on a cycle.");
  assert.equal(inSprache("en", () => kreisLogZeile(7, befund.kreise[0])), "#7 waits on a cycle: #8 -> #9 -> #8");
  assert.equal(inSprache("en", () => kreisLogZeile(8, { karten: [8, 9], steht: true })), "#8 is in a cycle: #8 -> #9 -> #8");
  assert.throws(() => inSprache("en", () => abhaengigkeitenAbhaengigkeiten({ quer: () => {} })),
    { message: "abhaengigkeitenAbhaengigkeiten knows no dependency 'quer'" });
});

// --- Keine deutsche Meldung am Texthelfer vorbei ------------------------------------------

// Vertragswerte (E14) im Bericht: die Aktion `bleibt` aus `issue ursprung` und das Ergebnis
// `nicht-vorbereitet` der Vorbereitung.
const BERICHT_VERTRAG = ["bleibt", "nicht-vorbereitet"];

// Die Tabellen der Teile unter kit/night/ liegen seit Issue #1525 in kit/texte/; gescannt wird das Modul ohne sie.
test("[1450] beide Module geben in einem englischen Projekt keine deutsche Meldung aus", () => {
  for (const [datei, tabelle, vertrag] of [["kit/night/bericht.mjs", BERICHT_TEXTE, BERICHT_VERTRAG], ["kit/night/abhaengigkeiten.mjs", ABH_TEXTE, []]]) {
    assert.deepEqual(deutschAmHelferVorbei(datei, null, vertrag), [], `${datei}: deutsche Texte am Texthelfer vorbei`);
    assert.deepEqual(deutschImEnglischen(tabelle), [], `${datei}: deutsche Woerter in der englischen Tabelle`);
  }
});
