// Ablauf-Pruefung: drei Faelle starten checks.mjs als Prozess, weil nur dort der dynamische Import der Teile hinter dem Einstieg und der Exitcode der Kommandozeile zu sehen sind.
//
// Die Kommandozeile von `areas suggest` und `areas compare` (Issue #1718, Plan #1713 A1, A10,
// A13, E11).
//
// Beide Unterkommandos enden mit Exit 0, auch wenn der Abgleich Luecken findet: Sie melden und
// halten nie an (Kriterium 11). `--json` liefert dieselben Daten wie der Text. `areas suggest`
// laeuft auch ohne `.claude/workflow.config.json`, damit der Installer es beim ersten Einrichten
// fahren kann; alle anderen Unterkommandos brechen ohne Config weiter ab.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { UEBERNAHME_MARKE } from "../kit/checks.mjs";
import { mitRepo, checks, datei, run, zusammenfassung } from "./helpers/checks-repo.mjs";
import { CHECKS, checksProzess } from "./helpers/checks-ablauf.mjs";

/** Ein Projekt, dessen Test eine Datei aus einem Bereich laedt, den sein Kommando nicht nennt. */
const MIT_LUECKE = {
  buildChecks: [{ cmd: "node --test test/a.test.mjs", areas: ["a"] }],
  checkAreas: { a: ["src/a/**", "test/a.test.mjs"], b: ["src/b/**"] },
};

function lueckeAnlegen(dir) {
  datei(dir, "src/a/eins.mjs", "export const eins = 1;\n");
  datei(dir, "src/b/zwei.mjs", "export const zwei = 2;\n");
  datei(dir, "test/a.test.mjs", [
    'import { eins } from "../src/a/eins.mjs";',
    'import { zwei } from "../src/b/zwei.mjs";',
    "console.log(eins, zwei);",
    "",
  ].join("\n"));
}

test("[1718] areas suggest und areas compare enden als Prozess mit Exit 0, auch bei Luecken", async () => {
  await mitRepo({ config: MIT_LUECKE }, (dir) => {
    lueckeAnlegen(dir);

    const vorschlag = checksProzess(dir, ["areas", "suggest"]);
    assert.equal(vorschlag.status, 0, vorschlag.stderr);
    assert.match(vorschlag.stdout, /^Vorschlag fuer Pruefbereiche/);

    const abgleich = checksProzess(dir, ["areas", "compare"]);
    assert.equal(abgleich.status, 0, abgleich.stderr);
    assert.match(abgleich.stdout, /- test\/a\.test\.mjs laedt src\/b\/zwei\.mjs aus Bereich b, den node --test test\/a\.test\.mjs nicht ausloest/);
  });
});

test("[1718] --json liefert dieselben Daten wie der Text", async () => {
  await mitRepo({ config: MIT_LUECKE }, async (dir) => {
    lueckeAnlegen(dir);

    const abgleichText = (await checks(dir, "areas", "compare")).stdout;
    const abgleich = JSON.parse((await checks(dir, "areas", "compare", "--json")).stdout);
    assert.deepEqual(abgleich.luecken, [
      { test: "test/a.test.mjs", datei: "src/b/zwei.mjs", bereich: "b", kommando: "node --test test/a.test.mjs" },
    ]);
    for (const { test: testdatei, datei: pfad, bereich } of abgleich.luecken) {
      assert.ok(abgleichText.includes(`${testdatei} laedt ${pfad} aus Bereich ${bereich}`), abgleichText);
    }

    const vorschlagText = (await checks(dir, "areas", "suggest")).stdout;
    const vorschlag = JSON.parse((await checks(dir, "areas", "suggest", "--json")).stdout);
    assert.ok(vorschlag.bereiche.length > 0);
    for (const bereich of vorschlag.bereiche) {
      assert.ok(vorschlagText.includes(`- ${bereich.name}: ${bereich.muster.join(", ")}`), vorschlagText);
      assert.ok(vorschlagText.includes(`    Tests: ${bereich.tests.join(", ")}`), vorschlagText);
    }
    assert.ok(vorschlagText.includes(JSON.stringify(vorschlag.ausschnitt, null, 2)), "der Ausschnitt im Text ist der aus dem JSON");
  });
});

test("[1718] areas suggest ohne Config arbeitet mit leerer Config, Gruppen sind die Ordner der Testdateien", async () => {
  await mitRepo({ ohneConfig: true }, async (dir) => {
    datei(dir, "src/eins.mjs", "export const eins = 1;\n");
    datei(dir, "test/eins.test.mjs", 'import { eins } from "../src/eins.mjs";\nconsole.log(eins);\n');

    const res = await checks(dir, "areas", "suggest", "--json");

    assert.equal(res.status, 0, res.stderr);
    const vorschlag = JSON.parse(res.stdout);
    assert.equal(vorschlag.gruppenArt, "ordner");
    assert.deepEqual(vorschlag.kommandos, []);
    const bereich = vorschlag.bereiche.find((b) => b.dateien.includes("src/eins.mjs"));
    assert.deepEqual(bereich?.gruppen, ["test"], JSON.stringify(vorschlag.bereiche));
    assert.deepEqual(bereich.tests, ["test/eins.test.mjs"]);
  });
});

