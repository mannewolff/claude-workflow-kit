// Ablauf-Pruefung: Ob der Mutationstest wirklich einmal nach den Pruefungen laeuft und den Ausgang des Laufs nicht beruehrt, zeigen nur echte Kommandos in einem echten Repository.
//
// Der Mutationstest in `checks.mjs run --stage push` (Issue #1673, Plan #1671, E3; fachliche
// Quelle #1609, Kriterium 4). `mutationCommand` laeuft nach allen `buildChecks` genau einmal,
// auch mit `--retry`, nie an der Paketstufe und nie an `--stage merge`. Sein Ergebnis wird
// nur berichtet: Exit-Code und `ok` bleiben unberuehrt, und `.claude/ausfuehrungen.tsv`
// bekommt keine Zeile.
//
// Die Pruefung `pruef.mjs` ist rot, solange `.claude/pruef-rot` existiert. Der Mutationstest
// `mutation.mjs` zaehlt seine Aufrufe in `.claude/mutation-zaehler` und endet rot, solange
// `.claude/mutation-rot` existiert; mit `.claude/mutation-haengt` endet er nie von selbst. Beide haengen ihren Namen an `.claude/protokoll.txt`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mitRepo, run, checksMit, zusammenfassung, datei, ausfuehrungen, ausfuehrungenPfad } from "./helpers/checks-repo.mjs";

const PRUEFUNG = "node .claude/pruef.mjs";
const MUTATION = "node .claude/mutation.mjs";

function werkzeugeAnlegen(dir) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "pruef.mjs"), [
    "import { appendFileSync, existsSync } from 'node:fs';",
    String.raw`appendFileSync('.claude/protokoll.txt', 'pruef\n');`,
    "process.exit(existsSync('.claude/pruef-rot') ? 1 : 0);",
    "",
  ].join("\n"), "utf-8");
  writeFileSync(join(dir, ".claude", "mutation.mjs"), [
    "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
    String.raw`appendFileSync('.claude/protokoll.txt', 'mutation\n');`,
    "const zaehler = '.claude/mutation-zaehler';",
    "writeFileSync(zaehler, String((existsSync(zaehler) ? Number(readFileSync(zaehler, 'utf-8')) : 0) + 1));",
    // Haengt, bis die Obergrenze ihn abbricht: Ein Intervall haelt den Prozess am Leben.
    "if (existsSync('.claude/mutation-haengt')) setInterval(() => {}, 1000);",
    "else process.exit(existsSync('.claude/mutation-rot') ? 3 : 0);",
    "",
  ].join("\n"), "utf-8");
}

/** Ein Wegwerfprojekt mit Pruefung und Mutationstest; `fn(dir)` laeuft darin. */
function imProjekt({ pruefungRot = false, mutationRot = false, haengt = false } = {}, fn) {
  return mitRepo({ config: { buildChecks: [{ cmd: PRUEFUNG }], mutationCommand: ` ${MUTATION} ` } }, async (dir) => {
    werkzeugeAnlegen(dir);
    datei(dir, "src/a.txt", "a\n");
    if (pruefungRot) writeFileSync(join(dir, ".claude", "pruef-rot"), "", "utf-8");
    if (mutationRot) writeFileSync(join(dir, ".claude", "mutation-rot"), "", "utf-8");
    if (haengt) writeFileSync(join(dir, ".claude", "mutation-haengt"), "", "utf-8");
    return fn(dir);
  });
}

function mutationAufrufe(dir) {
  const pfad = join(dir, ".claude", "mutation-zaehler");
  return existsSync(pfad) ? Number(readFileSync(pfad, "utf-8")) : 0;
}

function protokoll(dir) {
  const pfad = join(dir, ".claude", "protokoll.txt");
  return existsSync(pfad) ? readFileSync(pfad, "utf-8").trim().split("\n") : [];
}

function block(ausgabe) {
  return ausgabe.slice(ausgabe.indexOf("Fuer den Abschlussbericht:"));
}

