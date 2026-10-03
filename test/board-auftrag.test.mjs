// `issue auftrag` — Aufgabe, Voraussetzungen und das Urteil "darf beginnen" in einem Zug
// (Issue #1023, Plan #1015 E2, E3, E5, E6).
//
// Der Befehl ist rein lesend: Er bewegt keine Karte und schreibt keinen Kommentar. Bei
// Folge "backlog" liefert er den Kommentartext, den die Session selbst ans Board haengt.
//
// Je Adapter dieselben Faelle ueber das echte CLI: local direkt, GitHub und GitLab mit
// Fake-gh/-glab, toolbox gegen einen Mock-Server. Dazu zwei Gleichlauf-Tests gegen
// kit/night.mjs: Abhaengigkeitslesung gegen `parseDeps`, Backlog-Texte gegen die
// `Nachtlauf: `-Texte in `pruefeIssueGates`, der Text fuer `kit:geschuetzt` darunter
// (Issue #1052).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, runBoardAsync, fakeCli, aufrufe, starteServer, toolboxMitKommentaren } from "./helpers/board-fixture.mjs";
import { GITHUB, basisRegeln as ghBasis } from "./helpers/board-github-fixture.mjs";
import { GITLAB, basisRegeln as glabBasis } from "./helpers/board-gitlab-fixture.mjs";
import {
  AUFTRAG_BACKLOG_TEXTE, GESCHUETZTE_PFADE, GESCHUETZT_LABEL_GESETZT, abhaengigkeitenLesen, abhaengigkeitenMitHerkunft, fenceLauf,
} from "../kit/board.mjs";
import { GESCHUETZT_LABEL_GATE_TEXT, parseDeps, pruefeIssueGates } from "../kit/night.mjs";

// --- Das gemeinsame Board ---
//
// Jede Karte steht fuer genau ein Urteil. 20 bis 22 sind Voraussetzungen, 99 fehlt.

const deps = (...nummern) => `## Abhängigkeiten\n${nummern.length ? nummern.map((n) => "Issue #" + n).join("\n") : "Keine."}\n`;
const body = (...nummern) => `## Kontext\nText.\n\n## Aufgabe\nTun.\n\n## Akzeptanzkriterium\n- gruen\n\n${deps(...nummern)}`;

// Kontext-Zeilen eines Pakets, wie `/issues` sie schreibt.
const kontext = (...zeilen) => `## Kontext\nText.\n\n${zeilen.join("\n")}\n\n## Aufgabe\nTun.\n\n## Akzeptanzkriterium\n- gruen\n\n${deps()}`;

// Freitext mit E9 und E2E vor den Eintraegen, ein `- E8:` erst im naechsten Abschnitt: Beides
// ist keine Plan-Entscheidung.
const E_ABSCHNITT = "## Architektonische Entscheidungen\n\n- **Zwei Befehle.** Freitext mit E9 und E2E.\n\n"
  + "- E2: Frage zwei?\n  Gewählt: A. Grund: B.\n- E5: Frage fünf?\n  Gewählt: C.\n  Rückbau: trivial.\n"
  + "- E7: Frage sieben?\n  Gewählt: D.\n\n## Geplante Änderungen\n\n- E8: steht nicht im Abschnitt.\n";
const E2 = "- E2: Frage zwei?\n  Gewählt: A. Grund: B.";
const E5 = "- E5: Frage fünf?\n  Gewählt: C.\n  Rückbau: trivial.";
const E7 = "- E7: Frage sieben?\n  Gewählt: D.";

// Ein Codeblock mit `##` im Ziel: Er gehoert zum Ziel und beendet es nicht.
const ZIEL = "Zieltext.\n\n```\n## kein Abschnitt\n```";
const KRITERIEN = "1. Kriterium eins.\n2. Kriterium zwei.";
const FACHLICH_BODY = `## Ziel\n\n${ZIEL}\n\n## Fachliche Akzeptanzkriterien\n\n${KRITERIEN}\n\n## Nicht-Ziele\n\nNichts davon.\n`;

// Ein Paket, das eine geschuetzte Datei beim Namen nennt (Issue #1052, Plan #987). Der Pfad
// kommt aus der Vorgabeliste (E18), nicht aus einer eigenen Schreibweise im Test.
const GESCHUETZT_PFAD = GESCHUETZTE_PFADE[0];
const GESCHUETZT_ZEILE = `Den Eintrag in \`${GESCHUETZT_PFAD}\` ergaenzen.`;
const geschuetztBody = `## Kontext\nText.\n\n## Aufgabe\n${GESCHUETZT_ZEILE}\n\n## Akzeptanzkriterium\n- gruen\n\n${deps()}`;
// Der Halt-Kommentar, wie der Runner ihn nach einem gelungenen `label add` schreibt — mit
// abgenommenem Label gibt er die Karte nach E5 frei.
const FREIGABE = `## Geschuetzte Datei\n\nText.\n\n- \`${GESCHUETZT_PFAD}\`\n  > ${GESCHUETZT_ZEILE}\n\n${GESCHUETZT_LABEL_GESETZT}`;

