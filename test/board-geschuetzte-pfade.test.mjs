// Die Erkennung geschuetzter Pfade (Issue #1041, Plan #987, Verifizierung 1).
//
// Zwei Naechte endeten hart, weil ein Paket eine Datei aendern sollte, die nur ein Mensch
// schreiben darf. Diese Datei prueft das Fundament: die eine Stelle in kit/board.mjs, die
// entscheidet, ob ein Paket einen geschuetzten Pfad beim Namen nennt. Formgates, Kommando
// und Runner-Gate bauen darauf auf und pruefen sich in eigenen Dateien.
//
// Beispielpfade kommen aus GESCHUETZTE_PFADE, nicht als Literal (E18): Ein Literal liefe
// auseinander, sobald die Vorgabeliste sich aendert, und der Test bezeugte dann eine Liste,
// die das Gate nicht fuehrt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  GESCHUETZTE_PFADE,
  KOPIE_PFADE,
  geschuetztePfade,
  trifftGeschuetzt,
  pfadTokens,
  geschuetzteTreffer,
} from "../kit/board.mjs";

const TICK = "`";
const ERSTER = GESCHUETZTE_PFADE[0];
const VERZEICHNIS = GESCHUETZTE_PFADE.find((e) => e.endsWith("/"));
const PRUEFEINSTELLUNGEN = [".claude", "workflow.config.json"].join("/");
// Zusammengesetzt, nicht als Literal: Die Kopplungserhebung (test/config-teile.test.mjs)
// zaehlt jede Erwaehnung eines Quellpfads und hielte diese Datei sonst fuer einen Test des
// Pruefkommandos, den es nicht laedt.
const KOPIE_AUFRUF = ["node .claude/kit", "checks.mjs run"].join("/");

function leereWurzel() {
  return mkdtempSync(join(tmpdir(), "geschuetzt-leer-"));
}

function wurzelMitEinstellungen(datei, inhalt) {
  const wurzel = mkdtempSync(join(tmpdir(), "geschuetzt-deny-"));
  mkdirSync(join(wurzel, ".claude"), { recursive: true });
  writeFileSync(join(wurzel, datei), typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt));
  return wurzel;
}

function paket({ kontext = "Ohne Pfad.", aufgabe = "Nichts Geschuetztes.", kriterium = "- Tests gruen." } = {}) {
  return [
    "## Kontext", kontext, "",
    "## Aufgabe", aufgabe, "",
    "## Akzeptanzkriterium", kriterium, "",
    "## Abhaengigkeiten", "Keine.", "",
  ].join("\n");
}

// --- Die Tabellen -------------------------------------------------------------

test("[board-1041] die Vorgabeliste fuehrt Einstellungsdateien und das Hook-Verzeichnis, nicht die Pruefeinstellungen", () => {
  assert.ok(GESCHUETZTE_PFADE.length >= 3);
  assert.ok(VERZEICHNIS, "die Vorgabeliste fuehrt ein Verzeichnis mit Endung /");
  assert.equal(GESCHUETZTE_PFADE.includes(PRUEFEINSTELLUNGEN), false);
  assert.ok(Object.isFrozen(GESCHUETZTE_PFADE));
  assert.ok(Object.isFrozen(KOPIE_PFADE));
});

test("[board-1041] die installierte Kopie trifft Werkzeuge, Skills und die CLAUDE-Dokumente, nicht die Quelle", () => {
  const trifftKopie = (token) => KOPIE_PFADE.some((e) => trifftGeschuetzt(token, e));
  assert.equal(trifftKopie(".claude/kit/board.mjs"), true);
  assert.equal(trifftKopie(".claude/skills/task/SKILL.md"), true);
  assert.equal(trifftKopie(".claude/CLAUDE-workflow.md"), true);
  assert.equal(trifftKopie("kit/board.mjs"), false);
  assert.equal(trifftKopie("skills/task/SKILL.md"), false);
  assert.equal(trifftKopie(".claude/CLAUDE.md"), false);
});

// --- trifftGeschuetzt (E16) ---------------------------------------------------

test("[board-1041] trifftGeschuetzt: Gleichheit trifft, ein fuehrendes ./ aendert nichts", () => {
  assert.equal(trifftGeschuetzt(ERSTER, ERSTER), true);
  assert.equal(trifftGeschuetzt(`./${ERSTER}`, ERSTER), true);
});

test("[board-1041] trifftGeschuetzt: ein Token unterhalb eines Verzeichniseintrags trifft", () => {
  assert.equal(trifftGeschuetzt(`${VERZEICHNIS}pre-commit.sh`, VERZEICHNIS), true);
  assert.equal(trifftGeschuetzt(`${VERZEICHNIS}tief/drin.mjs`, VERZEICHNIS), true);
  assert.equal(trifftGeschuetzt(VERZEICHNIS.slice(0, -1), VERZEICHNIS), true, "das Verzeichnis selbst ohne Endung /");
  assert.equal(trifftGeschuetzt(`${VERZEICHNIS.slice(0, -1)}-alt/x.sh`, VERZEICHNIS), false, "nur an der Segmentgrenze");
});

