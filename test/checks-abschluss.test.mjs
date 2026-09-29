// Der Abschlusslauf und die Achse `nichtBeimAbschluss` (Issue #946, Plan #944).
//
// Bis hierher trug jeder Abschluss eines Arbeitspakets den vollen Paketumfang —
// auch die Pruefungen, die nur das Zusammenspiel pruefen oder ihren Befund aus der
// vollstaendigen Testmenge gewinnen. Die vierte Achse am Eintrag sagt, DASS eine
// Pruefung erst beim Veroeffentlichen zaehlt; `--abschluss` am Aufruf sagt, dass
// dieser Lauf genau ein Arbeitspaket abschliesst.
//
// Drei Stellen sind leicht falsch, und jede irrt in die stille Richtung:
//   - Ein Grund, der auf die falsche Ursache zeigt. Zweig (4) muss vor der
//     Bereichsauswahl stehen, sonst liest man "Bereich unberuehrt", wo die Pruefung
//     auch im beruehrten Bereich nicht gelaufen waere.
//   - Ein Abschlusslauf, der das Ergebnis eines vollen Laufs uebernimmt (oder
//     umgekehrt). Basis, Stufe, Dateien und Hashes sind dieselben — nur die Auswahl
//     ist eine andere, und ohne das Feld in der Zusammenfassung faellt das niemandem
//     auf.
//   - Eine Config, in der beim Abschluss keine einzige Pruefung mehr uebrig bleibt.
//     Dann hat die Umsetzung eines Arbeitspakets kein Gate, und der Lauf ist gruen,
//     weil er nichts gefahren hat.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mitRepo, plan, run, checks, zusammenfassung, datei, eintrag, kommandos,
} from "./helpers/checks-repo.mjs";
import { UEBERNAHME_MARKE } from "../kit/checks.mjs";

const BEREICHE = { frontend: ["frontend/**"], backend: ["backend/**"] };

const MUSTER = String.raw`\((\d+)%\)`;
const MISST_84 = `node -e "console.log('Killed 42 (84%)')"`;

/** Eine Einheitenpruefung und je eine Pruefung mit einem der beiden Feldwerte. */
const DREI = {
  buildChecks: [
    { cmd: "echo einheit", areas: ["frontend"] },
    { cmd: "echo zusammenspiel", areas: ["frontend"], nichtBeimAbschluss: "zusammenspiel" },
    { cmd: "echo volle-menge", areas: ["frontend"], nichtBeimAbschluss: "volleTestmenge" },
  ],
  checkAreas: BEREICHE,
};

/** Eine Einheitenpruefung neben einer Guetemessung der Paketstufe. */
const MIT_GUETE = {
  buildChecks: [
    { cmd: "echo einheit", always: true },
    { cmd: MISST_84, always: true, guete: { muster: MUSTER, marke: 80 } },
  ],
  checkAreas: BEREICHE,
};

test("ohne --abschluss laufen die Pruefungen mit nichtBeimAbschluss unveraendert mit", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.equal(ergebnis.abschluss, false);
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo einheit", "echo zusammenspiel", "echo volle-menge"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), []);
  });
});

test("--abschluss laesst beide Feldwerte mit sprechendem Grund aus", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--abschluss", "946");

    assert.equal(ergebnis.abschluss, true);
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo einheit"]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), ["echo zusammenspiel", "echo volle-menge"]);
    assert.equal(
      eintrag(ergebnis.ausgelassen, "echo zusammenspiel").grund,
      "Abschlusslauf: zusammenspiel, laeuft beim Veroeffentlichen",
    );
    assert.equal(
      eintrag(ergebnis.ausgelassen, "echo volle-menge").grund,
      "Abschlusslauf: volleTestmenge, laeuft beim Veroeffentlichen",
    );
  });
});

test("--abschluss ohne Kartennummer waehlt dieselbe Auswahl", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--abschluss");

    assert.equal(ergebnis.abschluss, true);
    assert.deepEqual(kommandos(ergebnis.laufen), ["echo einheit"]);
  });
});