test("[1718] run, plan, areas und areas compare brechen ohne Config weiter ab", async () => {
  await mitRepo({ ohneConfig: true }, async (dir) => {
    for (const argv of [["run"], ["plan"], ["areas"], ["areas", "compare"], ["areas", "compare", "--json"]]) {
      const res = await checks(dir, ...argv);
      assert.equal(res.status, 1, `${argv.join(" ")}: ${res.stdout}`);
      assert.match(res.stderr, /Keine \.claude\/workflow\.config\.json/, argv.join(" "));
    }
  });
});

test("[1718] areas mit einem unbekannten Argument wird abgewiesen", async () => {
  await mitRepo({ config: MIT_LUECKE }, async (dir) => {
    for (const [argv, arg] of [
      [["areas", "vorschlag"], "vorschlag"],
      [["areas", "suggest", "--frei"], "--frei"],
      [["areas", "compare", "x"], "x"],
      [["areas", "--json"], "--json"],
    ]) {
      const res = await checks(dir, ...argv);
      assert.equal(res.status, 1, argv.join(" "));
      assert.match(res.stderr, new RegExp(`Unbekanntes Argument: '${arg}'`), argv.join(" "));
    }
  });
});

// --- Der Abgleich im Prueflauf (Issue #1719, Plan #1713 A1, A11, E1, E2, E7) ---
//
// Der Abgleich laeuft als Hinweis nur an der Paketstufe und steht im eigenen Feld
// `bereichsabgleich`, nie in `laufen` (Vertrag V1): Das Gate von kanban-kit sperrt bei jedem
// nicht gruenen Eintrag dort.

test("[1719] an --stage push und --stage merge laeuft kein Abgleich", async () => {
  await mitRepo({ config: MIT_LUECKE }, async (dir) => {
    lueckeAnlegen(dir);

    for (const stufe of ["push", "merge"]) {
      const res = await run(dir, "--stage", stufe, "--fresh");
      assert.equal(res.status, 0, `${stufe}: ${res.stdout}${res.stderr}`);
      const stand = zusammenfassung(dir);
      assert.equal(Object.hasOwn(stand, "bereichsabgleich"), false, `${stufe}: ${JSON.stringify(stand.bereichsabgleich)}`);
      assert.doesNotMatch(res.stdout, /Abgleich der Pruefbereiche/, stufe);
    }
  });
});

test("[1719] ein Ladefehler der Teile steht als fehler im Feld, der Lauf bleibt gruen mit Exit 0", async () => {
  await mitRepo({ config: MIT_LUECKE }, (dir) => {
    lueckeAnlegen(dir);
    // checks.mjs allein, ohne die Teile unter checks/: So liegt es in einem Projekt, das nur
    // den Einstieg kopiert hat, und der dynamische Import scheitert.
    const ziel = join(dir, ".claude", "kit", "checks.mjs");
    mkdirSync(dirname(ziel), { recursive: true });
    copyFileSync(CHECKS, ziel);

    const res = spawnSync(process.execPath, [ziel, "run"], { cwd: dir, encoding: "utf-8" });

    assert.equal(res.status, 0, res.stdout + res.stderr);
    const stand = zusammenfassung(dir);
    assert.deepEqual(stand.laufen.map((e) => e.ergebnis), ["gruen"]);
    assert.deepEqual(stand.bereichsabgleich.luecken, []);
    assert.match(stand.bereichsabgleich.fehler, /bereiche\.mjs|checks\//, JSON.stringify(stand.bereichsabgleich));
    assert.match(res.stdout, /Abgleich der Pruefbereiche nicht moeglich: /);
  });
});

test("[1719] ein uebernommener Lauf traegt bereichsabgleich des uebernommenen Ergebnisses weiter", async () => {
  await mitRepo({ config: MIT_LUECKE }, async (dir) => {
    lueckeAnlegen(dir);
    const erster = await run(dir);
    assert.equal(erster.status, 0, erster.stdout + erster.stderr);
    assert.equal(zusammenfassung(dir).bereichsabgleich.luecken.length, 1);

    // Ein Merkmal, das nur der fruehere Lauf traegt: Rechnete die Uebernahme neu, fehlte es.
    const pfad = join(dir, ".claude", "checks-summary.json");
    const frueher = JSON.parse(readFileSync(pfad, "utf-8"));
    frueher.bereichsabgleich.luecken[0].kommando = "aus dem frueheren Lauf";
    writeFileSync(pfad, `${JSON.stringify(frueher, null, 2)}\n`, "utf-8");

    const zweiter = await run(dir);

    assert.equal(zweiter.status, 0, zweiter.stdout + zweiter.stderr);
    assert.match(zweiter.stdout, new RegExp(UEBERNAHME_MARKE));
    assert.deepEqual(zusammenfassung(dir).bereichsabgleich, frueher.bereichsabgleich);
    assert.match(zweiter.stdout, /aus dem frueheren Lauf/);
  });
});