test("[board-1041] trifftGeschuetzt: ein Glob aus deny trifft nach seinen Regeln", () => {
  assert.equal(trifftGeschuetzt("/abs/x/y.txt", "/abs/**"), true);
  assert.equal(trifftGeschuetzt("config/geheim.json", "config/*.json"), true);
  assert.equal(trifftGeschuetzt("config/tief/geheim.json", "config/*.json"), false, "* bleibt im Segment");
  assert.equal(trifftGeschuetzt("config/tief/geheim.json", "config/**/*.json"), true);
  assert.equal(trifftGeschuetzt("config/geheim.json", "config/**/*.json"), true, "** samt Trenner darf leer sein");
  assert.equal(trifftGeschuetzt("a/b/.env", "*.env"), true, "ein Muster ohne Schraegstrich gilt in jeder Tiefe");
  assert.equal(trifftGeschuetzt("datei1.txt", "datei?.txt"), true);
});

test("[board-1041] trifftGeschuetzt: ein fremder Pfad trifft nicht", () => {
  for (const eintrag of GESCHUETZTE_PFADE) {
    assert.equal(trifftGeschuetzt("kit/board.mjs", eintrag), false, eintrag);
    assert.equal(trifftGeschuetzt(PRUEFEINSTELLUNGEN, eintrag), false, eintrag);
  }
  assert.equal(trifftGeschuetzt("/anders/x.txt", "/abs/**"), false);
  assert.equal(trifftGeschuetzt(`praefix-${ERSTER}`, ERSTER), false);
});

// --- geschuetztePfade (E2, E16) -----------------------------------------------

