// Die Folgen einer Umbenennung (Issue #726 und #728, Plan #721, Kriterien 8, 9, 9a, 18, 19, 20).
//
// Einen Reviewer umzubenennen oder zu entfernen ist samt seiner Folgen in `issueReview.pairs`
// EINE Aenderung des Reviewer-Teils: Sie wird dort gespeichert oder verworfen, und eine
// unabhaengige Aenderung im Paarungs-Teil kommt dabei nicht mit. Gerechnet wird das in
// `paarungsFolgen` — dieselbe Fassung, die das Browser-Skript als Baustein traegt.
//
// Dasselbe gilt fuer einen Bereich aus `checkAreas` und die `buildChecks`, die ihn nennen:
// `bereichsFolgen` rechnet die Folge, `checkForm` und `checkSetzen` halten die Form eines
// Eintrags fest. Beide Wege stehen im selben Teil M4 und werden mit ihm gespeichert.
//
// Jeder Lauf steht auf einer echten Kopie der `.claude/workflow.config.json` dieses Projekts
// (Kriterium der Aufgabe). Ihre Namen sind kein Mass: Der Test holt Autor und Pruefer aus der
// Datei, statt sie festzuschreiben.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { bereichsFolgen, checkForm, checkSetzen, paarungsFolgen, projektZustand, schluesselUmbenennen, speichere, vorschau } from "../kit/einstellungen.mjs";
import { projekt } from "./helpers/einstellungen-fixture.mjs";

const ECHT = JSON.parse(readFileSync(new URL("../.claude/workflow.config.json", import.meta.url), "utf-8"));