test("ein Wert am --abschluss, der keine Kartennummer ist, endet rot", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = checks(dir, "plan", "--abschluss", "vier");

    assert.notEqual(res.status, 0, "ein Wort statt einer Nummer darf nicht als Kartennummer durchgehen");
    assert.match(res.stderr, /vier/);
  });
});

test("der Grund steht auch in der Zusammenfassung des Laufs", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir, "--abschluss", "946");

    assert.equal(res.status, 0, `der Lauf haette gruen sein muessen: ${res.stdout}${res.stderr}`);
    const summary = zusammenfassung(dir);
    assert.equal(summary.abschluss, true);
    assert.equal(
      eintrag(summary.ausgelassen, "echo zusammenspiel").grund,
      "Abschlusslauf: zusammenspiel, laeuft beim Veroeffentlichen",
    );
    assert.match(res.stdout, /ausgelassen: echo zusammenspiel — Abschlusslauf: zusammenspiel, laeuft beim Veroeffentlichen/);
  });
});

test("beim Veroeffentlichen laeuft die ausgelassene Pruefung wieder mit", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--stufe", "push");

    assert.deepEqual(kommandos(ergebnis.laufen), ["echo einheit", "echo zusammenspiel", "echo volle-menge"]);
  });
});

test("--abschluss zusammen mit --stufe push oder merge endet rot", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    for (const stufe of ["push", "merge"]) {
      const res = checks(dir, "plan", "--abschluss", "946", "--stufe", stufe);
      assert.notEqual(res.status, 0, `--abschluss mit --stufe ${stufe} darf nicht durchgehen`);
      assert.match(res.stderr, /--abschluss/);
    }
    // Auch in der anderen Reihenfolge, damit die Pruefung nicht an der Stellung haengt.
    const umgekehrt = checks(dir, "plan", "--stufe", "push", "--abschluss");
    assert.notEqual(umgekehrt.status, 0);
  });
});

test("--abschluss zusammen mit --bereich endet rot", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = checks(dir, "plan", "--abschluss", "946", "--bereich", "frontend");

    assert.notEqual(res.status, 0, "--abschluss mit --bereich darf nicht durchgehen");
    assert.match(res.stderr, /--bereich/);
  });
});

test("die Guetemessung der Paketstufe wird im Abschlusslauf ausgelassen", () => {
  mitRepo({ config: MIT_GUETE }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--abschluss", "946");

    assert.deepEqual(kommandos(ergebnis.laufen), ["echo einheit"]);
    assert.equal(
      eintrag(ergebnis.ausgelassen, MISST_84).grund,
      "Abschlusslauf: Guetemessung braucht die vollstaendige Testmenge",
    );
  });
});

test("die ausgelassene Guetemessung gilt nie als bestanden", () => {
  mitRepo({ config: MIT_GUETE }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir, "--abschluss", "946");

    assert.equal(res.status, 0, `der Lauf haette gruen sein muessen: ${res.stdout}${res.stderr}`);
    const guete = zusammenfassung(dir).guete;
    assert.equal(guete.anteil, null);
    assert.equal(guete.erfuellt, false);
    assert.match(guete.grund, /ausgelassen: Abschlusslauf/);
  });
});

test("ohne --abschluss laeuft dieselbe Guetemessung wie bisher", () => {
  mitRepo({ config: MIT_GUETE }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(kommandos(ergebnis.laufen), ["echo einheit", MISST_84]);
    assert.deepEqual(kommandos(ergebnis.ausgelassen), []);
  });
});

