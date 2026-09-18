// Der Vorschau-Endpunkt von kit/einstellungen.mjs (Issue #724, Plan #721 E1).
//
// Die Oberflaeche soll ihre Pruefungen vor dem Speichern an der betroffenen Zeile zeigen
// (Kriterium 3), den Fuss eines Teils mit den offenen Aenderungen fuellen (Kriterium 2) und
// Anzeigen tragen, die gar kein Feld der Datei sind (Kriterien 12, 16, 20, 22, 23, 26).
// Die Logik dafuer liegt im Modul, nicht im Browser-Skript: `SEITEN_SKRIPT` ist ein
// Zeichenketten-Literal, das kein Test ausfuehrt. Geprueft wird sie deshalb hier.
//
// Jeder Lauf durch `vorschau` steht auf einer echten Kopie der `.claude/workflow.config.json`
// dieses Projekts — samt dem Beleg, dass danach beide Dateien bytegleich sind. Ein Mass fuer
// die abgeleiteten Anzeigen ist diese Datei nicht: Sie lebt, und ein Test, der ihre
// Reviewer-Namen und Minutenwerte festschreibt, briche beim naechsten Pflegeschritt.
// Erwartete Werte stehen deshalb an BEISPIEL; die echte Datei laeuft am Ende gegen das, was
// unabhaengig von ihren Werten gilt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { abgeleitet, aenderungsliste, projektZustand, VERWEIS_BEISPIEL, vorschau } from "../kit/einstellungen.mjs";
import { projekt } from "./helpers/einstellungen-fixture.mjs";

const ECHT = JSON.parse(readFileSync(new URL("../.claude/workflow.config.json", import.meta.url), "utf-8"));

/** Eine Konfiguration mit allen Lagen, die die abgeleiteten Anzeigen kennen muessen. */
const BEISPIEL = {
  mainBranch: "main",
  issueReview: {
    requiredBeforeReady: false,
    reviewers: [
      { name: "opus", kind: "claude", model: "claude-opus-5" },
      { name: "qwen", kind: "command", model: "qwen-kit", command: "claude-qwen" },
      { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
      { name: "fable", kind: "claude", model: "claude-fable-5.1" },
      { name: "gpt-astra", kind: "command", model: "gpt-6-astra", command: "codex exec" },
    ],
    pairs: { opus: ["fable", "gpt-astra"], sonnet: ["gpt-astra", "opus"] },
  },
  reviewStufen: {
    fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] },
    plan: { reviewer: 1, rollen: ["architektur-bestand"] },
    issue: { reviewer: 1, rollen: ["pruefbarkeit"] },
  },
  checkAreas: { kit: ["kit/**"], docs: ["docs/**"], leer: [] },
  buildChecks: ["node --test", { cmd: "eslint", areas: ["kit"] }, { cmd: "markdown", areas: ["kit", "docs"] }, { cmd: "immer", always: true }],
  spec: { seit: "2026-09-03", bereiche: { board: ["kit/board.mjs"], einstellungen: ["kit/einstellungen.mjs"] }, testGlobs: ["test/*.test.mjs"], testPattern: String.raw`\[<ID>\]` },
  // Kein umsetzungMin: Der fehlende Wert kommt aus dem Vorgabewert des Schemas.
  night: { kette: { planMin: 30, paketeMin: 25, reviewMin: 30, abdeckungMin: 10 } },
};

const ohne = (config, feld) => {
  const kopie = { ...config };
  delete kopie[feld];
  return kopie;
};

const mitSpec = (aenderung) => ({ ...BEISPIEL, spec: { ...BEISPIEL.spec, ...aenderung } });