/** Ein Wegwerf-Projekt mit der echten Konfiguration dieses Projekts. */
function wegwerfProjekt(team = ECHT) {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-folgen-"));
  const home = mkdtempSync(join(tmpdir(), "einstellungen-folgen-home-"));
  const pfad = projekt(wurzel, "echt", { team, stand: "1.0.0" });
  const eigen = { name: "echt", pfad };
  const optionen = { home, eigenerStand: "99.0.0" };
  return {
    projekt: eigen,
    optionen,
    datei: join(pfad, ".claude", "workflow.config.json"),
    hashes: () => projektZustand(eigen, optionen).hashes,
    gespeichert: () => JSON.parse(readFileSync(join(pfad, ".claude", "workflow.config.json"), "utf-8")),
    raeumAuf: () => {
      rmSync(wurzel, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

async function mitProjekt(team, fn) {
  const p = wegwerfProjekt(team);
  try {
    return await fn(p);
  } finally {
    p.raeumAuf();
  }
}

/** Der Reviewer-Eintrag zu einem Namen, wie der Redaktor ihn ergaenzt statt neu zu bauen. */
const umbenannteListe = (reviewers, von, nach) => reviewers.map((r) => (r.name === von ? { ...r, name: nach } : r));

// --- Die Rechnung selbst ----------------------------------------------------

test("[einstellungen-12] umbenennen zieht jede Paarung mit: Autor-Zeile und Pruefername", () => {
  const pairs = { opus: ["fable", "gpt-astra"], fable: ["opus"], sonnet: ["fable", "opus"] };
  const folge = paarungsFolgen(pairs, [{ von: "fable", nach: "fabel" }], []);
  assert.deepEqual(folge.pairs, { opus: ["fabel", "gpt-astra"], fabel: ["opus"], sonnet: ["fabel", "opus"] });
  // Eine Umbenennung braucht keine Rueckfrage — sie nimmt niemandem etwas weg (Kriterium 8).
  assert.deepEqual(folge.betroffen, []);
});

test("[einstellungen-12] entfernen nimmt die eigene Autor-Zeile und aus fremden Zeilen nur den Namen", () => {
  const pairs = { "gpt-sol": ["opus", "gpt-astra"], opus: ["fable", "gpt-sol"], sonnet: ["fable"] };
  const folge = paarungsFolgen(pairs, [], ["gpt-sol"]);
  assert.deepEqual(folge.pairs, { opus: ["fable"], sonnet: ["fable"] });
  assert.deepEqual(folge.betroffen, [
    { autor: "gpt-sol", art: "autorzeile" },
    { autor: "opus", art: "name" },
  ]);
});

test("[einstellungen-12] eine Zeile, die dadurch ohne Pruefer bliebe, faellt mit weg", () => {
  const folge = paarungsFolgen({ opus: ["fable"], sonnet: ["fable", "opus"] }, [], ["fable"]);
  assert.deepEqual(folge.pairs, { sonnet: ["opus"] });
  assert.deepEqual(folge.betroffen, [
    { autor: "opus", art: "leer" },
    { autor: "sonnet", art: "name" },
  ]);
});

test("[einstellungen-12] ohne Umbenennung und ohne Entfernung bleibt alles, wie es war", () => {
  const pairs = { opus: ["fable"] };
  assert.deepEqual(paarungsFolgen(pairs, [], []), { pairs: { opus: ["fable"] }, betroffen: [] });
  // Eine Datei ohne pairs-Block und eine Zeile ohne Liste duerfen nicht werfen.
  assert.deepEqual(paarungsFolgen(undefined, [], ["opus"]), { pairs: {}, betroffen: [] });
  assert.deepEqual(paarungsFolgen({ opus: "unsinn" }, [], []), { pairs: { opus: [] }, betroffen: [] });
});

test("[einstellungen-12] paarungsFolgen laesst die uebergebenen Paarungen unveraendert", () => {
  const pairs = { opus: ["fable", "gpt-astra"] };
  paarungsFolgen(pairs, [{ von: "fable", nach: "fabel" }], ["gpt-astra"]);
  assert.deepEqual(pairs, { opus: ["fable", "gpt-astra"] });
});

// --- Gegen die Vorschau -----------------------------------------------------

test("[einstellungen-12] die Vorschau nimmt Reviewer und Folge als eine Aenderung des Reviewer-Teils", async () => {
  await mitProjekt(ECHT, async (p) => {
    const alt = ECHT.issueReview.reviewers[0].name;
    const folge = paarungsFolgen(ECHT.issueReview.pairs, [{ von: alt, nach: `${alt}-neu` }], []);
    const res = vorschau(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m1",
      aenderungen: [
        { pfad: "issueReview.reviewers", wert: umbenannteListe(ECHT.issueReview.reviewers, alt, `${alt}-neu`) },
        { pfad: "issueReview.pairs", wert: folge.pairs },
      ],
    }, p.optionen);
    assert.equal(res.status, 200);
    // Kein neuer Fehler: Die Paarungen zeigen nach der Umbenennung wieder auf bekannte Namen.
    assert.deepEqual(res.body.befunde.filter((b) => b.art === "fehler"), []);
    // Der Fuss des Reviewer-Teils nennt beides — die Reviewer-Zeile und die Paarungen.
    const pfade = res.body.aenderungen.map((a) => a.pfad);
    assert.ok(pfade.some((x) => x.startsWith("issueReview.reviewers")), JSON.stringify(pfade));
    assert.ok(pfade.some((x) => x.startsWith("issueReview.pairs")), JSON.stringify(pfade));
  });
});

test("[einstellungen-12] die Vorschau eines Reviewers ohne Folge meldet die verwaisten Paarungen", async () => {
  await mitProjekt(ECHT, async (p) => {
    const alt = ECHT.issueReview.reviewers[0].name;
    const res = vorschau(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m1",
      aenderungen: [{ pfad: "issueReview.reviewers", wert: umbenannteListe(ECHT.issueReview.reviewers, alt, `${alt}-neu`) }],
    }, p.optionen);
    assert.equal(res.status, 200);
    const fehler = res.body.befunde.filter((b) => b.art === "fehler");
    assert.ok(fehler.length > 0, "eine Umbenennung ohne Folge laesst die Paarungen ins Leere zeigen");
    for (const b of fehler) assert.ok(b.pfad.startsWith("issueReview.pairs."), b.pfad);
  });
});

// --- Gegen das Speichern (Kriterium 9a) -------------------------------------

test("[einstellungen-12] der Reviewer-Teil speichert seine Folge, nicht die offene Paarungs-Aenderung", async () => {
  await mitProjekt(ECHT, async (p) => {
    const alt = ECHT.issueReview.reviewers.find((r) => Object.values(ECHT.issueReview.pairs).some((l) => l.includes(r.name))).name;
    const neu = `${alt}-neu`;
    const folge = paarungsFolgen(ECHT.issueReview.pairs, [{ von: alt, nach: neu }], []);
    // Der Paarungs-Teil traegt eine offene, unabhaengige Aenderung — sie steht in seiner
    // Arbeitskopie und damit in keinem Auftrag des Reviewer-Teils.
    const unabhaengig = { ...ECHT.issueReview.pairs, erfunden: ["opus"] };
    assert.notDeepEqual(unabhaengig, folge.pairs);

    const res = speichere(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m1",
      aenderungen: [
        { pfad: "issueReview.reviewers", wert: umbenannteListe(ECHT.issueReview.reviewers, alt, neu) },
        { pfad: "issueReview.pairs", wert: folge.pairs },
      ],
    }, p.optionen);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const datei = p.gespeichert();
    assert.ok(datei.issueReview.reviewers.some((r) => r.name === neu), "die Umbenennung fehlt");
    assert.deepEqual(datei.issueReview.pairs, folge.pairs, "die Folge fehlt");
    assert.equal("erfunden" in datei.issueReview.pairs, false, "die unabhaengige Paarungs-Aenderung wurde mitgespeichert");
    // Jede Paarung zeigt danach auf einen Namen, den die Reviewer-Tabelle kennt.
    const bekannt = new Set(datei.issueReview.reviewers.map((r) => r.name));
    for (const [autor, liste] of Object.entries(datei.issueReview.pairs)) {
      assert.ok(bekannt.has(autor), `${autor} steht nicht mehr in reviewers`);
      for (const name of liste) assert.ok(bekannt.has(name), `${name} in ${autor} steht nicht mehr in reviewers`);
    }
  });
});

test("[einstellungen-12] der Paarungs-Teil speichert nur die Paarungen und laesst die Reviewer stehen", async () => {
  await mitProjekt(ECHT, async (p) => {
    const autor = Object.keys(ECHT.issueReview.pairs)[0];
    const pairs = { ...ECHT.issueReview.pairs, [autor]: [ECHT.issueReview.pairs[autor][0]] };
    const res = speichere(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m2",
      aenderungen: [{ pfad: "issueReview.pairs", wert: pairs }],
    }, p.optionen);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const datei = p.gespeichert();
    assert.deepEqual(datei.issueReview.pairs, pairs);
    assert.deepEqual(datei.issueReview.reviewers, ECHT.issueReview.reviewers);
  });
});