test("eine Config ohne eine einzige Pruefung fuer den Abschluss faellt durch", () => {
  const ohneGate = {
    buildChecks: [
      { cmd: "echo zusammenspiel", always: true, nichtBeimAbschluss: "zusammenspiel" },
      { cmd: MISST_84, always: true, guete: { muster: MUSTER, marke: 80 } },
    ],
    checkAreas: BEREICHE,
  };
  mitRepo({ config: ohneGate }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = checks(dir, "plan", "--abschluss", "946");

    assert.notEqual(res.status, 0, "ein Abschluss ohne eine einzige Pruefung ist kein Gate");
    assert.match(res.stderr, /Abschluss/);

    // Dieselbe Config bleibt fuer jeden anderen Lauf gueltig: Ohne den Schalter
    // laufen beide Pruefungen, und nur der Abschluss stuende ohne Gate da.
    const ohne = plan(dir);
    assert.deepEqual(kommandos(ohne.laufen), ["echo zusammenspiel", MISST_84]);
  });
});

test("bleibt ein Paketstufen-Eintrag ohne beides, ist die Config gueltig", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.deepEqual(kommandos(plan(dir, "--abschluss", "946").laufen), ["echo einheit"]);
  });
});

test("ein unbekannter Feldwert faellt durch, auch ohne --abschluss", () => {
  const falsch = {
    buildChecks: [
      { cmd: "echo einheit", always: true },
      { cmd: "echo abends", always: true, nichtBeimAbschluss: "abends" },
    ],
    checkAreas: BEREICHE,
  };
  mitRepo({ config: falsch }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = checks(dir, "plan");

    assert.notEqual(res.status, 0, "ein unbekannter Feldwert darf nicht stillschweigend wirkungslos bleiben");
    assert.match(res.stderr, /abends/);
    for (const wert of ["zusammenspiel", "volleTestmenge"]) {
      assert.match(res.stderr, new RegExp(wert), `die Meldung nennt '${wert}' nicht`);
    }
  });
});

test("nichtBeimAbschluss an einem push- oder merge-Eintrag faellt durch", () => {
  for (const stufe of ["push", "merge"]) {
    const falsch = {
      buildChecks: [
        { cmd: "echo einheit", always: true },
        { cmd: "echo spaet", always: true, stufe, nichtBeimAbschluss: "zusammenspiel" },
      ],
      checkAreas: BEREICHE,
    };
    mitRepo({ config: falsch }, (dir) => {
      datei(dir, "frontend/src/App.tsx");

      const res = checks(dir, "plan");

      assert.notEqual(res.status, 0, `nichtBeimAbschluss an stufe '${stufe}' darf nicht durchgehen`);
      assert.match(res.stderr, new RegExp(stufe));
    });
  }
});

test("ein Abschlusslauf uebernimmt das Ergebnis eines vollen Laufs nicht", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.equal(run(dir).status, 0);
    const res = run(dir, "--abschluss", "946");

    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.ok(!res.stdout.includes(UEBERNAHME_MARKE), "der Abschlusslauf hat ein fremdes Ergebnis uebernommen");
    assert.deepEqual(kommandos(zusammenfassung(dir).laufen), ["echo einheit"]);
  });
});

test("ein voller Lauf uebernimmt das Ergebnis eines Abschlusslaufs nicht", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.equal(run(dir, "--abschluss", "946").status, 0);
    const res = run(dir);

    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.ok(!res.stdout.includes(UEBERNAHME_MARKE), "der volle Lauf hat ein eingegrenztes Ergebnis uebernommen");
    assert.deepEqual(
      kommandos(zusammenfassung(dir).laufen),
      ["echo einheit", "echo zusammenspiel", "echo volle-menge"],
    );
  });
});

test("zwei Abschlusslaeufe auf demselben Stand uebernehmen einander", () => {
  mitRepo({ config: DREI }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.equal(run(dir, "--abschluss", "946").status, 0);
    const res = run(dir, "--abschluss", "946");

    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.ok(res.stdout.includes(UEBERNAHME_MARKE), "derselbe Stand haette sein Ergebnis behalten muessen");
  });
});

test("die Hilfe nennt die Achse und den Schalter", () => {
  mitRepo({ config: DREI }, (dir) => {
    const res = checks(dir, "--help");

    assert.equal(res.status, 0);
    assert.match(res.stdout, /--abschluss/);
    assert.match(res.stdout, /nichtBeimAbschluss/);
  });
});
