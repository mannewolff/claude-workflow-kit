// Die Folgen einer Reviewer-Aenderung in den Paarungen (Issue #726, Plan #721, Kriterien 8, 9, 9a).
//
// Einen Reviewer umzubenennen oder zu entfernen ist samt seiner Folgen in `issueReview.pairs`
// EINE Aenderung des Reviewer-Teils: Sie wird dort gespeichert oder verworfen, und eine
// unabhaengige Aenderung im Paarungs-Teil kommt dabei nicht mit. Gerechnet wird das in
// `paarungsFolgen` — dieselbe Fassung, die das Browser-Skript als Baustein traegt.
//
// Jeder Lauf steht auf einer echten Kopie der `.claude/workflow.config.json` dieses Projekts
// (Kriterium der Aufgabe). Ihre Namen sind kein Mass: Der Test holt Autor und Pruefer aus der
// Datei, statt sie festzuschreiben.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { paarungsFolgen, projektZustand, speichere, vorschau } from "../kit/einstellungen.mjs";
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
