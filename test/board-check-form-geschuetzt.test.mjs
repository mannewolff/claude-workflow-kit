// `issue check-form` — I7 bis I9 am Arbeitspaket (Issue #1044, Plan #987, fachliche Quelle #868).
//
// Zwei Naechte endeten hart an einem Paket, das eine geschuetzte Datei aendern sollte. Die
// drei Gates fangen das beim Schneiden ab: I7 verlangt, dass `## Aufgabe` ueberhaupt eine
// Datei nennt — ohne sie findet die Erkennung nichts —, I8 weist eine geschuetzte Datei ab
// (sie gehoert als `[Mensch]`-Karte heraus), I9 die installierte Kopie statt der Quelle.
// Ein `[Mensch]`-Paket besteht alle drei (E8).
//
// Geschuetzte und Kopie-Pfade kommen aus `GESCHUETZTE_PFADE` und `KOPIE_PFADE`, nie als
// Literal (E18): Sonst hielte das eigene Gate die Pakete dieses Plans an.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { pruefeForm, GESCHUETZTE_PFADE, KOPIE_PFADE } from "../kit/board.mjs";
import { setupProjekt, runBoard } from "./helpers/board-fixture.mjs";

const EINSTELLUNGEN = GESCHUETZTE_PFADE[0];
const KOPIE_KIT = `${KOPIE_PFADE[0]}board.mjs`;
const KOPIE_ANLEITUNG = KOPIE_PFADE.find((p) => p.includes("*")).replace("*", "workflow");

function paket({ aufgabe = "In `kit/board.mjs` etwas aendern.", kriterium = "- `node --test` ist gruen." } = {}) {
  return `## Kontext
Warum.

Autor-Modell: fixture-modell

## Aufgabe
${aufgabe}

## Akzeptanzkriterium
${kriterium}

## Abhängigkeiten
Keine.
`;
}

