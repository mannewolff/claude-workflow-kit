// Wackler und Reparaturkandidaten in der Wirksamkeitsauswertung (Issue #1398, Plan #1395,
// E8, E9, E10).
//
// Die zwoelfte Spalte des Ausfuehrungsprotokolls (Issue #1396) markiert die beiden Laeufe
// einer wiederholten Pruefung: `erstlauf` am roten ersten Lauf, `wiederholung` an der
// Wiederholung. Gepaart wird je Laufkennung und Pruefung in Zeitfolge — ein `erstlauf` mit
// der naechsten `wiederholung` desselben Kommandos. Rot und Gruen ist ein Wackler und keine
// Beanstandung, Rot und Rot eine Beanstandung, Rot ohne Partner wie bisher eine.
// Ab drei Wacklern im Fenster ist die Pruefung ein Reparaturkandidat.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, zeile, wirksamkeit, auswerten, pruefung, stand, bericht } from "./helpers/wirksamkeit-fixture.mjs";

const TAG_MS = 24 * 60 * 60 * 1000;
const CMD = "node --test";
const CONFIG = { buildChecks: [CMD] };

/**
 * Eine Protokollzeile mit allen zwoelf Spalten, wie `ausfuehrungSchreiben` in kit/checks.mjs
 * sie seit Issue #1396 schreibt. `sek` verschiebt den Zeitpunkt in Sekunden — so liegen die
 * Zeilen eines Laufs in fester Zeitfolge, ohne ueber eine Tagesgrenze zu fallen.
 */
function zeile12({ tage = 1, sek = 0, cmd = CMD, ergebnis = "gruen", dauerMs = 1000, lauf = "L1", wiederholung = "" }) {
  const stempel = new Date(Date.now() - tage * TAG_MS + sek * 1000).toISOString();
  return `${stempel}\t${cmd}\t${ergebnis}\t${dauerMs}\tabschluss\t${lauf}\t12\tbereiche\t\t\t\t${wiederholung}`;
}

/** Ein gewackeltes Paar: erst rot, dann gruen, in derselben Laufkennung. */
function wackelpaar({ tage = 1, sek = 0, lauf = "L1" } = {}) {
  return [
    zeile12({ tage, sek, ergebnis: "rot", dauerMs: 2000, lauf, wiederholung: "erstlauf" }),
    zeile12({ tage, sek: sek + 1, ergebnis: "gruen", dauerMs: 3000, lauf, wiederholung: "wiederholung" }),
  ];
}

test("[wirksamkeit-1398] Rot und Gruen zaehlt einen Wackler und keine Beanstandung, beide Zeilen als Ausfuehrungen", () => {
  mitProjekt({ config: CONFIG, zeilen: wackelpaar() }, (dir) => {
    const p = pruefung(auswerten(dir), CMD);
    assert.equal(p.wackler, 1);
    assert.equal(p.beanstandungen, 0);
    assert.equal(p.ausfuehrungen, 2);
    assert.equal(p.dauerMs, 5000);
  });
});

test("[wirksamkeit-1398] Rot und Rot zaehlt eine Beanstandung und keinen Wackler", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [
      zeile12({ ergebnis: "rot", wiederholung: "erstlauf" }),
      zeile12({ sek: 1, ergebnis: "rot", wiederholung: "wiederholung" }),
    ],
  }, (dir) => {
    const p = pruefung(auswerten(dir), CMD);
    assert.equal(p.beanstandungen, 1);
    assert.equal(p.wackler, 0);
    assert.equal(p.ausfuehrungen, 2);
    assert.equal(p.zustand, "beanstandet");
  });
});

test("[wirksamkeit-1398] Rot ohne Partner zaehlt eine Beanstandung", () => {
  mitProjekt({ config: CONFIG, zeilen: [zeile12({ ergebnis: "rot", wiederholung: "erstlauf" })] }, (dir) => {
    const p = pruefung(auswerten(dir), CMD);
    assert.equal(p.beanstandungen, 1);
    assert.equal(p.wackler, 0);
  });
});

test("[wirksamkeit-1398] zwei Paare derselben Laufkennung werden in Zeitfolge getrennt gepaart", () => {
  // Teillauf und voller Lauf derselben Laufkennung: erst rot-rot, dann rot-gruen. Ein
  // Paaren ohne Zeitfolge machte daraus zwei Wackler oder zwei Beanstandungen.
  mitProjekt({
    config: CONFIG,
    zeilen: [
      // In der Datei bewusst nicht nach Zeit sortiert: Die Zeitfolge entscheidet.
      zeile12({ sek: 11, ergebnis: "gruen", wiederholung: "wiederholung" }),
      zeile12({ sek: 0, ergebnis: "rot", wiederholung: "erstlauf" }),
      zeile12({ sek: 10, ergebnis: "rot", wiederholung: "erstlauf" }),
      zeile12({ sek: 1, ergebnis: "rot", wiederholung: "wiederholung" }),
    ],
  }, (dir) => {
    const p = pruefung(auswerten(dir), CMD);
    assert.equal(p.beanstandungen, 1, "das erste Paar blieb rot");
    assert.equal(p.wackler, 1, "das zweite Paar hat gewackelt");
    assert.equal(p.ausfuehrungen, 4);
  });
});

