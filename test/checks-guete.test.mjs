// Die Guetemessung: Auswertung und Marke (Issue #763, Plan #753).
//
// Aus der Ausgabe eines Kommandos wird ueber das Pflichtmuster ein Anteil, und
// aus dem Vergleich mit der Marke wird gruen oder rot. Drei Stellen sind leicht
// falsch, und jede irrt in die stille Richtung:
//   - Ein nicht auswertbares Ergebnis, das als gruen durchgeht. AK 11 des
//     Fachplans (#738) sagt: Ein fehlendes Ergebnis gilt nie als bestandene
//     Pruefung — kein Treffer ist rot, nicht gruen mit Warnung.
//   - Eine Guetemessung, die bei push oder merge ausgelassen wird. AK 8 macht
//     ihr Ergebnis fuer den Stand massgeblich, der veroeffentlicht werden soll;
//     eine ausgelassene Messung liesse den Halt ins Leere laufen.
//   - Zwei Marken oder eine Messung erst an der Freigabestufe. Beides ist ein
//     Konfigurationsfehler und bricht ab, statt still eine Wahl zu treffen.
//
// Die Kommandos schreiben ihre Messwerte selbst (node -e), damit die Tests auf
// POSIX und Windows dieselbe Ausgabe sehen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  mitRepo, checks, plan, run, zusammenfassung, datei, eintrag, kommandos,
} from "./helpers/checks-repo.mjs";

const MUSTER = String.raw`\((\d+)%\)`;

/** Ein Kommando im PIT-Format: `Killed 42 (84%)` in der Ausgabe. */
const MISST_84 = `node -e "console.log('Killed 42 (84%)')"`;

/** Ein Kommando ohne Prozentangabe — das Muster findet nichts. */
const OHNE_ANTEIL = `node -e "console.log('BUILD SUCCESS')"`;

const BEREICHE = { frontend: ["frontend/**"], backend: ["backend/**"] };

function gueteConfig(marke, eintragExtra = {}) {
  return {
    buildChecks: [{ cmd: MISST_84, always: true, guete: { muster: MUSTER, marke }, ...eintragExtra }],
    checkAreas: BEREICHE,
  };
}

