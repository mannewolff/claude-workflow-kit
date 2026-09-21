// Aggregation der Pruefungs-Kennzahlen (Issue #787, Plan #782, E3, E4).
//
// Die Menge der Pruefungen ist die VEREINIGUNG aus den `cmd`-Werten der heutigen
// buildChecks und allen Kommandos, die im Fenster eine Protokollzeile tragen (E3):
// Eine im Fenster entfernte Pruefung faellt damit nicht aus der Zeitbilanz, und eine
// vorgeschriebene ohne jede Ausfuehrung erscheint als "nicht gelaufen" statt gar nicht.
//
// Beanstandet heisst `rot` (E4): Das Protokoll traegt nur beendete Ausfuehrungen,
// und ein roter Lauf ist genau der Fall, in dem die Pruefung etwas gefunden hat.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, zeile, wirksamkeit, auswerten, pruefung, stand, bericht, hatStand } from "./helpers/wirksamkeit-fixture.mjs";

const CONFIG = { buildChecks: ["node --test", { cmd: "npx eslint .", areas: ["kern"] }] };

test("[wirksamkeit-1] auswerten aggregiert je Kommando Ausfuehrungen, Beanstandungen und Dauer", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [
      zeile({ tage: 3, cmd: "node --test", ergebnis: "rot", dauerMs: 40_000 }),
      zeile({ tage: 2, cmd: "node --test", ergebnis: "gruen", dauerMs: 50_000 }),
      zeile({ tage: 2, cmd: "npx eslint .", ergebnis: "gruen", dauerMs: 1_200 }),
    ],
  }, (dir) => {
    const e = auswerten(dir);

    const tests = pruefung(e, "node --test");
    assert.equal(tests.ausfuehrungen, 2);
    assert.equal(tests.beanstandungen, 1);
    assert.equal(tests.dauerMs, 90_000);
    assert.equal(tests.lauftage, 2);

    const eslint = pruefung(e, "npx eslint .");
    assert.equal(eslint.ausfuehrungen, 1);
    assert.equal(eslint.beanstandungen, 0);
    assert.equal(eslint.dauerMs, 1_200);
  });
});

test("[wirksamkeit-1] auswerten schreibt wirksamkeit.md und wirksamkeit.json und gibt denselben Stand auf stdout", () => {
  mitProjekt({ config: CONFIG, zeilen: [zeile({ tage: 1 })] }, (dir) => {
    const e = auswerten(dir);

    assert.ok(hatStand(dir), "wirksamkeit.json fehlt");
    assert.deepEqual(stand(dir), e, "stdout und wirksamkeit.json sind nicht derselbe Stand");
    assert.match(bericht(dir), /# Wirksamkeit der Pruefungen/);
  });
});

test("[wirksamkeit-1] mehrfache Ausfuehrung desselben Kommandos in einer Runde wird addiert, der Tag zaehlt einmal", () => {
  // Rot, Fix, erneut gruen — dieselbe Runde, derselbe Zeitpunkt: zwei Ausfuehrungen,
  // ein Lauftag. Identische Stempel, damit keine Kalendertagsgrenze dazwischenfaellt.
  const stempel = zeile({ tage: 2, ergebnis: "rot", dauerMs: 30_000 }).split("\t")[0];
  mitProjekt({
    config: { buildChecks: ["node --test"] },
    zeilen: [
      zeile({ zeit: stempel, ergebnis: "rot", dauerMs: 30_000 }),
      zeile({ zeit: stempel, ergebnis: "gruen", dauerMs: 31_000 }),
    ],
  }, (dir) => {
    const p = pruefung(auswerten(dir), "node --test");
    assert.equal(p.ausfuehrungen, 2);
    assert.equal(p.beanstandungen, 1);
    assert.equal(p.lauftage, 1, "zwei Ausfuehrungen am selben Tag sind ein Lauftag");
  });
});

test("[wirksamkeit-1] eine unlesbare Protokollzeile wird uebersprungen und im Bericht gezaehlt", () => {
  mitProjekt({
    config: { buildChecks: ["node --test"] },
    zeilen: [
      "das ist keine Protokollzeile",
      zeile({ tage: 1, dauerMs: "keineZahl" }),
      zeile({ tage: 1, ergebnis: "nicht gestartet" }),
      zeile({ tage: 1, dauerMs: 5_000 }),
    ],
  }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.protokoll.fehlerhafteZeilen, 3, "nur gruen und rot mit Zahl und Zeit sind Ausfuehrungen");
    assert.equal(pruefung(e, "node --test").ausfuehrungen, 1);
    assert.match(bericht(dir), /3 .*(uebersprungen|unlesbar)/, "der Bericht zaehlt die uebersprungenen Zeilen nicht");
  });
});

test("[wirksamkeit-3] eine im Fenster entfernte Pruefung bleibt in der Zeitbilanz und wird benannt", () => {
  // "alt --check" traegt Zeilen, steht aber nicht mehr in den buildChecks (E3).
  mitProjekt({
    config: { buildChecks: ["node --test"] },
    zeilen: [
      zeile({ tage: 2, cmd: "alt --check", ergebnis: "gruen", dauerMs: 9_000 }),
      zeile({ tage: 1, cmd: "node --test" }),
    ],
  }, (dir) => {
    const e = auswerten(dir);
    const alt = pruefung(e, "alt --check");
    assert.ok(alt, "die entfernte Pruefung fehlt in der Auswertung");
    assert.equal(alt.vorgeschrieben, false);
    assert.equal(alt.ausfuehrungen, 1);
    assert.match(bericht(dir), /alt --check/);
  });
});

test("[wirksamkeit-1] ohne Ausfuehrungsprotokoll steht der Leerfall ausgeschrieben, JSON kommt trotzdem", () => {
  mitProjekt({ config: CONFIG, zeilen: null }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.protokoll.vorhanden, false);
    assert.ok(hatStand(dir), "auch im Leerfall werden beide Dateien geschrieben");
    assert.match(bericht(dir), /kein Ausfuehrungsprotokoll/i, "der Leerfall steht nicht ausgeschrieben im Bericht");
    // Die vorgeschriebenen Pruefungen erscheinen trotzdem — als "nicht gelaufen".
    assert.equal(pruefung(e, "node --test").zustand, "nicht gelaufen");
  });
});

test("[wirksamkeit-1] ohne Protokoll und ohne buildChecks steht 'keine Pruefung im Fenster' ausgeschrieben", () => {
  mitProjekt({ config: { buildChecks: [] }, zeilen: null }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.pruefungen.length, 0);
    assert.match(bericht(dir), /[Kk]eine .*Pruefung im Fenster/, "der zweite Leerfall steht nicht ausgeschrieben");
  });
});

test("[wirksamkeit-1] ein abgewiesener Aufruf gibt JSON auf stdout aus", () => {
  mitProjekt({ zeilen: [] }, (dir) => {
    const res = wirksamkeit(dir, "auswerten", "--fenster", "keineZahl");

    assert.notEqual(res.status, 0);
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    assert.match(json.fehler, /--fenster/);
  });
});

test("[wirksamkeit-1] der Bericht nennt die Messgrenze der Salvage-Pruefungen", () => {
  mitProjekt({ config: CONFIG, zeilen: [zeile({ tage: 1 })] }, (dir) => {
    auswerten(dir);
    assert.match(bericht(dir), /Salvage/, "die Messgrenze aus E17 fehlt im Bericht");
  });
});
