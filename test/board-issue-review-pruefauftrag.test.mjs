// `issue-review review-brief` im selben Prozess (Issue #1380, Plan #1375 A3, E2, E3, E7):
// Das Kit montiert den Pruefauftrag aus der Rollendatei unter kit/rollen/, der Artenliste,
// dem Dokument vom Board oder dem Material der Code-Pruefung. Board und Dateizugriff sind
// injiziert; die Rollendateien liest der Test echt, damit er die ausgelieferten Rollen misst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { issueReviewPruefauftrag } from "../kit/board/issue-review.mjs";
import { arten } from "../kit/findings.mjs";

const ROLLEN = join(import.meta.dirname, "..", "kit", "rollen");
const ROLLEN_NAMEN = readdirSync(ROLLEN).filter((d) => d.endsWith(".md")).map((d) => d.slice(0, -3));
const DOKUMENT_ROLLEN = ROLLEN_NAMEN.filter((r) => r !== "code-review");

const ARTEN_ZEILEN = arten().arten.map((a) => `${a.name} — ${a.erklaerung}`).join("\n");

/** Liest echt, ausser fuer die Pfade, die der Test vorgibt (null = Datei fehlt). */
function liesMit(vorgaben = {}) {
  return (pfad) => {
    for (const [ende, inhalt] of Object.entries(vorgaben)) {
      if (pfad.endsWith(ende)) return inhalt;
    }
    return existsSync(pfad) ? readFileSync(pfad, "utf-8") : null;
  };
}

/**
 * Ein Board mit festen Karten; `getIssue` wirft wie ein Adapter fuer Unbekanntes. Eine Karte
 * ist ein Body oder `{ title, body }`.
 */
function boardMit(karten) {
  return {
    async getIssue(id) {
      if (!(String(id) in karten)) throw new Error(`Issue #${id} nicht gefunden`);
      const karte = karten[id];
      return typeof karte === "string"
        ? { id: String(id), title: `Karte ${id}`, body: karte }
        : { id: String(id), ...karte };
    },
  };
}

const PLAN_MIT_QUELLE = "## Ziel\nDer Plan.\nFachliche Quelle: Issue #20\n";
const PLAN_OHNE_QUELLE = "## Ziel\nDer Plan ohne Quelle.\n";
const QUELLE_OHNE_VORLAGE = "## Ziel\nDie fachliche Quelle.\n";
const QUELLE_MIT_VORLAGE = "## Ziel\nDie fachliche Quelle.\nVorlage: `docs/bild/maske.png` — verbindlich\n";

async function montiere(args, umgebung = {}) {
  const verz = mkdtempSync(join(tmpdir(), "pruefauftrag-"));
  const datei = join(verz, "auftrag.md");
  try {
    const antwort = await issueReviewPruefauftrag({ ...args, file: datei }, {
      config: umgebung.config ?? {},
      board: umgebung.board ?? boardMit({}),
      lies: umgebung.lies ?? liesMit(),
    });
    const text = existsSync(datei) ? readFileSync(datei, "utf-8") : null;
    return { antwort, text, datei };
  } finally {
    rmSync(verz, { recursive: true, force: true });
  }
}

// --- Montage je Rolle ---

