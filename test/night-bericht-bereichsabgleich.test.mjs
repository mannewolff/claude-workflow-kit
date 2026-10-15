// Die Luecken der Pruefbereiche im Nachtbericht (Issue #1720, Plan #1713, Kriterium 11).
//
// Der Prueflauf eines Pakets schreibt den Abgleich ab Issue #1719 ins Feld `bereichsabgleich`
// der Zusammenfassung. Der Runner uebernimmt ihn ueber `lesePruefung` in den Pruefstand der
// Einheit, und der Nachtbericht sammelt die Luecken aller Pakete der Nacht unter einer eigenen
// Zeile im Block des Prueflaufs — je Luecke Paket, Test, Datei und Pruefkommando.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lesePruefung } from "../kit/night/session.mjs";
import { prueflaufZeilen, berichtBauen } from "../kit/night/bericht.mjs";
import { zusammenfassungPfad } from "../kit/checks.mjs";
import { spracheFestlegen } from "../kit/board/namen.mjs";

const LUECKE_A = { test: "test/a.test.mjs", datei: "kit/a.mjs", bereich: "board", kommando: "node --test test/a.test.mjs" };
const LUECKE_B = { test: "test/b.test.mjs", datei: "kit/b.mjs", bereich: "nacht", kommando: "node --test test/b.test.mjs" };

/** Liest den Pruefstand aus einer Zusammenfassung, wie `checks.mjs run` sie hinterlaesst. */
function pruefungAus(zusammenfassung) {
  const dir = mkdtempSync(join(tmpdir(), "bereichsabgleich-"));
  const vorher = process.cwd();
  try {
    const pfad = zusammenfassungPfad(dir);
    mkdirSync(join(pfad, ".."), { recursive: true });
    writeFileSync(pfad, JSON.stringify(zusammenfassung));
    process.chdir(dir);
    return lesePruefung("7");
  } finally {
    process.chdir(vorher);
    rmSync(dir, { recursive: true, force: true });
  }
}

function zusammenfassung(extra = {}) {
  return {
    zeitpunkt: "2026-10-15T10:00:00.000Z", stufe: "paket", basis: "HEAD", vollerUmfang: false, leeresPaket: false,
    bereiche: ["board"], ohneZuordnung: [], hinweise: [], rot: false,
    laufen: [{ cmd: "node --test test/a.test.mjs", ergebnis: "gruen", dauerMs: 1200 }],
    ausgelassen: [],
    ...extra,
  };
}

/** Fuehrt `fn` mit der Prozesssprache `sprache` aus. */
function inSprache(sprache, fn) {
  spracheFestlegen(sprache);
  try {
    return fn();
  } finally {
    spracheFestlegen(null);
  }
}

test("[night-1720] der Pruefstand uebernimmt bereichsabgleich aus der Zusammenfassung", () => {
  const abgleich = { luecken: [LUECKE_A], nichtBeurteilbar: [], fehler: null };
  assert.deepEqual(pruefungAus(zusammenfassung({ bereichsabgleich: abgleich })).bereichsabgleich, abgleich);
});

test("[night-1720] ohne das Feld ist bereichsabgleich null", () => {
  assert.equal(pruefungAus(zusammenfassung()).bereichsabgleich, null);
});

test("[night-1720] der Prueflauf-Block sammelt die Luecken aller Pakete der Nacht", () => {
  const einheiten = [
    { id: "10", dauerMs: 60000, pruefung: { zustand: "geprueft", bereichsabgleich: { luecken: [LUECKE_A], nichtBeurteilbar: [], fehler: null } } },
    { id: "11", dauerMs: 60000, pruefung: { zustand: "geprueft", bereichsabgleich: null } },
    { id: "12", dauerMs: 60000, pruefung: { zustand: "geprueft", bereichsabgleich: { luecken: [LUECKE_B], nichtBeurteilbar: [], fehler: null } } },
  ];
  const zeilen = prueflaufZeilen(einheiten);
  const kopf = zeilen.indexOf("Lücken der Prüfbereiche:");
  assert.ok(kopf > 0, JSON.stringify(zeilen));
  assert.deepEqual(zeilen.slice(kopf + 1, kopf + 3), [
    "  - Issue #10: test/a.test.mjs lädt kit/a.mjs aus Bereich board, den node --test test/a.test.mjs nicht auslöst",
    "  - Issue #12: test/b.test.mjs lädt kit/b.mjs aus Bereich nacht, den node --test test/b.test.mjs nicht auslöst",
  ]);
});

test("[night-1720] der Nachtbericht traegt die Luecken unter ### Umsetzung", () => {
  const kette = {
    id: "1", ausgang: "fertig", variante: "B",
    stufen: { umsetzung: { umgesetzt: [{ id: "10", stufe: "leicht" }], angehalten: [], nichtBegonnen: [] } },
  };
  const einheiten = [{ id: "10", dauerMs: 60000, pruefung: { zustand: "geprueft", bereichsabgleich: { luecken: [LUECKE_A], nichtBeurteilbar: [], fehler: null } } }];
  const text = berichtBauen(kette, { pakete: [{ id: "10", title: "P1" }], einheiten, stempel: "s" });
  const umsetzung = text.slice(text.indexOf("### Umsetzung"), text.indexOf("### Entscheidungen der Nacht"));
  assert.match(umsetzung, /Lücken der Prüfbereiche:\n {2}- Issue #10: test\/a\.test\.mjs lädt kit\/a\.mjs/);
});

test("[night-1720] englisch mit der Fassung aus kit/texte/night-bericht.mjs", () => {
  const einheiten = [{ id: "10", dauerMs: 60000, pruefung: { zustand: "geprueft", bereichsabgleich: { luecken: [LUECKE_A], nichtBeurteilbar: [], fehler: null } } }];
  const zeilen = inSprache("en", () => prueflaufZeilen(einheiten));
  const kopf = zeilen.indexOf("Gaps in the check areas:");
  assert.ok(kopf > 0, JSON.stringify(zeilen));
  assert.equal(zeilen[kopf + 1], "  - Issue #10: test/a.test.mjs loads kit/a.mjs from area board, which node --test test/a.test.mjs does not trigger");
});

test("[night-1720] ohne Luecken in der Nacht erscheint die Zeile nicht", () => {
  for (const bereichsabgleich of [undefined, null, { luecken: [], nichtBeurteilbar: [], fehler: null }, { luecken: [], nichtBeurteilbar: [], fehler: "kaputt" }]) {
    const zeilen = prueflaufZeilen([{ id: "10", dauerMs: 60000, pruefung: { zustand: "geprueft", bereichsabgleich } }]);
    assert.ok(!zeilen.some((z) => z.startsWith("Lücken der Prüfbereiche")), JSON.stringify(zeilen));
  }
});