test("[einstellungen-12] ein Reviewer-Eintrag behaelt ein Feld, das die Tabelle nicht zeigt", async () => {
  const mitZusatz = ECHT.issueReview.reviewers.map((r, i) => (i === 0 ? { ...r, notiz: "bleibt stehen" } : r));
  const team = { ...ECHT, issueReview: { ...ECHT.issueReview, reviewers: mitZusatz } };
  await mitProjekt(team, async (p) => {
    // Der Redaktor ergaenzt den vorhandenen Eintrag, statt ihn aus den Spalten neu zu bauen
    // (Plan E9, Kriterium 4) — genau das sendet er hier.
    const geaendert = mitZusatz.map((r, i) => (i === 0 ? { ...r, model: "claude-opus-6" } : r));
    const res = speichere(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m1",
      aenderungen: [{ pfad: "issueReview.reviewers", wert: geaendert }],
    }, p.optionen);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const eintrag = p.gespeichert().issueReview.reviewers[0];
    assert.equal(eintrag.model, "claude-opus-6");
    assert.equal(eintrag.notiz, "bleibt stehen");
  });
});

// --- Ein unbekannter Name in einer Paarung (Kriterium 4a) -------------------

test("[einstellungen-12] eine Paarung auf einen unbekannten Reviewer ergibt einen Befund am Pfad ihrer Zeile", async () => {
  const autor = Object.keys(ECHT.issueReview.pairs)[0];
  const team = { ...ECHT, issueReview: { ...ECHT.issueReview, pairs: { ...ECHT.issueReview.pairs, [autor]: ["erfunden"] } } };
  await mitProjekt(team, async (p) => {
    const zustand = projektZustand(p.projekt, p.optionen);
    const eintraege = Object.values(zustand.themen).flat().flatMap((t) => t.eintraege);
    const zeile = eintraege.find((e) => e.pfad === "issueReview.pairs");
    const befunde = zeile.befunde.filter((b) => b.art === "fehler");
    assert.equal(befunde.length, 1, JSON.stringify(befunde));
    assert.equal(befunde[0].pfad, `issueReview.pairs.${autor}`);
    assert.match(befunde[0].grund, /erfunden/);
  });
});

