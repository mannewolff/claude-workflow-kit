// Die drei Zustaende je Pruefung und die Schwelle "nie beanstandet" (Issue #787).
//
// "Nicht gelaufen" ist ein EIGENER Zustand und nie ein Unterfall von "nie beanstandet":
// Eine Pruefung, die gar nicht lief, hat nichts bewiesen — weder Wirksamkeit noch
// Wirkungslosigkeit. Sie loest deshalb nie einen Befund aus und wird nie als "nie
// beanstandet" dargestellt; sonst laese sich ein vergessenes Kommando als eines, das
// zehnmal nichts fand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, zeile, auswerten, pruefung, bericht } from "./helpers/wirksamkeit-fixture.mjs";

/** n gruene Ausfuehrungen desselben Kommandos, ueber n Tage verteilt. */
function gruene(n, cmd = "node --test") {
  return Array.from({ length: n }, (_, i) => zeile({ tage: i + 1, cmd, dauerMs: 1_000 }));
}

test("[wirksamkeit-3] die drei Zustaende: mit Beanstandungen, nie beanstandet, nicht gelaufen", () => {
  mitProjekt({
    config: { buildChecks: ["node --test", "npx eslint .", "npm run mutation"] },
    zeilen: [
      zeile({ tage: 2, cmd: "node --test", ergebnis: "rot" }),
      zeile({ tage: 1, cmd: "node --test", ergebnis: "gruen" }),
      zeile({ tage: 1, cmd: "npx eslint .", ergebnis: "gruen" }),
    ],
  }, (dir) => {
    const e = auswerten(dir);

    assert.equal(pruefung(e, "node --test").zustand, "beanstandet");
    assert.equal(pruefung(e, "npx eslint .").zustand, "nie beanstandet");
    assert.equal(pruefung(e, "npm run mutation").zustand, "nicht gelaufen");
  });
});

test("[wirksamkeit-3] null Beanstandungen unter zehn Ausfuehrungen: kein Befund; ab zehn: Befund", () => {
  mitProjekt({ config: { buildChecks: ["node --test"] }, zeilen: gruene(9) }, (dir) => {
    assert.equal(auswerten(dir).befund.length, 0, "neun Ausfuehrungen liegen unter der Schwelle");
  });
  mitProjekt({ config: { buildChecks: ["node --test"] }, zeilen: gruene(10) }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.befund.length, 1, "zehn Ausfuehrungen ohne Beanstandung sind der Befund");
    assert.match(e.befund[0].text, /node --test/);
  });
});

test("[wirksamkeit-3] eine vorgeschriebene Pruefung ohne Ausfuehrung loest keinen Befund aus und heisst nirgends 'nie beanstandet'", () => {
  mitProjekt({ config: { buildChecks: ["npm run mutation"] }, zeilen: [] }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.befund.length, 0, "'nicht gelaufen' loest nie einen Befund aus");
    const zeilenMitCmd = bericht(dir).split("\n").filter((z) => z.includes("npm run mutation"));
    assert.ok(zeilenMitCmd.length > 0, "die Pruefung fehlt im Bericht");
    for (const z of zeilenMitCmd) {
      assert.doesNotMatch(z, /nie beanstandet/, `'nicht gelaufen' als 'nie beanstandet' dargestellt: ${z}`);
    }
    assert.match(zeilenMitCmd.join("\n"), /nicht gelaufen/);
  });
});

test("[wirksamkeit-3] jeder Wert aus dem Config-Block wirksamkeit sticht seine Vorgabe", () => {
  // Schwelle 3 statt 10: drei gruene Ausfuehrungen loesen jetzt den Befund aus.
  mitProjekt({
    config: { buildChecks: ["node --test"], wirksamkeit: { nieBeanstandetAbAusfuehrungen: 3 } },
    zeilen: gruene(3),
  }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.schwellen.nieBeanstandetAbAusfuehrungen, 3);
    assert.equal(e.befund.length, 1);
  });
  // Fenster 2 statt 30 Tage: die Zeile von vor 5 Tagen faellt heraus.
  mitProjekt({
    config: { buildChecks: ["node --test"], wirksamkeit: { fensterTage: 2 } },
    zeilen: [zeile({ tage: 5 }), zeile({ tage: 1 })],
  }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.fenster.tage, 2);
    assert.equal(pruefung(e, "node --test").ausfuehrungen, 1);
  });
});

test("[wirksamkeit-3] ein unbrauchbarer Config-Wert faellt auf die Vorgabe zurueck", () => {
  mitProjekt({
    config: { buildChecks: ["node --test"], wirksamkeit: { nieBeanstandetAbAusfuehrungen: "viele", fensterTage: -3 } },
    zeilen: gruene(10),
  }, (dir) => {
    const e = auswerten(dir);
    assert.equal(e.schwellen.nieBeanstandetAbAusfuehrungen, 10);
    assert.equal(e.fenster.tage, 30);
  });
});
