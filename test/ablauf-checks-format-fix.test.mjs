// Ablauf-Pruefung: Ob das Nachformatieren den Arbeitsbaum wirklich aendert und der zweite Durchgang den neuen Stand misst, zeigen nur echte Kommandos in einem echten Repository.
//
// Das Nachformatieren in `checks.mjs run` an der Paketstufe (Issue #1672, Plan #1671, E1;
// fachliche Quelle #1609, Kriterium 3). Ist der Lauf rot und `formatFixCommand` gesetzt,
// laeuft das Kommando genau einmal, danach ein zweiter, frischer Durchgang — nie ein dritter.
// Mit `--finish` erst nach der bestehenden Wiederholung.
//
// Die Pruefung `pruef.mjs` ist rot, solange die Marker-Datei `src/kaputt.txt` "kaputt"
// enthaelt. Der Fix `fix.mjs` schreibt "ok" hinein — oder, mit `.claude/fix-hilft-nicht`,
// nichts — und zaehlt seine Aufrufe in `.claude/fix-zaehler`. Beide haengen ihren Namen an
// `.claude/protokoll.txt`, damit die Reihenfolge sichtbar ist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mitRepo, run, zusammenfassung, datei, git, ausfuehrungen } from "./helpers/checks-repo.mjs";

const PRUEFUNG = "node .claude/pruef.mjs";
const FIX = "node .claude/fix.mjs";

function werkzeugeAnlegen(dir) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "pruef.mjs"), [
    "import { appendFileSync, readFileSync } from 'node:fs';",
    String.raw`appendFileSync('.claude/protokoll.txt', 'pruef\n');`,
    "const rot = readFileSync('src/kaputt.txt', 'utf-8').includes('kaputt');",
    "console.log(rot ? 'Formatverstoss in src/kaputt.txt' : 'sauber');",
    "process.exit(rot ? 1 : 0);",
    "",
  ].join("\n"), "utf-8");
  writeFileSync(join(dir, ".claude", "fix.mjs"), [
    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    String.raw`appendFileSync('.claude/protokoll.txt', 'fix\n');`,
    "const zaehler = '.claude/fix-zaehler';",
    "writeFileSync(zaehler, String((existsSync(zaehler) ? Number(readFileSync(zaehler, 'utf-8')) : 0) + 1));",
    String.raw`if (!existsSync('.claude/fix-hilft-nicht')) writeFileSync('src/kaputt.txt', 'ok\n');`,
    "",
  ].join("\n"), "utf-8");
}

function config(mitFix = true) {
  return { buildChecks: [{ cmd: PRUEFUNG }], ...(mitFix ? { formatFixCommand: ` ${FIX} ` } : {}) };
}

/** Ein Wegwerfprojekt mit roter Marker-Datei; `fn(dir)` laeuft darin. */
function imProjekt(optionen, fn) {
  return mitRepo({ config: config(optionen.mitFix) }, async (dir) => {
    werkzeugeAnlegen(dir);
    datei(dir, "src/kaputt.txt", "kaputt\n");
    if (optionen.hilftNicht) writeFileSync(join(dir, ".claude", "fix-hilft-nicht"), "", "utf-8");
    return fn(dir);
  });
}

function fixAufrufe(dir) {
  const pfad = join(dir, ".claude", "fix-zaehler");
  return existsSync(pfad) ? Number(readFileSync(pfad, "utf-8")) : 0;
}

function protokoll(dir) {
  const pfad = join(dir, ".claude", "protokoll.txt");
  return existsSync(pfad) ? readFileSync(pfad, "utf-8").trim().split("\n") : [];
}