for (const rolle of DOKUMENT_ROLLEN) {
  test(`pruefauftrag montiert die Rolle ${rolle} aus kit/rollen/ ohne offenen Platzhalter`, async () => {
    const board = boardMit({ 10: PLAN_MIT_QUELLE, 20: QUELLE_MIT_VORLAGE });
    const { antwort, text, datei } = await montiere({ role: rolle, id: "10" }, { board });
    assert.equal(antwort.ok, true);
    assert.equal(antwort.rolle, rolle);
    assert.equal(antwort.datei, datei);
    assert.equal(antwort.zeichen, text.length);
    assert.ok(text.includes("Der Plan."), "Dokument eingesetzt");
    assert.ok(text.includes(ARTEN_ZEILEN), "Artenliste eingesetzt");
    assert.doesNotMatch(text, /\{\{[#/]?[A-Z_]+\}\}/, "kein Platzhalter und keine Blockmarke bleibt");
    const rahmen = readFileSync(join(ROLLEN, `${rolle}.md`), "utf-8").split("\n")[0];
    assert.ok(text.startsWith(rahmen), "beginnt mit dem Wortlaut der Rolle");
  });
}

test("pruefauftrag montiert die Rolle code-review aus der Material-Datei", async () => {
  const lies = liesMit({ "material.diff": "diff --git a/x b/x\n+neu\n", "checks-summary.json": null });
  const { antwort, text } = await montiere({ role: "code-review", "material-file": "/irgendwo/material.diff" }, { lies });
  assert.equal(antwort.ok, true);
  assert.ok(text.includes("--- REVIEW-MATERIAL ---\ndiff --git a/x b/x\n+neu\n"));
  assert.ok(text.includes(ARTEN_ZEILEN));
  assert.doesNotMatch(text, /\{\{[#/]?[A-Z_]+\}\}/);
});

// --- {{ARTEN}} (E2) ---

test("pruefauftrag setzt {{ARTEN}} je Art als Zeile '<name> — <erklaerung>'", async () => {
  const lies = liesMit({ "rollen/probe.md": "Arten:\n{{ARTEN}}\n--- ISSUE ---\n{{ISSUE_BODY}}\n" });
  const { text } = await montiere({ role: "probe", id: "10" }, { lies, board: boardMit({ 10: "Inhalt" }) });
  const zeilen = text.split("\n").slice(1, 1 + arten().anzahl);
  assert.deepEqual(zeilen, arten().arten.map((a) => `${a.name} — ${a.erklaerung}`));
});

// --- Bloecke {{#QUELLE}} / {{#VORLAGE}} (E3) ---

test("mit Quelle und Vorlage entfallen nur die Blockmarken", async () => {
  const board = boardMit({ 10: PLAN_MIT_QUELLE, 20: QUELLE_MIT_VORLAGE });
  const { text } = await montiere({ role: "architektur-bestand", id: "10" }, { board });
  assert.ok(text.includes("5. Was fehlt im Zuschnitt, und was kann RAUS?\n6. Stellt der Plan her,"));
  assert.ok(text.includes("deren Aussehen?\nDie Vorlage liegt unter docs/bild/maske.png; lies sie.\nFür jeden Fund"));
  assert.ok(text.includes("--- PLAN ---\n## Ziel\nDer Plan.\nFachliche Quelle: Issue #20\n\n--- FACHLICHE QUELLE ---\n## Ziel\nDie fachliche Quelle."));
});

test("mit Quelle ohne Vorlage entfaellt nur der Satz zur Vorlage samt Zeilenumbruch", async () => {
  const board = boardMit({ 10: PLAN_MIT_QUELLE, 20: QUELLE_OHNE_VORLAGE });
  const { text } = await montiere({ role: "architektur-bestand", id: "10" }, { board });
  assert.ok(text.includes("deren Aussehen?\nFür jeden Fund"), "keine Leerzeile, wo der Satz stand");
  assert.ok(!text.includes("Vorlage liegt unter"));
  assert.ok(text.includes("--- FACHLICHE QUELLE ---"));
});

test("die Vorlage-Zeile im Plan zaehlt wie die in der Quelle", async () => {
  const plan = `${PLAN_MIT_QUELLE}Vorlage: docs/plan-vorlage.html — Anregung\n`;
  const board = boardMit({ 10: plan, 20: QUELLE_OHNE_VORLAGE });
  const { text } = await montiere({ role: "architektur-bestand", id: "10" }, { board });
  assert.ok(text.includes("Die Vorlage liegt unter docs/plan-vorlage.html; lies sie."));
});

test("ohne Quelle entfallen Frage 6 und der Abschnitt FACHLICHE QUELLE samt Zeilenumbruch", async () => {
  const board = boardMit({ 10: PLAN_OHNE_QUELLE });
  for (const rolle of ["architektur-bestand", "schnitt-abhaengigkeiten"]) {
    const { antwort, text } = await montiere({ role: rolle, id: "10" }, { board });
    assert.equal(antwort.ok, true);
    assert.ok(!text.includes("FACHLICHE QUELLE"), rolle);
    assert.ok(!text.includes("6. Stellt"), rolle);
    assert.ok(text.endsWith("--- PLAN ---\n## Ziel\nDer Plan ohne Quelle.\n\n"), `${rolle}: ${JSON.stringify(text.slice(-60))}`);
  }
  const { text } = await montiere({ role: "architektur-bestand", id: "10" }, { board });
  assert.ok(text.includes("5. Was fehlt im Zuschnitt, und was kann RAUS?\nFür jeden Fund"));
});

test("Platzhalter im Dokument selbst werden nicht als Rollen-Platzhalter gelesen", async () => {
  const body = "Ein Text mit {{ARTEN}}, {{UNBEKANNT}} und {{#QUELLE}}x{{/QUELLE}} darin.\n";
  const { antwort, text } = await montiere({ role: "pruefbarkeit", id: "10" }, { board: boardMit({ 10: body }) });
  assert.equal(antwort.ok, true);
  assert.ok(text.includes(body), "das Dokument steht wortgetreu im Auftrag");
});

// --- Fehler ---

test("fehlende Rollendatei ergibt den Fehler rolle-fehlt mit Pfad", async () => {
  const { antwort, text } = await montiere({ role: "gibt-es-nicht", id: "10" }, { board: boardMit({ 10: "x" }) });
  assert.equal(antwort.ok, false);
  assert.equal(antwort.fehler, "rolle-fehlt");
  assert.equal(antwort.rolle, "gibt-es-nicht");
  assert.ok(antwort.pfad.endsWith(join("rollen", "gibt-es-nicht.md")), antwort.pfad);
  assert.equal(text, null, "keine Auftragsdatei");
});

test("ein anderer ungefuellter Platzhalter ist ein Fehler", async () => {
  const lies = liesMit({ "rollen/probe.md": "{{ARTEN}}\n{{ISSUE_BODY}}\n{{UNBEKANNT}} und {{QUELLE_BODY}}\n" });
  const { antwort, text } = await montiere({ role: "probe", id: "10" }, { lies, board: boardMit({ 10: "x" }) });
  assert.equal(antwort.ok, false);
  assert.equal(antwort.fehler, "platzhalter-offen");
  assert.deepEqual(antwort.platzhalter, ["UNBEKANNT", "QUELLE_BODY"]);
  assert.equal(text, null);
});

test("die Dokument-Rolle mit --material-file laesst {{ISSUE_BODY}} offen und ist ein Fehler", async () => {
  const lies = liesMit({ "material.diff": "diff" });
  const { antwort } = await montiere({ role: "pruefbarkeit", "material-file": "/x/material.diff" }, { lies });
  assert.equal(antwort.fehler, "platzhalter-offen");
  assert.deepEqual(antwort.platzhalter, ["ISSUE_BODY"]);
});

test("ein unlesbares Dokument ist ein Fehler mit der Kartennummer", async () => {
  const { antwort } = await montiere({ role: "pruefbarkeit", id: "99" });
  assert.equal(antwort.ok, false);
  assert.equal(antwort.fehler, "dokument-nicht-lesbar");
  assert.equal(antwort.id, "99");
});

test("eine fehlende Material-Datei ist ein Fehler mit Pfad", async () => {
  const lies = liesMit({ "material.diff": null });
  const { antwort } = await montiere({ role: "code-review", "material-file": "/x/material.diff" }, { lies });
  assert.equal(antwort.fehler, "material-fehlt");
  assert.equal(antwort.pfad, "/x/material.diff");
});

test("eine Rolle mit Pfadzeichen wird abgewiesen", async () => {
  await assert.rejects(montiere({ role: "../geheim", id: "10" }), /--role/);
});

test("--id und --material-file zugleich oder keins von beiden wird abgewiesen", async () => {
  await assert.rejects(montiere({ role: "pruefbarkeit", id: "10", "material-file": "/x" }), /entweder/);
  await assert.rejects(montiere({ role: "pruefbarkeit" }), /entweder/);
});

// --- Code-Pruefung und lokale Pruefung (E7) ---

test("code-review haengt checks-summary.json als Abschnitt LOKALE PRUEFUNG an", async () => {
  const summary = "{\n  \"ok\": true\n}\n";
  const lies = liesMit({ "material.diff": "diff\n", ".claude/checks-summary.json": summary });
  const { text } = await montiere({ role: "code-review", "material-file": "/x/material.diff" }, { lies });
  assert.ok(text.endsWith(`--- REVIEW-MATERIAL ---\ndiff\n\n--- LOKALE PRUEFUNG ---\n${summary}`), JSON.stringify(text.slice(-80)));
});

test("code-review ohne checks-summary.json hat keinen Abschnitt LOKALE PRUEFUNG", async () => {
  const lies = liesMit({ "material.diff": "diff\n", ".claude/checks-summary.json": null });
  const { text } = await montiere({ role: "code-review", "material-file": "/x/material.diff" }, { lies });
  assert.ok(!text.includes("LOKALE PRUEFUNG"));
  assert.ok(text.endsWith("--- REVIEW-MATERIAL ---\ndiff\n\n"));
});

// --- Kriterium 4: byte-gleich ---

test("zwei Laeufe mit gleichem Eingang ergeben byte-gleiche Dateien", async () => {
  const board = boardMit({ 10: PLAN_MIT_QUELLE, 20: QUELLE_MIT_VORLAGE });
  const eins = await montiere({ role: "schnitt-abhaengigkeiten", id: "10" }, { board });
  const zwei = await montiere({ role: "schnitt-abhaengigkeiten", id: "10" }, { board });
  assert.ok(Buffer.from(eins.text).equals(Buffer.from(zwei.text)));
});

// --- Block {{#VORGESCHICHTE}} (Issue #1540, Plan #1534 A3, A9, E2, E3) ---

const MIT_VORGESCHICHTE = { vorgeschichte: true };
const FRUEHER_41 = "## Ziel\nFrüheres Ziel 41.\n\n## Nicht-Ziele\n- Kein Export.\n";
const FRUEHER_42 = "## Ziel\nFrüheres Ziel 42.\n";
const PLAN_MIT_VORGESCHICHTE = [
  "## Ziel", "Der Plan.", "Fachliche Quelle: Issue #20", "",
  "### Vorgeschichte", "Suchbegriffe: Export; Archiv", "Dateien: `kit/gibt-es-nicht.mjs`", "- #41: zählt.", "",
  "## Betroffene Bereiche", "- x", "",
].join("\n");
const FACHPLAN_MIT_VORGESCHICHTE = [
  "## Ziel", "Die Anforderung.", "", "## Vorgeschichte", "Suchbegriffe: Export", "- #41: zählt.", "",
].join("\n");

/**
 * Ein Board, das auch die Archivsuche kann: `suche` (Begriff -> Nummern); jede Nummer ist eine
 * Karte mit [Fachlich]-Titel. `fehler` laesst die Suche scheitern wie ein Board ohne Netz.
 */
function boardMitArchiv(karten, { suche = {}, fehler = false } = {}) {
  const fruehere = { 10: PLAN_MIT_VORGESCHICHTE, 20: QUELLE_OHNE_VORLAGE, 41: FRUEHER_41, 42: FRUEHER_42 };
  const archiviert = new Set([41]);
  const aufrufe = [];
  return {
    aufrufe,
    ...boardMit(karten),
    async sucheFachplaene(begriff) {
      aufrufe.push(begriff);
      if (fehler) throw new Error("fetch failed");
      return { treffer: (suche[begriff] ?? []).map((n) => ({ nummer: n, titel: `[Fachlich] Karte ${n}`, archiviert: archiviert.has(n) })) };
    },
    async karteNachNummer(n) {
      return n in fruehere ? { titel: `[Fachlich] Karte ${n}`, body: fruehere[n], archiviert: archiviert.has(n) } : null;
    },
    async herkunftskette() {
      return [];
    },
  };
}

const PLAN_KARTEN = { 10: { title: "[Plan] Der Plan", body: PLAN_MIT_VORGESCHICHTE }, 20: QUELLE_OHNE_VORLAGE };
// Die Suche liefert auch das Dokument selbst und seine Fachliche Quelle (E3).
const SUCHE = { Export: [41, 10, 20], Archiv: [42, 41] };

test("mit Treffern traegt der Auftrag Pruefsatz und Anhang VORGESCHICHTE mit den ungekuerzten Bodies", async () => {
  const board = boardMitArchiv(PLAN_KARTEN, { suche: SUCHE });
  const { antwort, text } = await montiere({ role: "architektur-bestand", id: "10" }, { board, config: MIT_VORGESCHICHTE });
  assert.equal(antwort.ok, true);
  assert.deepEqual(board.aufrufe, ["Export", "Archiv"], "Suchbegriffe aus dem Abschnitt");
  assert.ok(text.includes("nicht vermerkt"), "die unnummerierte Pruefsatz-Zeile steht im Auftrag");
  const anhang = text.slice(text.indexOf("--- VORGESCHICHTE ---\n"));
  assert.ok(text.indexOf("--- VORGESCHICHTE ---\n") > text.indexOf("--- FACHLICHE QUELLE ---"), "Anhang nach der Quelle");
  assert.ok(anhang.includes("#41 [Fachlich] Karte 41 — archiviert: ja\n" + FRUEHER_41), anhang);
  assert.ok(anhang.includes("#42 [Fachlich] Karte 42 — archiviert: nein\n" + FRUEHER_42), anhang);
  assert.ok(!anhang.includes("#10 "), "das Dokument selbst ist keine Vorgeschichte");
  assert.ok(!anhang.includes("#20 "), "die Fachliche Quelle ist keine Vorgeschichte");
  assert.doesNotMatch(text, /\{\{[#/]?[A-Z_]+\}\}/);
});

test("die Nummerierung der Pruefungsfragen bleibt mit Vorgeschichte unveraendert", async () => {
  const board = boardMitArchiv(PLAN_KARTEN, { suche: SUCHE });
  const { text } = await montiere({ role: "architektur-bestand", id: "10" }, { board, config: MIT_VORGESCHICHTE });
  const nummern = [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(nummern, [1, 2, 3, 4, 5, 6]);
});

test("der Fachplan liest seine Vorgeschichte unter ## und schliesst sich selbst aus", async () => {
  const karten = { 30: { title: "[Fachlich] Neu", body: FACHPLAN_MIT_VORGESCHICHTE } };
  const board = boardMitArchiv(karten, { suche: { Export: [30, 41] } });
  for (const rolle of ["form-beobachtbarkeit", "abgrenzung"]) {
    const { antwort, text } = await montiere({ role: rolle, id: "30" }, { board, config: MIT_VORGESCHICHTE });
    assert.equal(antwort.ok, true, rolle);
    assert.ok(text.includes("--- VORGESCHICHTE ---\n#41 [Fachlich] Karte 41 — archiviert: ja\n"), rolle);
    assert.ok(!text.includes("#30 "), `${rolle}: eigene Nummer`);
  }
});

test("mit Treffern bleibt in keiner Dokument-Rolle ein Platzhalter offen", async () => {
  const board = boardMitArchiv(PLAN_KARTEN, { suche: SUCHE });
  for (const rolle of DOKUMENT_ROLLEN) {
    const { antwort, text } = await montiere({ role: rolle, id: "10" }, { board, config: MIT_VORGESCHICHTE });
    assert.equal(antwort.ok, true, `${rolle}: ${JSON.stringify(antwort)}`);
    assert.doesNotMatch(text, /\{\{[#/]?[A-Z_]+\}\}/, rolle);
  }
});

test("Schalter aus, ohne Suchbegriffe-Zeile und ohne Archiv entfaellt der Block wie heute", async () => {
  const ohneZeile = PLAN_MIT_VORGESCHICHTE.replace("Suchbegriffe: Export; Archiv\n", "");
  const faelle = [
    ["Schalter aus", boardMitArchiv(PLAN_KARTEN, { suche: SUCHE }), { vorgeschichte: false }],
    ["ohne Suchbegriffe-Zeile", boardMitArchiv({ ...PLAN_KARTEN, 10: { title: "[Plan] P", body: ohneZeile } }, { suche: SUCHE }), MIT_VORGESCHICHTE],
    ["archiv-nicht-erreichbar", boardMitArchiv(PLAN_KARTEN, { suche: SUCHE, fehler: true }), MIT_VORGESCHICHTE],
  ];
  for (const rolle of ["architektur-bestand", "form-beobachtbarkeit"]) {
    const heute = (await montiere({ role: rolle, id: "10" }, { board: boardMit(PLAN_KARTEN) })).text;
    for (const [fall, board, config] of faelle) {
      const { antwort, text } = await montiere({ role: rolle, id: "10" }, { board, config });
      assert.equal(antwort.ok, true, `${rolle}, ${fall}`);
      assert.ok(!text.includes("VORGESCHICHTE"), `${rolle}, ${fall}`);
      if (fall !== "ohne Suchbegriffe-Zeile") assert.equal(text, heute, `${rolle}, ${fall}: Auftrag wie heute`);
    }
  }
});

// Die Zeilen der Vorgeschichte stehen in der Projektsprache (Issue #1568): `Search terms:`
// gilt wie `Suchbegriffe:`.
test("[1568] die Vorgeschichte liest auch die englische Zeile Search terms:", async () => {
  const englisch = PLAN_MIT_VORGESCHICHTE.replace("Suchbegriffe:", "Search terms:").replace("Dateien:", "Files:");
  const board = boardMitArchiv({ ...PLAN_KARTEN, 10: { title: "[Plan] Der Plan", body: englisch } }, { suche: SUCHE });
  const { antwort, text } = await montiere({ role: "architektur-bestand", id: "10" }, { board, config: MIT_VORGESCHICHTE });
  assert.equal(antwort.ok, true);
  assert.deepEqual(board.aufrufe, ["Export", "Archiv"]);
  assert.ok(text.includes("--- VORGESCHICHTE ---\n"), "Anhang fehlt");
});