test("[einstellungen-12] ein unbekannter Name in einer Paarung haelt eine unabhaengige Aenderung nicht auf", async () => {
  const autor = Object.keys(ECHT.issueReview.pairs)[0];
  const team = { ...ECHT, issueReview: { ...ECHT.issueReview, pairs: { ...ECHT.issueReview.pairs, [autor]: ["erfunden"] } } };
  await mitProjekt(team, async (p) => {
    const res = speichere(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m1",
      aenderungen: [{ pfad: "issueReview.requiredBeforeReady", wert: true }],
    }, p.optionen);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(p.gespeichert().issueReview.requiredBeforeReady, true);
    assert.deepEqual(p.gespeichert().issueReview.pairs[autor], ["erfunden"], "der Altfehler wurde stillschweigend geraeumt");
  });
});

// ============================================================
// M4: die drei Formen eines Pruefkommandos (Issue #728, Kriterium 18)
// ============================================================

test("[einstellungen-2] checkForm liest die drei Formen des Bestands auseinander", () => {
  // Der bloße String und das Objekt nur mit `cmd` laufen gleich, sagen aber Verschiedenes:
  // "noch niemand zugeordnet" gegen "bewusst entschieden". Beide sind `offen`.
  assert.deepEqual(checkForm("node --test"), { cmd: "node --test", laufart: "offen", areas: [] });
  assert.deepEqual(checkForm({ cmd: "node --test" }), { cmd: "node --test", laufart: "offen", areas: [] });
  assert.deepEqual(checkForm({ cmd: "x", always: true }), { cmd: "x", laufart: "immer", areas: [] });
  assert.deepEqual(checkForm({ cmd: "x", areas: ["kit"] }), { cmd: "x", laufart: "bereiche", areas: ["kit"] });
  // Ein `areas` ohne Eintrag bleibt `bereiche` — es wird nie still zu "immer" (Kriterium 19).
  assert.deepEqual(checkForm({ cmd: "x", areas: [] }), { cmd: "x", laufart: "bereiche", areas: [] });
  // Unsinn in der Datei darf nicht werfen.
  assert.deepEqual(checkForm(undefined), { cmd: "", laufart: "offen", areas: [] });
  assert.deepEqual(checkForm({ cmd: "x", areas: "unsinn" }), { cmd: "x", laufart: "offen", areas: [] });
});

test("[einstellungen-2] eine Zeile, deren Laufart unveraendert bleibt, behaelt ihre Form", () => {
  // Aus einem String wird kein Objekt — auch nicht, wenn nur das Kommando getippt wurde.
  assert.equal(checkSetzen("node --test", { cmd: "node --test -w" }), "node --test -w");
  assert.equal(checkSetzen("node --test", { laufart: "offen" }), "node --test");
  // Ohne Aenderung derselbe Eintrag, nicht nur ein gleicher: Der Schreiber sieht dann nichts.
  const objekt = { cmd: "x", always: true };
  assert.equal(checkSetzen(objekt, { laufart: "immer" }), objekt);
  assert.equal(checkSetzen(objekt, { cmd: "x" }), objekt);
  // "immer (offen)" wird beim Speichern nicht zu always: true.
  assert.deepEqual(checkSetzen({ cmd: "x" }, { cmd: "y" }), { cmd: "y" });
  assert.equal("always" in checkSetzen({ cmd: "x" }, { cmd: "y" }), false);
});

