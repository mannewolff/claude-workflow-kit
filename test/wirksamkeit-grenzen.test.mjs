// Die Grenzen des Protokolls: Groesse, Zukunft und Maskierung (Issue #822).
//
// Anlass sind drei Funde des Code-Reviews ueber v2.0.0..HEAD. Sie teilen eine Ursache:
// Das Ausfuehrungsprotokoll waechst unbegrenzt und wird nie geleert, und die Auswertung
// las es, als sei es klein, frisch und wohlgeformt.
//
// - GROESSE: `Math.min(...zeilen)` legt jede Zeile als eigenes Argument auf den
//   Aufrufstapel. Ab etwa 150.000 Zeilen endet die Auswertung mit RangeError — bei
//   Dutzenden Zeilen am Tag eine Frage von ein bis zwei Jahren, ohne jedes Zutun.
// - ZUKUNFT: Eine Zeile mit einem Zeitstempel hinter jetzt wurde gezaehlt und zog den
//   Erhebungsbeginn mit sich. Das Fenster stand dann als `von 2099, bis heute` da — eine
//   falsch gehende Uhr genuegt als Ausloeser.
// - MASKIERUNG: Ein Kommando mit Tab oder Zeilenumbruch zerfiel in mehrere Zeilen; die
//   Pruefung erschien als "nicht gelaufen", ihre Zeilen als fehlerhaft.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, zeile, bewegung, vorTagen, auswerten, pruefung } from "./helpers/wirksamkeit-fixture.mjs";

const CONFIG = { buildChecks: ["node --test"] };

// Hinter der Grenze, an der der Spread-Aufruf bricht (gemessen ab ~150.000).
const VIELE = 200_000;

const ZUKUNFT = "2099-01-01T00:00:00.000Z";

test("[wirksamkeit-7] ein Protokoll mit 200.000 Zeilen wird ausgewertet und nennt den richtigen Erhebungsbeginn", () => {
  const aeltest = vorTagen(20);
  const juengst = vorTagen(1);
  const zeilen = [zeile({ zeit: aeltest })];
  for (let i = 1; i < VIELE; i += 1) zeilen.push(zeile({ zeit: juengst }));

  mitProjekt({ config: CONFIG, zeilen }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.protokoll.zeilen, VIELE, "jede Zeile wird gelesen");
    assert.equal(pruefung(e, "node --test").ausfuehrungen, VIELE);
    assert.equal(e.fenster.erhebungsbeginn, aeltest, "der frueheste Zeitstempel ist der Erhebungsbeginn");
  });
});

test("[wirksamkeit-7] eine Zeile aus der Zukunft ist keine Ausfuehrung, sondern eine fehlerhafte Zeile", () => {
  mitProjekt({ config: CONFIG, zeilen: [zeile({ zeit: ZUKUNFT }), zeile({ tage: 5 })] }, (dir) => {
    const e = auswerten(dir);

    assert.equal(pruefung(e, "node --test").ausfuehrungen, 1, "nur die Zeile von vor fuenf Tagen zaehlt");
    assert.equal(e.protokoll.zeilen, 1, "die Zukunftszeile steht nicht unter den gueltigen");
    assert.equal(e.protokoll.fehlerhafteZeilen, 1, "sie wird gezaehlt statt gedeutet");
    assert.ok(e.fenster.erhebungsbeginn < e.fenster.bis, "der Erhebungsbeginn liegt nicht in der Zukunft");
    assert.ok(e.fenster.von <= e.fenster.bis, "das Fenster bleibt geordnet");
  });
});

test("[wirksamkeit-7] ein Protokoll nur aus Zukunftszeilen ergibt keinen Erhebungsbeginn und ein geordnetes Fenster", () => {
  mitProjekt({ config: CONFIG, zeilen: [zeile({ zeit: ZUKUNFT })] }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.fenster.erhebungsbeginn, null);
    assert.equal(e.fenster.abgeschnitten, false);
    assert.ok(e.fenster.von <= e.fenster.bis, "das Fenster bleibt geordnet");
    assert.equal(pruefung(e, "node --test").zustand, "nicht gelaufen");
  });
});

test("[wirksamkeit-7] ein maskiertes mehrzeiliges Kommando ist genau eine Ausfuehrung und traegt seinen echten Text", () => {
  const echt = "echo a\necho b";
  mitProjekt({
    config: { buildChecks: [echt] },
    zeilen: [zeile({ tage: 1, cmd: String.raw`echo a\necho b` })],
  }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.protokoll.fehlerhafteZeilen, 0, "die maskierte Zeile ist wohlgeformt");
    const p = pruefung(e, echt);
    assert.ok(p, `das Kommando steht unter seinem echten Text: ${JSON.stringify(e.pruefungen.map((x) => x.cmd))}`);
    assert.equal(p.ausfuehrungen, 1);
    assert.equal(p.zustand, "nie beanstandet", "genau eine gruene Ausfuehrung, kein Zerfall in zwei Zeilen");
  });
});

test("[wirksamkeit-7] ein maskiertes Tab-Kommando und ein maskierter Backslash werden zurueckgewandelt", () => {
  const mitTab = "echo a\tb";
  const mitBackslash = String.raw`echo a\b`;
  mitProjekt({
    config: { buildChecks: [mitTab, mitBackslash] },
    zeilen: [
      zeile({ tage: 1, cmd: String.raw`echo a\tb` }),
      zeile({ tage: 1, cmd: String.raw`echo a\\b` }),
    ],
  }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.protokoll.fehlerhafteZeilen, 0);
    assert.equal(pruefung(e, mitTab).ausfuehrungen, 1, "der maskierte Tab bleibt im Kommando statt zur Spalte zu werden");
    assert.equal(pruefung(e, mitBackslash).ausfuehrungen, 1, "der verdoppelte Backslash wird wieder einer");
  });
});

test("[wirksamkeit-7] eine alte, unmaskierte Zeile liest sich unveraendert", () => {
  const cmd = "node tools/sync-blobs.mjs --check";
  mitProjekt({ config: { buildChecks: [cmd] }, zeilen: [zeile({ tage: 1, cmd })] }, (dir) => {
    const p = pruefung(auswerten(dir), cmd);

    assert.equal(p.ausfuehrungen, 1, "ein Kommando ohne Sonderzeichen bleibt, was es war");
  });
});

test("[wirksamkeit-7] eine Bewegungszeile aus der Zukunft macht keinen Kandidaten und zaehlt als fehlerhaft", () => {
  mitProjekt({
    config: { buildChecks: ["node --test"], issueTracker: "toolbox" },
    zeilen: [zeile({ tage: 1 })],
    bewegungen: [bewegung({ zeit: ZUKUNFT, id: "99" })],
    board: { verlaeufe: {} },
  }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.ruecklauf.kandidaten.imFenster, 0, "eine Karte aus der Zukunft ist kein Kandidat");
    assert.equal(e.ruecklauf.protokoll.zeilen, 0, "die Zukunftszeile steht nicht unter den gueltigen");
    assert.equal(e.ruecklauf.protokoll.fehlerhafteZeilen, 1);
    assert.equal(e.ruecklauf.status, "nichtBerechenbar");
  });
});