test("[wirksamkeit-1398] verschiedene Laufkennungen paaren nicht miteinander", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [
      zeile12({ sek: 0, ergebnis: "rot", lauf: "A", wiederholung: "erstlauf" }),
      zeile12({ sek: 1, ergebnis: "gruen", lauf: "B", wiederholung: "wiederholung" }),
    ],
  }, (dir) => {
    const p = pruefung(auswerten(dir), CMD);
    assert.equal(p.wackler, 0);
    assert.equal(p.beanstandungen, 1);
  });
});

test("[wirksamkeit-1398] eine Zeile ohne Spalte 12 zaehlt wie bisher", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [
      zeile({ tage: 2, ergebnis: "rot", dauerMs: 1000, anlass: "abschluss", lauf: "L1", karte: "12" }),
      zeile({ tage: 1, ergebnis: "gruen", dauerMs: 1000 }),
    ],
  }, (dir) => {
    const p = pruefung(auswerten(dir), CMD);
    assert.equal(p.beanstandungen, 1);
    assert.equal(p.wackler, 0);
    assert.equal(p.ausfuehrungen, 2);
    assert.equal(p.reparaturkandidat, false);
  });
});

test("[wirksamkeit-1398] Reparaturkandidat ab drei Wacklern im Fenster", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [...wackelpaar({ lauf: "A" }), ...wackelpaar({ lauf: "B" }), ...wackelpaar({ lauf: "C" })],
  }, (dir) => {
    const p = pruefung(auswerten(dir), CMD);
    assert.equal(p.wackler, 3);
    assert.equal(p.reparaturkandidat, true);
  });
});

test("[wirksamkeit-1398] zwei Wackler im Fenster machen keinen Reparaturkandidaten", () => {
  mitProjekt({ config: CONFIG, zeilen: [...wackelpaar({ lauf: "A" }), ...wackelpaar({ lauf: "B" })] }, (dir) => {
    const p = pruefung(auswerten(dir), CMD);
    assert.equal(p.wackler, 2);
    assert.equal(p.reparaturkandidat, false);
  });
});

test("[wirksamkeit-1398] Wackler ausserhalb des Fensters zaehlen nicht zur Kennzeichnung", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [
      ...wackelpaar({ tage: 40, lauf: "A" }),
      ...wackelpaar({ tage: 40, lauf: "B" }),
      ...wackelpaar({ tage: 1, lauf: "C" }),
    ],
  }, (dir) => {
    const p = pruefung(auswerten(dir), CMD);
    assert.equal(p.wackler, 1);
    assert.equal(p.reparaturkandidat, false);
  });
});

test("[wirksamkeit-1398] Zustand gewackelt statt nie beanstandet, und kein Befund nie beanstandet", () => {
  // Zwoelf gruene Laeufe laegen ueber der Schwelle von zehn — mit einem Wackler darunter
  // darf der Satz "kein einziges Mal etwas beanstandet" trotzdem nicht erscheinen.
  const gruen = Array.from({ length: 10 }, (_, i) => zeile12({ sek: 100 + i, lauf: `G${i}` }));
  mitProjekt({ config: CONFIG, zeilen: [...gruen, ...wackelpaar()] }, (dir) => {
    const e = auswerten(dir);
    const p = pruefung(e, CMD);
    assert.equal(p.zustand, "gewackelt");
    assert.equal(e.befund.filter((b) => b.schwelle === "nieBeanstandet").length, 0);
    assert.match(bericht(dir), /\| ausgefuehrt, gewackelt \|/);
  });
});

test("[wirksamkeit-1398] wirksamkeit.md fuehrt die Spalte Wackler und je Reparaturkandidat eine Zeile", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [...wackelpaar({ lauf: "A" }), ...wackelpaar({ lauf: "B" }), ...wackelpaar({ lauf: "C" })],
  }, (dir) => {
    auswerten(dir);
    const md = bericht(dir);
    assert.match(md, /\| Kommando \| Zustand \| Ausfuehrungen \| Beanstandungen \| Wackler \| Dauer \| Lauftage \|/);
    assert.match(md, /\| `node --test` \| ausgefuehrt, gewackelt \| 6 \| 0 \| 3 \|/);
    assert.match(md, /Reparaturkandidat: `node --test` — 3 Wackler im Zeitfenster/);
  });
});

test("[wirksamkeit-1398] wirksamkeit.json traegt wackler und reparaturkandidat je Pruefung, keine Liste reparaturkandidaten", () => {
  mitProjekt({ config: { buildChecks: [CMD, "npx eslint ."] }, zeilen: wackelpaar() }, (dir) => {
    auswerten(dir);
    const s = stand(dir);
    for (const p of s.pruefungen) {
      assert.equal(typeof p.wackler, "number", `wackler fehlt bei ${p.cmd}`);
      assert.equal(typeof p.reparaturkandidat, "boolean", `reparaturkandidat fehlt bei ${p.cmd}`);
    }
    assert.equal("reparaturkandidaten" in s, false);
  });
});

test("[wirksamkeit-1398] kandidaten nennt je Reparaturkandidat eine Zeile aus wirksamkeit.json", () => {
  mitProjekt({
    config: { buildChecks: [CMD, "npx eslint ."] },
    zeilen: [...wackelpaar({ lauf: "A" }), ...wackelpaar({ lauf: "B" }), ...wackelpaar({ lauf: "C" })],
  }, (dir) => {
    auswerten(dir);
    const res = wirksamkeit(dir, "kandidaten");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "Reparaturkandidat: node --test — 3 Wackler im Zeitfenster\n");
  });
});
