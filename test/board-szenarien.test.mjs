// Teil szenarien: Lesen, Vollstaendigkeit und Pflicht des Abschnitts Szenarien im Fachplan
// (Issue #1589, Plan #1588 A1 bis A7, E1 bis E3, E10).
//
// Formpruefung, Anlegen, Grooming und Nacht-Kette stellen dieselbe Frage — ist die Karte
// pflichtig, und traegt sie ein vollstaendiges Szenario? Die Antwort steht in
// kit/board/szenarien.mjs; die Aufrufer folgen in eigenen Paketen. Alles hier laeuft im
// selben Prozess, der fachliche Anlass von `issue brief` ueber einen Tracker-Ersatz.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  TEXTE, szenarienLesen, szenarioVollstaendig, szenarienPflicht, szenarienVerstoss, stichtagHinweis,
} from "../kit/board/szenarien.mjs";
import { GHERKIN, UEBERSCHRIFTEN, gherkinWort, pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { SCHLUESSEL } from "../kit/board/config-namen.mjs";
import { issueAuftrag } from "../kit/board/dokumente.mjs";
import { geschuetzteTreffer, geschuetztFreigabe, geschuetztKommentar } from "../kit/board/geschuetzt.mjs";

afterEach(() => spracheFestlegen(null));

const SZENARIO_DE = [
  "### Szenario: Fachplan ohne Szenarien wird abgewiesen",
  "- Angenommen ein Projekt auf der Kit-Version mit der Pflicht",
  "- Wenn der Mensch einen Fachplan ohne Abschnitt Szenarien anlegt",
  "- Dann legt das Kit nichts an",
  "- Und die Meldung zeigt die Form eines Szenarios",
].join("\n");

const SZENARIO_EN = [
  "### Scenario: Requirement without scenarios is rejected",
  "- Given a project on the kit version with the duty",
  "- When the human creates a requirement without a scenarios section",
  "- Then the kit creates nothing",
  "- And the message shows the form of a scenario",
].join("\n");

/** Ein Fachplan mit den vier Pflichtabschnitten und `szenarien` an der Stelle nach A1. */
function fachplan(szenarien, { de = true } = {}) {
  const k = de
    ? ["## Ziel\nZiel.", "## Fachliche Akzeptanzkriterien\n1. Kriterium.", szenarien, "## Nicht-Ziele\nKeine.", "## Offene Fragen an den PO\nKeine."]
    : ["## Goal\nGoal.", "## Business acceptance criteria\n1. Criterion.", szenarien, "## Non-goals\nNone.", "## Open questions for the PO\nNone."];
  return k.filter((teil) => teil !== null).join("\n\n") + "\n";
}

// --- Register ----------------------------------------------------------------

test("Register: Ueberschrift Szenarien/Scenarios und die Schluesselwoerter je Sprache (E1)", () => {
  assert.deepEqual({ ...UEBERSCHRIFTEN.szenarien }, { de: "Szenarien", en: "Scenarios" });
  const erwartet = {
    szenario: ["Szenario", "Scenario"], angenommen: ["Angenommen", "Given"], wenn: ["Wenn", "When"],
    dann: ["Dann", "Then"], und: ["Und", "And"],
  };
  assert.deepEqual(Object.keys(GHERKIN).sort(), Object.keys(erwartet).sort());
  for (const [sache, [de, en]] of Object.entries(erwartet)) {
    assert.equal(gherkinWort(sache, "de"), de);
    assert.equal(gherkinWort(sache, "en"), en);
  }
  assert.equal(SCHLUESSEL.szenarienAb, "scenariosFrom");
});

// --- Lesen und Vollstaendigkeit ----------------------------------------------

test("vollstaendiges Szenario im deutschen Projekt -> vollstaendig: true", () => {
  const s = szenarienLesen(fachplan(`## Szenarien\n\n${SZENARIO_DE}`), "de");
  assert.equal(s.vorhanden, true);
  assert.equal(s.lage, "zwischen");
  assert.equal(s.szenarien.length, 1);
  assert.equal(s.szenarien[0].titel, "Fachplan ohne Szenarien wird abgewiesen");
  assert.equal(s.szenarien[0].zeilen.length, 4);
  assert.equal(s.szenarien[0].vollstaendig, true);
  assert.equal(szenarienVerstoss(fachplan(`## Szenarien\n\n${SZENARIO_DE}`), "de"), null);
});

test("vollstaendiges Szenario im englischen Projekt -> vollstaendig: true", () => {
  const body = fachplan(`## Scenarios\n\n${SZENARIO_EN}`, { de: false });
  const s = szenarienLesen(body, "en");
  assert.equal(s.vorhanden, true);
  assert.equal(s.lage, "zwischen");
  assert.equal(s.szenarien[0].titel, "Requirement without scenarios is rejected");
  assert.equal(s.szenarien[0].vollstaendig, true);
  assert.equal(szenarienVerstoss(body, "en"), null);
});

test("die Ueberschrift gilt in beiden Sprachen, die Schluesselwoerter nur in der Projektsprache (E2)", () => {
  const s = szenarienLesen(fachplan(`## Scenarios\n\n${SZENARIO_DE}`), "de");
  assert.equal(s.vorhanden, true);
  assert.equal(s.szenarien[0].vollstaendig, true);
});

test("Szenario ohne Dann -> vollstaendig: false", () => {
  const ohneDann = SZENARIO_DE.split("\n").filter((z) => !z.startsWith("- Dann")).join("\n");
  const body = fachplan(`## Szenarien\n\n${ohneDann}`);
  const s = szenarienLesen(body, "de");
  assert.equal(s.szenarien[0].vollstaendig, false);
  assert.match(szenarienVerstoss(body, "de"), /^Der Fachplan braucht einen Abschnitt Szenarien mit mindestens einem vollständigen Szenario\./);
});

test("falsche Reihenfolge -> vollstaendig: false", () => {
  const szenario = { titel: "Reihenfolge", zeilen: ["- Wenn etwas geschieht", "- Angenommen eine Lage", "- Dann ein Ergebnis"] };
  assert.equal(szenarioVollstaendig(szenario, "de"), false);
  const richtig = { titel: "Reihenfolge", zeilen: ["- Angenommen eine Lage", "- Und noch eine", "- Wenn etwas geschieht", "- Dann ein Ergebnis"] };
  assert.equal(szenarioVollstaendig(richtig, "de"), true);
});

test("Szenario ohne Titel -> vollstaendig: false", () => {
  const zeilen = ["- Angenommen eine Lage", "- Wenn etwas geschieht", "- Dann ein Ergebnis"];
  assert.equal(szenarioVollstaendig({ titel: "", zeilen }, "de"), false);
});

test("englische Schluesselwoerter im deutschen Projekt -> vollstaendig: false", () => {
  const body = fachplan(`## Szenarien\n\n${SZENARIO_EN}`);
  const s = szenarienLesen(body, "de");
  assert.equal(s.vorhanden, true);
  assert.equal(s.szenarien[0].vollstaendig, false);
  assert.notEqual(szenarienVerstoss(body, "de"), null);
  // Umgekehrt ebenso: deutsche Schluesselwoerter im englischen Projekt.
  assert.equal(szenarienLesen(fachplan(`## Scenarios\n\n${SZENARIO_DE}`, { de: false }), "en").szenarien[0].vollstaendig, false);
});

test("Zeilen nur im Codeblock -> vorhanden: false", () => {
  const body = fachplan("```markdown\n## Szenarien\n\n" + SZENARIO_DE + "\n```");
  const s = szenarienLesen(body, "de");
  assert.equal(s.vorhanden, false);
  assert.equal(s.lage, null);
  assert.deepEqual(s.szenarien, []);
  assert.notEqual(szenarienVerstoss(body, "de"), null);
});

test("Ueberschrift ausserhalb, Szenario im Codeblock -> vorhanden, aber kein Szenario", () => {
  const s = szenarienLesen(fachplan("## Szenarien\n\n```\n" + SZENARIO_DE + "\n```"), "de");
  assert.equal(s.vorhanden, true);
  assert.deepEqual(s.szenarien, []);
});

test("leerer Abschnitt und fehlender Abschnitt -> Meldung mit der Form in der Projektsprache", () => {
  const leer = szenarienVerstoss(fachplan("## Szenarien\n"), "de");
  const fehlt = szenarienVerstoss(fachplan(null), "de");
  assert.equal(leer, fehlt);
  for (const teil of ["## Szenarien", "### Szenario: ", "- Angenommen ", "- Wenn ", "- Dann "]) assert.ok(fehlt.includes(teil), `${teil} fehlt in:\n${fehlt}`);
  spracheFestlegen("en");
  const en = szenarienVerstoss(fachplan(null, { de: false }), "en");
  assert.match(en, /^The requirement needs a Scenarios section with at least one complete scenario\./);
  for (const teil of ["## Scenarios", "### Scenario: ", "- Given ", "- When ", "- Then "]) assert.ok(en.includes(teil), `${teil} fehlt in:\n${en}`);
});

test("ein vollstaendiges neben einem unvollstaendigen Szenario genuegt (A3)", () => {
  const body = fachplan(`## Szenarien\n\n${SZENARIO_DE}\n\n### Szenario: Halb\n- Angenommen nur eine Lage`);
  const s = szenarienLesen(body, "de");
  assert.deepEqual(s.szenarien.map((x) => x.vollstaendig), [true, false]);
  assert.equal(szenarienVerstoss(body, "de"), null);
});

// --- Lage (A1) -----------------------------------------------------------------

test("Lage: zwischen Kriterien und Nicht-Zielen, sonst ausserhalb mit eigener Meldung", () => {
  const vorne = `## Szenarien\n\n${SZENARIO_DE}\n\n## Ziel\nZiel.\n\n## Fachliche Akzeptanzkriterien\n1. K.\n\n## Nicht-Ziele\nKeine.\n`;
  const hinten = `## Ziel\nZiel.\n\n## Fachliche Akzeptanzkriterien\n1. K.\n\n## Nicht-Ziele\nKeine.\n\n## Szenarien\n\n${SZENARIO_DE}\n`;
  assert.equal(szenarienLesen(vorne, "de").lage, "ausserhalb");
  assert.equal(szenarienLesen(hinten, "de").lage, "ausserhalb");
  assert.match(szenarienVerstoss(hinten, "de"), /zwischen/);
  assert.equal(szenarienLesen(fachplan(null), "de").lage, null);
});

// --- Pflicht (A4 bis A6, E3) -----------------------------------------------------

test("szenarienPflicht: unter, gleich und ueber dem Stichtag -> false, true, true", () => {
  const config = { szenarienAb: 100 };
  assert.equal(szenarienPflicht("99", config), false);
  assert.equal(szenarienPflicht("100", config), true);
  assert.equal(szenarienPflicht(101, config), true);
});

test("szenarienPflicht: gepolsterte Nummer wird numerisch verglichen", () => {
  assert.equal(szenarienPflicht("0042", { szenarienAb: 42 }), true);
  assert.equal(szenarienPflicht("0041", { szenarienAb: 42 }), false);
  assert.equal(szenarienPflicht("0100", { szenarienAb: 99 }), true, "nicht als Zeichenkette verglichen");
});

test("szenarienPflicht: fehlendes oder ungueltiges Feld -> ohne-stichtag", () => {
  assert.equal(szenarienPflicht("5", {}), "ohne-stichtag");
  assert.equal(szenarienPflicht("5", undefined), "ohne-stichtag");
  assert.equal(szenarienPflicht("5", { szenarienAb: 0 }), "ohne-stichtag");
  assert.equal(szenarienPflicht("5", { szenarienAb: "7" }), "ohne-stichtag");
});

test("szenarienPflicht: der englische Feldname einer nicht normalisierten Config gilt ebenso", () => {
  assert.equal(szenarienPflicht("7", { scenariosFrom: 7 }), true);
});

test("Hinweis Stichtag fehlt nennt Feld und Kommando zum Nachholen, je Sprache", () => {
  assert.match(stichtagHinweis(), /^Stichtag fehlt/);
  assert.ok(stichtagHinweis().includes("`szenarienAb`"));
  assert.ok(stichtagHinweis().includes("node .claude/kit/board.mjs scenarios baseline"));
  spracheFestlegen("en");
  assert.match(stichtagHinweis(), /^Cut-off missing/);
  assert.ok(stichtagHinweis().includes("`scenariosFrom`"));
  assert.ok(stichtagHinweis().includes("node .claude/kit/board.mjs scenarios baseline"));
});

// --- Texte -------------------------------------------------------------------------

test("die Texttabelle hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
});

