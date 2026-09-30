// Die Berichtszeilen von `checks.mjs run` (Issue #1003, Plan #1001, E1 bis E4, E12).
//
// Der Abschlussbericht eines Arbeitspakets verlor bisher Dauer und Grund jeder
// Pruefung, und der Grund des vollen Umfangs nannte nur die erste unzugeordnete
// Datei. Jetzt bildet das Kommando die Zeilen selbst — die Skills uebernehmen sie
// wortgetreu. Diese Datei haelt fest:
//   - den Grundtext des vollen Umfangs mit allen (hoechstens zehn) Dateien (E2),
//   - die Obergrenze je Pruefung, die nur vermerkt und nie rot faerbt (E3, E4),
//   - den Block `Fuer den Abschlussbericht:` bei rotem, gekuerztem, uebernommenem
//     und leerem Lauf (E1, E12).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  mitRepo, plan, run, datei, eintrag, zusammenfassung, CHECKS,
} from "./helpers/checks-repo.mjs";
import {
  PRUEFDAUER_OBERGRENZE_MS, OBERGRENZE_ENV, obergrenzeZusatz, dauerText,
} from "../kit/checks.mjs";

const BAU = "node -e \"console.log('frontend')\"";
const VERIFY = "node -e \"console.log('backend')\"";
const ROT = "node -e \"process.exit(3)\"";

const CONFIG = {
  buildChecks: [
    { cmd: BAU, areas: ["frontend"] },
    { cmd: VERIFY, areas: ["backend"] },
  ],
  checkAreas: {
    frontend: ["frontend/**"],
    backend: ["backend/**"],
  },
};

/** Alle Zeilen des Blocks `Fuer den Abschlussbericht:` — bis zur ersten Leerzeile. */
function vollerBlock(stdout) {
  const zeilen = stdout.split("\n");
  const start = zeilen.indexOf("Fuer den Abschlussbericht:");
  assert.notEqual(start, -1, `kein Berichtsblock in der Ausgabe:\n${stdout}`);
  const rest = zeilen.slice(start + 1);
  const ende = rest.indexOf("");
  return ende === -1 ? rest : rest.slice(0, ende);
}

/**
 * Die Pruefzeilen des Blocks, ohne die Zeile `Wartezeit:`, die ihn eroeffnet (Issue
 * #1069). Sie sind genau das Feld `berichtszeilen` der Zusammenfassung.
 */
function berichtsblock(stdout) {
  const [wartezeit, ...rest] = vollerBlock(stdout);
  assert.match(wartezeit, /^Wartezeit: /, "der Block beginnt nicht mit der Zeile 'Wartezeit:'");
  return rest;
}

/** Die Zeile `Wartezeit:` am Anfang des Blocks. */
function wartezeitZeile(stdout) {
  return vollerBlock(stdout)[0];
}

// --- Grundtext des vollen Umfangs (E2) --------------------------------------

test("zwei unzugeordnete Dateien stehen beide im Grund", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "a.txt");
    datei(dir, "b.txt");

    const ergebnis = plan(dir);

    assert.equal(eintrag(ergebnis.laufen, BAU).grund, "voller Umfang: 'a.txt', 'b.txt' treffen kein Muster");
  });
});

test("bei elf unzugeordneten Dateien nennt der Grund zehn und 'und 1 weitere', die Liste alle elf", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const namen = Array.from({ length: 11 }, (_, i) => `d${String(i + 1).padStart(2, "0")}.txt`);
    for (const n of namen) datei(dir, n);

    const ergebnis = plan(dir);

    const zehn = namen.slice(0, 10).map((n) => `'${n}'`).join(", ");
    assert.equal(eintrag(ergebnis.laufen, BAU).grund, `voller Umfang: ${zehn} und 1 weitere treffen kein Muster`);
    assert.deepEqual(ergebnis.ohneZuordnung, namen, "die Zusammenfassung traegt die volle Liste");
  });
});

test("bei genau zehn Dateien stehen alle zehn ohne Zusatz", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const namen = Array.from({ length: 10 }, (_, i) => `d${String(i + 1).padStart(2, "0")}.txt`);
    for (const n of namen) datei(dir, n);

    const grund = eintrag(plan(dir).laufen, BAU).grund;
    const liste = namen.map((n) => `'${n}'`).join(", ");

    assert.equal(grund, `voller Umfang: ${liste} treffen kein Muster`);
  });
});

// --- Obergrenze (E3, E4) ----------------------------------------------------

test("die Obergrenze ist eine Konstante von 30 s, und der Zusatz nennt die Ueberschreitung", () => {
  assert.equal(PRUEFDAUER_OBERGRENZE_MS, 30_000);
  assert.equal(obergrenzeZusatz(30_000), "", "genau an der Grenze ist nichts ueberschritten");
  assert.equal(obergrenzeZusatz(31_000), " — Obergrenze 30 s um 1 s ueberschritten");
  assert.equal(obergrenzeZusatz(45_400), " — Obergrenze 30 s um 15.4 s ueberschritten");
  assert.equal(obergrenzeZusatz(null), "", "ohne Messung keine Ueberschreitung");
});