test("[einstellungen-2] ein Wechsel der Laufart legt genau das Feld der neuen Form an", () => {
  assert.deepEqual(checkSetzen("node --test", { laufart: "immer" }), { cmd: "node --test", always: true });
  assert.deepEqual(checkSetzen("node --test", { laufart: "bereiche" }), { cmd: "node --test", areas: [] });
  assert.deepEqual(checkSetzen({ cmd: "x", always: true }, { laufart: "offen" }), { cmd: "x" });
  assert.deepEqual(checkSetzen({ cmd: "x", always: true }, { laufart: "bereiche" }), { cmd: "x", areas: [] });
  assert.deepEqual(checkSetzen({ cmd: "x", areas: ["kit"] }, { laufart: "immer" }), { cmd: "x", always: true });
  // Zurueck nach "offen" ist der Objektfall — ein String waere eine Formaenderung ohne Anlass.
  assert.deepEqual(checkSetzen({ cmd: "x", areas: ["kit"] }, { laufart: "offen" }), { cmd: "x" });
  // Die Bereiche gehen beim Setzen mit, und die Form bleibt `bereiche`, auch wenn sie leer sind.
  assert.deepEqual(checkSetzen({ cmd: "x", areas: ["kit"] }, { areas: [] }), { cmd: "x", areas: [] });
});

test("[einstellungen-2] checkSetzen erhaelt ein Feld, das die Tabelle nicht zeigt, und aendert nichts am Bestand", () => {
  const bestand = { cmd: "x", areas: ["kit"], notiz: "bleibt stehen" };
  const neu = checkSetzen(bestand, { areas: ["kit", "doku"] });
  assert.deepEqual(neu, { cmd: "x", areas: ["kit", "doku"], notiz: "bleibt stehen" });
  assert.deepEqual(bestand, { cmd: "x", areas: ["kit"], notiz: "bleibt stehen" });
});

// ============================================================
// M4: die Folgen einer Bereichs-Aenderung (Issue #728, Kriterium 20)
// ============================================================

test("[einstellungen-12] einen Bereich umbenennen zieht jedes Kommando mit, das ihn nennt", () => {
  const checks = ["node --test", { cmd: "eslint", areas: ["kit", "doku"] }, { cmd: "md", areas: ["doku"] }];
  const folge = bereichsFolgen(checks, [{ von: "doku", nach: "docs" }], []);
  assert.deepEqual(folge.buildChecks, ["node --test", { cmd: "eslint", areas: ["kit", "docs"] }, { cmd: "md", areas: ["docs"] }]);
  // Eine Umbenennung nimmt keinem Kommando etwas weg und braucht keine Rueckfrage.
  assert.deepEqual(folge.betroffen, []);
});

test("[einstellungen-12] einen Bereich entfernen nimmt seinen Namen aus jedem Kommando", () => {
  const checks = [{ cmd: "eslint", areas: ["kit", "doku"] }, { cmd: "immer", always: true }];
  const folge = bereichsFolgen(checks, [], ["doku"]);
  assert.deepEqual(folge.buildChecks, [{ cmd: "eslint", areas: ["kit"] }, { cmd: "immer", always: true }]);
  assert.deepEqual(folge.betroffen, [{ index: 0, cmd: "eslint", art: "name" }]);
});

test("[einstellungen-12] ein Kommando, das dadurch ohne Bereich bliebe, wird nicht zu immer", () => {
  const folge = bereichsFolgen([{ cmd: "md", areas: ["doku"] }], [], ["doku"]);
  // Kriterium 19: Das leere `areas` bleibt stehen und haelt das Speichern auf — es wird nie
  // stillschweigend zu "immer".
  assert.deepEqual(folge.buildChecks, [{ cmd: "md", areas: [] }]);
  assert.deepEqual(folge.betroffen, [{ index: 0, cmd: "md", art: "leer" }]);
});

