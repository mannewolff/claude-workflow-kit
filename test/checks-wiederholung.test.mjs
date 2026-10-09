// Eine rote Pruefung wird einmal auf demselben Stand wiederholt (Issue #1396, Plan #1395,
// E2–E8, E12, E17; fachliche Quelle #1345).
//
// Wiederholt wird nur, wenn der Lauf mit `--abschluss` oder `--wiederholen` faehrt. Rot und
// Gruen ergibt ein gruenes Ergebnis mit dem Feld `gewackelt`, Rot und Rot ein rotes mit
// `wiederholt: true`. Beide Laeufe stehen im Ausfuehrungsprotokoll, die Bremse zaehlt das
// Paar als einen Versuch.
//
// Geprueft wird an der WIRKUNG: Das Fake-Kommando haengt seinen Namen an ein Protokoll und
// zaehlt seine Aufrufe in einer Datei unter `.claude/` (hinter der Ignore-Regel, veraendert
// also den Stand nicht). Rot ist es, solange die Zahl seiner Aufrufe unter dem Wert aus
// `.claude/rotbis-<name>` liegt — 1 heisst „erst rot, dann gruen", 99 „immer rot".

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checksMit, mitRepo, run, plan, zusammenfassung, datei, eintrag, ausfuehrungen,
} from "./helpers/checks-repo.mjs";

const A = "node .claude/w.mjs a";
const B = "node .claude/w.mjs b";
const C = "node .claude/w.mjs c";

const CONFIG = {
  buildChecks: [
    { cmd: A, areas: ["kern"] },
    { cmd: B, areas: ["kern"] },
  ],
  checkAreas: { kern: ["src/**"] },
};

const IMMER = 99;

function kommandoAnlegen(dir) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "w.mjs"), [
    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "const name = process.argv[2];",
    "const zaehler = '.claude/zaehler-' + name;",
    "const bisher = existsSync(zaehler) ? Number(readFileSync(zaehler, 'utf-8')) : 0;",
    "writeFileSync(zaehler, String(bisher + 1));",
    "const rotBis = existsSync('.claude/rotbis-' + name) ? Number(readFileSync('.claude/rotbis-' + name, 'utf-8')) : 0;",
    String.raw`appendFileSync('.claude/protokoll.txt', name + '\n');`,
    "const rot = bisher < rotBis;",
    "console.log(name + (rot ? ' scheitert in Aufruf ' : ' besteht in Aufruf ') + (bisher + 1));",
    "process.exit(rot ? 1 : 0);",
    "",
  ].join("\n"), "utf-8");
}

/** Rot fuer die ersten `n` Aufrufe ab jetzt. */
function rotFuer(dir, name, n) {
  writeFileSync(join(dir, ".claude", `rotbis-${name}`), String(n), "utf-8");
  rmSync(join(dir, ".claude", `zaehler-${name}`), { force: true });
}

/** Die Kommandos in der Reihenfolge ihrer Ausfuehrung; danach ist das Protokoll leer. */
function gefahren(dir) {
  const pfad = join(dir, ".claude", "protokoll.txt");
  let zeilen = [];
  try {
    zeilen = readFileSync(pfad, "utf-8").split("\n").filter(Boolean);
  } catch { /* noch nichts gelaufen */ }
  rmSync(pfad, { force: true });
  return zeilen;
}

/** Die Zeilen des Blocks `Fuer den Abschlussbericht:` bis zur ersten Leerzeile. */
function berichtsblock(stdout) {
  const ab = stdout.split("\n");
  const start = ab.indexOf("Fuer den Abschlussbericht:");
  assert.notEqual(start, -1, stdout);
  const rest = ab.slice(start + 1);
  const ende = rest.indexOf("");
  return ende === -1 ? rest : rest.slice(0, ende);
}