test("die Dauer steht in Sekunden mit einer Nachkommastelle, fehlend als 'Dauer nicht gemessen'", () => {
  assert.equal(dauerText(0), "0 s");
  assert.equal(dauerText(1234), "1.2 s");
  assert.equal(dauerText(30_000), "30 s");
  assert.equal(dauerText(null), "Dauer nicht gemessen");
});

test("eine Pruefung ueber der Grenze traegt den Zusatz und ueberObergrenzeMs, der Lauf bleibt gruen", () => {
  const langsam = "node -e \"setTimeout(() => {}, 300)\"";
  mitRepo({ config: { buildChecks: [langsam] } }, (dir) => {
    datei(dir, "a.txt");

    const res = spawnSync(process.execPath, [CHECKS, "run"], {
      cwd: dir, encoding: "utf-8", env: { ...process.env, [OBERGRENZE_ENV]: "100" },
    });

    assert.equal(res.status, 0, `die Ueberschreitung faerbt nicht rot:\n${res.stdout}${res.stderr}`);
    const [zeile] = berichtsblock(res.stdout);
    assert.match(zeile, /^gelaufen: .* → gruen, [\d.]+ s — .* — Obergrenze 0\.1 s um [\d.]+ s ueberschritten$/);
    const [lauf] = zusammenfassung(dir).laufen;
    assert.ok(lauf.ueberObergrenzeMs > 0, `ueberObergrenzeMs fehlt: ${JSON.stringify(lauf)}`);
    assert.equal(lauf.ueberObergrenzeMs, lauf.dauerMs - 100);
  });
});

test("eine Pruefung unter der Grenze traegt weder Zusatz noch ueberObergrenzeMs", () => {
  mitRepo({ config: { buildChecks: [BAU] } }, (dir) => {
    datei(dir, "a.txt");

    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /Obergrenze/);
    assert.equal(zusammenfassung(dir).laufen[0].ueberObergrenzeMs, undefined);
  });
});

// --- Berichtsblock (E1, E12) ------------------------------------------------

test("gekuerzter Lauf: gelaufen mit Ergebnis, Dauer und Grund, ausgelassen mit Grund", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/App.tsx");

    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    const [lauf] = zusammenfassung(dir).laufen;
    const block = berichtsblock(res.stdout);
    assert.deepEqual(block, [
      `gelaufen: ${BAU} → gruen, ${dauerText(lauf.dauerMs)} — ${lauf.grund}`,
      `ausgelassen: ${VERIFY} → ${zusammenfassung(dir).ausgelassen[0].grund}`,
    ]);
    assert.deepEqual(zusammenfassung(dir).berichtszeilen, block, "dieselben Zeilen stehen in der Zusammenfassung");
  });
});

test("roter Lauf: das rote Kommando mit Dauer, das nicht gestartete ohne", () => {
  mitRepo({ config: { buildChecks: [ROT, BAU] } }, (dir) => {
    datei(dir, "a.txt");

    const res = run(dir);

    assert.equal(res.status, 1);
    const [rot, offen] = zusammenfassung(dir).laufen;
    const block = berichtsblock(res.stdout);
    assert.deepEqual(block, [
      `gelaufen: ${ROT} → rot, ${dauerText(rot.dauerMs)} — ${rot.grund}`,
      `gelaufen: ${BAU} → nicht gestartet, Dauer nicht gemessen — ${offen.grund}`,
    ]);
    assert.deepEqual(zusammenfassung(dir).berichtszeilen, block);
  });
});

test("leerer Lauf: der Block sagt, dass nichts veraendert wurde, und nennt die Auslassungen", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    const res = run(dir);

    assert.equal(res.status, 0, res.stderr);
    const block = berichtsblock(res.stdout);
    assert.equal(block[0], "keine Pruefung, weil nichts veraendert wurde");
    assert.equal(block.length, 3);
    assert.match(block[1], /^ausgelassen: .* → leeres Paket: keine Aenderung seit /);
    assert.deepEqual(zusammenfassung(dir).berichtszeilen, block);
  });
});

test("uebernommener Lauf: der Block traegt die Dauer des Ursprungslaufs und 'Ergebnis uebernommen'", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/App.tsx");
    assert.equal(run(dir).status, 0);
    const [ursprung] = zusammenfassung(dir).laufen;

    const zweiter = run(dir);

    assert.equal(zweiter.status, 0, zweiter.stderr);
    const block = berichtsblock(zweiter.stdout);
    assert.equal(
      block[0],
      `gelaufen: ${BAU} → gruen, ${dauerText(ursprung.dauerMs)} (Ergebnis uebernommen) — ${ursprung.grund}`,
    );
    assert.match(block[1], /^ausgelassen: /);
    assert.deepEqual(zusammenfassung(dir).berichtszeilen, block);
  });
});