const KARTEN = [
  { nr: 10, spalte: "ready", titel: "Paket frei", body: body() },
  { nr: 11, spalte: "in_progress", titel: "Paket in Arbeit", body: body() },
  { nr: 12, spalte: "ready", titel: "[Fachlich] Anforderung", body: body() },
  { nr: 13, spalte: "ready", titel: "[Idee] Einfall", body: body() },
  { nr: 14, spalte: "ready", titel: "[Plan] Weg", body: body() },
  { nr: 15, spalte: "ready", titel: "[Mensch] Zugang anlegen", body: body() },
  { nr: 16, spalte: "ready", titel: "Paket mit Frage", body: body(), labels: ["kit:klaeren"] },
  { nr: 17, spalte: "ready", titel: "Paket wartet", body: body(20) },
  { nr: 18, spalte: "ready", titel: "Paket mit Phantom", body: body(99) },
  { nr: 19, spalte: "ready", titel: "Rueckläufer", body: body(21, 22), kommentare: ["Review: Test fehlt."] },
  { nr: 20, spalte: "ready", titel: "Voraussetzung offen", body: body() },
  { nr: 21, spalte: "in_review", titel: "Voraussetzung im Review", body: body() },
  { nr: 22, spalte: "done", titel: "Voraussetzung fertig", body: body() },
  // Ein Vorhaben (Issue #1024): Plan 30 mit fachlicher Quelle 40, seine Pakete 31 bis 34.
  // 35 gehoert zu Plan 300 und nennt #30 nur im Fliesstext; 36 gehoert zu Plan 37 ohne Quelle.
  { nr: 30, spalte: "backlog", titel: "[Plan] Vorhaben", body: `Fachliche Quelle: Issue #40\n\n## Ziel\nPlanziel.\n\n${E_ABSCHNITT}` },
  { nr: 31, spalte: "ready", titel: "Paket mit Auswahl", body: kontext("Plan: Issue #30", "Fachliche Quelle: Issue #40", "Plan-Entscheidungen: E2, E5") },
  { nr: 32, spalte: "done", titel: "Geschwister fertig", body: kontext("Plan: Issue #30") },
  { nr: 33, spalte: "ready", titel: "Paket ohne Auswahl", body: kontext("Plan: Issue #30") },
  { nr: 34, spalte: "in_review", titel: "Paket mit Phantom-E", body: kontext("Plan: Issue #30", "Plan-Entscheidungen: E2, E9") },
  { nr: 35, spalte: "backlog", titel: "Fremdes Vorhaben", body: kontext("Plan: Issue #300", "Siehe Plan: Issue #30 im Fliesstext.") },
  { nr: 36, spalte: "ready", titel: "Paket ohne Quelle", body: kontext("Plan: Issue #37", "Plan-Entscheidungen: Keine.") },
  { nr: 37, spalte: "backlog", titel: "[Plan] Ohne Quelle", body: "## Ziel\nOhne Quelle.\n\n## Architektonische Entscheidungen\n\n- E1: Einzige?\n  Gewählt: ja.\n" },
  { nr: 40, spalte: "backlog", titel: "[Fachlich] Anlass", body: FACHLICH_BODY },
  // Geschuetzte Dateien (Issue #1052): Label, Treffer, freigegebene Karte, Menschenschritt.
  { nr: 50, spalte: "ready", titel: "Paket wartet auf Handlung", body: body(), labels: ["kit:geschuetzt"] },
  { nr: 51, spalte: "ready", titel: "Paket mit geschuetzter Datei", body: geschuetztBody },
  { nr: 52, spalte: "ready", titel: "Paket freigegeben", body: geschuetztBody, kommentare: [FREIGABE] },
  { nr: 53, spalte: "ready", titel: "[Mensch] Einstellung eintragen", body: geschuetztBody },
  { nr: 54, spalte: "ready", titel: "Paket mit geschuetzter Datei und Voraussetzung", body: geschuetztBody.replace(deps(), deps(20)) },
];

const GLIEDER = ["Urteil", "Aufgabe", "Plan-Entscheidungen", "Fachlicher Anlass", "Geschwister", "Voraussetzungen", "Lücken"];