async function mitAufbau(fn, config = CONFIG) {
  await mitRepo({ config }, async (dir) => {
    kommandoAnlegen(dir);
    datei(dir, "src/a.txt");
    await fn(dir);
  });
}

for (const schalter of [["--abschluss", "7"], ["--wiederholen"]]) {
  test(`${schalter[0]}: eine rote Pruefung laeuft genau zweimal, eine gruene genau einmal`, async () => {
    await mitAufbau(async (dir) => {
      rotFuer(dir, "a", 1);

      const res = await run(dir, ...schalter);

      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.deepEqual(gefahren(dir), ["a", "a", "b"], "die uebrigen laufen nach dem Wackler weiter");
      assert.ok(res.stdout.includes(`Wiederholung: ${A} war rot — einmal auf demselben Stand wiederholt`), res.stdout);
      assert.ok(res.stdout.includes("-> gewackelt (erst rot, dann gruen)"), res.stdout);
    });
  });
}

test("Rot und Gruen: Ergebnis gruen, Feld gewackelt, Ablage -erstlauf und Zeile Gewackelt: im Bericht", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", 1);

    const res = await run(dir, "--abschluss", "7");

    assert.equal(res.status, 0, res.stdout);
    const z = zusammenfassung(dir);
    const a = eintrag(z.laufen, A);
    assert.equal(a.ergebnis, "gruen");
    assert.equal(a.wiederholt, undefined);
    assert.equal(a.protokoll, undefined, "die Pruefung hat bestanden — keine rote Ablage am Eintrag");
    assert.equal(typeof a.gewackelt.erstDauerMs, "number");
    assert.ok(a.dauerMs >= a.gewackelt.erstDauerMs, "dauerMs ist die Summe beider Laeufe");
    assert.match(a.gewackelt.protokoll, /^\.claude\/checks-protokolle\/01-.*-erstlauf\.log$/);
    assert.match(readFileSync(join(dir, a.gewackelt.protokoll), "utf-8"), /a scheitert in Aufruf 1/);
    assert.equal(Object.keys(a).at(-1), "gewackelt", "das Feld steht hinten");
    assert.equal(eintrag(z.laufen, B).gewackelt, undefined);

    const block = berichtsblock(res.stdout);
    const i = block.findIndex((zeile) => zeile.startsWith(`gelaufen: ${A} → gruen`));
    assert.notEqual(i, -1, block.join("\n"));
    assert.equal(block[i + 1], `Gewackelt: ${A} → erst rot, dann gruen — Ausgabe des ersten Laufs: ${a.gewackelt.protokoll}`);
    assert.equal(block.filter((zeile) => zeile.startsWith("Gewackelt:")).length, 1);
    assert.ok(z.berichtszeilen.includes(block[i + 1]), "dieselbe Zeile steht in der Zusammenfassung");
  });
});

test("Rot und Rot: Ergebnis rot, wiederholt: true, Exit 1, Rest nicht gestartet", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", IMMER);

    const res = await run(dir, "--abschluss", "7");

    assert.equal(res.status, 1, res.stdout);
    assert.deepEqual(gefahren(dir), ["a", "a"]);
    const z = zusammenfassung(dir);
    const a = eintrag(z.laufen, A);
    assert.equal(a.ergebnis, "rot");
    assert.equal(a.wiederholt, true);
    assert.equal(a.gewackelt, undefined);
    assert.equal(eintrag(z.laufen, B).ergebnis, "nicht gestartet");
    assert.ok(res.stdout.includes("-> rot, auch bei der Wiederholung"), res.stdout);
    assert.match(readFileSync(join(dir, a.protokoll), "utf-8"), /a scheitert in Aufruf 2/,
      "die Ablage am Eintrag ist die der Wiederholung");
    const zeile = berichtsblock(res.stdout).find((z2) => z2.startsWith(`gelaufen: ${A}`));
    assert.ok(zeile.startsWith(`gelaufen: ${A} → rot, auch bei der Wiederholung, `), zeile);
    assert.ok(!berichtsblock(res.stdout).some((z2) => z2.startsWith("Gewackelt:")));
  });
});

