// Die gestaffelte Auswahl nach `stufe` (Issue #758).
//
// Die Bereichsauswahl beantwortet „ist diese Pruefung betroffen", die Stufe
// beantwortet „ist sie jetzt an der Reihe". Beide Fragen zusammen entscheiden,
// was laeuft — und jede Auslassung ist still, wenn sie keinen Grund traegt.
// Deshalb prueft jeder Test hier nicht nur, WAS laeuft, sondern auch, WARUM das
// Uebrige nicht laeuft.
//
// Zwei Stellen sind besonders leicht falsch und beide fallen niemandem auf:
//   - Ein unbekannter Stufenwert, der stillschweigend als `paket` durchgeht.
//     Dann laeuft weniger als gedacht, und der Aufrufer glaubt, er habe die
//     Push-Stufe gefahren.
//   - Die Freigabestufe, an der eine Bereichs- oder Leerpaket-Auslassung greift.
//     Dann laeuft vor der Freigabe genau das nicht, wofuer die Stufe da ist.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mitRepo, plan, run, checks, zusammenfassung, datei, eintrag, kommandos,
} from "./helpers/checks-repo.mjs";

const BEREICHE = { frontend: ["frontend/**"], backend: ["backend/**"] };

/** Die drei Stufen an einem Beispiel: je eine Pruefung, alle ohne Bereichsbindung. */
const DREI_STUFEN = {
  buildChecks: [
    { cmd: "echo paket" },
    { cmd: "echo push", stufe: "push" },
    { cmd: "echo merge", stufe: "merge" },
  ],
  checkAreas: BEREICHE,
};

/** Die Stufe je Kommando aus einer Ergebnisliste — Reihenfolge wie in der Config. */
function stufen(liste) {
  return liste.map((e) => e.stufe);
}

test("[checks-5] ein unbekannter Stufenwert endet rot und nennt die drei zulaessigen", () => {
  mitRepo({ config: DREI_STUFEN }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = checks(dir, "plan", "--stufe", "abend");

    assert.notEqual(res.status, 0, "ein unbekannter Stufenwert darf nicht als 'paket' durchgehen");
    for (const name of ["paket", "push", "merge"]) {
      assert.match(res.stderr, new RegExp(name), `die Meldung nennt '${name}' nicht`);
    }
  });
});

test("[checks-5] --stufe ohne Wert endet rot und faellt nicht auf die Paketstufe zurueck", () => {
  mitRepo({ config: DREI_STUFEN }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = checks(dir, "plan", "--stufe");

    assert.notEqual(res.status, 0, "ein fehlender Wert ist keine gueltige Stufe");
  });
});

test("[checks-5] ohne --stufe gilt die Paketstufe: String, Objekt ohne stufe und stufe 'paket' sind gleichwertig", () => {
  // Der Regressionsschutz des Pakets: Wer nichts angibt, bekommt genau die
  // Auswahl von vorher — und die drei Schreibweisen derselben Aussage muessen
  // in derselben Bahn landen, sonst waere die Stufenangabe eine stille
  // Verhaltensaenderung fuer bestehende Konfigurationen.
  const config = {
    buildChecks: ["echo a", { cmd: "echo b" }, { cmd: "echo c", stufe: "paket" }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.stufe, "paket");
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo a", "echo b", "echo c"]);
    assert.deepEqual(ergebnis.ausgelassen, []);
    assert.deepEqual(stufen(ergebnis.laufen), ["paket", "paket", "paket"]);
    for (const cmd of ["echo a", "echo b", "echo c"]) {
      assert.match(eintrag(ergebnis.laufen, cmd).grund, /nicht zugeordnet/);
    }
  });
});

test("[checks-5] die Paketstufe laesst eine Pruefung spaeterer Stufe mit Grund aus", () => {
  mitRepo({ config: DREI_STUFEN }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--stufe", "paket");

    assert.deepEqual(kommandos(ergebnis.laufen), ["echo paket"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["echo push", "echo merge"]);
    assert.equal(eintrag(ergebnis.ausgelassen, "echo push").grund, "Stufe push, gefahren wird paket");
    assert.equal(eintrag(ergebnis.ausgelassen, "echo merge").grund, "Stufe merge, gefahren wird paket");
  });
});

test("[checks-5] die Push-Stufe faehrt die Paketstufe mit, die Freigabestufe nicht", () => {
  mitRepo({ config: DREI_STUFEN }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--stufe", "push");

    assert.equal(ergebnis.stufe, "push");
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo paket", "echo push"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["echo merge"]);
    assert.equal(eintrag(ergebnis.ausgelassen, "echo merge").grund, "Stufe merge, gefahren wird push");
  });
});

test("[checks-5] die Stufe greift vor der Bereichsauswahl: eine Push-Pruefung bleibt auch im beruehrten Bereich aus", () => {
  const config = {
    buildChecks: [{ cmd: "echo e2e", areas: ["frontend"], stufe: "push" }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.bereiche, ["frontend"], "der Bereich ist beruehrt");
    assert.deepEqual(ergebnis.laufen, [], "die Stufe entscheidet vor dem Bereich");
    assert.equal(eintrag(ergebnis.ausgelassen, "echo e2e").grund, "Stufe push, gefahren wird paket");
  });
});

