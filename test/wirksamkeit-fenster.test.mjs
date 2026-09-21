// Fenstergrenze und Erhebungsbeginn (Issue #787, Plan #782, E2).
//
// Das Fenster ist `jetzt − fensterTage`, nach vorne abgeschnitten am Erhebungsbeginn —
// dem fruehesten Zeitstempel im Protokoll. Keine Konstante im Werkzeug, kein
// Config-Feld: Das Protokoll traegt seinen eigenen Anfang. Ohne den Abschnitt laese
// sich "2 Ausfuehrungen in 30 Tagen" als duenne Datenlage, wo die Erhebung schlicht
// erst seit vorgestern laeuft.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitProjekt, zeile, auswerten, pruefung, bericht } from "./helpers/wirksamkeit-fixture.mjs";

const CONFIG = { buildChecks: ["node --test"] };

test("[wirksamkeit-4] eine Zeile vor dem Fenster geht nicht ein, eine darin schon", () => {
  mitProjekt({
    config: CONFIG,
    zeilen: [
      zeile({ tage: 40, ergebnis: "rot", dauerMs: 7_000 }),
      zeile({ tage: 5, ergebnis: "gruen", dauerMs: 3_000 }),
    ],
  }, (dir) => {
    const p = pruefung(auswerten(dir), "node --test");

    assert.equal(p.ausfuehrungen, 1, "die Zeile von vor 40 Tagen liegt ausserhalb der 30-Tage-Vorgabe");
    assert.equal(p.beanstandungen, 0);
    assert.equal(p.dauerMs, 3_000);
  });
});

test("[wirksamkeit-4] beginnt die Erhebung spaeter als das Fenster, wird dort abgeschnitten und der Anfang benannt", () => {
  mitProjekt({ config: CONFIG, zeilen: [zeile({ tage: 5 })] }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.fenster.abgeschnitten, true);
    assert.equal(e.fenster.erhebungsbeginn, e.fenster.von, "das Fenster beginnt am Erhebungsbeginn");
    assert.match(bericht(dir), /beginnt erst/, "der Bericht nennt den Erhebungsbeginn nicht als Teil der Traglast");
  });
});

test("[wirksamkeit-4] reicht die Erhebung weiter zurueck als das Fenster, wird nichts abgeschnitten", () => {
  mitProjekt({ config: CONFIG, zeilen: [zeile({ tage: 40 }), zeile({ tage: 5 })] }, (dir) => {
    const e = auswerten(dir);

    assert.equal(e.fenster.abgeschnitten, false);
    assert.ok(e.fenster.erhebungsbeginn < e.fenster.von, "der Erhebungsbeginn liegt vor dem Fensterbeginn");
    assert.doesNotMatch(bericht(dir), /beginnt erst/);
  });
});

test("[wirksamkeit-4] --fenster sticht Config und Vorgabe", () => {
  mitProjekt({
    config: { ...CONFIG, wirksamkeit: { fensterTage: 30 } },
    zeilen: [zeile({ tage: 5 }), zeile({ tage: 1 })],
  }, (dir) => {
    const e = auswerten(dir, "--fenster", "2");

    assert.equal(e.fenster.tage, 2);
    assert.equal(pruefung(e, "node --test").ausfuehrungen, 1);
  });
});

test("[wirksamkeit-4] eine Aussage aus einem einzigen Lauftag wird als solche benannt", () => {
  mitProjekt({ config: CONFIG, zeilen: [zeile({ tage: 2 })] }, (dir) => {
    auswerten(dir);
    assert.match(bericht(dir), /einem einzigen Lauftag/, "die Traglast eines einzelnen Lauftags steht nicht im Bericht");
  });
});
