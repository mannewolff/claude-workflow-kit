// Der Abschnitt "Bereiche" der Wirksamkeits-Auswertung (Issue #1005, Plan #1001, E4, E6,
// E7, E8, E14).
//
// Die Rohdaten kommen aus zwei Quellen: die drei hinteren Protokollspalten (Ausloeser,
// Bereiche, Dateien — Issue #1004) fuer Laeufe und Minuten, und `checks.mjs bereiche`
// fuer Anteil, Hervorhebung und Inventar. Der Unterbefehl ist hier ein Fake unter
// `.claude/kit/checks.mjs` im Fixture — derselbe Pfad, den die Auswertung aufruft.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, zeile, auswerten, wirksamkeit, bericht, stand } from "./helpers/wirksamkeit-fixture.mjs";

/** Eine Zeile mit den drei neuen Spalten. */
function lauf({ cmd = "node --test a", dauerMs = 60_000, anlass = "paket", karte = "", ausloeser = "bereiche", bereiche = [], dateien = [], lauf: kennung, tage = 2, ergebnis = "gruen" }) {
  return zeile({ tage, cmd, dauerMs, anlass, lauf: kennung, karte, ausloeser, bereiche, dateien, ergebnis });
}

/** Die Ausgabe von `checks.mjs bereiche`, wie Issue #1004 sie liefert. */
function zuschnitt({ bereiche = [], kommandos = 3, freigestellt = [], ohneZuordnung = [], dateien = 20 } = {}) {
  return {
    ausgabe: {
      kommandos,
      bereiche: bereiche.map((b) => ({
        muster: [], nennend: 1, von: kommandos, hervorgehoben: false, kopplungsgrund: null, ...b,
      })),
      inventar: {
        dateien,
        ohneTreffer: freigestellt.length + ohneZuordnung.length,
        freigestellt,
        ohneZuordnung,
      },
    },
  };
}

function tabellenzeile(b, name) {
  const treffer = b.tabelle.find((z) => z.name === name);
  assert.ok(treffer, `Bereich '${name}' fehlt in der Tabelle`);
  return treffer;
}

function sonderzeile(b, name) {
  const treffer = b.sonderzeilen.find((z) => z.name === name);
  assert.ok(treffer, `Sonderzeile '${name}' fehlt`);
  return treffer;
}