/** Eine leere Projektwurzel ohne Einstellungen: Es gilt nur die Vorgabeliste. */
function mitWurzel(fn) {
  const wurzel = mkdtempSync(join(tmpdir(), "check-form-geschuetzt-"));
  try {
    return fn(wurzel);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
}

function pruefe(body, title, wurzel) {
  return pruefeForm(body, title, {}, [], wurzel);
}

function gate(ergebnis, kennung) {
  return ergebnis.verstoesse.filter((v) => v.gate === kennung);
}

// --- I7: die Aufgabe nennt eine Datei -----------------------------------------------

test("I7 weist ein Paket ohne Backtick-Pfad in der Aufgabe ab", () => {
  mitWurzel((wurzel) => {
    const r = pruefe(paket({ aufgabe: "Etwas am Kit aendern." }), "[Task] Etwas", wurzel);
    assert.equal(r.ok, false);
    assert.equal(gate(r, "I7").length, 1);
    assert.match(gate(r, "I7")[0].meldung, /## Aufgabe/);
  });
});

test("I7 zaehlt ein Label oder eine Konstante nicht als Dateipfad", () => {
  mitWurzel((wurzel) => {
    for (const aufgabe of ["Das Label `kit:geschuetzt` setzen.", "Die Konstante `KOPIE_PFADE` erweitern."]) {
      const r = pruefe(paket({ aufgabe }), "[Task] Etwas", wurzel);
      assert.equal(gate(r, "I7").length, 1, aufgabe);
    }
  });
});

test("I7 laesst ein Paket mit Pfad oder Dateiendung durch", () => {
  mitWurzel((wurzel) => {
    for (const aufgabe of ["In `kit/board.mjs` etwas aendern.", "In `README.md` etwas aendern.", "Unter `docs/` etwas aendern."]) {
      const r = pruefe(paket({ aufgabe }), "[Task] Etwas", wurzel);
      assert.deepEqual(r, { ok: true, stufe: "issue", verstoesse: [] }, aufgabe);
    }
  });
});

test("I7 liest nur die Aufgabe — ein Pfad allein im Kriterium genuegt nicht", () => {
  mitWurzel((wurzel) => {
    const r = pruefe(paket({ aufgabe: "Etwas aendern.", kriterium: "- `node --test test/a.test.mjs` ist gruen.\n- `test/a.test.mjs` existiert." }), "[Task] Etwas", wurzel);
    assert.equal(gate(r, "I7").length, 1);
  });
});

// --- I8: eine genannte Datei ist geschuetzt -----------------------------------------

test("I8 weist eine geschuetzte Datei in der Aufgabe ab und nennt Pfad und Zeile", () => {
  mitWurzel((wurzel) => {
    const zeile = `In \`${EINSTELLUNGEN}\` einen Eintrag ergaenzen.`;
    const r = pruefe(paket({ aufgabe: zeile }), "[Task] Etwas", wurzel);
    assert.equal(r.ok, false);
    const i8 = gate(r, "I8");
    assert.equal(i8.length, 1);
    assert.ok(i8[0].meldung.includes(EINSTELLUNGEN), i8[0].meldung);
    assert.ok(i8[0].meldung.includes(zeile), i8[0].meldung);
    assert.match(i8[0].meldung, /\[Mensch\]-Karte/);
    assert.equal(gate(r, "I7").length, 0, "ein geschuetzter Pfad ist auch ein Pfad");
  });
});

test("I8 liest auch das Akzeptanzkriterium", () => {
  mitWurzel((wurzel) => {
    const r = pruefe(paket({ kriterium: `- \`${GESCHUETZTE_PFADE.at(-1)}pre-commit.sh\` ist ausfuehrbar.` }), "[Task] Etwas", wurzel);
    assert.equal(gate(r, "I8").length, 1);
  });
});

test("I8 liest die Schreibsperren aus den Einstellungen der Wurzel", () => {
  mitWurzel((wurzel) => {
    mkdirSync(join(wurzel, ".claude"));
    writeFileSync(join(wurzel, EINSTELLUNGEN), JSON.stringify({ permissions: { deny: ["Edit(docs/geheim.md)"] } }));
    const r = pruefe(paket({ aufgabe: "In `docs/geheim.md` etwas aendern." }), "[Task] Etwas", wurzel);
    assert.equal(gate(r, "I8").length, 1);
  });
});

// --- I9: die installierte Kopie statt der Quelle ------------------------------------

test("I9 weist die installierte Kopie in der Aufgabe ab und nennt Quelle und Kit-Update", () => {
  mitWurzel((wurzel) => {
    for (const pfad of [KOPIE_KIT, KOPIE_ANLEITUNG]) {
      const r = pruefe(paket({ aufgabe: `In \`${pfad}\` etwas aendern.` }), "[Task] Etwas", wurzel);
      assert.equal(r.ok, false, pfad);
      const i9 = gate(r, "I9");
      assert.equal(i9.length, 1, pfad);
      assert.ok(i9[0].meldung.includes(pfad), i9[0].meldung);
      assert.match(i9[0].meldung, /die Quelle unter `kit\/`/);
      assert.match(i9[0].meldung, /Kit-Update/);
      assert.equal(gate(r, "I8").length, 0, "die Kopie ist kein geschuetzter Pfad");
    }
  });
});

test("I9 laesst ein Akzeptanzkriterium durch, das die Kopie aufruft", () => {
  mitWurzel((wurzel) => {
    const kriterium = `- \`node ${KOPIE_PFADE[0]}checks.mjs run\` endet mit Exit 0.\n- \`${KOPIE_KIT}\` ist aufgefrischt.`;
    const r = pruefe(paket({ kriterium }), "[Task] Etwas", wurzel);
    assert.deepEqual(r, { ok: true, stufe: "issue", verstoesse: [] });
  });
});

// --- [Mensch] besteht alle drei ------------------------------------------------------

test("ein [Mensch]-Paket besteht I7, I8 und I9", () => {
  mitWurzel((wurzel) => {
    for (const aufgabe of ["Am Board ein Label anlegen.", `In \`${EINSTELLUNGEN}\` einen Eintrag ergaenzen.`, `\`${KOPIE_KIT}\` pruefen.`]) {
      const r = pruefe(paket({ aufgabe }), "[Mensch] Etwas", wurzel);
      assert.deepEqual(r.verstoesse.filter((v) => ["I7", "I8", "I9"].includes(v.gate)), [], aufgabe);
    }
  });
});

// --- Kommandozeile -------------------------------------------------------------------

test("check-form liest die Schreibsperren aus der Projektwurzel der Config", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local" }, "board-check-form-geschuetzt-");
  try {
    writeFileSync(join(dir, EINSTELLUNGEN), JSON.stringify({ permissions: { deny: ["Write(docs/geheim.md)"] } }));
    const datei = join(dir, "paket.md");
    writeFileSync(datei, paket({ aufgabe: "In `docs/geheim.md` etwas aendern." }));
    const res = runBoard(dir, ["issue", "check-form", "--body-file", datei, "--title", "[Task] Etwas"]);
    assert.equal(res.status, 1, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout).verstoesse.map((v) => v.gate), ["I8"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("die Hilfe zu check-form nennt I1 bis I9", () => {
  const dir = setupProjekt({ codeHost: "local", issueTracker: "local" }, "board-check-form-geschuetzt-");
  try {
    const res = runBoard(dir, ["--help"]);
    assert.match(res.stdout, /Arbeitspaket I1 bis I9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