test("ohne --abschluss und --wiederholen: genau ein Lauf, keine Wiederholungszeile — Paketstufe und --stufe push", async () => {
  for (const schalter of [[], ["--stufe", "push"]]) {
    await mitAufbau(async (dir) => {
      rotFuer(dir, "a", 1);

      const res = await run(dir, ...schalter);

      assert.equal(res.status, 1, res.stdout);
      assert.deepEqual(gefahren(dir), ["a"], `Schalter ${schalter.join(" ")}`);
      assert.doesNotMatch(res.stdout, /Wiederholung|Gewackelt|gewackelt/);
      const a = eintrag(zusammenfassung(dir).laufen, A);
      assert.equal(a.wiederholt, undefined);
      assert.equal(a.gewackelt, undefined);
      assert.deepEqual(ausfuehrungen(dir).map((z) => z.split("\t")[11]), [""], "Spalte 12 leer");
    });
  }
});

test("--stufe push mit --wiederholen wiederholt", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", 1);

    const res = await run(dir, "--stufe", "push", "--wiederholen");

    assert.equal(res.status, 0, res.stdout);
    assert.deepEqual(gefahren(dir), ["a", "a", "b"]);
  });
});

test("Ausfuehrungsprotokoll: erstlauf und wiederholung in Spalte 12, sonst leer", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", 1);

    await run(dir, "--abschluss", "7");

    const zeilen = ausfuehrungen(dir).map((z) => z.split("\t"));
    assert.deepEqual(zeilen.map((s) => s.length), [12, 12, 12]);
    assert.deepEqual(zeilen.map((s) => [s[1], s[2], s[11]]), [
      [A, "rot", "erstlauf"],
      [A, "gruen", "wiederholung"],
      [B, "gruen", ""],
    ]);
  });
});

test("gleichzeitige Phase: zwei rote Pruefungen je einmal wiederholt, Ausgabe in Config-Reihenfolge", async () => {
  const config = {
    buildChecks: [
      { cmd: A, areas: ["kern"], gleichzeitig: true },
      { cmd: B, areas: ["kern"], gleichzeitig: true },
      { cmd: C, areas: ["kern"], gleichzeitig: true },
    ],
    checkAreas: { kern: ["src/**"] },
  };
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", 1);
    rotFuer(dir, "c", 1);

    const res = await checksMit(dir, { env: { KIT_CHECKS_GLEICHZEITIG: "2" } }, "run", "--abschluss", "7");

    assert.equal(res.status, 0, res.stdout);
    const lauf = gefahren(dir);
    assert.equal(lauf.filter((n) => n === "a").length, 2);
    assert.equal(lauf.filter((n) => n === "b").length, 1);
    assert.equal(lauf.filter((n) => n === "c").length, 2);
    const posA = res.stdout.indexOf(`$ ${A}`);
    const posWiederA = res.stdout.indexOf(`Wiederholung: ${A}`);
    const posB = res.stdout.indexOf(`$ ${B}`);
    const posC = res.stdout.indexOf(`$ ${C}`);
    const posWiederC = res.stdout.indexOf(`Wiederholung: ${C}`);
    assert.ok(posA < posWiederA && posWiederA < posB && posB < posC && posC < posWiederC, res.stdout);
    const z = zusammenfassung(dir);
    assert.ok(eintrag(z.laufen, A).gewackelt);
    assert.ok(eintrag(z.laufen, C).gewackelt);
    assert.equal(berichtsblock(res.stdout).filter((zeile) => zeile.startsWith("Gewackelt:")).length, 2);
  }, config);
});