test("[einstellungen-12] bereichsFolgen laesst jeden Eintrag ohne Bereiche unangetastet", () => {
  const checks = ["node --test", { cmd: "offen" }, { cmd: "immer", always: true }];
  const folge = bereichsFolgen(checks, [{ von: "doku", nach: "docs" }], ["kit"]);
  assert.deepEqual(folge.buildChecks, checks);
  assert.deepEqual(folge.betroffen, []);
  // Dieselben Eintraege, nicht nur gleiche: Der Schreiber findet dann keine Aenderung.
  folge.buildChecks.forEach((eintrag, i) => assert.equal(eintrag, checks[i]));
});

test("[einstellungen-12] bereichsFolgen ohne Umbenennung, ohne Entfernung und ohne Bestand wirft nicht", () => {
  const checks = [{ cmd: "eslint", areas: ["kit"] }];
  assert.deepEqual(bereichsFolgen(checks, [], []), { buildChecks: checks, betroffen: [] });
  assert.deepEqual(bereichsFolgen(undefined, [], ["kit"]), { buildChecks: [], betroffen: [] });
  assert.deepEqual(bereichsFolgen(checks, [{ von: "kit", nach: "k" }], ["kit"]), {
    buildChecks: [{ cmd: "eslint", areas: [] }],
    betroffen: [{ index: 0, cmd: "eslint", art: "leer" }],
  });
  // Die uebergebenen Kommandos bleiben unveraendert.
  assert.deepEqual(checks, [{ cmd: "eslint", areas: ["kit"] }]);
});

// ============================================================
// M4 gegen Vorschau und Speichern, an der echten Konfiguration
// ============================================================

test("[einstellungen-2] die drei Kommandostrings dieses Projekts bleiben nach einer anderen Aenderung Strings", async () => {
  // Das Akzeptanzkriterium des Pakets: Die `buildChecks` der echten Datei sind drei Strings.
  assert.ok(ECHT.buildChecks.length >= 3, "die echte Datei traegt keine drei Kommandos mehr");
  for (const eintrag of ECHT.buildChecks) assert.equal(typeof eintrag, "string", JSON.stringify(eintrag));
  await mitProjekt(ECHT, async (p) => {
    const res = speichere(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m4",
      aenderungen: [{ pfad: "checkAreas", wert: { kit: ["kit/**"] } }],
    }, p.optionen);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const datei = p.gespeichert();
    assert.deepEqual(datei.buildChecks, ECHT.buildChecks, "die Kommandos wurden mitgeschrieben");
    for (const eintrag of datei.buildChecks) assert.equal(typeof eintrag, "string", JSON.stringify(eintrag));
  });
});

test("[einstellungen-2] eine Aenderung an einem Kommandostring laesst die Nachbarn als Strings stehen", async () => {
  await mitProjekt(ECHT, async (p) => {
    const geaendert = ECHT.buildChecks.map((e, i) => (i === 0 ? checkSetzen(e, { cmd: `${e} --concurrency 4` }) : e));
    const res = speichere(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m4",
      aenderungen: [{ pfad: "buildChecks", wert: geaendert }],
    }, p.optionen);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const datei = p.gespeichert();
    assert.equal(datei.buildChecks[0], `${ECHT.buildChecks[0]} --concurrency 4`);
    for (const eintrag of datei.buildChecks) assert.equal(typeof eintrag, "string", JSON.stringify(eintrag));
    // Und die Datei traegt weiter drei Zeilen in Stringform, keine aufgeblaehten Objekte.
    const text = readFileSync(p.datei, "utf-8");
    assert.doesNotMatch(text, /"always"/, "eine Zeile wurde zu always: true gehoben");
    assert.doesNotMatch(text, /"cmd"/, "eine Zeile wurde von der String- in die Objektform gehoben");
  });
});