test("[checks-6] 84 % gegen Marke 80: gruen, und die Zeile nennt beide Werte", () => {
  mitRepo({ config: gueteConfig(80) }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.equal(res.status, 0, `der Lauf haette gruen sein muessen: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /Guete: 84 % erreicht, Marke 80 % — genuegt/);
    assert.equal(eintrag(zusammenfassung(dir).laufen, MISST_84).ergebnis, "gruen");
  });
});

test("[checks-6] 84 % gegen Marke 90: rot, und der Lauf bricht wie bei jedem roten Kommando ab", () => {
  const config = gueteConfig(90);
  config.buildChecks.push({ cmd: "echo x > danach.txt", always: true });
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.notEqual(res.status, 0, "eine verfehlte Marke muss den Exit-Code rot faerben");
    assert.match(res.stdout, /Guete: 84 % erreicht, Marke 90 % — unter der Marke/);
    assert.ok(!existsSync(join(dir, "danach.txt")), "nach der verfehlten Marke darf nichts mehr starten");
    const summary = zusammenfassung(dir);
    assert.equal(eintrag(summary.laufen, MISST_84).ergebnis, "rot");
    assert.equal(eintrag(summary.laufen, "echo x > danach.txt").ergebnis, "nicht gestartet");
  });
});

test("[checks-6] trifft das Muster nicht, ist das Ergebnis rot mit dem Grund im Text — nicht gruen", () => {
  const config = {
    buildChecks: [{ cmd: OHNE_ANTEIL, always: true, guete: { muster: MUSTER, marke: 80 } }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.notEqual(res.status, 0, "ein nicht auswertbares Ergebnis darf nie als bestanden gelten");
    assert.match(res.stdout, /Guete: kein auswertbares Ergebnis \(.+\)/);
    const guete = zusammenfassung(dir).guete;
    assert.equal(guete.anteil, null);
    assert.equal(guete.erfuellt, false);
    assert.match(guete.grund, /trifft/, "der Grund nennt das nicht treffende Muster nicht");
  });
});

test("[checks-6] war das Kommando selbst rot, bleibt es rot, und die Guete-Zeile nennt den fehlenden Anteil", () => {
  const config = {
    buildChecks: [{ cmd: "exit 1", always: true, guete: { muster: MUSTER, marke: 80 } }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /kein Anteil erhoben/);
    const summary = zusammenfassung(dir);
    assert.equal(eintrag(summary.laufen, "exit 1").ergebnis, "rot");
    assert.equal(summary.guete.anteil, null);
    assert.equal(summary.guete.erfuellt, false);
    assert.match(summary.guete.grund, /rot/, "der Grund nennt das rote Kommando nicht");
  });
});

test("[checks-6] bei --stufe push laeuft die Guetemessung auch im unberuehrten Bereich", () => {
  const config = gueteConfig(80, { always: undefined, areas: ["backend"] });
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir, "--stufe", "push");

    assert.ok(kommandos(ergebnis.laufen).includes(MISST_84), "die Guetemessung laeuft nicht");
    assert.equal(
      eintrag(ergebnis.laufen, MISST_84).grund,
      "Guetemessung: laeuft vor dem Veroeffentlichen immer",
    );
  });
});

test("[checks-6] bei --stufe push laeuft die Guetemessung auch dann, wenn das Paket leer waere", () => {
  mitRepo({ config: gueteConfig(80) }, (dir) => {
    const ergebnis = plan(dir, "--stufe", "push");

    // Seit Issue #849 faehrt die Push-Stufe ohnehin jede faellige Pruefung, und
    // `leeresPaket` bleibt dort false. Die Guetemessung behaelt trotzdem ihren
    // EIGENEN Grund: Ihre Regel steht in `verteilen` vor der Stufenauswahl und
    // gilt damit unabhaengig davon, welche Auswahlbahn `planen` nimmt.
    assert.equal(ergebnis.leeresPaket, false, "an der Push-Stufe greift die Leerpaket-Auslassung nicht");
    assert.deepEqual(ergebnis.geaendert, [], "das Paket ist trotzdem leer, und das steht auch so da");
    assert.deepEqual(kommandos(ergebnis.laufen), [MISST_84]);
    assert.equal(
      eintrag(ergebnis.laufen, MISST_84).grund,
      "Guetemessung: laeuft vor dem Veroeffentlichen immer",
    );
  });
});

test("[checks-6] bei --stufe merge traegt die Guetemessung ihren eigenen Grund", () => {
  mitRepo({ config: gueteConfig(80) }, (dir) => {
    const ergebnis = plan(dir, "--stufe", "merge");

    assert.equal(
      eintrag(ergebnis.laufen, MISST_84).grund,
      "Guetemessung: laeuft vor dem Veroeffentlichen immer",
    );
  });
});

test("[checks-6] an der Paketstufe gilt die normale Auswahl: ein unberuehrter Bereich laesst die Messung aus", () => {
  const config = gueteConfig(80, { always: undefined, areas: ["backend"] });
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const ergebnis = plan(dir);

    assert.deepEqual(ergebnis.laufen, [], "an der Paketstufe gibt es keine Sonderrolle");
    assert.match(eintrag(ergebnis.ausgelassen, MISST_84).grund, /unberuehrt/);
  });
});

test("[checks-6] zwei Eintraege mit guete beenden das Kommando mit Exit ungleich 0", () => {
  const config = {
    buildChecks: [
      { cmd: "echo a", always: true, guete: { muster: MUSTER, marke: 80 } },
      { cmd: "echo b", always: true, guete: { muster: MUSTER, marke: 70 } },
    ],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    const res = checks(dir, "plan");

    assert.notEqual(res.status, 0, "zwei Guetemessungen duerfen nicht still durchgehen");
    assert.match(res.stderr, /Guetemessung/);
  });
});

test("[checks-6] ein guete-Eintrag mit stufe merge beendet das Kommando mit Exit ungleich 0", () => {
  const config = gueteConfig(80, { stufe: "merge" });
  mitRepo({ config }, (dir) => {
    const res = checks(dir, "plan");

    assert.notEqual(res.status, 0, "eine Messung erst an der Freigabestufe kaeme zu spaet");
    assert.match(res.stderr, /merge/);
  });
});

test("[checks-6] die Zusammenfassung traegt das Feld guete mit allen fuenf Unterfeldern — auch beim gruenen Lauf", () => {
  mitRepo({ config: gueteConfig(80) }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.equal(run(dir).status, 0);
    const guete = zusammenfassung(dir).guete;

    assert.deepEqual(guete, {
      cmd: MISST_84,
      anteil: 84,
      marke: 80,
      erfuellt: true,
      grund: "genuegt",
    });
  });
});

test("[checks-6] ohne guete-Eintrag traegt die Zusammenfassung kein guete-Feld", () => {
  const config = { buildChecks: ["echo lint"], checkAreas: BEREICHE };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.equal(run(dir).status, 0);

    assert.ok(!("guete" in zusammenfassung(dir)), "ein Projekt ohne Benennung bleibt unberuehrt");
  });
});

test("[checks-6] eine ausgelassene Guetemessung steht mit ihrem Grund im guete-Feld — nie als bestanden", () => {
  // Auch die Auslassung an der Paketstufe ist ein Ergebnis und kein Loch: Wer
  // die Zusammenfassung liest, sieht, dass kein Anteil erhoben wurde.
  const config = gueteConfig(80, { always: undefined, areas: ["backend"] });
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    assert.equal(run(dir).status, 0);
    const guete = zusammenfassung(dir).guete;

    assert.equal(guete.anteil, null);
    assert.equal(guete.erfuellt, false);
    assert.match(guete.grund, /ausgelassen/);
  });
});

// --- Was gar kein Anteil ist (Issue #817) ---
//
// Bis hierher galt jede endliche Zahl als Messwert. `Number("")` und
// `Number("   ")` sind aber 0, und 0 genuegt jeder Marke 0 — eine leere Gruppe
// bescheinigte so eine Messung, die es nie gab. Und einen Anteil von 184
// Prozent meldet kein Werkzeug; er entsteht aus einem verbogenen Muster und
// traegt darum keine Aussage ueber die Guete. Beides ist "nicht auswertbar" im
// Sinne von checks-6 und damit rot, nicht gruen.

/** Ein Kommando mit einem Anteil ausserhalb von 0 bis 100. */
const MISST_184 = `node -e "console.log('Killed 99 (184%)')"`;

/** Ein Kommando, dessen Ausgabe nur Leerzeichen in die Gruppe legt. */
const MISST_LEERZEICHEN = `node -e "console.log('Score:   84')"`;

test("[checks-9] ein Anteil ueber 100 gilt als nicht auswertbar und faerbt den Lauf rot", () => {
  const config = {
    buildChecks: [{ cmd: MISST_184, always: true, guete: { muster: MUSTER, marke: 80 } }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.notEqual(res.status, 0, "184 % ist kein Messwert und darf nicht als bestanden gelten");
    assert.match(res.stdout, /Guete: kein auswertbares Ergebnis \(.+\)/);
    const guete = zusammenfassung(dir).guete;
    assert.equal(guete.anteil, null);
    assert.equal(guete.erfuellt, false);
    assert.match(guete.grund, /184/, "der Grund nennt den gefundenen Wert nicht");
    assert.match(guete.grund, /0 bis 100/, "der Grund nennt den erlaubten Bereich nicht");
  });
});

test("[checks-9] ein negativer Anteil gilt ebenso als nicht auswertbar", () => {
  const config = {
    buildChecks: [{
      cmd: `node -e "console.log('Score: -5')"`,
      always: true,
      guete: { muster: String.raw`Score: (-?\d+)`, marke: 0 },
    }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.notEqual(res.status, 0, "ein negativer Anteil darf nicht als bestanden gelten");
    assert.equal(zusammenfassung(dir).guete.anteil, null);
  });
});

test("[checks-9] eine leere Gruppe gegen Marke 0 ist rot — nicht gruen mit Anteil 0", () => {
  const config = {
    buildChecks: [{ cmd: OHNE_ANTEIL, always: true, guete: { muster: String.raw`(\d*)`, marke: 0 } }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.notEqual(res.status, 0, "eine leere Gruppe ist kein Messwert");
    assert.match(res.stdout, /Guete: kein auswertbares Ergebnis \(.+\)/);
    const guete = zusammenfassung(dir).guete;
    assert.equal(guete.anteil, null);
    assert.equal(guete.erfuellt, false);
    assert.match(guete.grund, /leer/, "der Grund nennt die leere Gruppe nicht");
  });
});

test("[checks-9] eine Gruppe aus lauter Leerzeichen gegen Marke 0 ist rot", () => {
  const config = {
    buildChecks: [{
      cmd: MISST_LEERZEICHEN,
      always: true,
      guete: { muster: String.raw`Score:(\s*)`, marke: 0 },
    }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.notEqual(res.status, 0, "Leerzeichen sind kein Messwert");
    const guete = zusammenfassung(dir).guete;
    assert.equal(guete.anteil, null);
    assert.equal(guete.erfuellt, false);
    assert.match(guete.grund, /leer/);
  });
});

test("[checks-9] 100 % gegen Marke 100 bleibt gruen — die obere Grenze gehoert dazu", () => {
  const config = {
    buildChecks: [{
      cmd: `node -e "console.log('Killed 9 (100%)')"`,
      always: true,
      guete: { muster: MUSTER, marke: 100 },
    }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.equal(res.status, 0, `100 % gegen Marke 100 haette gruen sein muessen: ${res.stdout}${res.stderr}`);
    assert.equal(zusammenfassung(dir).guete.anteil, 100);
  });
});

test("[checks-9] 0 % gegen Marke 0 bleibt gruen, solange die Null wirklich gemessen wurde", () => {
  const config = {
    buildChecks: [{
      cmd: `node -e "console.log('Killed 0 (0%)')"`,
      always: true,
      guete: { muster: MUSTER, marke: 0 },
    }],
    checkAreas: BEREICHE,
  };
  mitRepo({ config }, (dir) => {
    datei(dir, "frontend/src/App.tsx");

    const res = run(dir);

    assert.equal(res.status, 0, `0 % gegen Marke 0 haette gruen sein muessen: ${res.stdout}${res.stderr}`);
    const guete = zusammenfassung(dir).guete;
    assert.equal(guete.anteil, 0);
    assert.equal(guete.erfuellt, true);
  });
});