test("gleichzeitige Phase: Rot und Rot bleibt rot, die nachfolgende Phase startet nicht", async () => {
  const config = {
    buildChecks: [
      { cmd: A, areas: ["kern"], gleichzeitig: true },
      { cmd: B, areas: ["kern"] },
    ],
    checkAreas: { kern: ["src/**"] },
  };
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", IMMER);

    const res = await run(dir, "--abschluss", "7");

    assert.equal(res.status, 1, res.stdout);
    assert.deepEqual(gefahren(dir), ["a", "a"]);
    const z = zusammenfassung(dir);
    assert.equal(eintrag(z.laufen, A).wiederholt, true);
    assert.equal(eintrag(z.laufen, B).ergebnis, "nicht gestartet");
  }, config);
});

test("Teillauf wackelt, voller Lauf gruen: eine Zeile Gewackelt:, zwei Protokollzeilen mit Spalte 12 und eine ohne", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", IMMER);
    const erster = await run(dir, "--abschluss", "7");
    assert.equal(erster.status, 1, erster.stdout);
    gefahren(dir);
    const vorher = ausfuehrungen(dir).length;

    rotFuer(dir, "a", 1);
    datei(dir, "src/a.txt", "korrigiert\n");
    const zweiter = await run(dir, "--abschluss", "7");

    assert.equal(zweiter.status, 0, zweiter.stdout);
    assert.match(zweiter.stdout, /Teillauf: nur die zuletzt roten Pruefungen/);
    assert.deepEqual(gefahren(dir), ["a", "a", "a", "b"], "Teillauf mit Wiederholung, dann der volle Lauf");
    const block = berichtsblock(zweiter.stdout);
    assert.equal(block.filter((zeile) => zeile.startsWith("Gewackelt:")).length, 1, block.join("\n"));
    const a = eintrag(zusammenfassung(dir).laufen, A);
    assert.equal(a.ergebnis, "gruen");
    assert.ok(a.gewackelt, "der Wackler des Teillaufs geht in den vollen Lauf ueber");
    assert.ok(existsSync(join(dir, a.gewackelt.protokoll)), "die Ablage des Teillaufs bleibt liegen");

    const neu = ausfuehrungen(dir).slice(vorher).map((z) => z.split("\t")).filter((s) => s[1] === A);
    assert.deepEqual(neu.map((s) => s[11]), ["erstlauf", "wiederholung", ""]);
  });
});

test("--wiederholen bei plan angenommen und ohne Wirkung, mit --abschluss erlaubt", async () => {
  await mitAufbau(async (dir) => {
    assert.deepEqual(plan(dir, "--wiederholen"), plan(dir));
    assert.deepEqual(plan(dir, "--abschluss", "--wiederholen"), plan(dir, "--abschluss"));
    rotFuer(dir, "a", 1);
    const res = await run(dir, "--abschluss", "7", "--wiederholen");
    assert.equal(res.status, 0, res.stdout);
    assert.deepEqual(gefahren(dir), ["a", "a", "b"], "einmal wiederholt, nicht zweimal");
  });
});

test("die Bremse zaehlt das Paar Rot und Rot als einen Versuch, mit dem Abdruck der Wiederholung", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", IMMER);

    await run(dir, "--abschluss", "7");

    const folge = zusammenfassung(dir).festgefahren.folgen[A];
    assert.equal(folge.versuche, 1);
    const a = eintrag(zusammenfassung(dir).laufen, A);
    assert.equal(folge.fehler, a.fehler);
  });
});

// Die Wackler je Karte (Issue #1397, Plan #1395, E11, E12): `gewackeltKarte` wird ueber die
// Abschlusslaeufe derselben Karte fortgeschrieben, bei anderer Karte neu begonnen und ohne
// Kartennummer nie uebernommen.

