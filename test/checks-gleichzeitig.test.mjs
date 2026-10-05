// Die Achse `gleichzeitig` in `checks.mjs run` (Issue #1071, Plan #1066, A1, A2, A5,
// A6, A8, E2, E3).
//
// Gekennzeichnete Pruefungen laufen in einer ersten Phase gleichzeitig, hoechstens
// zwei (`KIT_CHECKS_GLEICHZEITIG`, Issue #1178), die uebrigen danach nacheinander wie bisher. Die
// gleichzeitige Phase laeuft ganz durch, damit alle roten bekannt sind; die folgende
// bricht beim ersten Rot ab und startet nach einem Rot der ersten Phase gar nicht.
//
// Die Ausgabe bleibt lesbar: Jede Pruefung steht als geschlossener Block in
// Config-Reihenfolge, auch wenn eine spaetere zuerst fertig ist. Und der Bericht sagt
// bei jeder gleichzeitig gemessenen Dauer, dass sie neben anderen gemessen wurde —
// eine solche Dauer ist nicht die, die die Pruefung allein braeuchte.
//
// Die Zeiten sind bewusst grob: Zwei Kommandos zu je 1,5 s, deren Summe ueber der
// Wanduhr des ganzen Laufs liegen muss. Ein Lauf nacheinander kommt daran nie vorbei,
// einer gleichzeitig mit viel Luft.
//
// Jeder Lauf setzt `KIT_CHECKS_GLEICHZEITIG` selbst (Issue #1178): Wer den Wert fuer
// einen Prueflauf setzt, erbt ihn sonst bis hierher, und mit `1` liefe der Test auf
// das Ueberlappen nacheinander und waere rot, ohne dass `checks.mjs` schuld ist.

import "./helpers/checks-sperre.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CHECKS, mitRepo, zusammenfassung, datei, eintrag, ausfuehrungen,
} from "./helpers/checks-repo.mjs";

/** Ein Kommando, das `ms` Millisekunden schlaeft und danach `text` ausgibt. */
function schlaeft(ms, text) {
  return `node -e "setTimeout(() => console.log('${text}'), ${ms})"`;
}

/** Ein rotes Kommando, an seiner Ausgabe erkennbar. */
function rot(text) {
  return `node -e "console.log('${text}'); process.exit(1)"`;
}

/** `run` mit festgelegter Grenze gleichzeitiger Pruefungen, unabhaengig von der Umgebung. */
function runMit(dir, grenze = "2") {
  return spawnSync(process.execPath, [CHECKS, "run"], {
    cwd: dir, encoding: "utf-8", env: { ...process.env, KIT_CHECKS_GLEICHZEITIG: grenze },
  });
}

test("zwei gekennzeichnete Kommandos laufen ueberlappend: die Wartezeit liegt unter der Summe ihrer Dauern", () => {
  const a = schlaeft(1500, "a fertig");
  const b = schlaeft(1500, "b fertig");
  const config = { buildChecks: [{ cmd: a, gleichzeitig: true }, { cmd: b, gleichzeitig: true }] };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/x.txt");

    const res = runMit(dir);

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
    const z = zusammenfassung(dir);
    const summe = eintrag(z.laufen, a).dauerMs + eintrag(z.laufen, b).dauerMs;
    assert.ok(z.wartezeitMs < summe,
      `Wartezeit ${z.wartezeitMs} ms liegt nicht unter der Summe der Dauern ${summe} ms — nacheinander gelaufen?`);
  });
});

test("die Ausgabe erscheint in Config-Reihenfolge als geschlossene Bloecke, auch wenn das zweite zuerst endet", () => {
  const langsam = schlaeft(1200, "ausgabe-langsam");
  const schnell = schlaeft(10, "ausgabe-schnell");
  const config = { buildChecks: [{ cmd: langsam, gleichzeitig: true }, { cmd: schnell, gleichzeitig: true }] };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/x.txt");

    const res = runMit(dir);

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
    const out = res.stdout;
    const stellen = [
      out.indexOf(`$ ${langsam} — `),
      out.indexOf("ausgabe-langsam"),
      out.indexOf("-> gruen"),
      out.indexOf(`$ ${schnell} — `),
      out.indexOf("ausgabe-schnell"),
      out.lastIndexOf("-> gruen"),
    ];
    assert.ok(stellen.every((s) => s >= 0), `ein Teil der Bloecke fehlt:\n${out}`);
    assert.deepEqual([...stellen].sort((x, y) => x - y), stellen,
      `die Bloecke stehen nicht geschlossen in Config-Reihenfolge:\n${out}`);
    assert.notEqual(stellen[2], stellen[5], "es steht nur ein Ergebnis da");
  });
});

