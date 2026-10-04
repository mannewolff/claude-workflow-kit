// Die Dauer je Pruefkommando (Issue #747, Plan #745, Entscheidung E3).
//
// Die Auswertung soll sagen, welche Pflichtpruefung wie oft lief und wie viel
// Zeit sie verbraucht hat. `checks.mjs` misst das selbst, statt es aus der
// Werkzeugzeit des Session-Stroms herauszulesen: Der Strom kennt nur "ein
// Bash-Aufruf dauerte n Sekunden", nicht welches konfigurierte Kommando darin
// lief.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mitRepo, plan, run, zusammenfassung, datei } from "./helpers/checks-repo.mjs";

test("[checks-4] zwei gruene Kommandos tragen je eine gemessene Dauer, die Summe steht in dauerGesamtMs", () => {
  const config = {
    buildChecks: [
      { cmd: "echo eins", always: true },
      { cmd: "echo zwei", always: true },
    ],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    const summary = zusammenfassung(dir);
    for (const eintrag of summary.laufen) {
      assert.ok(Number.isFinite(eintrag.dauerMs), `dauerMs fuer ${eintrag.cmd} ist keine endliche Zahl`);
      assert.ok(eintrag.dauerMs >= 0, `dauerMs fuer ${eintrag.cmd} ist negativ`);
    }
    const summe = summary.laufen.reduce((s, eintrag) => s + eintrag.dauerMs, 0);
    assert.equal(summary.dauerGesamtMs, summe);
  });
});

test("[checks-4] ein roter erster Lauf misst nur das gestartete Kommando, der Rest traegt dauerMs: null", () => {
  const config = {
    buildChecks: [
      { cmd: "exit 1", always: true },
      { cmd: "echo nie", always: true },
    ],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    const res = run(dir);

    assert.notEqual(res.status, 0, "ein roter Check muss den Exit-Code rot faerben");
    const summary = zusammenfassung(dir);
    const [erster, zweiter] = summary.laufen;
    assert.equal(erster.ergebnis, "rot");
    assert.ok(Number.isFinite(erster.dauerMs), "das rote Kommando traegt keine gemessene Dauer");
    assert.equal(zweiter.ergebnis, "nicht gestartet");
    assert.equal(zweiter.dauerMs, null, "ein nicht gestartetes Kommando muss null tragen, nie 0");
    assert.equal(summary.dauerGesamtMs, erster.dauerMs, "dauerGesamtMs summiert nur die gemessenen");
  });
});

test("[checks-4] leeres Paket traegt dauerGesamtMs: null, nicht 0", () => {
  const config = {
    buildChecks: [{ cmd: "echo nie", always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    const res = run(dir);

    assert.equal(res.status, 0, `leeres Paket ist kein Fehler: ${res.stderr}`);
    const summary = zusammenfassung(dir);
    assert.equal(summary.leeresPaket, true);
    assert.equal(summary.dauerGesamtMs, null);
  });
});

test("[checks-4] die Feldmenge der Zusammenfassung bleibt vollstaendig, dauerGesamtMs kommt hinzu", () => {
  const config = {
    buildChecks: [{ cmd: "echo eins", always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    run(dir);
    const summary = zusammenfassung(dir);

    assert.deepEqual(
      Object.keys(summary).sort(),
      [
        "abgeschlossen", "abschluss", "ausgelassen", "basis", "bereichWahl", "bereiche", "berichtszeilen",
        "configHash",
        "dauerGesamtMs", "geaendert", "hashes", "hinweise", "laufen", "leeresPaket", "ohnePruefung", "ohneZuordnung",
        "stufe", "vollerUmfang", "wartezeitMs", "zeitpunkt",
      ],
    );
  });
});

test("[checks-4] checks.mjs plan traegt weder dauerMs noch dauerGesamtMs — die Dauer entsteht erst bei run", () => {
  const config = {
    buildChecks: [{ cmd: "echo eins", always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.dauerGesamtMs, undefined);
    for (const eintrag of ergebnis.laufen) {
      assert.equal(eintrag.dauerMs, undefined);
    }
  });
});

test("[checks-4] die Fliesstext-Ausgabe von run bleibt unveraendert — keine Zeitzeile ausser 'Wartezeit:' im Berichtsblock", () => {
  const config = {
    buildChecks: [{ cmd: "echo eins", always: true }],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\n\$ echo eins — als immer laufend festgelegt\n/);
    assert.match(res.stdout, /\n-> gruen\n/);
    assert.doesNotMatch(res.stdout, /dauer/i);
    const zeitzeilen = res.stdout.split("\n").filter((z) => /wartezeit|\d s\b/i.test(z) && !z.startsWith("gelaufen: "));
    assert.deepEqual(zeitzeilen.length, 1, `genau eine Zeitzeile erwartet:\n${res.stdout}`);
    const zeilen = res.stdout.split("\n");
    assert.match(zeilen[zeilen.indexOf("Fuer den Abschlussbericht:") + 1], /^Wartezeit: [\d.]+ s$/);
  });
});

// Die Wartezeit des Laufs (Issue #1069, Plan #1066, A7, E4): Wanduhr vom Aufruf bis
// zum Ergebnis. Heute laufen die Kommandos nacheinander, also ist sie mindestens die
// Summe der Wartezeiten der Kommandos; laufen sie spaeter gleichzeitig, bleibt sie
// die Zeit, auf die jemand gewartet hat, waehrend dauerGesamtMs die Summe bleibt.
test("[checks-4] wartezeitMs ist die Wanduhr des Laufs, bei zwei wartenden Kommandos mindestens deren Summe", () => {
  const warten = (ms) => `node -e "setTimeout(() => {}, ${ms})"`;
  const config = {
    buildChecks: [
      { cmd: warten(200), always: true },
      { cmd: warten(250), always: true },
    ],
    checkAreas: { kern: ["src/**"] },
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/a.txt");

    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    const summary = zusammenfassung(dir);
    assert.ok(Number.isFinite(summary.wartezeitMs), `wartezeitMs fehlt: ${JSON.stringify(summary)}`);
    assert.ok(summary.wartezeitMs >= 450, `wartezeitMs ${summary.wartezeitMs} unter der Summe der Wartezeiten`);
    assert.ok(summary.wartezeitMs >= summary.dauerGesamtMs, "die Wanduhr umfasst die Einzeldauern");
    assert.equal(summary.dauerGesamtMs, summary.laufen.reduce((s, e) => s + e.dauerMs, 0),
      "dauerGesamtMs bleibt die Summe der Einzeldauern");
  });
});