test("[1609] Vor dem Veröffentlichen läuft der Mutationstest einmal nach den Prüfungen und wird nur berichtet", async () => {
  await imProjekt({}, async (dir) => {
    const res = await run(dir, "--stage", "push");
    const ausgabe = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 0, ausgabe);
    assert.deepEqual(protokoll(dir), ["pruef", "mutation"], "der Mutationstest laeuft nach den buildChecks");
    assert.match(res.stdout, new RegExp(`^Stufe push:.*${MUTATION}`, "m"), "die Zeile Stufe push: kuendigt ihn nicht an");

    const z = zusammenfassung(dir);
    assert.equal(z.mutation.cmd, MUTATION);
    assert.equal(z.mutation.ergebnis, "gruen");
    assert.equal(z.mutation.exit, 0);
    assert.equal(typeof z.mutation.dauerMs, "number");
    assert.match(block(ausgabe), new RegExp(`Mutationstest: ${MUTATION} → gruen \\(Exit 0\\), [^—]+ — nur berichtet, haelt nicht an`));
    assert.ok(z.berichtszeilen.some((zeile) => zeile.startsWith(`Mutationstest: ${MUTATION} → gruen`)));

    // Keine Zeile im Ausfuehrungsprotokoll: allein die der Pruefung.
    const zeilen = ausfuehrungen(dir);
    assert.equal(zeilen.length, 1, zeilen.join("\n"));
    assert.ok(!zeilen.some((zeile) => zeile.includes(MUTATION)));
  });
});

test("[1673] ein roter Mutationstest laesst den Exit-Code bei 0, auch mit --retry genau ein Lauf", async () => {
  await imProjekt({ mutationRot: true }, async (dir) => {
    const res = await run(dir, "--stage", "push", "--retry");
    const ausgabe = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 0, ausgabe);
    assert.equal(mutationAufrufe(dir), 1, "der Mutationstest lief nicht genau einmal");
    const z = zusammenfassung(dir);
    assert.deepEqual({ ergebnis: z.mutation.ergebnis, exit: z.mutation.exit }, { ergebnis: "rot", exit: 3 });
    assert.equal(z.laufen[0].ergebnis, "gruen");
    assert.match(block(ausgabe), /Mutationstest: .* → rot \(Exit 3\), .* — nur berichtet, haelt nicht an/);
    assert.ok(!existsSync(ausfuehrungenPfad(dir)) || !readFileSync(ausfuehrungenPfad(dir), "utf-8").includes(MUTATION));
  });
});

test("[1673] reisst der Mutationstest die Obergrenze, wird er abgebrochen und ist rot, ohne den Ausgang zu aendern", async () => {
  await imProjekt({ haengt: true }, async (dir) => {
    const res = await checksMit(dir, { env: { KIT_CHECKS_PRUEFDAUER_OBERGRENZE_MS: "1500" } }, "run", "--stage", "push");
    const ausgabe = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 0, ausgabe);
    const z = zusammenfassung(dir);
    assert.equal(z.mutation.ergebnis, "rot");
    assert.equal(z.mutation.exit, null);
    assert.match(block(ausgabe), /Mutationstest: .* → rot \(ohne Rueckgabewert\)/);
    assert.ok(z.mutation.dauerMs < 15000, `nicht abgebrochen: ${z.mutation.dauerMs} ms`);
  });
});

test("[1673] bei roter Pflichtpruefung faellt der Mutationstest weg", async () => {
  await imProjekt({ pruefungRot: true }, async (dir) => {
    const res = await run(dir, "--stage", "push");
    const ausgabe = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 1, ausgabe);
    assert.equal(mutationAufrufe(dir), 0);
    assert.match(block(ausgabe), /^Mutationstest: ausgelassen, die Pruefung ist rot$/m);
    assert.equal(zusammenfassung(dir).mutation, undefined);
  });
});

test("[1673] an der Paketstufe und an --stage merge laeuft der Mutationstest nicht", async () => {
  for (const args of [[], ["--finish", "1"], ["--stage", "merge"]]) {
    await imProjekt({}, async (dir) => {
      const res = await run(dir, ...args);
      assert.equal(res.status, 0, `${args.join(" ")}: ${res.stdout}${res.stderr}`);
      assert.equal(mutationAufrufe(dir), 0, args.join(" "));
      assert.doesNotMatch(res.stdout, /Mutationstest/);
      assert.equal(zusammenfassung(dir).mutation, undefined);
    });
  }
});

test("[1673] ein uebernommener Push-Lauf faehrt den Mutationstest nicht neu und nennt sein Ergebnis", async () => {
  await imProjekt({}, async (dir) => {
    assert.equal((await run(dir, "--stage", "push")).status, 0);
    const nochmal = await run(dir, "--stage", "push");
    assert.equal(nochmal.status, 0);
    assert.equal(mutationAufrufe(dir), 1);
    assert.equal(zusammenfassung(dir).mutation.ergebnis, "gruen");
    assert.match(block(nochmal.stdout), /Mutationstest: .* → gruen \(Exit 0\)/);
  });
});
