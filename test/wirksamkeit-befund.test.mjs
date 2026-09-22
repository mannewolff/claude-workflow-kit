// Der Befund als Text (Issue #787, Plan #782).
//
// `befund` ist die Lesekante fuer die Ausgabestellen — dieselben zwei Zusagen wie bei
// kit/aufwand.mjs: Exit 0 IN JEDEM FALL (auch ohne Datei, mit leerer und mit kaputter
// Datei — der Befund ist kein Gate) und byteweise LEERE Ausgabe ohne Befund (keine
// Ueberschrift, kein beruhigender Satz).

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mitProjekt, zeile, wirksamkeit, auswerten, standPfad, hatStand } from "./helpers/wirksamkeit-fixture.mjs";

const CONFIG = { buildChecks: ["node --test"] };

/** Zehn gruene Ausfuehrungen — genau die Schwelle, ab der der Befund entsteht. */
function mitBefundZeilen() {
  return Array.from({ length: 10 }, (_, i) => zeile({ tage: i + 1 }));
}

test("[wirksamkeit-2] mit Befund traegt die Kopfzeile Datum der Auswertung und Fenster", () => {
  mitProjekt({ config: CONFIG, zeilen: mitBefundZeilen() }, (dir) => {
    auswerten(dir);

    const res = wirksamkeit(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    const [kopf, ...rest] = res.stdout.split("\n");
    assert.match(kopf, /^Auswertung vom \d{4}-\d{2}-\d{2}T[\d:.]+Z/, `die Kopfzeile nennt das Datum nicht: ${kopf}`);
    assert.match(kopf, /30 Tage/, `die Kopfzeile nennt das Fenster nicht: ${kopf}`);
    assert.match(rest.join("\n"), /node --test/, "der Befundblock selbst fehlt");
  });
});

test("[wirksamkeit-2] ohne Befund bleibt die Ausgabe byteweise leer", () => {
  mitProjekt({ config: CONFIG, zeilen: [zeile({ tage: 1 })] }, (dir) => {
    auswerten(dir);

    const res = wirksamkeit(dir, "befund");

    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "", `erwartet war eine leere Ausgabe, kam: ${JSON.stringify(res.stdout)}`);
    assert.equal(res.stderr, "", "auch stderr bleibt stumm");
  });
});

test("[wirksamkeit-2] ohne wirksamkeit.json bleibt die Ausgabe leer und der Exit-Code 0", () => {
  mitProjekt({ zeilen: [] }, (dir) => {
    const res = wirksamkeit(dir, "befund");

    assert.equal(res.status, 0, `ohne Datei darf der Befund nichts aufhalten: ${res.stderr}`);
    assert.equal(res.stdout, "");
    assert.equal(hatStand(dir), false, "befund legt nichts an — es liest nur");
  });
});

test("[wirksamkeit-2] mit leerer oder kaputter wirksamkeit.json bleibt die Ausgabe leer und der Exit-Code 0", () => {
  mitProjekt({ zeilen: [] }, (dir) => {
    for (const inhalt of ["", "{ das ist kein JSON", JSON.stringify({ erzeugtAm: "2026-09-01T00:00:00.000Z" })]) {
      writeFileSync(standPfad(dir), inhalt, "utf-8");

      const res = wirksamkeit(dir, "befund");

      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, "", `bei Inhalt ${JSON.stringify(inhalt.slice(0, 20))} kam Ausgabe`);
    }
  });
});

test("[wirksamkeit-2] der Befund gibt keine Handlungsempfehlung", () => {
  mitProjekt({ config: CONFIG, zeilen: mitBefundZeilen() }, (dir) => {
    auswerten(dir);

    const { stdout } = wirksamkeit(dir, "befund");

    assert.notEqual(stdout, "", "der Befund haette ausloesen muessen");
    assert.doesNotMatch(stdout, /sollte|empfehl|besser w(ae|ä)re|ratsam/i, "der Befund gibt eine Handlungsempfehlung");
  });
});

test("[wirksamkeit-2] befund weist ein ueberzaehliges Argument ab, ohne etwas auszugeben", () => {
  mitProjekt({ zeilen: [] }, (dir) => {
    const res = wirksamkeit(dir, "befund", "--fenster", "3");

    assert.notEqual(res.status, 0, "ein unbekanntes Argument gehoert abgewiesen");
    assert.equal(res.stdout, "", "auf stdout gehoert hier kein Text, den ein Skill weiterreicht");
    assert.match(res.stderr, /--fenster/);
  });
});
