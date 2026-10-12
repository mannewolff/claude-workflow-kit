// Zurueckgelesene Marker werden unter beiden Namen erkannt (Issue #1443, Plan #1420 E15).
//
// Jede Stelle, die einen Marker aus Kommentar oder Body zurueckliest, liest ihn ueber das
// Register in kit/board/namen.mjs. Geschrieben wird weiter deutsch; dieser Test zeigt an
// einem Ort, dass eine Karte mit englischen Markern so gelesen wird wie eine deutsche —
// in Nachtlauf, Bericht, Formgates, Ursprung, Auftrag und Befunden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { leseMarker, markerWerte } from "../kit/board/namen.mjs";
import { herkunftNummern, autorModellSicherstellen, kontextGrenzen, kitStandZeileFuer, issueStand,
  zerlegeAbschnitte } from "../kit/board/dokumente.mjs";
import { pruefeFachlich, pruefePlan, pruefeIssue, geschuetztFreigabe } from "../kit/board/geschuetzt.mjs";
import { ursprungAuswerten } from "../kit/board/ursprung.mjs";
import { planReviewWert, fachplanReviewWert, einarbeitungVon } from "../kit/night/bericht.mjs";
import { stammtAusErzeugung, fachlicheQuelleVon, paketUmgesetzt } from "../kit/night/kette.mjs";
import { empfohlenesModell, aufgabenStufe } from "../kit/night/session.mjs";
import { aufrufen } from "../kit/befunde.mjs";

/** Beide Sprachen einer Fixture: `de` und `en` ueber dieselbe Funktion. */
const beide = (de, en, pruefe) => {
  pruefe(de, "de");
  pruefe(en, "en");
};

test("leseMarker liefert Sache und Rest in der Schreibweise der Zeile", () => {
  assert.deepEqual(leseMarker("  Author-Model: Claude-Opus"), { sache: "autorModell", rest: " Claude-Opus" });
  assert.deepEqual(leseMarker("Plan-Review: fable"), { sache: "planReview", rest: " fable" });
  assert.equal(leseMarker("## Kontextwechsel"), null);
  assert.equal(leseMarker(undefined), null);
  assert.deepEqual(markerWerte("Plan: Issue #1\nfoo\nPlan: Issue #2", "plan"), [" Issue #1", " Issue #2"]);
});

// --- Kontext, Herkunft und Kennzeichnung (kit/board/dokumente.mjs) ---------------

test("Herkunftszeilen: Requirement und Plan werden wie Fachliche Quelle und Plan gelesen", () => {
  beide("Fachliche Quelle: Issue #0042\nPlan: Issue #7", "Requirement: Issue #0042\nPlan: Issue #7", (body) => {
    assert.deepEqual(herkunftNummern(body, "Fachliche Quelle"), ["42"]);
    assert.deepEqual(herkunftNummern(body, "Plan"), ["7"]);
  });
  assert.deepEqual(herkunftNummern("Plan-Review: Issue #7", "Plan"), [], "Plan-Review ist keine Herkunftszeile");
  assert.deepEqual(herkunftNummern("Plan: Issue #7 und mehr", "Plan"), [], "nur ganze Zeilen");
});

test("Autor-Modell: eine englische Zeile gilt als vorhanden, ein englischer Kontext nimmt die neue auf", () => {
  const en = "## Context\nAuthor-Model: claude-opus-5\n\n## Aufgabe\nx";
  assert.equal(autorModellSicherstellen(en, undefined, {}), en);
  const ohne = autorModellSicherstellen("## Context\nText\n\n## Aufgabe\nx", "fable", {});
  assert.equal(ohne, "## Context\nText\nAutor-Modell: fable\n\n## Aufgabe\nx");
  assert.deepEqual(kontextGrenzen("Vorlauf\n## Context\nText\n## Aufgabe\n"), { start: 8, ende: 24 });
});

test("Kit-Stand: ein Text mit englischer Zeile bekommt keine zweite", () => {
  const baum = mkdtempSync(join(tmpdir(), "marker-kitstand-"));
  try {
    mkdirSync(join(baum, ".claude"));
    writeFileSync(join(baum, ".claude", "kit-stand.json"), JSON.stringify({ pid: process.pid }));
    const env = { KIT_STAND: "0123456789abcdef" };
    const config = { mainBranch: "main" };
    assert.match(kitStandZeileFuer("Bericht", { env, baum, config }), /^Kit-Stand: 0123456789ab/);
    beide("Bericht\nKit-Stand: x", "Bericht\nKit-Revision: x", (text) => {
      assert.equal(kitStandZeileFuer(text, { env, baum, config }), null);
    });
  } finally {
    rmSync(baum, { recursive: true, force: true });
  }
});