test("[wirksamkeit-1005] eine Ausfuehrung mit zwei Bereichen zaehlt in beiden mit voller Dauer, der Summen-Hinweis steht da", () => {
  mitProjekt({
    zeilen: [
      lauf({ bereiche: ["kern", "doku"], dauerMs: 60_000 }),
      lauf({ bereiche: ["kern"], dauerMs: 30_000, ergebnis: "rot" }),
    ],
    zuschnitt: zuschnitt({ bereiche: [{ name: "kern", nennend: 2 }, { name: "doku", nennend: 1 }] }),
  }, (dir) => {
    const b = auswerten(dir).bereiche;

    assert.equal(b.vermerk, null);
    assert.deepEqual(
      { laeufe: tabellenzeile(b, "kern").laeufe, dauerMs: tabellenzeile(b, "kern").dauerMs },
      { laeufe: 2, dauerMs: 90_000 },
    );
    assert.deepEqual(
      { laeufe: tabellenzeile(b, "doku").laeufe, dauerMs: tabellenzeile(b, "doku").dauerMs },
      { laeufe: 1, dauerMs: 60_000 },
      "die Ausfuehrung zaehlt auch fuer den zweiten Bereich mit voller Dauer",
    );
    assert.equal(b.gesamtDauerMs, 90_000, "die Gesamtzeit zaehlt jede Ausfuehrung einmal");
    assert.equal(tabellenzeile(b, "kern").nennend, 2);
    assert.equal(tabellenzeile(b, "kern").von, 3);

    const text = bericht(dir);
    assert.match(text, /## Bereiche/);
    assert.match(text, /\| kern \| 2\/3 \| nein \| 2 \| 1,5 \|/);
    assert.match(text, /\| doku \| 1\/3 \| nein \| 1 \| 1,0 \|/);
    assert.match(text, /uebersteigt die Gesamtzeit.*fuer jeden ihrer Bereiche/s, "der Summen-Hinweis fehlt");
  });
});

test("[wirksamkeit-1005] jede Sonderzeile zaehlt ihre Ausloeserart, alte Zeilen stehen vor der Erfassung", () => {
  mitProjekt({
    zeilen: [
      lauf({ ausloeser: "ohne-bereich", dauerMs: 1_000 }),
      lauf({ ausloeser: "ohne-zuordnung", dateien: ["neu.txt"], dauerMs: 2_000 }),
      lauf({ ausloeser: "veroeffentlichung", anlass: "push", dauerMs: 3_000 }),
      lauf({ ausloeser: "anker", dauerMs: 4_000 }),
      // Vierspaltige und siebenspaltige Zeilen aus der Zeit vor Issue #1004.
      zeile({ tage: 2, dauerMs: 5_000 }),
      zeile({ tage: 2, dauerMs: 6_000, anlass: "abschluss", lauf: "X", karte: "7" }),
      // Ausserhalb des Fensters: zaehlt nirgends.
      lauf({ ausloeser: "ohne-bereich", dauerMs: 99_000, tage: 90 }),
    ],
    zuschnitt: zuschnitt(),
  }, (dir) => {
    const b = auswerten(dir).bereiche;
    const zahlen = (name) => {
      const z = sonderzeile(b, name);
      return [z.laeufe, z.dauerMs];
    };

    assert.deepEqual(zahlen("ohne Bereich"), [1, 1_000]);
    assert.deepEqual(zahlen("voller Umfang wegen fehlender Zuordnung"), [1, 2_000]);
    assert.deepEqual(zahlen("Veroeffentlichung (push/merge)"), [1, 3_000]);
    assert.deepEqual(zahlen("Anker nicht aufloesbar"), [1, 4_000]);
    assert.deepEqual(zahlen("vor der Erfassung"), [2, 11_000], "vier- und siebenspaltige Zeilen bleiben gueltig");
    assert.equal(b.gesamtDauerMs, 21_000);

    const text = bericht(dir);
    for (const name of ["ohne Bereich", "voller Umfang wegen fehlender Zuordnung", String.raw`Veroeffentlichung \(push\/merge\)`, "Anker nicht aufloesbar", "vor der Erfassung"]) {
      assert.match(text, new RegExp(`\\| ${name} \\|`), `Sonderzeile '${name}' fehlt im Bericht`);
    }
  });
});

test("[wirksamkeit-1005] ein gekoppelter Bereich bleibt hervorgehoben und traegt den Vermerk", () => {
  mitProjekt({
    zeilen: [lauf({ bereiche: ["board"] })],
    zuschnitt: zuschnitt({
      bereiche: [
        { name: "board", nennend: 3, hervorgehoben: true, kopplungsgrund: "Fast jede Gruppe laedt kit/board.mjs." },
        { name: "breit", nennend: 2, hervorgehoben: true },
        { name: "schmal", nennend: 1 },
      ],
    }),
  }, (dir) => {
    const b = auswerten(dir).bereiche;
    assert.equal(tabellenzeile(b, "board").hervorgehoben, true);
    assert.equal(tabellenzeile(b, "board").kopplungsgrund, "Fast jede Gruppe laedt kit/board.mjs.");
    assert.equal(tabellenzeile(b, "schmal").laeufe, 0, "ein Bereich ohne Lauf steht mit 0 in der Tabelle");

    const text = bericht(dir);
    assert.match(text, /\| board \| 3\/3 \| ja — durch Kopplung erzwungen: Fast jede Gruppe laedt kit\/board\.mjs\. \|/);
    assert.match(text, /\| breit \| 2\/3 \| ja \|/);
    assert.match(text, /\| schmal \| 1\/3 \| nein \| 0 \|/);
  });
});

test("[wirksamkeit-1005] das Inventar trennt Freigestellte und Dateien ohne jede Zuordnung", () => {
  mitProjekt({
    zeilen: [],
    zuschnitt: zuschnitt({
      dateien: 446,
      freigestellt: [{ pfad: "LICENSE", grund: "Lizenztext." }, { pfad: "CHANGELOG.md", grund: "Protokoll." }],
      ohneZuordnung: ["test/fixtures/a.json"],
    }),
  }, (dir) => {
    const i = auswerten(dir).bereiche.inventar;
    assert.equal(i.dateien, 446);
    assert.equal(i.ohneTreffer, 3);
    assert.equal(i.freigestellt.length, 2);
    assert.deepEqual(i.ohneZuordnung, ["test/fixtures/a.json"]);

    const text = bericht(dir);
    assert.match(text, /3 von 446/);
    assert.match(text, /freigestellt \(`ohnePruefung`, mit Grund\): 2/);
    assert.match(text, /- `LICENSE` — Lizenztext\./);
    assert.match(text, /ohne jede Zuordnung — loest den vollen Umfang aus: 1/);
    assert.match(text, /- `test\/fixtures\/a\.json`/);
  });
});

test("[wirksamkeit-1005] teure Dateien zaehlen volle Laeufe und Minuten aus der Spalte dateien", () => {
  mitProjekt({
    zeilen: [
      // Ein voller Lauf "L1" mit zwei Kommandos: ein Lauf, beide Dauern.
      lauf({ ausloeser: "ohne-zuordnung", dateien: ["neu.txt", "a,b.txt"], lauf: "L1", dauerMs: 60_000 }),
      lauf({ ausloeser: "ohne-zuordnung", dateien: ["neu.txt", "a,b.txt"], lauf: "L1", dauerMs: 30_000, cmd: "node --test b" }),
      lauf({ ausloeser: "ohne-zuordnung", dateien: ["neu.txt"], lauf: "L2", dauerMs: 60_000 }),
      // Ausserhalb des Fensters: zaehlt nicht.
      lauf({ ausloeser: "ohne-zuordnung", dateien: ["alt.txt"], lauf: "L0", tage: 90 }),
    ],
    zuschnitt: zuschnitt(),
  }, (dir) => {
    const teure = auswerten(dir).bereiche.teureDateien;
    assert.deepEqual(teure, [
      { pfad: "neu.txt", volleLaeufe: 2, dauerMs: 150_000 },
      { pfad: "a,b.txt", volleLaeufe: 1, dauerMs: 90_000 },
    ], "das maskierte Komma im Pfad ist kein Trenner");

    const text = bericht(dir);
    assert.match(text, /\| `neu\.txt` \| 2 \| 2,5 \|/);
    assert.match(text, /\| `a,b\.txt` \| 1 \| 1,5 \|/);
  });
});

test("[wirksamkeit-1005] der Ueberschreitungszaehler zaehlt Abschlusslaeufe ueber 30 s je Kommando", () => {
  mitProjekt({
    config: { buildChecks: ["node --test a", "node --test b"] },
    zeilen: [
      lauf({ cmd: "node --test a", anlass: "abschluss", karte: "1", dauerMs: 31_000 }),
      lauf({ cmd: "node --test a", anlass: "abschluss", karte: "2", dauerMs: 29_000 }),
      lauf({ cmd: "node --test b", anlass: "abschluss", karte: "1", dauerMs: 29_000 }),
      // Kein Abschlusslauf: zaehlt nicht, auch ueber der Grenze.
      lauf({ cmd: "node --test b", anlass: "push", ausloeser: "veroeffentlichung", dauerMs: 90_000 }),
      // Die alte siebenspaltige Abschlusszeile zaehlt mit — der Anlass steht dort schon.
      zeile({ tage: 2, cmd: "node --test b", anlass: "abschluss", lauf: "X", karte: "3", dauerMs: 45_000 }),
    ],
    zuschnitt: zuschnitt(),
  }, (dir) => {
    const o = auswerten(dir).bereiche.obergrenze;
    assert.equal(o.grenzeMs, 30_000);
    const je = Object.fromEntries(o.kommandos.map((k) => [k.cmd, [k.abschlusslaeufe, k.ueber]]));
    assert.deepEqual(je["node --test a"], [2, 1], "31 s zaehlt, 29 s nicht");
    assert.deepEqual(je["node --test b"], [2, 1], "nur Abschlusslaeufe zaehlen");

    const text = bericht(dir);
    assert.match(text, /\| `node --test a` \| 2 \| 1 \|/);
  });
});

test("[wirksamkeit-1005] scheitert checks.mjs bereiche, endet die Auswertung mit 0 und vermerkt es", () => {
  mitProjekt({
    zeilen: [lauf({ bereiche: ["kern"], dauerMs: 60_000 })],
    zuschnitt: { exit: 3, stderr: "Fehler: checkAreas kaputt" },
  }, (dir) => {
    const res = wirksamkeit(dir, "auswerten");
    assert.equal(res.status, 0, `Exit ${res.status}: ${res.stderr}`);
    const b = JSON.parse(res.stdout).bereiche;

    assert.match(b.vermerk, /checkAreas kaputt/);
    assert.equal(b.inventar, null);
    assert.equal(tabellenzeile(b, "kern").laeufe, 1, "Laeufe und Minuten stammen weiter aus dem Protokoll");
    assert.equal(tabellenzeile(b, "kern").nennend, null);

    const text = bericht(dir);
    assert.match(text, /## Bereiche/);
    assert.match(text, /checks\.mjs bereiche.*checkAreas kaputt/);
    assert.match(text, /\| kern \| — \| — \| 1 \| 1,0 \|/);
    assert.deepEqual(stand(dir).bereiche, b, "der JSON-Stand traegt denselben Abschnitt");
  });
});

test("[wirksamkeit-1005] fehlt checks.mjs ganz, ist das ebenfalls nur ein Vermerk", () => {
  mitProjekt({ zeilen: [] }, (dir) => {
    const res = wirksamkeit(dir, "auswerten");
    assert.equal(res.status, 0);
    assert.ok(JSON.parse(res.stdout).bereiche.vermerk, "der Vermerk fehlt");
  });
});