test("[checks-5] die Freigabestufe faehrt alles, auch bei unberuehrten Bereichen", () => {
  const config = {
    buildChecks: [
      { cmd: "echo build", areas: ["frontend"] },
      { cmd: "echo verify", areas: ["backend"] },
      { cmd: "echo release", stufe: "merge" },
    ],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--stufe", "merge");

    assert.deepEqual(kommandos(ergebnis.laufen), ["echo build", "echo verify", "echo release"]);
    assert.deepEqual(ergebnis.ausgelassen, []);
    for (const cmd of ["echo build", "echo verify", "echo release"]) {
      assert.equal(eintrag(ergebnis.laufen, cmd).grund, "Freigabestufe: voller Umfang");
    }
  });
});

test("[checks-5] die Freigabestufe faehrt alles, auch wenn das Paket leer ist", () => {
  mitRepo({ config: DREI_STUFEN }, (dir) => {
    const ergebnis = plan(dir, "--stufe", "merge");

    assert.equal(ergebnis.leeresPaket, false, "an der Freigabestufe greift die Leerpaket-Auslassung nicht");
    assert.deepEqual(ergebnis.geaendert, [], "das Paket ist trotzdem leer, und das steht auch so da");
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo paket", "echo push", "echo merge"]);
    assert.deepEqual(ergebnis.ausgelassen, []);
  });
});

test("[checks-5] die Freigabestufe bestimmt basis, geaendert und hashes wie ein Lauf ohne das Flag", () => {
  const config = {
    buildChecks: [{ cmd: "echo paket" }, { cmd: "echo release", stufe: "merge" }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.equal(run(dir).status, 0);
    const ohneFlag = zusammenfassung(dir);
    assert.equal(run(dir, "--stufe", "merge").status, 0);
    const mitFlag = zusammenfassung(dir);

    assert.equal(mitFlag.basis, ohneFlag.basis);
    assert.deepEqual(mitFlag.geaendert, ohneFlag.geaendert);
    assert.deepEqual(mitFlag.hashes, ohneFlag.hashes);
    // Nur die Auswahl unterscheidet sich — der Nachweis, gegen den das
    // Commit-Gate den Index prueft, bleibt derselbe (gate-1).
    assert.deepEqual(kommandos(ohneFlag.laufen), ["echo paket"]);
    assert.deepEqual(kommandos(mitFlag.laufen), ["echo paket", "echo release"]);
  });
});

test("[checks-5] die Push-Stufe nennt die hinzukommenden Pruefungen vor dem ersten Kommando", () => {
  mitRepo({ config: DREI_STUFEN }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir, "--stufe", "push");

    assert.equal(res.status, 0, res.stderr);
    const ankuendigung = res.stdout.indexOf("Stufe push");
    assert.notEqual(ankuendigung, -1, "die Ankuendigung fehlt");
    const erstesKommando = res.stdout.indexOf("$ echo paket");
    assert.notEqual(erstesKommando, -1, "das erste Kommando fehlt in der Ausgabe");
    assert.ok(ankuendigung < erstesKommando, "die Ankuendigung steht nicht vor dem ersten Kommando");
    const zeile = res.stdout.slice(ankuendigung, res.stdout.indexOf("\n", ankuendigung));
    assert.match(zeile, /echo push/, "die Ankuendigung nennt die hinzukommende Pruefung nicht");
    assert.doesNotMatch(zeile, /echo paket/, "die Paketstufe kommt nicht hinzu");
  });
});

test("[checks-5] die Paketstufe kuendigt nichts an — der haeufigste Lauf bleibt still", () => {
  mitRepo({ config: DREI_STUFEN }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /Stufe paket/, "die Paketstufe kuendigt eine Stufe an");
    assert.doesNotMatch(res.stdout, /zusaetzlich/, "die Paketstufe kuendigt Hinzukommendes an");
  });
});

test("[checks-5] die Zusammenfassung traegt die Stufe des Laufs und je Eintrag dessen Stufe", () => {
  mitRepo({ config: DREI_STUFEN }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.equal(run(dir, "--stufe", "push").status, 0);
    const summary = zusammenfassung(dir);

    assert.equal(summary.stufe, "push");
    assert.deepEqual(stufen(summary.laufen), ["paket", "push"]);
    assert.deepEqual(stufen(summary.ausgelassen), ["merge"]);
  });
});

test("[checks-5] die Nutzungshilfe nennt --stufe mit allen drei Werten", () => {
  mitRepo({ config: DREI_STUFEN }, (dir) => {
    const res = checks(dir, "--help");

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /--stufe/);
    for (const name of ["paket", "push", "merge"]) {
      assert.match(res.stdout, new RegExp(name), `die Nutzungshilfe nennt '${name}' nicht`);
    }
  });
});