test("issue stand: ein englischer Laufstand wird ersetzt, kein zweiter angelegt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marker-stand-"));
  try {
    const datei = join(dir, "stand.md");
    writeFileSync(datei, "Umsetzung laeuft\n");
    const aufrufe = [];
    const tracker = {
      kommentareStreng: async () => [{ id: "k1", body: "## Run status\n\nalt" }],
      labelIssue: async () => {},
      getIssue: async (id) => ({ id, labels: [] }),
      ersetzeKommentar: async (id, kid) => aufrufe.push(["ersetzt", kid]),
      commentIssue: async () => aufrufe.push(["angelegt"]),
    };
    await issueStand(tracker, {}, { _: ["5"], zustand: "laeuft", "text-file": datei });
    assert.deepEqual(aufrufe, [["ersetzt", "k1"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Formgates (kit/board/geschuetzt.mjs) ---------------------------------------

const gates = (verstoesse) => verstoesse.map((v) => v.gate);

test("Formgate Fachlich: Author-Model erfuellt F2, Requirement an der Wurzel ist F9, Issue-Review F11", () => {
  beide("Autor-Modell", "Author-Model", (_, sprache) => {
    const kopf = sprache === "de" ? "Autor-Modell: fable" : "Author-Model: fable";
    const quelle = sprache === "de" ? "Fachliche Quelle: Issue #3" : "Requirement: Issue #3";
    const body = `## Ziel\nText\n${kopf}\n${quelle}\nIssue-Review: x\n\n## Fachliche Akzeptanzkriterien\n1. a\n\n## Nicht-Ziele\n- b\n\n## Offene Fragen an den PO\n- Keine.`;
    const { abschnitte } = zerlegeAbschnitte(body);
    const g = gates(pruefeFachlich(abschnitte, body.split("\n")));
    assert.ok(!g.includes("F2"), `${sprache}: F2 trotz Kennzeichnung`);
    assert.ok(g.includes("F9"), `${sprache}: Herkunftszeile nicht erkannt`);
    assert.ok(g.includes("F11"), `${sprache}: Issue-Review nicht erkannt`);
  });
});

test("Formgate Plan: Plan-Model erfuellt P3", () => {
  beide("Plan-Modell: fable", "Plan-Model: fable", (kopfZeile) => {
    const { abschnitte } = zerlegeAbschnitte("## Ziel\nx");
    assert.ok(!gates(pruefePlan([kopfZeile], abschnitte, [])).includes("P3"));
  });
});

test("Formgate Paket: Author-Model, Template und Decision im englischen Kontext", () => {
  const paket = (kontext, akzeptanz = "- `node --test x`") =>
    `## Kontext\n${kontext}\n\n## Aufgabe\n1. a\n\n## Akzeptanzkriterium\n${akzeptanz}\n\n## Abhaengigkeiten\nKeine.`;
  beide("de", "en", (sprache) => {
    const en = sprache === "en";
    const autor = en ? "Author-Model: fable" : "Autor-Modell: fable";
    const vorlage = `${en ? "Template:" : "Vorlage:"} docs/a.png — verbindlich`;
    const entscheidung = `${en ? "Decision:" : "Entscheidung:"} Vollauf im Paket? Gewaehlt: ja`;
    const g = gates(pruefeIssue(zerlegeAbschnitte(paket(`${autor}\n${vorlage}\n${entscheidung}`)).abschnitte, {}, "Titel", process.cwd()));
    assert.ok(!g.includes("I2"), `${sprache}: I2 trotz Kennzeichnung`);
    assert.ok(g.includes("I5"), `${sprache}: Vorlage nicht erkannt`);
    assert.ok(g.includes("I6"), `${sprache}: Entscheidung nicht erkannt`);
  });
  const abh = `## Kontext\nAuthor-Model: x\n\n## Aufgabe\n1. a\n\n## Akzeptanzkriterium\n- a\n\n## Abhaengigkeiten\nRequirement: Issue #4`;
  assert.ok(gates(pruefeIssue(zerlegeAbschnitte(abh).abschnitte, {}, "Titel", process.cwd())).includes("I4"));
});

test("Geschuetzte Datei: ein englischer Halt-Kommentar gibt frei wie ein deutscher", () => {
  const treffer = [{ pfad: ".claude/settings.json", zeile: "x" }];
  beide("## Geschuetzte Datei", "## Protected file", (anker) => {
    const body = `${anker}\n\nText\n\n- \`.claude/settings.json\`\n\nLabel kit:geschuetzt gesetzt`;
    assert.equal(geschuetztFreigabe(treffer, [{ body }], []), true);
  });
});

// --- Ursprung (kit/board/ursprung.mjs) ------------------------------------------

test("Ursprung: Requirement-Zeile und Superseded-Vermerk werden gelesen", async () => {
  const karten = (quelle) => [
    { id: "10", titel: "[Fachlich] A", spalte: "backlog", body: "" },
    { id: "20", titel: "[Plan] neu", spalte: "backlog", body: `${quelle} Issue #10` },
    { id: "21", titel: "Paket", spalte: "in_review", body: "Plan: Issue #20" },
    { id: "30", titel: "[Plan] alt", spalte: "backlog", body: `${quelle} Issue #10` },
    { id: "31", titel: "Paket alt", spalte: "backlog", body: "Plan: Issue #30" },
  ];
  for (const [quelle, vermerk] of [["Fachliche Quelle:", "Ueberholt durch Plan #20"], ["Requirement:", "Superseded by plan #20"]]) {
    const r = await ursprungAuswerten({ karten: karten(quelle), planNr: "20", kommentareVon: async () => [vermerk] });
    const anforderung = r.dokumente.find((d) => d.art === "fachlich");
    assert.equal(anforderung?.aktion, "wandert", `${quelle}: ${JSON.stringify(r.dokumente)}`);
  }
});

// --- Bericht (kit/night/bericht.mjs) --------------------------------------------

test("Bericht: Plan-Review, Requirement-Review und Einarbeitung unter beiden Namen", () => {
  assert.equal(planReviewWert("x\n  Plan-Review:  fable \n"), "fable");
  beide("Fachplan-Review: gpt", "Requirement-Review: gpt", (body) => assert.equal(fachplanReviewWert(body), "gpt"));
  beide("## Einarbeitung, Runde 2\n\ntext", "## Incorporation, Round 2\n\ntext", (k) => {
    assert.equal(einarbeitungVon({ comments: [{ body: "andere" }, { body: k }] }), k);
  });
  assert.equal(einarbeitungVon({ comments: [{ body: "## Incorporation, Round x" }] }), null);
});

// --- Nachtlauf (kit/night/kette.mjs, kit/night/session.mjs) --------------------

test("Nachtlauf: Herkunft der Erzeugung, fachliche Quelle und Nachweis-Vermerk", () => {
  beide("Fachliche Quelle: Issue #007", "Requirement: Issue #007", (body) => {
    assert.equal(stammtAusErzeugung({ title: "[Plan] x", body }, "007", "plan"), true);
    assert.equal(fachlicheQuelleVon(body), "007");
  });
  assert.equal(stammtAusErzeugung({ title: "[Plan] x", body: "Requirement: Issue #70" }, "7", "plan"), false);
  beide("Nachtlauf: Nachweis fehlt", "Night run: evidence missing", (k) => {
    assert.equal(paketUmgesetzt({ status: "in_review", comments: [{ body: k }] }), false);
  });
  assert.equal(paketUmgesetzt({ status: "in_review", comments: [{ body: "anders" }] }), true);
});

test("Sitzung: Recommended model und Task-Tier wie Empfohlenes Modell und Aufgabenstufe", () => {
  beide("Empfohlenes Modell: fable", "Recommended model: fable", (body) => {
    assert.deepEqual(empfohlenesModell(body, ["fable"]), { modell: "fable", grund: null });
  });
  beide("Aufgabenstufe: mittel", "Task-Tier: mittel", (body) => {
    assert.deepEqual(aufgabenStufe(body), { stufe: "mittel", grund: null });
  });
  assert.deepEqual(aufgabenStufe("Task-Tier: zwei Woerter"), { stufe: null, grund: null });
});

// --- Befunde (kit/befunde.mjs) --------------------------------------------------

test("Befunde: ein englischer Review-Kopf verlangt den Reviewer-Kopf wie ein deutscher", () => {
  const fund = ["#### WICHTIG", "", "**W1 — Titel.**", "Gegenprobe: x — geprueft, bestaetigt", "Art: doppelung"].join("\n");
  beide("## Plan-Review, Runde 1", "## Requirement-Review, Round 1", (kopf) => {
    const dir = mkdtempSync(join(tmpdir(), "marker-befunde-"));
    try {
      const datei = join(dir, "b.md");
      writeFileSync(datei, `${kopf}\n\n${fund}\n`);
      const json = JSON.parse(aufrufen(["pruefen", "--datei", datei], { cwd: dir }).stdout);
      assert.deepEqual(json.funde[0].fehlt, ["reviewer-kopf"], kopf);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