/** Ein Wegwerf-Projekt samt Kontext fuer `vorschau`; `raeumAuf` loescht beides wieder. */
function wegwerfProjekt({ team = ECHT, lokal } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-vorschau-"));
  const home = mkdtempSync(join(tmpdir(), "einstellungen-vorschau-home-"));
  const pfad = projekt(wurzel, "echt", { team, lokal, stand: "1.0.0" });
  const eigen = { name: "echt", pfad };
  const optionen = { home, eigenerStand: "99.0.0" };
  return {
    projekt: eigen,
    optionen,
    dateien: { team: join(pfad, ".claude", "workflow.config.json"), lokal: join(pfad, ".claude", "workflow.config.local.json") },
    // Die Hashes kommen aus derselben Quelle wie in der Oberflaeche: dem geladenen Zustand.
    hashes: () => projektZustand(eigen, optionen).hashes,
    raeumAuf: () => {
      rmSync(wurzel, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Fuehrt `fn` mit einem Wegwerf-Projekt aus und raeumt danach auf. */
async function mitProjekt(aufbau, fn) {
  const p = wegwerfProjekt(aufbau);
  try {
    return await fn(p);
  } finally {
    p.raeumAuf();
  }
}

const antwortVon = (p, auftrag) => vorschau(p.projekt, { hashes: p.hashes(), ...auftrag }, p.optionen);
const fehlerIn = (res) => res.body.befunde.filter((b) => b.art === "fehler");

// --- Befunde ----------------------------------------------------------------

test("[einstellungen-10] ein Befund traegt den Pfad der betroffenen Paarungszeile, nicht den des Wurzelfeldes", async () => {
  // Der Auftrag setzt die Paarungen unabhaengig vom Bestand der echten Datei — geprueft wird
  // der Pfad des Befundes, nicht die Besetzung dieses Projekts.
  await mitProjekt({}, async (p) => {
    const res = antwortVon(p, { ebene: "team", teil: "m2", aenderungen: [{ pfad: "issueReview.pairs", wert: { opus: ["erfunden"] } }] });
    assert.equal(res.status, 200);
    assert.equal(fehlerIn(res).length, 1, JSON.stringify(fehlerIn(res)));
    assert.equal(fehlerIn(res)[0].pfad, "issueReview.pairs.opus");
    assert.match(fehlerIn(res)[0].grund, /erfunden/);
  });
});

test("[einstellungen-10] ein Fehler, der schon vorher in der Datei stand, taucht nicht als neuer Fehler auf", async () => {
  const team = { ...ECHT, issueReview: { ...ECHT.issueReview, pairs: { opus: ["erfunden"] } } };
  await mitProjekt({ team }, async (p) => {
    const res = antwortVon(p, { ebene: "team", teil: "wert", aenderungen: [{ pfad: "mainBranch", wert: "trunk" }] });
    assert.equal(res.status, 200);
    assert.deepEqual(fehlerIn(res), []);
  });
});

test("[einstellungen-10] ein Befund der Art warnung haelt nicht auf", async () => {
  await mitProjekt({ team: BEISPIEL }, async (p) => {
    const wert = { ...BEISPIEL.checkAreas, nochleer: [] };
    const res = antwortVon(p, { ebene: "team", teil: "m4", aenderungen: [{ pfad: "checkAreas", wert }] });
    assert.equal(res.status, 200);
    const warnung = res.body.befunde.find((b) => b.pfad === "checkAreas.nochleer");
    assert.ok(warnung, JSON.stringify(res.body.befunde));
    assert.equal(warnung.art, "warnung");
    assert.deepEqual(fehlerIn(res), []);
  });
});

test("[einstellungen-10] eine faellige Bestaetigung steht in der Antwort, solange sie nicht mitkommt", async () => {
  await mitProjekt({ team: BEISPIEL }, async (p) => {
    const auftrag = { ebene: "team", teil: "m4", aenderungen: [{ pfad: "buildChecks", wert: [] }] };
    assert.deepEqual(antwortVon(p, auftrag).body.bestaetigung.map((b) => b.pfad), ["buildChecks"]);
    assert.deepEqual(antwortVon(p, { ...auftrag, bestaetigt: ["buildChecks"] }).body.bestaetigung, []);
  });
});

test("[einstellungen-10] eine persoenlich unerlaubte Aenderung wird zum Befund, nicht zur Ausnahme", async () => {
  await mitProjekt({}, async (p) => {
    const res = antwortVon(p, { ebene: "persoenlich", teil: "m4", aenderungen: [{ pfad: "buildChecks", wert: [] }] });
    assert.equal(res.status, 200);
    assert.equal(res.body.befunde.length, 1);
    assert.equal(res.body.befunde[0].pfad, "buildChecks");
    assert.deepEqual(res.body.aenderungen, []);
  });
});

test("[einstellungen-10] eine seit dem Laden geaenderte Datei meldet die Vorschau wie das Speichern", async () => {
  await mitProjekt({}, async (p) => {
    const auftrag = { hashes: p.hashes(), ebene: "team", teil: "wert", aenderungen: [{ pfad: "mainBranch", wert: "trunk" }] };
    appendFileSync(p.dateien.team, "\n");
    const res = vorschau(p.projekt, auftrag, p.optionen);
    assert.equal(res.status, 409);
    assert.equal(res.body.art, "geaendert");
  });
});

// --- Aenderungsliste --------------------------------------------------------

test("[einstellungen-10] die Aenderungsliste nennt Zahl und Inhalt der offenen Aenderungen des Teils", async () => {
  await mitProjekt({ team: BEISPIEL }, async (p) => {
    const res = antwortVon(p, {
      ebene: "team",
      teil: "m1",
      aenderungen: [
        { pfad: "issueReview.requiredBeforeReady", wert: true },
        { pfad: "issueReview.reviewers", wert: BEISPIEL.issueReview.reviewers.map((r, i) => (i === 0 ? { ...r, model: "claude-opus-6" } : r)) },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.aenderungen.length, 2, JSON.stringify(res.body.aenderungen));
    const nachPfad = Object.fromEntries(res.body.aenderungen.map((a) => [a.pfad, a]));
    assert.equal(nachPfad["issueReview.requiredBeforeReady"].art, "geaendert");
    assert.match(nachPfad["issueReview.requiredBeforeReady"].satz, /true.*false/);
    assert.equal(nachPfad["issueReview.reviewers[0].model"].art, "geaendert");
    assert.match(nachPfad["issueReview.reviewers[0].model"].satz, /claude-opus-6/);
  });
});

test("[einstellungen-10] die Aenderungsliste eines Teils nennt die Aenderung eines anderen Teils nicht", () => {
  const alt = { mainBranch: "main", issueReview: { requiredBeforeReady: false } };
  const neu = { mainBranch: "trunk", issueReview: { requiredBeforeReady: true } };
  assert.deepEqual(aenderungsliste(alt, neu, "m1").map((a) => a.pfad), ["issueReview.requiredBeforeReady"]);
  assert.deepEqual(aenderungsliste(alt, neu, "wert").map((a) => a.pfad), ["mainBranch"]);
  assert.deepEqual(aenderungsliste(alt, alt, "m1"), []);
});

test("[einstellungen-10] die Aenderungsliste unterscheidet hinzugekommen, weggefallen und geaendert", () => {
  const alt = { checkAreas: { kit: ["kit/**"], alt: ["x"] } };
  const neu = { checkAreas: { kit: ["kit/**", "tools/**"], dazu: ["y"] } };
  const nachPfad = Object.fromEntries(aenderungsliste(alt, neu, "m4").map((a) => [a.pfad, a]));
  assert.deepEqual(Object.keys(nachPfad).sort(), ["checkAreas.alt", "checkAreas.dazu", "checkAreas.kit"]);
  assert.equal(nachPfad["checkAreas.dazu"].art, "neu");
  assert.match(nachPfad["checkAreas.dazu"].satz, /kommt hinzu/);
  assert.equal(nachPfad["checkAreas.alt"].art, "weg");
  assert.match(nachPfad["checkAreas.alt"].satz, /f.llt weg/);
  assert.equal(nachPfad["checkAreas.kit"].art, "geaendert");
  assert.match(nachPfad["checkAreas.kit"].satz, /2 Eintr.ge statt 1/);
});

// --- Die Vorschau schreibt nichts -------------------------------------------

test("[einstellungen-10] die Vorschau laesst beide Konfigurationsdateien bytegleich", async () => {
  await mitProjekt({ lokal: { reviewScope: "full" } }, async (p) => {
    const vorher = { team: readFileSync(p.dateien.team), lokal: readFileSync(p.dateien.lokal) };
    const auftraege = [
      { ebene: "team", teil: "wert", aenderungen: [{ pfad: "mainBranch", wert: "trunk" }] },
      { ebene: "team", teil: "m4", aenderungen: [{ pfad: "buildChecks", wert: [] }] },
      { ebene: "team", teil: "m2", aenderungen: [{ pfad: "issueReview.pairs", wert: { opus: ["erfunden"] } }] },
      { ebene: "persoenlich", teil: "wert", aenderungen: [{ pfad: "reviewScope", wert: "diff" }] },
      { ebene: "persoenlich", teil: "wert", aenderungen: [], entfernt: ["reviewScope"] },
    ];
    for (const auftrag of auftraege) {
      assert.equal(antwortVon(p, auftrag).status, 200, JSON.stringify(auftrag));
      assert.deepEqual(readFileSync(p.dateien.team), vorher.team, `team nach ${JSON.stringify(auftrag)}`);
      assert.deepEqual(readFileSync(p.dateien.lokal), vorher.lokal, `lokal nach ${JSON.stringify(auftrag)}`);
    }
  });
});

// --- Abgeleitete Anzeigen ---------------------------------------------------

test("[einstellungen-11] die Wirkung einer Paarungszeile nennt je Stufe Pruefer und Rolle", () => {
  const a = abgeleitet(BEISPIEL, "m2");
  assert.deepEqual(Object.keys(a.wirkung).sort(), ["opus", "sonnet"]);
  const opus = a.wirkung.opus;
  assert.deepEqual(opus.fachlich.pruefer, [
    { name: "fable", rolle: "form-beobachtbarkeit" },
    { name: "gpt-astra", rolle: "abgrenzung" },
  ]);
  assert.equal(opus.fachlich.unterbesetzt, false);
  assert.equal(opus.fachlich.quelle, "pairs");
  assert.deepEqual(opus.plan.pruefer, [{ name: "fable", rolle: "architektur-bestand" }]);
  assert.deepEqual(opus.issue.pruefer, [{ name: "fable", rolle: "pruefbarkeit" }]);
});

test("[einstellungen-11] eine unterbesetzte Stufe wird genannt und nicht aus der Reviewer-Tabelle aufgefuellt", () => {
  const config = { ...BEISPIEL, issueReview: { ...BEISPIEL.issueReview, pairs: { opus: ["fable"] } } };
  const opus = abgeleitet(config, "m2").wirkung.opus;
  assert.equal(opus.fachlich.unterbesetzt, true);
  assert.deepEqual(opus.fachlich.pruefer.map((r) => r.name), ["fable"]);
  assert.equal(opus.plan.unterbesetzt, false);
});

test("[einstellungen-11] ein Pruefer, der bei keiner Stufe zum Zug kommt, ist erkennbar", () => {
  const config = { ...BEISPIEL, issueReview: { ...BEISPIEL.issueReview, pairs: { opus: ["fable", "gpt-astra", "sonnet"] } } };
  assert.deepEqual(abgeleitet(config, "m2").wirkung.opus.ungenutzt, ["sonnet"]);
  assert.deepEqual(abgeleitet(BEISPIEL, "m2").wirkung.opus.ungenutzt, []);
});

test("[einstellungen-11] die Beispielbesetzung geht vom ersten Autor mit eigener Paarung aus", () => {
  const beispiel = abgeleitet(BEISPIEL, "m3").beispiel;
  assert.equal(beispiel.fachlich.autor, "opus");
  assert.equal(beispiel.fachlich.quelle, "pairs");
  assert.deepEqual(beispiel.fachlich.pruefer, [
    { name: "fable", rolle: "form-beobachtbarkeit" },
    { name: "gpt-astra", rolle: "abgrenzung" },
  ]);
  assert.deepEqual(beispiel.plan.pruefer, [{ name: "fable", rolle: "architektur-bestand" }]);
  assert.deepEqual(beispiel.issue.pruefer, [{ name: "fable", rolle: "pruefbarkeit" }]);
});

test("[einstellungen-11] ohne Paarungen geht die Beispielbesetzung vom ersten Reviewer aus", () => {
  const config = { ...BEISPIEL, issueReview: { ...BEISPIEL.issueReview, pairs: {} } };
  const beispiel = abgeleitet(config, "m3").beispiel;
  assert.equal(beispiel.fachlich.autor, "opus");
  assert.equal(beispiel.fachlich.quelle, "regel");
  assert.deepEqual(beispiel.fachlich.pruefer.map((r) => r.name), ["qwen", "sonnet"]);
});

test("[einstellungen-11] ohne reviewStufen-Block gilt die Bestandsvorgabe", () => {
  const fachlich = abgeleitet(ohne(BEISPIEL, "reviewStufen"), "m3").beispiel.fachlich;
  assert.deepEqual(fachlich.pruefer, [
    { name: "fable", rolle: "vollstaendigkeit-pruefbarkeit" },
    { name: "gpt-astra", rolle: "scope-risiko-bestand" },
  ]);
});

test("[einstellungen-11] je Bereich steht, wie viele Kommandos ihn nutzen", () => {
  assert.deepEqual(abgeleitet(BEISPIEL, "m4").nutzung, { kit: 2, docs: 1, leer: 0 });
  assert.deepEqual(abgeleitet(ohne(BEISPIEL, "checkAreas"), "m4").nutzung, {});
});

test("[einstellungen-11] je Spec-Bereich steht die Spezifikationsdatei", () => {
  assert.deepEqual(abgeleitet(BEISPIEL, "m5").datei, { board: "specs/board.md", einstellungen: "specs/einstellungen.md" });
});

test("[einstellungen-11] das Verweis-Muster wird am Beispieltext ausgewertet", () => {
  const trifft = abgeleitet(BEISPIEL, "m5").verweis;
  assert.equal(trifft.trifft, true);
  assert.equal(trifft.fehler, null);
  assert.equal(trifft.id, VERWEIS_BEISPIEL.id);
  assert.equal(trifft.beispiel, VERWEIS_BEISPIEL.text);

  // Ohne testPattern gilt der Vorgabewert, und der findet den Verweis ebenso.
  assert.equal(abgeleitet(mitSpec({ testPattern: undefined }), "m5").verweis.trifft, true);

  const daneben = abgeleitet(mitSpec({ testPattern: "<ID>-steht-nicht-im-text" }), "m5").verweis;
  assert.equal(daneben.trifft, false);
  assert.equal(daneben.fehler, null);

  const ohnePlatzhalter = abgeleitet(mitSpec({ testPattern: "irgendwas" }), "m5").verweis;
  assert.equal(ohnePlatzhalter.trifft, false);
  assert.match(ohnePlatzhalter.fehler, /<ID>/);

  const kaputt = abgeleitet(mitSpec({ testPattern: "[<ID>" }), "m5").verweis;
  assert.equal(kaputt.trifft, false);
  assert.ok(kaputt.fehler);
});

test("[einstellungen-11] ohne spec-Block liefert m5 keine abgeleiteten Anzeigen", () => {
  assert.deepEqual(abgeleitet(ohne(BEISPIEL, "spec"), "m5"), {});
});

test("[einstellungen-11] die Summe der Zeitbudgets steht getrennt nach Kette und Umsetzung", () => {
  // 30 + 25 + 30 + 10; umsetzungMin fehlt und kommt aus dem Vorgabewert des Schemas.
  assert.deepEqual(abgeleitet(BEISPIEL, "m6").zeit, { kette: 95, umsetzung: 120 });
  const eigen = { night: { kette: { planMin: 1, paketeMin: 2, reviewMin: 3, abdeckungMin: 4, umsetzungMin: 5 } } };
  assert.deepEqual(abgeleitet(eigen, "m6").zeit, { kette: 10, umsetzung: 5 });
});

test("[einstellungen-11] ein Teil ohne abgeleitete Anzeige liefert nichts, ohne Teil kommt alles", () => {
  assert.deepEqual(abgeleitet(BEISPIEL, "m1"), {});
  assert.deepEqual(abgeleitet(BEISPIEL, "text"), {});
  assert.deepEqual(abgeleitet(BEISPIEL, "erfundeneKennung"), {});
  const alles = abgeleitet(BEISPIEL);
  assert.deepEqual(Object.keys(alles).sort(), ["m2", "m3", "m4", "m5", "m6"]);
  assert.deepEqual(alles.m6.zeit, { kette: 95, umsetzung: 120 });
});

test("[einstellungen-11] die Vorschau liefert die abgeleiteten Anzeigen des Teils zum geaenderten Stand", async () => {
  await mitProjekt({ team: BEISPIEL }, async (p) => {
    const res = antwortVon(p, { ebene: "team", teil: "m2", aenderungen: [{ pfad: "issueReview.pairs", wert: { opus: ["fable"] } }] });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.abgeleitet.wirkung), ["opus"]);
    assert.equal(res.body.abgeleitet.wirkung.opus.fachlich.unterbesetzt, true);
  });
});

test("[einstellungen-11] die abgeleiteten Anzeigen halten der echten Konfiguration dieses Projekts stand", () => {
  const alles = abgeleitet(ECHT);
  const stufen = ["fachlich", "plan", "issue"];

  for (const [autor, wirkung] of Object.entries(alles.m2.wirkung)) {
    assert.ok(autor in ECHT.issueReview.pairs, `${autor} hat keine eigene Paarung`);
    for (const stufe of stufen) {
      const { pruefer, unterbesetzt } = wirkung[stufe];
      assert.equal(unterbesetzt, pruefer.length < ECHT.reviewStufen[stufe].reviewer, `${autor}/${stufe}`);
      // Keine Auffuellung aus der Reviewer-Tabelle: jeder Name steht in der Zeile des Autors.
      for (const { name, rolle } of pruefer) {
        assert.ok(ECHT.issueReview.pairs[autor].includes(name), `${name} steht nicht in der Zeile ${autor}`);
        assert.ok(ECHT.reviewStufen[stufe].rollen.includes(rolle), `${rolle} ist keine Rolle der Stufe ${stufe}`);
      }
    }
  }

  assert.deepEqual(Object.keys(alles.m5.datei).sort(), Object.keys(ECHT.spec.bereiche).sort());
  assert.equal(alles.m5.datei.einstellungen, "specs/einstellungen.md");
  assert.equal(alles.m5.verweis.trifft, true, "das Verweis-Muster dieses Projekts findet den Beispiel-Verweis nicht");
  assert.deepEqual(alles.m4.nutzung, Object.fromEntries(Object.keys(ECHT.checkAreas ?? {}).map((n) => [n, alles.m4.nutzung[n]])));
  assert.ok(alles.m6.zeit.kette > 0 && alles.m6.zeit.umsetzung > 0);
});