// Die `##`-Ueberschriften ausserhalb von Codebloecken — der Body steht eingezaeunt darin.
function ueberschriften(markdown) {
  const imFence = fenceLauf();
  return markdown.split("\n").filter((z) => !imFence(z) && /^## /.test(z)).map((z) => z.slice(3).trim());
}

function json(res) {
  assert.equal(res.status, 0, `Exit ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/**
 * Die Faelle, die jeder Adapter erfuellen muss. `lauf(args)` ruft `issue auftrag` und
 * liefert { status, stdout, stderr }; `zustand()` liefert, was sich am Board aendern
 * koennte (Spalte und Kommentare), fuer den Vorher-nachher-Vergleich.
 */
async function adapterFaelle(t, lauf, zustand) {
  const auftrag = async (...args) => json(await lauf(["issue", "auftrag", ...args, "--json"]));

  await t.test("darf beginnen", async () => {
    const a = await auftrag("10");
    assert.equal(a.urteil.urteil, "darf beginnen");
    assert.equal(a.urteil.folge, "beginnen");
    assert.equal(a.aufgabe.titel, "Paket frei");
    assert.equal(a.aufgabe.spalte, "ready");
    assert.match(a.aufgabe.body, /## Aufgabe\nTun\./);
    assert.deepEqual(a.voraussetzungen, []);
  });

  await t.test("nicht in Ready -> bleibt", async () => {
    const a = await auftrag("11");
    assert.equal(a.urteil.urteil, "darf nicht beginnen");
    assert.equal(a.urteil.folge, "bleibt");
    assert.match(a.urteil.grund, /liegt nicht \(mehr\) in Ready/);
    assert.equal(a.urteil.kommentar, null);
  });

  await t.test("--spalte in_progress erwartet In progress", async () => {
    assert.equal((await auftrag("11", "--spalte", "in_progress")).urteil.folge, "beginnen");
    const a = await auftrag("10", "--spalte", "in_progress");
    assert.equal(a.urteil.folge, "bleibt");
    assert.match(a.urteil.grund, /liegt nicht \(mehr\) in In progress/);
  });

  const backlogFaelle = [
    ["12", "[Fachlich]", AUFTRAG_BACKLOG_TEXTE.fachlich("12")],
    ["13", "[Idee]", AUFTRAG_BACKLOG_TEXTE.idee("13")],
    ["14", "[Plan]", AUFTRAG_BACKLOG_TEXTE.plan("14")],
    ["15", "[Mensch]", AUFTRAG_BACKLOG_TEXTE.mensch("15")],
    ["16", "kit:klaeren", AUFTRAG_BACKLOG_TEXTE.klaeren("16")],
  ];
  for (const [nr, was, text] of backlogFaelle) {
    await t.test(`${was} -> backlog mit Kommentartext, Karte unveraendert`, async () => {
      const vorher = await zustand(nr);
      const a = await auftrag(nr);
      assert.equal(a.urteil.urteil, "darf nicht beginnen");
      assert.equal(a.urteil.folge, "backlog");
      assert.equal(a.urteil.kommentar, text);
      const md = await lauf(["issue", "auftrag", nr]);
      assert.equal(md.status, 0);
      assert.ok(md.stdout.includes(text), "der Kommentartext steht woertlich in der Markdown-Ausgabe");
      assert.deepEqual(await zustand(nr), vorher, "weder Spalte noch Kommentare veraendert");
    });
  }

  // --- Geschuetzte Dateien (Issue #1052, Plan #987, E5, E6, E10, E11, E17) ---

  await t.test("kit:geschuetzt -> backlog mit eigenem Text, Label und Karte unveraendert", async () => {
    const vorher = await zustand("50");
    const a = await auftrag("50");
    assert.equal(a.urteil.urteil, "darf nicht beginnen");
    assert.equal(a.urteil.folge, "backlog");
    assert.equal(a.urteil.kommentar, AUFTRAG_BACKLOG_TEXTE.geschuetzt("50"));
    assert.match(a.urteil.grund, /kit:geschuetzt/);
    assert.ok(a.aufgabe.labels.includes("kit:geschuetzt"), "das Label bleibt");
    assert.deepEqual(await zustand("50"), vorher);
  });

  await t.test("geschuetzter Pfad -> geschuetzt, Kommentar gleich dem von check-geschuetzt", async () => {
    const vorher = await zustand("51");
    const a = await auftrag("51");
    assert.equal(a.urteil.urteil, "darf nicht beginnen");
    assert.equal(a.urteil.folge, "geschuetzt");
    const check = await lauf(["issue", "check-geschuetzt", "51"]);
    assert.equal(check.status, 1, check.stderr);
    const erwartet = JSON.parse(check.stdout).kommentar;
    assert.ok(erwartet, "check-geschuetzt liefert einen Kommentar");
    assert.equal(a.urteil.kommentar, erwartet);
    assert.ok(!a.urteil.kommentar.includes(GESCHUETZT_LABEL_GESETZT), "ohne Label-Zeile");
    for (const schritt of [/Backlog/, /issue label add 51 kit:geschuetzt/, /Fehlschlag/, /Label kit:geschuetzt gesetzt/, /Label kit:geschuetzt nicht gesetzt/]) {
      assert.match(a.urteil.grund, schritt);
    }
    const md = await lauf(["issue", "auftrag", "51"]);
    assert.equal(md.status, 0);
    assert.match(md.stdout, /Folge: geschuetzt/);
    assert.ok(md.stdout.includes(`Kommentar fuer die Karte (woertlich):\n\n${erwartet}`), md.stdout);
    assert.deepEqual(await zustand("51"), vorher, "weder Spalte noch Labels noch Kommentare veraendert");
  });

  await t.test("geschuetzt steht vor den Voraussetzungen", async () => {
    assert.equal((await auftrag("54")).urteil.folge, "geschuetzt");
  });

  await t.test("freigegebene Karte nach E5 -> darf beginnen", async () => {
    const a = await auftrag("52");
    assert.equal(a.urteil.urteil, "darf beginnen");
    assert.equal(a.urteil.folge, "beginnen");
  });

  await t.test("[Mensch]-Titel mit geschuetztem Pfad -> weiter das Praefix-Urteil", async () => {
    const a = await auftrag("53");
    assert.equal(a.urteil.folge, "backlog");
    assert.equal(a.urteil.kommentar, AUFTRAG_BACKLOG_TEXTE.mensch("53"));
  });

  await t.test("Voraussetzung unerfuellt -> bleibt", async () => {
    const a = await auftrag("17");
    assert.equal(a.urteil.folge, "bleibt");
    assert.deepEqual(a.voraussetzungen, [{ id: "20", titel: "Voraussetzung offen", spalte: "ready", befund: "unerfuellt" }]);
  });

  await t.test("Voraussetzung nicht feststellbar -> bleibt und steht unter Luecken", async () => {
    const a = await auftrag("18");
    assert.equal(a.urteil.folge, "bleibt");
    assert.equal(a.voraussetzungen.length, 1);
    assert.equal(a.voraussetzungen[0].id, "99");
    assert.equal(a.voraussetzungen[0].befund, "nicht feststellbar");
    assert.ok(a.luecken.some((l) => l.includes("#99")));
  });

  await t.test("Voraussetzungen in In review und Done -> darf beginnen; Ruecklaeufer zeigt Kommentare", async () => {
    const vorher = await zustand("19");
    const a = await auftrag("19");
    assert.equal(a.urteil.folge, "beginnen");
    assert.deepEqual(a.voraussetzungen.map((v) => [v.id, v.spalte, v.befund]), [["21", "in_review", "erfuellt"], ["22", "done", "erfuellt"]]);
    assert.ok(a.aufgabe.kommentare.some((k) => k.body.includes("Review: Test fehlt.")));
    const md = (await lauf(["issue", "auftrag", "19"])).stdout;
    assert.ok(md.includes("Review: Test fehlt."), "der Kommentar steht im Glied Aufgabe");
    assert.deepEqual(await zustand("19"), vorher);
  });

  await t.test("Markdown: sieben Glieder in fester Reihenfolge, fehlende unter Luecken", async () => {
    const res = await lauf(["issue", "auftrag", "10"]);
    assert.equal(res.status, 0);
    assert.deepEqual(ueberschriften(res.stdout), GLIEDER);
    const luecken = res.stdout.slice(res.stdout.lastIndexOf("## Lücken"));
    assert.match(luecken, /Plan-Entscheidungen: .*kein Vorhaben/);
    assert.match(luecken, /Fachlicher Anlass: /);
    assert.match(luecken, /Geschwister: .*kein Vorhaben/);
    assert.doesNotMatch(res.stdout, /noch nicht ermittelt/);
  });

  await t.test("--json: jedes Glied als eigenes Feld", async () => {
    const a = await auftrag("31");
    assert.deepEqual(Object.keys(a), ["id", "urteil", "aufgabe", "planEntscheidungen", "fachlicherAnlass", "geschwister", "voraussetzungen", "luecken"]);
    assert.deepEqual(Object.keys(a.planEntscheidungen), ["plan", "auswahl", "hinweis", "eintraege"]);
    assert.deepEqual(Object.keys(a.fachlicherAnlass), ["quelle", "herkunft", "ziel", "kriterien", "vollerText"]);
    assert.deepEqual(Object.keys(a.geschwister), ["plan", "hinweis", "karten"]);
  });

  // --- Plan-Entscheidungen (E1) ---

  await t.test("Plan-Entscheidungen: genau die genannten Eintraege im Wortlaut samt Folgezeilen", async () => {
    const a = await auftrag("31");
    assert.equal(a.planEntscheidungen.plan, "30");
    assert.deepEqual(a.planEntscheidungen.auswahl, ["E2", "E5"]);
    assert.equal(a.planEntscheidungen.hinweis, null);
    assert.deepEqual(a.planEntscheidungen.eintraege, [{ id: "E2", text: E2 }, { id: "E5", text: E5 }]);
    assert.ok(!a.luecken.some((l) => l.startsWith("Plan-Entscheidung")), a.luecken.join("\n"));
    const md = (await lauf(["issue", "auftrag", "31"])).stdout;
    const glied = md.slice(md.indexOf("## Plan-Entscheidungen"), md.indexOf("## Fachlicher Anlass"));
    assert.ok(glied.includes(E2) && glied.includes(E5), glied);
    assert.ok(!glied.includes("E7"), "nicht genannte Eintraege fehlen");
  });

  await t.test("Plan-Entscheidungen ohne Zeile: alle Eintraege und der Satz 'keine Auswahl'", async () => {
    const a = await auftrag("33");
    assert.equal(a.planEntscheidungen.auswahl, null);
    assert.match(a.planEntscheidungen.hinweis, /keine Auswahl/);
    assert.deepEqual(a.planEntscheidungen.eintraege, [{ id: "E2", text: E2 }, { id: "E5", text: E5 }, { id: "E7", text: E7 }]);
    const md = (await lauf(["issue", "auftrag", "33"])).stdout;
    assert.match(md, /keine Auswahl/);
    assert.ok(!md.includes("E8: steht nicht"), "ein `- E8:` ausserhalb des Abschnitts ist kein Eintrag");
  });

  await t.test("Plan-Entscheidungen: ein im Plan fehlendes E<n> steht unter Luecken", async () => {
    const a = await auftrag("34", "--spalte", "in_progress");
    assert.deepEqual(a.planEntscheidungen.eintraege.map((e) => e.id), ["E2"]);
    assert.ok(a.luecken.some((l) => l.includes("E9") && l.includes("#30")), a.luecken.join("\n"));
  });

  await t.test("Plan-Entscheidungen: Keine. ist eine Auswahl, keine Luecke", async () => {
    const a = await auftrag("36");
    assert.equal(a.planEntscheidungen.plan, "37");
    assert.deepEqual(a.planEntscheidungen.auswahl, []);
    assert.deepEqual(a.planEntscheidungen.eintraege, []);
    assert.ok(!a.luecken.some((l) => l.startsWith("Plan-Entscheidung")), a.luecken.join("\n"));
  });

  // --- Fachlicher Anlass (E4) ---

  await t.test("fachlicher Anlass aus dem Paket: Ziel und Kriterien woertlich, Satz Voller Text", async () => {
    const a = await auftrag("31");
    assert.deepEqual(a.fachlicherAnlass, {
      quelle: "40", herkunft: "paket", ziel: ZIEL, kriterien: KRITERIEN,
      vollerText: "Voller Text: `node .claude/kit/board.mjs issue get 40`",
    });
    const md = (await lauf(["issue", "auftrag", "31"])).stdout;
    assert.deepEqual(ueberschriften(md), GLIEDER, "das `##` im Ziel bleibt Inhalt");
    const glied = md.slice(md.indexOf("## Fachlicher Anlass"), md.indexOf("## Geschwister"));
    for (const teil of ["Ziel", "Fachliche Akzeptanzkriterien", "Zieltext.", "1. Kriterium eins.", "Voller Text: `node .claude/kit/board.mjs issue get 40`"]) {
      assert.ok(glied.includes(teil), `${teil} fehlt in:\n${glied}`);
    }
    assert.ok(!glied.includes("Nichts davon."), "nur Ziel und Kriterien, nicht der ganze Body");
  });

  await t.test("fachlicher Anlass aus dem Plan, wenn das Paket keine Quelle nennt", async () => {
    const a = await auftrag("33");
    assert.equal(a.fachlicherAnlass.quelle, "40");
    assert.equal(a.fachlicherAnlass.herkunft, "plan");
    assert.equal(a.fachlicherAnlass.kriterien, KRITERIEN);
  });

  await t.test("ohne fachliche Quelle in Paket und Plan: Luecke", async () => {
    const a = await auftrag("36");
    assert.equal(a.fachlicherAnlass.quelle, null);
    assert.ok(a.luecken.some((l) => l.startsWith("Fachlicher Anlass")), a.luecken.join("\n"));
  });

  // --- Geschwister (E7) ---

  await t.test("Geschwister: alle Karten des Plans ueber alle Spalten, auch Done, mit Spalte", async () => {
    const a = await auftrag("31");
    assert.equal(a.geschwister.plan, "30");
    const karten = a.geschwister.karten.filter((k) => k.id !== "38");
    assert.deepEqual(karten, [
      { id: "32", titel: "Geschwister fertig", spalte: "done" },
      { id: "33", titel: "Paket ohne Auswahl", spalte: "ready" },
      { id: "34", titel: "Paket mit Phantom-E", spalte: "in_review" },
    ]);
    const md = (await lauf(["issue", "auftrag", "31"])).stdout;
    assert.match(md, /#32 Geschwister fertig — Spalte: done/);
  });

  await t.test("ohne Plan: kein Vorhaben und Luecke", async () => {
    const a = await auftrag("10");
    assert.equal(a.planEntscheidungen.plan, null);
    assert.equal(a.geschwister.plan, null);
    assert.equal(a.geschwister.hinweis, "kein Vorhaben");
    assert.deepEqual(a.geschwister.karten, []);
    assert.equal(a.fachlicherAnlass.quelle, null);
    assert.ok(a.luecken.some((l) => l.startsWith("Geschwister") && l.includes("kein Vorhaben")), a.luecken.join("\n"));
    assert.ok(a.luecken.some((l) => l.startsWith("Fachlicher Anlass")), a.luecken.join("\n"));
    assert.match((await lauf(["issue", "auftrag", "10"])).stdout, /kein Vorhaben/);
  });

  await t.test("nicht lesbares Paket -> Exit 1", async () => {
    const res = await lauf(["issue", "auftrag", "99"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /99/);
  });
}

// --- local ---

function lokalDatei(k) {
  const labels = k.labels ? `labels: ${k.labels.join(", ")}\n` : "";
  let inhalt = `---\nid: "${String(k.nr).padStart(4, "0")}"\ntype: task\nstatus: ${k.spalte}\ntitle: ${k.titel}\n${labels}---\n\n${k.body}`;
  for (const c of k.kommentare || []) inhalt += `\n\n---\n**Kommentar** (2026-09-28 08:00)\n\n${c}`;
  return inhalt;
}

test("local", async (t) => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-auftrag-local-");
  mkdirSync(join(dir, "issues"));
  for (const k of KARTEN) writeFileSync(join(dir, "issues", `${String(k.nr).padStart(4, "0")}.md`), lokalDatei(k));
  const zustand = (nr) => readFileSync(join(dir, "issues", `${nr.padStart(4, "0")}.md`), "utf-8");
  try {
    await adapterFaelle(t, async (args) => runBoard(dir, args), zustand);
    await t.test("rein lesend: kein Bewegungsprotokoll, keine Berichtsstuecke", () => {
      assert.deepEqual(readdirSync(join(dir, ".claude")).sort(), ["workflow.config.json"]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- GitHub ---

const GH_STATUS = { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "In review", done: "Done" };
const ghKommentar = (i, text) => ({
  id: `IC_${i}`, url: `https://github.com/besitzer/mein-repo/issues/19#issuecomment-${500 + i}`,
  author: { login: "manne" }, body: text, createdAt: "2026-09-28T08:00:00Z",
});

function ghRegeln() {
  const regeln = KARTEN.map((k) => ({
    match: `^issue view ${k.nr} `,
    stdout: {
      number: k.nr, title: k.titel, body: k.body, state: k.spalte === "done" ? "CLOSED" : "OPEN",
      labels: (k.labels || []).map((name) => ({ name })),
      comments: (k.kommentare || []).map((c, i) => ghKommentar(i, c)),
      createdAt: "2026-09-27T08:00:00Z",
    },
  }));
  regeln.push({ match: "^issue view 99 ", stderr: "GraphQL: Could not resolve to an issue with the number of 99.\n", exit: 1 });
  regeln.push({
    match: "^project item-list",
    stdout: { items: KARTEN.map((k) => ({ status: GH_STATUS[k.spalte], content: { number: k.nr, title: k.titel } })) },
  });
  // Die Bodies fuer die Geschwister: alle Zustaende, dazu 38, das in keiner Spalte steht.
  const geschwister = { number: 38, title: "Geschwister ohne Spalte", body: kontext("Plan: Issue #30"), state: "OPEN" };
  regeln.push({
    match: "^issue list .*--state all .*--json number,title,body",
    stdout: [...KARTEN.map((k) => ({ number: k.nr, title: k.titel, body: k.body, state: k.spalte === "done" ? "CLOSED" : "OPEN" })), geschwister],
  });
  regeln.push({
    match: "^issue list .*--state all",
    stdout: KARTEN.map((k) => ({ number: k.nr, labels: (k.labels || []).map((name) => ({ name })) })),
  });
  return regeln;
}

const ghSchreibend = (argv) => (argv[0] === "issue" && ["comment", "edit", "close", "reopen"].includes(argv[1]))
  || (argv[0] === "project" && ["item-edit", "item-add"].includes(argv[1]))
  || argv.includes("PATCH");

test("GitHub", async (t) => {
  const dir = setupProjekt(GITHUB, "board-auftrag-gh-");
  fakeCli(dir, "gh", [...ghRegeln(), ...ghBasis()]);
  const zustand = () => aufrufe(dir, "gh").filter(ghSchreibend);
  try {
    await adapterFaelle(t, async (args) => runBoard(dir, args), zustand);
    await t.test("Geschwister in keiner Spalte: nicht feststellbar und unter Luecken", () => {
      const res = runBoard(dir, ["issue", "auftrag", "31", "--json"]);
      const a = json(res);
      assert.deepEqual(a.geschwister.karten.find((k) => k.id === "38"), { id: "38", titel: "Geschwister ohne Spalte", spalte: null });
      assert.ok(a.luecken.some((l) => l.includes("#38") && l.includes("nicht feststellbar")), a.luecken.join("\n"));
      const md = runBoard(dir, ["issue", "auftrag", "31"]).stdout;
      assert.match(md, /#38 Geschwister ohne Spalte — Spalte: nicht feststellbar/);
    });
    await t.test("geschlossene Voraussetzung in Done gilt als erfuellt", () => {
      const a = json(runBoard(dir, ["issue", "auftrag", "19", "--json"]));
      assert.deepEqual(a.voraussetzungen.find((v) => v.id === "22"), { id: "22", titel: "Voraussetzung fertig", spalte: "done", befund: "erfuellt" });
    });
    await t.test("kein schreibender gh-Aufruf", () => assert.deepEqual(zustand(), []));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- GitLab ---

const GL_LABEL = { backlog: "Backlog", ready: "Ready", in_progress: "In progress", in_review: "In review" };

const glKarte = (k) => ({
  iid: k.nr, title: k.titel, description: k.body, state: k.spalte === "done" ? "closed" : "opened",
  labels: [...(k.labels || []), ...(GL_LABEL[k.spalte] ? [GL_LABEL[k.spalte]] : [])],
  created_at: "2026-09-27T08:00:00Z",
});

function glRegeln() {
  // Die Spaltenlisten fuer die Geschwister: vier Label-Spalten, Done ist der Zustand Closed.
  const regeln = Object.entries(GL_LABEL).map(([spalte, label]) => ({
    match: `^issue list .*--label ${label}( |$)`,
    stdout: KARTEN.filter((k) => k.spalte === spalte).map(glKarte),
  }));
  regeln.push({ match: "^issue list .*--closed", stdout: KARTEN.filter((k) => k.spalte === "done").map(glKarte) });
  for (const k of KARTEN) {
    regeln.push({
      match: `^issue view ${k.nr} `,
      stdout: glKarte(k),
    });
    regeln.push({
      match: `^api projects/:id/issues/${k.nr}/notes$`,
      stdout: (k.kommentare || []).map((c, i) => ({ id: 70 + i, author: { username: "manne" }, body: c, created_at: "2026-09-28T08:00:00Z" })),
    });
  }
  regeln.push({ match: "^issue view 99 ", stderr: "404 Not Found\n", exit: 1 });
  return regeln;
}

const glSchreibend = (argv) => (argv[0] === "issue" && ["update", "note", "close", "reopen"].includes(argv[1]))
  || argv.includes("PUT") || argv.includes("POST");

test("GitLab", async (t) => {
  const dir = setupProjekt(GITLAB, "board-auftrag-glab-");
  fakeCli(dir, "glab", [...glRegeln(), ...glabBasis()]);
  const zustand = () => aufrufe(dir, "glab").filter(glSchreibend);
  try {
    await adapterFaelle(t, async (args) => runBoard(dir, args), zustand);
    await t.test("kein schreibender glab-Aufruf", () => assert.deepEqual(zustand(), []));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- toolbox ---

const TBX_SPALTE = { backlog: "BACKLOG", ready: "READY", in_progress: "IN_PROGRESS", in_review: "IN_REVIEW", done: "DONE" };

test("toolbox", async (t) => {
  const karten = KARTEN.map((k, i) => ({
    id: 900 + k.nr, number: k.nr, title: k.titel, body: k.body, column: TBX_SPALTE[k.spalte], position: i,
    labels: (k.labels || []).map((name) => ({ name })),
  }));
  const kommentare = {};
  for (const k of KARTEN) {
    kommentare[900 + k.nr] = (k.kommentare || []).map((c, i) => ({ id: 40 + i, author: "manne", body: c, createdAt: "2026-09-28T08:00:00Z" }));
  }
  const { server, requests, host } = await starteServer(toolboxMitKommentaren({ karten, kommentare }));
  const dir = setupProjekt({ codeHost: "local", issueTracker: "toolbox", toolbox: { host } }, "board-auftrag-tbx-");
  const zustand = (nr) => {
    const karte = karten.find((k) => String(k.number) === nr);
    return JSON.stringify({ spalte: karte.column, kommentare: kommentare[karte.id] });
  };
  try {
    await adapterFaelle(t, (args) => runBoardAsync(dir, args, { TBX_TOKEN: "test-token" }), zustand);
    await t.test("nur lesende Requests", () => {
      assert.deepEqual(requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`), []);
    });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Aufrufformen ---

test("ohne id und mit falscher --spalte: Exit 1", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "board-auftrag-args-");
  mkdirSync(join(dir, "issues"));
  writeFileSync(join(dir, "issues", "0010.md"), lokalDatei(KARTEN[0]));
  try {
    assert.equal(runBoard(dir, ["issue", "auftrag"]).status, 1);
    const res = runBoard(dir, ["issue", "auftrag", "10", "--spalte", "done"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--spalte/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Gleichlauf: Abhaengigkeitslesung gegen parseDeps ---

const DEPS_FIXTURES = [
  body(),
  body(3, 4),
  "## Abhaengigkeiten\n#7, #8 und #7\n",
  "## Kontext\nsiehe #5\n\n## Abhängigkeiten\nIssue #6\n\n## Nachtrag\n#9\n",
  "## Abhängigkeiten\n```\n## Aufgabe\n#11\n```\n#12\n",
  "```\n## Abhängigkeiten\n#13\n```\n\n## Abhängigkeiten\n#14\n",
  "## Abhängigkeiten\n`owner/repo`#245 und repo#246 und #247\n",
  "Im Fliesstext: ## Abhängigkeiten #15\n",
  "## Abhängigkeiten\n#16\n\n## Abhängigkeiten\n#17\n",
  "   ##  abhängigkeiten  \r\n#18\r\n",
  "",
];

function depsAbweichungen(lesen, vergleich) {
  return DEPS_FIXTURES.filter((b) => JSON.stringify(lesen(b)) !== JSON.stringify(vergleich(b)));
}

test("Gleichlauf: die Abhaengigkeitslesung stimmt auf allen Fixtures mit parseDeps ueberein", () => {
  assert.deepEqual(depsAbweichungen(abhaengigkeitenLesen, parseDeps), []);
  assert.deepEqual(abhaengigkeitenLesen(body(3, 4)), [3, 4]);
});

// Die Lesung mit Herkunft (Issue #1058) muss dieselben Nummern liefern wie parseDeps.
const herkunftNummern = (lesen) => (b) => lesen(b).map((t) => t.nummer);

test("Gleichlauf: die Nummern der Lesung mit Herkunft stimmen mit parseDeps ueberein", () => {
  assert.deepEqual(depsAbweichungen(herkunftNummern(abhaengigkeitenMitHerkunft), parseDeps), []);
  assert.deepEqual(depsAbweichungen(herkunftNummern(abhaengigkeitenMitHerkunft), abhaengigkeitenLesen), []);
});

test("Gleichlauf: eine abweichende Kopie der Lesung mit Herkunft faellt auf", () => {
  const ohneCodeblock = (b) => abhaengigkeitenMitHerkunft(b).filter((t) => t.stelle !== "#11");
  const ohneDedupe = (b) => abhaengigkeitenMitHerkunft(b).flatMap((t) => (t.nummer === 7 ? [t, t] : [t]));
  assert.notDeepEqual(depsAbweichungen(herkunftNummern(ohneCodeblock), parseDeps), []);
  assert.notDeepEqual(depsAbweichungen(herkunftNummern(ohneDedupe), parseDeps), []);
});

test("Gleichlauf: eine abweichende Kopie der Lesung faellt auf", () => {
  const fenceBlind = (b) => abhaengigkeitenLesen(b.replaceAll("```", ""));
  const ohneDedupe = (b) => [...String(b).matchAll(/(?<![\w`/#])#(\d+)/g)].map((m) => Number(m[1]));
  assert.notDeepEqual(depsAbweichungen(fenceBlind, parseDeps), []);
  assert.notDeepEqual(depsAbweichungen(ohneDedupe, parseDeps), []);
});

// --- Gleichlauf: Backlog-Kommentartexte gegen kit/night.mjs ---

const TEXT_FAELLE = [
  ["fachlich", { id: "41", title: "[Fachlich] X", labels: [] }],
  ["idee", { id: "42", title: "[Idee] X", labels: [] }],
  ["plan", { id: "43", title: "[Plan] X", labels: [] }],
  ["mensch", { id: "44", title: "[Mensch] X", labels: [] }],
  ["klaeren", { id: "45", title: "Paket", labels: ["kit:klaeren"] }],
  ["geschuetzt", { id: "46", title: "Paket", labels: ["kit:geschuetzt"] }],
];

function textAbweichungen(texte, gates) {
  return TEXT_FAELLE
    .filter(([art, issue]) => `Nachtlauf: ${texte[art](issue.id)}` !== gates(issue)?.kommentar)
    .map(([art]) => art);
}

test("Gleichlauf: die Backlog-Texte gleichen den Nachtlauf-Texten ohne Praefix", () => {
  assert.deepEqual(Object.keys(AUFTRAG_BACKLOG_TEXTE).sort(), TEXT_FAELLE.map(([a]) => a).sort());
  assert.deepEqual(textAbweichungen(AUFTRAG_BACKLOG_TEXTE, pruefeIssueGates), []);
});

test("Gleichlauf: ein abweichender Text auf einer Seite faellt auf", () => {
  const kopie = { ...AUFTRAG_BACKLOG_TEXTE, idee: (id) => AUFTRAG_BACKLOG_TEXTE.idee(id).replace("wird nicht", "wird nachts nicht") };
  assert.deepEqual(textAbweichungen(kopie, pruefeIssueGates), ["idee"]);
  const nachtAnders = (issue) => {
    const r = pruefeIssueGates(issue);
    return issue.labels.includes("kit:klaeren") ? { ...r, kommentar: `${r.kommentar} ` } : r;
  };
  assert.deepEqual(textAbweichungen(AUFTRAG_BACKLOG_TEXTE, nachtAnders), ["klaeren"]);
});

test("Gleichlauf: der Label-Text fuer kit:geschuetzt gleicht GESCHUETZT_LABEL_GATE_TEXT, eine Abwandlung faellt auf", () => {
  assert.equal(`Nachtlauf: ${AUFTRAG_BACKLOG_TEXTE.geschuetzt("46")}`, GESCHUETZT_LABEL_GATE_TEXT);
  const kopie = { ...AUFTRAG_BACKLOG_TEXTE, geschuetzt: (id) => AUFTRAG_BACKLOG_TEXTE.geschuetzt(id).replace("nur ein Mensch", "die Maschine") };
  assert.deepEqual(textAbweichungen(kopie, pruefeIssueGates), ["geschuetzt"]);
  const nachtAnders = (issue) => {
    const r = pruefeIssueGates(issue);
    return issue.labels.includes("kit:geschuetzt") ? { ...r, kommentar: r.kommentar.replace("wartet", "steht aus") } : r;
  };
  assert.deepEqual(textAbweichungen(AUFTRAG_BACKLOG_TEXTE, nachtAnders), ["geschuetzt"]);
});