test("[1609] Rote Prüfung beim Abschluss eines Pakets — checks.mjs formatiert einmal nach, prüft einmal neu und meldet beides", async () => {
  // Hilft der Fix, endet der Abschluss gruen.
  await imProjekt({ mitFix: true }, async (dir) => {
    const res = await run(dir, "--finish", "1");
    const ausgabe = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 0, ausgabe);
    assert.equal(fixAufrufe(dir), 1, "der Fix lief nicht genau einmal");
    assert.deepEqual(protokoll(dir), ["pruef", "pruef", "fix", "pruef"],
      "der Fix laeuft erst nach der Wiederholung, danach genau ein Durchgang ohne neue Wiederholung");
    assert.equal(readFileSync(join(dir, "src", "kaputt.txt"), "utf-8"), "ok\n");

    const z = zusammenfassung(dir);
    assert.deepEqual(z.formatFix, { cmd: FIX, gereicht: true });
    assert.equal(z.laufen[0].ergebnis, "gruen");
    assert.equal(z.hashes["src/kaputt.txt"], git(dir, "hash-object", "src/kaputt.txt"),
      "die Blob-Hashes bezeugen den Stand nach dem Fix");
    const block = ausgabe.slice(ausgabe.indexOf("Fuer den Abschlussbericht:"));
    assert.match(block, new RegExp(`Format-Fix: ${FIX} → ausgefuehrt`));
    assert.match(block, /Arbeitsbaum ist veraendert/);
    assert.doesNotMatch(block, /hat nicht gereicht/);
    assert.ok(z.berichtszeilen.some((zeile) => zeile.startsWith(`Format-Fix: ${FIX} → ausgefuehrt`)));

    // Ein Lauf im Protokoll: alle Zeilen tragen dieselbe Laufkennung, und die Zeilen des
    // zweiten Durchgangs tragen keine Wiederholungsmarke.
    const zeilen = ausfuehrungen(dir).map((zeile) => zeile.split("\t"));
    assert.equal(zeilen.length, 3, zeilen.join("\n"));
    assert.ok(zeilen.every((s) => s.length === 12), "das Format der Zeilen hat sich geaendert");
    // Spalte 6 ist die Laufkennung (`ausfuehrungSchreiben`).
    const kennungen = new Set(zeilen.map((s) => s[5]));
    assert.equal(kennungen.size, 1, `mehr als eine Laufkennung: ${[...kennungen].join(", ")}`);
    assert.deepEqual(zeilen.map((s) => s.at(-1)), ["erstlauf", "wiederholung", ""]);
    assert.notEqual(z.zeitpunkt, [...kennungen][0], "der zweite Durchgang hat einen neuen Zeitpunkt");
  });

  // Hilft der Fix nicht, bleibt der Lauf rot und sagt es.
  await imProjekt({ mitFix: true, hilftNicht: true }, async (dir) => {
    const res = await run(dir, "--finish", "1");
    const ausgabe = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 1, ausgabe);
    assert.equal(fixAufrufe(dir), 1, "nie ein zweiter Fix");
    assert.deepEqual(protokoll(dir), ["pruef", "pruef", "fix", "pruef"], "nie ein dritter Durchgang");
    assert.match(ausgabe, new RegExp(`Format-Fix: ${FIX} → ausgefuehrt`));
    assert.match(ausgabe, /Format-Fix lief und hat nicht gereicht/);
    assert.deepEqual(zusammenfassung(dir).formatFix, { cmd: FIX, gereicht: false });
  });

  // Ohne formatFixCommand laeuft kein Fix.
  await imProjekt({ mitFix: false }, async (dir) => {
    const res = await run(dir, "--finish", "1");
    assert.equal(res.status, 1);
    assert.equal(fixAufrufe(dir), 0);
    assert.doesNotMatch(res.stdout, /Format-Fix/);
    assert.equal(zusammenfassung(dir).formatFix, undefined);
  });

  // An --stage push ebenfalls nicht: Dort wird der Stand gemessen, der hinausgeht.
  await imProjekt({ mitFix: true }, async (dir) => {
    const res = await run(dir, "--stage", "push");
    assert.equal(res.status, 1);
    assert.equal(fixAufrufe(dir), 0);
    assert.doesNotMatch(res.stdout, /Format-Fix/);
  });
});

test("[1672] ohne --finish laeuft der Fix an der Paketstufe ebenso, ohne Wiederholung", async () => {
  await imProjekt({ mitFix: true }, async (dir) => {
    const res = await run(dir);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.deepEqual(protokoll(dir), ["pruef", "fix", "pruef"]);
    assert.deepEqual(zusammenfassung(dir).formatFix, { cmd: FIX, gereicht: true });

    // Ein zweiter Aufruf auf dem Stand nach dem Fix uebernimmt — samt Format-Fix.
    const nochmal = await run(dir);
    assert.equal(nochmal.status, 0);
    assert.equal(fixAufrufe(dir), 1);
    assert.deepEqual(zusammenfassung(dir).formatFix, { cmd: FIX, gereicht: true });
    assert.match(nochmal.stdout, new RegExp(`Format-Fix: ${FIX} → ausgefuehrt`));
  });
});

test("[1672] ein gruener Lauf faehrt keinen Fix", async () => {
  await imProjekt({ mitFix: true }, async (dir) => {
    datei(dir, "src/kaputt.txt", "ok\n");
    const res = await run(dir, "--finish", "1");
    assert.equal(res.status, 0);
    assert.equal(fixAufrufe(dir), 0);
    assert.equal(zusammenfassung(dir).formatFix, undefined);
  });
});