test("[einstellungen-12] ein Kommando mit einem Bereich, den checkAreas nicht kennt, ergibt einen Befund am Pfad seiner Zeile", async () => {
  const team = { ...ECHT, buildChecks: [...ECHT.buildChecks, { cmd: "eslint", areas: ["erfunden"] }], checkAreas: { kit: ["kit/**"] } };
  await mitProjekt(team, async (p) => {
    const zustand = projektZustand(p.projekt, p.optionen);
    const eintraege = Object.values(zustand.themen).flat().flatMap((t) => t.eintraege);
    const zeile = eintraege.find((e) => e.pfad === "buildChecks");
    const befunde = zeile.befunde.filter((b) => b.art === "fehler");
    assert.equal(befunde.length, 1, JSON.stringify(befunde));
    assert.equal(befunde[0].pfad, `buildChecks[${team.buildChecks.length - 1}].areas`);
    assert.match(befunde[0].grund, /erfunden/);
  });
});

test("[einstellungen-12] ein unbekannter Bereich haelt eine unabhaengige Aenderung nicht auf", async () => {
  const team = { ...ECHT, buildChecks: [...ECHT.buildChecks, { cmd: "eslint", areas: ["erfunden"] }], checkAreas: { kit: ["kit/**"] } };
  await mitProjekt(team, async (p) => {
    const res = speichere(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m4",
      aenderungen: [{ pfad: "checkAreas", wert: { kit: ["kit/**"], doku: ["docs/**"] } }],
    }, p.optionen);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const datei = p.gespeichert();
    assert.deepEqual(datei.checkAreas, { kit: ["kit/**"], doku: ["docs/**"] });
    assert.deepEqual(datei.buildChecks.at(-1), { cmd: "eslint", areas: ["erfunden"] }, "der Altfehler wurde stillschweigend geraeumt");
  });
});

test("[einstellungen-13] ein Bereich ohne Muster laesst sich speichern, ein areas ohne Eintrag nicht", async () => {
  await mitProjekt(ECHT, async (p) => {
    // Kriterium 20: Ein Bereich ohne Muster erfasst nichts — das ist eine Warnung und haelt
    // das Speichern nicht auf.
    const wert = { kit: ["kit/**"], leer: [] };
    const sicht = vorschau(p.projekt, { hashes: p.hashes(), ebene: "team", teil: "m4", aenderungen: [{ pfad: "checkAreas", wert }] }, p.optionen);
    assert.equal(sicht.status, 200);
    const warnung = sicht.body.befunde.find((b) => b.pfad === "checkAreas.leer");
    assert.ok(warnung, JSON.stringify(sicht.body.befunde));
    assert.equal(warnung.art, "warnung");
    const gespeichert = speichere(p.projekt, { hashes: p.hashes(), ebene: "team", teil: "m4", aenderungen: [{ pfad: "checkAreas", wert }] }, p.optionen);
    assert.equal(gespeichert.status, 200, JSON.stringify(gespeichert.body));
    assert.deepEqual(p.gespeichert().checkAreas, wert);
  });
});

test("[einstellungen-12] ein Kommando, das durch das Entfernen eines Bereichs ohne Bereich bliebe, haelt das Speichern auf", async () => {
  const team = { ...ECHT, buildChecks: [{ cmd: "eslint", areas: ["kit"] }], checkAreas: { kit: ["kit/**"] } };
  await mitProjekt(team, async (p) => {
    // Was der Redaktor der Rueckfrage vorlegt: der Bereich weg, und das Kommando bliebe leer.
    const folge = bereichsFolgen(team.buildChecks, [], ["kit"]);
    assert.deepEqual(folge.betroffen, [{ index: 0, cmd: "eslint", art: "leer" }]);
    const res = speichere(p.projekt, {
      hashes: p.hashes(),
      ebene: "team",
      teil: "m4",
      aenderungen: [{ pfad: "checkAreas", wert: {} }, { pfad: "buildChecks", wert: folge.buildChecks }],
    }, p.optionen);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.ok(res.body.befunde.some((b) => b.pfad.startsWith("buildChecks[0]")), JSON.stringify(res.body.befunde));
    // Nichts wurde geschrieben, und das Kommando steht weiter auf seinem Bereich.
    assert.deepEqual(p.gespeichert().buildChecks, team.buildChecks);
  });
});