// --- Fachlicher Anlass (E10) -------------------------------------------------------

/** Ein Tracker-Ersatz ueber einer Kartenliste: nur, was `issue brief` liest. */
function tracker(karten) {
  return {
    async getIssue(id) {
      const k = karten.find((x) => x.id === String(id).replace(/^0+(?=\d)/, ""));
      if (!k) throw new Error(`#${id} fehlt`);
      return k;
    },
    async listIssues(status) {
      return karten.filter((k) => k.status === status);
    },
  };
}

const GESCHUETZT = { geschuetzteTreffer, geschuetztFreigabe, geschuetztKommentar };

/** Was `fn` auf stdout schreibt. */
async function ausgabe(fn) {
  const alt = process.stdout.write;
  let text = "";
  process.stdout.write = (teil) => {
    text += teil;
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = alt;
  }
  return text;
}

test("issue brief nennt die Szenarien eines Fachplans nicht unter Fachlicher Anlass (E10)", async () => {
  spracheFestlegen("de");
  const karten = [
    { id: "40", status: "backlog", title: "[Fachlich] Anlass", labels: [], body: fachplan(`## Szenarien\n\n${SZENARIO_DE}`) },
    {
      id: "41", status: "ready", title: "Paket", labels: [],
      body: "## Kontext\nText.\n\nFachliche Quelle: Issue #40\n\n## Aufgabe\nTun.\n\n## Akzeptanzkriterium\n- gruen\n\n## Abhängigkeiten\nKeine.\n",
    },
  ];
  const json = JSON.parse(await ausgabe(() => issueAuftrag(tracker(karten), { _: ["41"], json: true }, GESCHUETZT)));
  assert.equal(json.fachlicherAnlass.kriterien, "1. Kriterium.");
  const md = await ausgabe(() => issueAuftrag(tracker(karten), { _: ["41"] }, GESCHUETZT));
  const glied = md.slice(md.indexOf("## Fachlicher Anlass"), md.indexOf("## Geschwister"));
  assert.ok(glied.includes("1. Kriterium."), glied);
  for (const zeile of SZENARIO_DE.split("\n")) assert.ok(!glied.includes(zeile), `${zeile} steht im Anlass`);
});