test("zwei rote gekennzeichnete Kommandos stehen beide rot da, ein nicht gekennzeichnetes danach startet nicht", () => {
  const r1 = rot("rot-eins");
  const r2 = rot("rot-zwei");
  const danach = "echo x > lief.txt";
  const config = { buildChecks: [{ cmd: r1, gleichzeitig: true }, { cmd: r2, gleichzeitig: true }, danach] };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/x.txt");

    const res = runMit(dir);

    assert.equal(res.status, 1, `ein roter Lauf endet mit 1, nicht ${res.status}`);
    const z = zusammenfassung(dir);
    assert.equal(eintrag(z.laufen, r1).ergebnis, "rot");
    assert.equal(eintrag(z.laufen, r2).ergebnis, "rot", "die gleichzeitige Phase lief nicht ganz durch");
    assert.equal(eintrag(z.laufen, danach).ergebnis, "nicht gestartet");
    assert.ok(!existsSync(join(dir, "lief.txt")), "die nachfolgende Phase lief trotz Rot der ersten");
    assert.equal(z.abgeschlossen, true);
  });
});

test("KIT_CHECKS_GLEICHZEITIG=1 faehrt die gekennzeichneten nacheinander", () => {
  const a = schlaeft(700, "a fertig");
  const b = schlaeft(700, "b fertig");
  const config = { buildChecks: [{ cmd: a, gleichzeitig: true }, { cmd: b, gleichzeitig: true }] };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/x.txt");

    const res = runMit(dir, "1");

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
    const z = zusammenfassung(dir);
    const summe = eintrag(z.laufen, a).dauerMs + eintrag(z.laufen, b).dauerMs;
    assert.ok(z.wartezeitMs >= summe,
      `Wartezeit ${z.wartezeitMs} ms liegt unter der Summe ${summe} ms — doch gleichzeitig gelaufen?`);
    assert.ok(!res.stdout.includes("(neben anderen gemessen)"),
      "eine allein gemessene Dauer traegt den Vermerk der gleichzeitigen");
  });
});

test("ein gleichzeitig gelaufenes Kommando: Vermerk in der Berichtszeile, Feld in laufen[], Spalte im Protokoll", () => {
  const a = schlaeft(10, "a");
  const b = schlaeft(10, "b");
  const config = { buildChecks: [{ cmd: a, gleichzeitig: true }, { cmd: b, gleichzeitig: true }] };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/x.txt");

    const res = runMit(dir);

    assert.equal(res.status, 0, `run endete mit ${res.status}: ${res.stdout}${res.stderr}`);
    const z = zusammenfassung(dir);
    for (const cmd of [a, b]) {
      assert.equal(eintrag(z.laufen, cmd).gleichzeitig, true, `laufen[] traegt gleichzeitig nicht fuer ${cmd}`);
      const zeile = z.berichtszeilen.find((l) => l.startsWith(`gelaufen: ${cmd} → `));
      assert.match(zeile, /→ gruen, [\d.]+ s \(neben anderen gemessen\) — /, `Berichtszeile ohne Vermerk: ${zeile}`);
      assert.ok(res.stdout.includes(zeile), "der Block 'Fuer den Abschlussbericht:' traegt die Zeile nicht");
    }
    const zeilen = ausfuehrungen(dir);
    assert.equal(zeilen.length, 2);
    for (const zeile of zeilen) {
      assert.equal(zeile.split("\t").at(-1), "gleichzeitig", `die Protokollzeile traegt hinten nicht die Spalte: ${zeile}`);
    }
  });
});

test("--help nennt KIT_CHECKS_GLEICHZEITIG und die Vorgabe 2", () => {
  const res = spawnSync(process.execPath, [CHECKS, "--help"], { encoding: "utf-8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /KIT_CHECKS_GLEICHZEITIG/);
  assert.match(res.stdout, /Vorgabe 2;/);
  assert.doesNotMatch(res.stdout, /sequenziell/, "die Hilfe spricht noch vom sequenziellen Lauf");
});

test("ohne Achse ist der Ablauf wie bisher: nacheinander, Abbruch beim ersten Rot", () => {
  const r = rot("rot-eins");
  const danach = "echo x > lief.txt";
  const config = { buildChecks: [r, { cmd: danach }] };
  mitRepo({ config }, (dir) => {
    datei(dir, "src/x.txt");

    const res = runMit(dir);

    assert.equal(res.status, 1);
    const z = zusammenfassung(dir);
    assert.equal(eintrag(z.laufen, r).ergebnis, "rot");
    assert.equal(eintrag(z.laufen, danach).ergebnis, "nicht gestartet");
    assert.equal(eintrag(z.laufen, r).gleichzeitig, undefined, "ein allein gelaufenes Kommando traegt das Feld");
    assert.ok(!existsSync(join(dir, "lief.txt")));
    assert.ok(!res.stdout.includes("(neben anderen gemessen)"));
    assert.equal(ausfuehrungen(dir)[0].split("\t").at(-1), "", "die Spalte gleichzeitig ist ohne Achse nicht leer");
  });
});