test("uebernommener Lauf ohne Dauer im Ursprung: 'Dauer nicht gemessen'", () => {
  mitRepo({ config: CONFIG }, (dir) => {
    datei(dir, "frontend/App.tsx");
    assert.equal(run(dir).status, 0);
    const pfad = join(dir, ".claude", "checks-summary.json");
    const alt = JSON.parse(readFileSync(pfad, "utf-8"));
    for (const e of alt.laufen) delete e.dauerMs;
    writeFileSync(pfad, JSON.stringify(alt, null, 2), "utf-8");

    const zweiter = run(dir);

    assert.equal(zweiter.status, 0, zweiter.stderr);
    assert.match(berichtsblock(zweiter.stdout)[0], /→ gruen, Dauer nicht gemessen \(Ergebnis uebernommen\) — /);
  });
});

// --- Wartezeit (Issue #1069, Plan #1066, A7, E4) ----------------------------

const ABSCHLUSS = {
  buildChecks: [BAU],
};

test("ohne Kartennummer: die Zeile nennt nur die Wartezeit, wartezeitKarte fehlt", () => {
  mitRepo({ config: ABSCHLUSS }, (dir) => {
    datei(dir, "a.txt");

    const res = run(dir, "--abschluss");

    assert.equal(res.status, 0, res.stderr);
    const summary = zusammenfassung(dir);
    assert.equal(wartezeitZeile(res.stdout), `Wartezeit: ${dauerText(summary.wartezeitMs)}`);
    assert.equal(summary.wartezeitKarte, undefined);
  });
});

test("mit Kartennummer: die Zeile nennt Wartezeit und Summe fuer die Karte", () => {
  mitRepo({ config: ABSCHLUSS }, (dir) => {
    datei(dir, "a.txt");

    const res = run(dir, "--abschluss", "7");

    assert.equal(res.status, 0, res.stderr);
    const summary = zusammenfassung(dir);
    assert.deepEqual(summary.wartezeitKarte, { karte: "7", summeMs: summary.wartezeitMs, laeufe: 1 });
    const s = dauerText(summary.wartezeitMs);
    assert.equal(wartezeitZeile(res.stdout), `Wartezeit: ${s}, zusammen ${s} in 1 Laeufen fuer Karte #7`);
    assert.deepEqual(summary.berichtszeilen, berichtsblock(res.stdout), "berichtszeilen bleibt ohne die Zeile");
  });
});

test("zwei Laeufe derselben Karte: die Summe addiert, die Zahl der Laeufe zaehlt hoch", () => {
  mitRepo({ config: ABSCHLUSS }, (dir) => {
    datei(dir, "a.txt");
    assert.equal(run(dir, "--abschluss", "7").status, 0);
    const erster = zusammenfassung(dir).wartezeitMs;
    datei(dir, "b.txt");

    const res = run(dir, "--abschluss", "7");

    assert.equal(res.status, 0, res.stderr);
    const summary = zusammenfassung(dir);
    const summe = erster + summary.wartezeitMs;
    assert.deepEqual(summary.wartezeitKarte, { karte: "7", summeMs: summe, laeufe: 2 });
    assert.equal(
      wartezeitZeile(res.stdout),
      `Wartezeit: ${dauerText(summary.wartezeitMs)}, zusammen ${dauerText(summe)} in 2 Laeufen fuer Karte #7`,
    );
  });
});

test("eine andere Karte beginnt die Summe neu", () => {
  mitRepo({ config: ABSCHLUSS }, (dir) => {
    datei(dir, "a.txt");
    assert.equal(run(dir, "--abschluss", "7").status, 0);
    datei(dir, "b.txt");

    const res = run(dir, "--abschluss", "8");

    assert.equal(res.status, 0, res.stderr);
    const summary = zusammenfassung(dir);
    assert.deepEqual(summary.wartezeitKarte, { karte: "8", summeMs: summary.wartezeitMs, laeufe: 1 });
  });
});

test("ein uebernommener Lauf zaehlt als Lauf ohne Zeit", () => {
  mitRepo({ config: ABSCHLUSS }, (dir) => {
    datei(dir, "a.txt");
    assert.equal(run(dir, "--abschluss", "7").status, 0);
    const erster = zusammenfassung(dir).wartezeitMs;

    const res = run(dir, "--abschluss", "7");

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Ergebnis uebernommen/);
    const summary = zusammenfassung(dir);
    assert.ok(Number.isFinite(summary.wartezeitMs), "auch der uebernommene Lauf traegt seine Wartezeit");
    assert.deepEqual(summary.wartezeitKarte, { karte: "7", summeMs: erster, laeufe: 2 });
    assert.equal(
      wartezeitZeile(res.stdout),
      `Wartezeit: ${dauerText(summary.wartezeitMs)}, zusammen ${dauerText(erster)} in 2 Laeufen fuer Karte #7`,
    );
  });
});
