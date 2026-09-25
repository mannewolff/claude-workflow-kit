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
        "abgeschlossen", "ausgelassen", "basis", "bereiche", "configHash", "dauerGesamtMs",
        "geaendert", "hashes", "laufen", "leeresPaket", "ohneZuordnung", "stufe", "vollerUmfang",
        "zeitpunkt",
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

test("[checks-4] die Fliesstext-Ausgabe von run bleibt unveraendert — keine zusaetzliche Zeitzeile", () => {
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
  });
});
