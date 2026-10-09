// `issue-review pruefauftrag` im selben Prozess (Issue #1380, Plan #1375 A3, E2, E3, E7):
// Das Kit montiert den Pruefauftrag aus der Rollendatei unter kit/rollen/, der Artenliste,
// dem Dokument vom Board oder dem Material der Code-Pruefung. Board und Dateizugriff sind
// injiziert; die Rollendateien liest der Test echt, damit er die ausgelieferten Rollen misst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { issueReviewPruefauftrag } from "../kit/board/issue-review.mjs";
import { arten } from "../kit/befunde.mjs";

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

/** Ein Board mit festen Karten; `getIssue` wirft wie ein Adapter fuer Unbekanntes. */
function boardMit(karten) {
  return {
    async getIssue(id) {
      if (!(String(id) in karten)) throw new Error(`Issue #${id} nicht gefunden`);
      return { id: String(id), title: `Karte ${id}`, body: karten[id] };
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
    const antwort = await issueReviewPruefauftrag({ ...args, datei }, {
      config: {},
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
    const { antwort, text, datei } = await montiere({ rolle, id: "10" }, { board });
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
  const { antwort, text } = await montiere({ rolle: "code-review", "material-datei": "/irgendwo/material.diff" }, { lies });
  assert.equal(antwort.ok, true);
  assert.ok(text.includes("--- REVIEW-MATERIAL ---\ndiff --git a/x b/x\n+neu\n"));
  assert.ok(text.includes(ARTEN_ZEILEN));
  assert.doesNotMatch(text, /\{\{[#/]?[A-Z_]+\}\}/);
});

// --- {{ARTEN}} (E2) ---

test("pruefauftrag setzt {{ARTEN}} je Art als Zeile '<name> — <erklaerung>'", async () => {
  const lies = liesMit({ "rollen/probe.md": "Arten:\n{{ARTEN}}\n--- ISSUE ---\n{{ISSUE_BODY}}\n" });
  const { text } = await montiere({ rolle: "probe", id: "10" }, { lies, board: boardMit({ 10: "Inhalt" }) });
  const zeilen = text.split("\n").slice(1, 1 + arten().anzahl);
  assert.deepEqual(zeilen, arten().arten.map((a) => `${a.name} — ${a.erklaerung}`));
});

// --- Bloecke {{#QUELLE}} / {{#VORLAGE}} (E3) ---

test("mit Quelle und Vorlage entfallen nur die Blockmarken", async () => {
  const board = boardMit({ 10: PLAN_MIT_QUELLE, 20: QUELLE_MIT_VORLAGE });
  const { text } = await montiere({ rolle: "architektur-bestand", id: "10" }, { board });
  assert.ok(text.includes("5. Was fehlt im Zuschnitt, und was kann RAUS?\n6. Stellt der Plan her,"));
  assert.ok(text.includes("deren Aussehen?\nDie Vorlage liegt unter docs/bild/maske.png; lies sie.\nFür jeden Fund"));
  assert.ok(text.includes("--- PLAN ---\n## Ziel\nDer Plan.\nFachliche Quelle: Issue #20\n\n--- FACHLICHE QUELLE ---\n## Ziel\nDie fachliche Quelle."));
});

test("mit Quelle ohne Vorlage entfaellt nur der Satz zur Vorlage samt Zeilenumbruch", async () => {
  const board = boardMit({ 10: PLAN_MIT_QUELLE, 20: QUELLE_OHNE_VORLAGE });
  const { text } = await montiere({ rolle: "architektur-bestand", id: "10" }, { board });
  assert.ok(text.includes("deren Aussehen?\nFür jeden Fund"), "keine Leerzeile, wo der Satz stand");
  assert.ok(!text.includes("Vorlage liegt unter"));
  assert.ok(text.includes("--- FACHLICHE QUELLE ---"));
});

test("die Vorlage-Zeile im Plan zaehlt wie die in der Quelle", async () => {
  const plan = `${PLAN_MIT_QUELLE}Vorlage: docs/plan-vorlage.html — Anregung\n`;
  const board = boardMit({ 10: plan, 20: QUELLE_OHNE_VORLAGE });
  const { text } = await montiere({ rolle: "architektur-bestand", id: "10" }, { board });
  assert.ok(text.includes("Die Vorlage liegt unter docs/plan-vorlage.html; lies sie."));
});

test("ohne Quelle entfallen Frage 6 und der Abschnitt FACHLICHE QUELLE samt Zeilenumbruch", async () => {
  const board = boardMit({ 10: PLAN_OHNE_QUELLE });
  for (const rolle of ["architektur-bestand", "schnitt-abhaengigkeiten"]) {
    const { antwort, text } = await montiere({ rolle, id: "10" }, { board });
    assert.equal(antwort.ok, true);
    assert.ok(!text.includes("FACHLICHE QUELLE"), rolle);
    assert.ok(!text.includes("6. Stellt"), rolle);
    assert.ok(text.endsWith("--- PLAN ---\n## Ziel\nDer Plan ohne Quelle.\n\n"), `${rolle}: ${JSON.stringify(text.slice(-60))}`);
  }
  const { text } = await montiere({ rolle: "architektur-bestand", id: "10" }, { board });
  assert.ok(text.includes("5. Was fehlt im Zuschnitt, und was kann RAUS?\nFür jeden Fund"));
});

test("Platzhalter im Dokument selbst werden nicht als Rollen-Platzhalter gelesen", async () => {
  const body = "Ein Text mit {{ARTEN}}, {{UNBEKANNT}} und {{#QUELLE}}x{{/QUELLE}} darin.\n";
  const { antwort, text } = await montiere({ rolle: "pruefbarkeit", id: "10" }, { board: boardMit({ 10: body }) });
  assert.equal(antwort.ok, true);
  assert.ok(text.includes(body), "das Dokument steht wortgetreu im Auftrag");
});

// --- Fehler ---

test("fehlende Rollendatei ergibt den Fehler rolle-fehlt mit Pfad", async () => {
  const { antwort, text } = await montiere({ rolle: "gibt-es-nicht", id: "10" }, { board: boardMit({ 10: "x" }) });
  assert.equal(antwort.ok, false);
  assert.equal(antwort.fehler, "rolle-fehlt");
  assert.equal(antwort.rolle, "gibt-es-nicht");
  assert.ok(antwort.pfad.endsWith(join("rollen", "gibt-es-nicht.md")), antwort.pfad);
  assert.equal(text, null, "keine Auftragsdatei");
});

test("ein anderer ungefuellter Platzhalter ist ein Fehler", async () => {
  const lies = liesMit({ "rollen/probe.md": "{{ARTEN}}\n{{ISSUE_BODY}}\n{{UNBEKANNT}} und {{QUELLE_BODY}}\n" });
  const { antwort, text } = await montiere({ rolle: "probe", id: "10" }, { lies, board: boardMit({ 10: "x" }) });
  assert.equal(antwort.ok, false);
  assert.equal(antwort.fehler, "platzhalter-offen");
  assert.deepEqual(antwort.platzhalter, ["UNBEKANNT", "QUELLE_BODY"]);
  assert.equal(text, null);
});

test("die Dokument-Rolle mit --material-datei laesst {{ISSUE_BODY}} offen und ist ein Fehler", async () => {
  const lies = liesMit({ "material.diff": "diff" });
  const { antwort } = await montiere({ rolle: "pruefbarkeit", "material-datei": "/x/material.diff" }, { lies });
  assert.equal(antwort.fehler, "platzhalter-offen");
  assert.deepEqual(antwort.platzhalter, ["ISSUE_BODY"]);
});

test("ein unlesbares Dokument ist ein Fehler mit der Kartennummer", async () => {
  const { antwort } = await montiere({ rolle: "pruefbarkeit", id: "99" });
  assert.equal(antwort.ok, false);
  assert.equal(antwort.fehler, "dokument-nicht-lesbar");
  assert.equal(antwort.id, "99");
});

test("eine fehlende Material-Datei ist ein Fehler mit Pfad", async () => {
  const lies = liesMit({ "material.diff": null });
  const { antwort } = await montiere({ rolle: "code-review", "material-datei": "/x/material.diff" }, { lies });
  assert.equal(antwort.fehler, "material-fehlt");
  assert.equal(antwort.pfad, "/x/material.diff");
});

test("eine Rolle mit Pfadzeichen wird abgewiesen", async () => {
  await assert.rejects(montiere({ rolle: "../geheim", id: "10" }), /--rolle/);
});

test("--id und --material-datei zugleich oder keins von beiden wird abgewiesen", async () => {
  await assert.rejects(montiere({ rolle: "pruefbarkeit", id: "10", "material-datei": "/x" }), /entweder/);
  await assert.rejects(montiere({ rolle: "pruefbarkeit" }), /entweder/);
});

// --- Code-Pruefung und lokale Pruefung (E7) ---

test("code-review haengt checks-summary.json als Abschnitt LOKALE PRUEFUNG an", async () => {
  const summary = "{\n  \"ok\": true\n}\n";
  const lies = liesMit({ "material.diff": "diff\n", ".claude/checks-summary.json": summary });
  const { text } = await montiere({ rolle: "code-review", "material-datei": "/x/material.diff" }, { lies });
  assert.ok(text.endsWith(`--- REVIEW-MATERIAL ---\ndiff\n\n--- LOKALE PRUEFUNG ---\n${summary}`), JSON.stringify(text.slice(-80)));
});

test("code-review ohne checks-summary.json hat keinen Abschnitt LOKALE PRUEFUNG", async () => {
  const lies = liesMit({ "material.diff": "diff\n", ".claude/checks-summary.json": null });
  const { text } = await montiere({ rolle: "code-review", "material-datei": "/x/material.diff" }, { lies });
  assert.ok(!text.includes("LOKALE PRUEFUNG"));
  assert.ok(text.endsWith("--- REVIEW-MATERIAL ---\ndiff\n\n"));
});

// --- Kriterium 4: byte-gleich ---

test("zwei Laeufe mit gleichem Eingang ergeben byte-gleiche Dateien", async () => {
  const board = boardMit({ 10: PLAN_MIT_QUELLE, 20: QUELLE_MIT_VORLAGE });
  const eins = await montiere({ rolle: "schnitt-abhaengigkeiten", id: "10" }, { board });
  const zwei = await montiere({ rolle: "schnitt-abhaengigkeiten", id: "10" }, { board });
  assert.ok(Buffer.from(eins.text).equals(Buffer.from(zwei.text)));
});