// ============================================================
// Ein belegter Zielname (Issue #816)
// ============================================================
//
// Bereiche, Paarungszeilen und Spec-Bereiche stehen alle drei unter ihrem Namen in einem
// flachen Objekt, und alle drei wurden bis hierher gleich umbenannt: den Schluessel neu
// setzen. Traegt das Objekt den Zielnamen schon, fiel der alte Eintrag dabei still weg —
// samt seiner Muster beziehungsweise seiner Pruefer. `schluesselUmbenennen` ist die eine
// Fassung, die das abweist; der Validator kann es nicht sehen, weil jedes Ergebnis fuer
// sich gueltig ist.

test("[einstellungen-21] schluesselUmbenennen haelt die Reihenfolge und laesst das Original stehen", () => {
  const bereiche = { kit: ["kit/**"], test: ["test/**"], docs: ["docs/**"] };
  const folge = schluesselUmbenennen(bereiche, "test", "pruefung");
  assert.equal(folge.ok, true);
  assert.equal(folge.grund, null);
  assert.deepEqual(Object.keys(folge.objekt), ["kit", "pruefung", "docs"]);
  assert.deepEqual(folge.objekt.pruefung, ["test/**"]);
  assert.deepEqual(bereiche, { kit: ["kit/**"], test: ["test/**"], docs: ["docs/**"] });
});

test("[einstellungen-21] ein belegter Zielname wird abgewiesen — Bereiche, Paarungen, Spec-Bereiche", () => {
  // Drei Formen desselben Falls: der alte Eintrag traegt Muster, Pruefer oder die Muster
  // eines Spec-Bereichs. Abgewiesen wird in allen dreien, und nichts geht verloren.
  const faelle = [
    { a: ["a/**"], b: ["b/**"] },
    { opus: ["fable"], sonnet: ["opus"] },
    { board: ["kit/board.mjs"], night: ["kit/night.mjs"] },
  ];
  for (const objekt of faelle) {
    const [alt, belegt] = Object.keys(objekt);
    const vorher = structuredClone(objekt);
    const folge = schluesselUmbenennen(objekt, alt, belegt);
    assert.equal(folge.ok, false, `${alt} -> ${belegt} durchgelassen`);
    assert.match(folge.grund, new RegExp(belegt), folge.grund);
    assert.deepEqual(folge.objekt, vorher, "das Ergebnis weicht vom Bestand ab");
    assert.deepEqual(objekt, vorher, "das uebergebene Objekt wurde angefasst");
  }
});

test("[einstellungen-21] ein unbekannter alter Name und ein Name auf sich selbst aendern nichts", () => {
  const bereiche = { kit: ["kit/**"] };
  assert.equal(schluesselUmbenennen(bereiche, "gibtsnicht", "neu").ok, false);
  const gleich = schluesselUmbenennen(bereiche, "kit", "kit");
  assert.equal(gleich.ok, true, "der eigene Name gilt nicht als belegt");
  assert.deepEqual(gleich.objekt, bereiche);
  // Eine Datei ohne den Block darf nicht werfen.
  assert.equal(schluesselUmbenennen(undefined, "kit", "neu").ok, false);
});

test("[einstellungen-21] eine abgewiesene Umbenennung laesst die areas der buildChecks unberuehrt", () => {
  const checkAreas = { a: ["a/**"], b: ["b/**"] };
  const buildChecks = [{ cmd: "lint-a", areas: ["a"] }, { cmd: "lint-b", areas: ["b"] }];
  const folge = schluesselUmbenennen(checkAreas, "a", "b");
  assert.equal(folge.ok, false);
  assert.deepEqual(folge.objekt, checkAreas);
  // Der Grund, warum der Redaktor erst `ok` prueft und dann rechnet: Ungeprueft haengt die
  // Folge "lint-a" auf den Bereich "b" um, und das Kommando liefe bei den falschen Dateien.
  const ungeprueft = bereichsFolgen(buildChecks, [{ von: "a", nach: "b" }], []);
  assert.deepEqual(ungeprueft.buildChecks[0].areas, ["b"]);
  assert.deepEqual(buildChecks[0].areas, ["a"], "der Bestand selbst bleibt unberuehrt");
});