test("[board-1041] geschuetztePfade ohne Einstellungsdatei liefert genau die Vorgabeliste", () => {
  const wurzel = leereWurzel();
  try {
    assert.deepEqual(geschuetztePfade(wurzel), [...GESCHUETZTE_PFADE]);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] geschuetztePfade nimmt deny-Muster aus der Team-Einstellung normalisiert auf", () => {
  const wurzel = wurzelMitEinstellungen(GESCHUETZTE_PFADE[0], {
    permissions: {
      allow: ["Edit(erlaubt/x.txt)"],
      deny: ["Edit(//abs/**)", "Write(config/geheim.json)", "Bash(rm:*)", "Read(./nur-lesen.txt)", "Edit"],
    },
  });
  try {
    const liste = geschuetztePfade(wurzel);
    assert.deepEqual(liste.slice(0, GESCHUETZTE_PFADE.length), [...GESCHUETZTE_PFADE]);
    assert.ok(liste.includes("/abs/**"), "// wird absolut");
    assert.ok(liste.includes("config/geheim.json"), "relativ zur Wurzel");
    assert.equal(liste.includes("erlaubt/x.txt"), false, "allow zaehlt nicht");
    assert.equal(liste.includes("nur-lesen.txt"), false, "Read ist keine Schreibsperre");
    assert.equal(liste.length, GESCHUETZTE_PFADE.length + 2);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] geschuetztePfade liest die lokale Einstellung, normalisiert ~/, ./ und / und doppelt nichts", () => {
  const wurzel = wurzelMitEinstellungen(GESCHUETZTE_PFADE[1], {
    permissions: { deny: ["Edit(~/geheim/**)", "Write(./a.txt)", "Edit(/b.txt)", "Edit(./a.txt)", `Edit(${ERSTER})`] },
  });
  try {
    const liste = geschuetztePfade(wurzel);
    assert.ok(liste.includes(join(homedir(), "geheim/**")));
    assert.ok(liste.includes("a.txt"));
    assert.ok(liste.includes("b.txt"));
    assert.equal(liste.filter((e) => e === "a.txt").length, 1);
    assert.equal(liste.filter((e) => e === ERSTER).length, 1);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] eine unlesbare Einstellungsdatei liefert nur die Vorgabeliste und haelt nichts auf", () => {
  for (const inhalt of ["{ kein json", JSON.stringify({ permissions: { deny: "Edit(x)" } }), "null", "[]"]) {
    const wurzel = wurzelMitEinstellungen(GESCHUETZTE_PFADE[0], inhalt);
    try {
      assert.deepEqual(geschuetztePfade(wurzel), [...GESCHUETZTE_PFADE], inhalt);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  }
});

// --- pfadTokens (E3) ----------------------------------------------------------

test("[board-1041] pfadTokens liefert Backtick-Spans ohne Leerzeichen samt Zeile", () => {
  const zeile = `Aendere ${TICK}kit/board.mjs${TICK} und ${TICK}node x.mjs run${TICK} sowie ${TICK}${TICK}a${TICK}b${TICK}${TICK}.`;
  assert.deepEqual(pfadTokens([zeile, "ohne Token", `offen ${TICK}nie zu`]), [
    { token: "kit/board.mjs", zeile },
    { token: `a${TICK}b`, zeile },
  ]);
});

test("[board-1041] pfadTokens paart Backticks wie Markdown, ein schliessender zaehlt nicht als oeffnender", () => {
  const zeile = `${TICK}a b${TICK}x${TICK}c${TICK}`;
  assert.deepEqual(pfadTokens([zeile]).map((t) => t.token), ["c"]);
});

// --- geschuetzteTreffer (E3, E4, E8, E17) -------------------------------------

test("[board-1041] der erste Vorgabepfad als Token in ## Aufgabe wird gefunden, samt Zeile", () => {
  const wurzel = leereWurzel();
  try {
    const zeile = `1. In ${TICK}${ERSTER}${TICK} einen Eintrag ergaenzen.`;
    const body = paket({ aufgabe: zeile });
    assert.deepEqual(geschuetzteTreffer(body, "Ein Paket", wurzel), [{ pfad: ERSTER, zeile }]);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] ein Token unterhalb des Verzeichniseintrags im Akzeptanzkriterium wird gefunden", () => {
  const wurzel = leereWurzel();
  try {
    const zeile = `- ${TICK}${VERZEICHNIS}pre-commit.sh${TICK} ist ausfuehrbar.`;
    const body = paket({ kriterium: zeile });
    assert.deepEqual(geschuetzteTreffer(body, "Ein Paket", wurzel), [{ pfad: `${VERZEICHNIS}pre-commit.sh`, zeile }]);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] derselbe Pfad nur in ## Kontext wird nicht gefunden", () => {
  const wurzel = leereWurzel();
  try {
    const body = paket({ kontext: `Frueher scheiterte ${TICK}${ERSTER}${TICK} hier.` });
    assert.deepEqual(geschuetzteTreffer(body, "Ein Paket", wurzel), []);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] ein Aufruf der Kopie im Akzeptanzkriterium wird nicht gefunden", () => {
  const wurzel = leereWurzel();
  try {
    const body = paket({ kriterium: `- ${TICK}${KOPIE_AUFRUF}${TICK} endet mit Exit 0.` });
    assert.deepEqual(geschuetzteTreffer(body, "Ein Paket", wurzel), []);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] die Pruefeinstellungen des Kits werden nicht gefunden", () => {
  const wurzel = leereWurzel();
  try {
    const body = paket({ aufgabe: `In ${TICK}${PRUEFEINSTELLUNGEN}${TICK} einen Bereich ergaenzen.` });
    assert.deepEqual(geschuetzteTreffer(body, "Ein Paket", wurzel), []);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] ein [Mensch]-Titel ergibt eine leere Liste", () => {
  const wurzel = leereWurzel();
  try {
    const body = paket({ aufgabe: `In ${TICK}${ERSTER}${TICK} einen Eintrag ergaenzen.` });
    assert.deepEqual(geschuetzteTreffer(body, "[Mensch] Eintrag setzen", wurzel), []);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] ein Token innerhalb eines Codeblocks wird nicht gefunden", () => {
  const wurzel = leereWurzel();
  try {
    const aufgabe = ["Beispiel:", "```", `Zeile mit ${TICK}${ERSTER}${TICK}`, "## Akzeptanzkriterium", "```"].join("\n");
    assert.deepEqual(geschuetzteTreffer(paket({ aufgabe }), "Ein Paket", wurzel), []);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] deny-Muster der Wurzel greifen, relativ wie absolut genannt", () => {
  const wurzel = wurzelMitEinstellungen(GESCHUETZTE_PFADE[0], {
    permissions: { deny: ["Write(config/*.json)", "Edit(//abs/**)"] },
  });
  try {
    const relativ = `- ${TICK}config/geheim.json${TICK} anpassen`;
    const absolut = `- ${TICK}${join(wurzel, "config/zwei.json")}${TICK} anpassen`;
    const fremd = `- ${TICK}/abs/datei.txt${TICK} und ${TICK}kit/board.mjs${TICK}`;
    const body = paket({ aufgabe: [relativ, absolut, fremd].join("\n") });
    assert.deepEqual(geschuetzteTreffer(body, "Ein Paket", wurzel), [
      { pfad: "config/geheim.json", zeile: relativ },
      { pfad: join(wurzel, "config/zwei.json"), zeile: absolut },
      { pfad: "/abs/datei.txt", zeile: fremd },
    ]);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] derselbe Pfad zweimal in einer Zeile ergibt einen Treffer, in zwei Zeilen zwei", () => {
  const wurzel = leereWurzel();
  try {
    const a = `${TICK}${ERSTER}${TICK} und nochmal ${TICK}${ERSTER}${TICK}`;
    const b = `- ${TICK}${ERSTER}${TICK} ist gesetzt.`;
    assert.deepEqual(geschuetzteTreffer(paket({ aufgabe: a, kriterium: b }), "Ein Paket", wurzel), [
      { pfad: ERSTER, zeile: a },
      { pfad: ERSTER, zeile: b },
    ]);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});

test("[board-1041] ein leerer Body ergibt keine Treffer", () => {
  const wurzel = leereWurzel();
  try {
    assert.deepEqual(geschuetzteTreffer("", "Ein Paket", wurzel), []);
    assert.deepEqual(geschuetzteTreffer(null, null, wurzel), []);
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
});