test("gewackeltKarte: fortgeschrieben ueber zwei Abschlusslaeufe derselben Karte, frueherer Fall im Bericht", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", 1);
    const erster = await run(dir, "--abschluss", "7");
    assert.equal(erster.status, 0, erster.stdout);
    const z1 = zusammenfassung(dir);
    assert.deepEqual(z1.gewackeltKarte, [{ cmd: A, zeitpunkt: z1.zeitpunkt, karte: z1.wartezeitKarte.karte }]);
    assert.equal(Object.keys(z1).at(-1), "gewackeltKarte", "das Feld steht hinten");
    assert.ok(!berichtsblock(erster.stdout).some((zeile) => zeile.includes("früherer Lauf")));

    rotFuer(dir, "b", 1);
    datei(dir, "src/a.txt", "weiter\n");
    const zweiter = await run(dir, "--abschluss", "7");

    assert.equal(zweiter.status, 0, zweiter.stdout);
    const z2 = zusammenfassung(dir);
    const karte = z1.wartezeitKarte.karte;
    assert.deepEqual(z2.gewackeltKarte, [
      { cmd: A, zeitpunkt: z1.zeitpunkt, karte },
      { cmd: B, zeitpunkt: z2.zeitpunkt, karte },
    ]);
    const block = berichtsblock(zweiter.stdout);
    const frueher = `Gewackelt: ${A} → erst rot, dann gruen (früherer Lauf vom ${z1.zeitpunkt})`;
    const i = block.findIndex((zeile) => zeile.startsWith(`gelaufen: ${A} → gruen`));
    assert.equal(block[i + 1], frueher, block.join("\n"));
    assert.equal(block.filter((zeile) => zeile.startsWith("Gewackelt:")).length, 2, block.join("\n"));
    assert.ok(z2.berichtszeilen.includes(frueher));
  });
});

test("gewackeltKarte: Neubeginn bei anderer Karte", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", 1);
    await run(dir, "--abschluss", "7");
    assert.equal(zusammenfassung(dir).gewackeltKarte.length, 1);

    datei(dir, "src/a.txt", "andere Karte\n");
    const res = await run(dir, "--abschluss", "8");

    assert.equal(res.status, 0, res.stdout);
    assert.deepEqual(zusammenfassung(dir).gewackeltKarte, []);
    assert.ok(!berichtsblock(res.stdout).some((zeile) => zeile.startsWith("Gewackelt:")));
  });
});

test("gewackeltKarte: Uebernahme reicht das Feld unveraendert weiter, ohne neue Protokollzeile", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", 1);
    await run(dir, "--abschluss", "7");
    const vorher = zusammenfassung(dir).gewackeltKarte;
    assert.equal(vorher.length, 1);
    const zeilenVorher = ausfuehrungen(dir).length;
    gefahren(dir);

    const res = await run(dir, "--abschluss", "7");

    assert.equal(res.status, 0, res.stdout);
    assert.match(res.stdout, /Ergebnis uebernommen/);
    assert.deepEqual(gefahren(dir), []);
    assert.deepEqual(zusammenfassung(dir).gewackeltKarte, vorher);
    assert.equal(ausfuehrungen(dir).length, zeilenVorher);
    const block = berichtsblock(res.stdout);
    assert.equal(block.filter((zeile) => zeile.startsWith("Gewackelt:")).length, 1, block.join("\n"));
    assert.ok(!block.some((zeile) => zeile.includes("früherer Lauf")), block.join("\n"));
  });
});

test("gewackeltKarte: --stufe push --wiederholen nach einer Karte erbt nichts", async () => {
  await mitAufbau(async (dir) => {
    rotFuer(dir, "a", 1);
    await run(dir, "--abschluss", "7");
    assert.ok(zusammenfassung(dir).gewackeltKarte);

    datei(dir, "src/a.txt", "vor dem push\n");
    const res = await run(dir, "--stufe", "push", "--wiederholen");

    assert.equal(res.status, 0, res.stdout);
    assert.equal(zusammenfassung(dir).gewackeltKarte, undefined);
    assert.ok(!berichtsblock(res.stdout).some((zeile) => zeile.startsWith("Gewackelt:")));
  });
});