// --- Satzzeichen nach dem Schluesselwort (Issue #1626) ------------------------

test("Komma oder Doppelpunkt direkt nach dem Schluesselwort zaehlt, in beiden Sprachen", () => {
  const de = { titel: "Komma", zeilen: ["- Angenommen, eine Lage", "- Wenn: etwas geschieht", "- Dann, ein Ergebnis"] };
  assert.equal(szenarioVollstaendig(de, "de"), true);
  const en = { titel: "Comma", zeilen: ["- Given, a state", "- When: something happens", "- Then, a result"] };
  assert.equal(szenarioVollstaendig(en, "en"), true);
  const body = fachplan("## Szenarien\n\n### Szenario: Komma\n- Angenommen, die Lage\n- Wenn der Mensch handelt\n- Dann folgt etwas");
  assert.equal(szenarienVerstoss(body, "de"), null);
});

test("ein anderes Satzzeichen nach dem Schluesselwort zaehlt weiter nicht", () => {
  for (const zeichen of [".", "?", ";", ",,"]) {
    const s = { titel: "Zeichen", zeilen: [`- Angenommen${zeichen} eine Lage`, "- Wenn etwas geschieht", "- Dann ein Ergebnis"] };
    assert.equal(szenarioVollstaendig(s, "de"), false, zeichen);
  }
});
