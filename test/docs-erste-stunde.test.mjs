// Ablauf-Pruefung: das lokale Board des Einstiegs ist nur als Aufruf von kit/board.mjs in einem frischen Projekt beobachtbar.
//
// Der Einstieg „Die erste Stunde“ (Issue #1757, Plan #1753). Jeder Schritt nennt Dauer,
// Erkennungszeichen und den Weg, wenn das Erkennungszeichen fehlt; der Board-Schritt fuehrt
// zum lokalen Board, das ohne Spalten und Labels bereitsteht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { setupProjekt, runBoard, repoRoot } from "./helpers/board-fixture.mjs";

const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

/** Die nummerierten Schritte einer Seite: Ueberschrift `### <n>. …` bis zur naechsten Ueberschrift. */
function schritte(text) {
  const liste = [];
  let aktuell = null;
  let imCode = false;
  for (const zeile of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(zeile)) imCode = !imCode;
    const kopf = imCode ? null : /^(#{2,3}) (?:(\d+)\. )?(.*)$/.exec(zeile);
    if (kopf) {
      aktuell = kopf[2] ? { nummer: Number(kopf[2]), titel: kopf[3], text: "" } : null;
      if (aktuell) liste.push(aktuell);
    } else if (aktuell) aktuell.text += `${zeile}\n`;
  }
  return liste;
}

const FASSUNGEN = [
  { pfad: ["docs", "quickstart.md"], dauer: /Dauer: etwa \d+/, gelungen: "Gelungen, wenn", sonst: "Sonst:" },
  { pfad: ["docs", "en", "quickstart.md"], dauer: /Time: about \d+/, gelungen: "Done when", sonst: "Otherwise:" },
];

test("Szenario: Ein Schritt ist nicht gelungen", () => {
  for (const { pfad, dauer, gelungen, sonst } of FASSUNGEN) {
    const liste = schritte(lies(...pfad));
    assert.deepEqual(liste.map((s) => s.nummer), Array.from({ length: 14 }, (_, i) => i + 1), `${pfad.join("/")}: nicht vierzehn Schritte`);
    for (const s of liste) {
      assert.match(s.text, dauer, `${pfad.join("/")}, Schritt ${s.nummer}: keine Dauer`);
      assert.ok(s.text.includes(gelungen), `${pfad.join("/")}, Schritt ${s.nummer}: kein „${gelungen}“`);
      assert.ok(s.text.includes(sonst), `${pfad.join("/")}, Schritt ${s.nummer}: kein „${sonst}“`);
    }
  }
});

test("Gegenprobe: ein Schritt ohne „Sonst:“ und eine Ueberschrift ohne Nummer werden erkannt", () => {
  const liste = schritte("## Voraussetzungen\n\nx\n\n### 1. A\n\nDauer: etwa 2 Minuten. Gelungen, wenn y.\n\n```\n### 9. kein Schritt\n```\n\n## Wie es weitergeht\n");
  assert.deepEqual(liste.map((s) => s.nummer), [1]);
  assert.ok(!liste[0].text.includes("Sonst:"));
});

test("Szenario: Das Board ist vor dem ersten Durchlauf bereit", () => {
  const text = lies("docs", "quickstart.md");
  const board = schritte(text).find((s) => /Board/.test(s.titel));
  assert.ok(board, "kein Schritt zum Board");
  for (const wort of ["`local`", "`issues/`", "node .claude/kit/board.mjs issue list"]) {
    assert.ok(board.text.includes(wort), `der Board-Schritt nennt ${wort} nicht`);
  }
  assert.match(text, /^\| Issue-Tracker[^|\n]*\| `local` \|/m, "die Antworttabelle nennt Issue-Tracker `local` nicht");

  const dir = setupProjekt({ codeHost: "local", issueTracker: "local", local: { issuesDir: "issues" } }, "erste-stunde-");
  try {
    const res = runBoard(dir, ["issue", "list"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("der Einstieg nennt genau einen Installationsweg", () => {
  for (const pfad of [["docs", "quickstart.md"], ["docs", "en", "quickstart.md"]]) {
    const text = lies(...pfad);
    assert.doesNotMatch(text, /npx claude-workflow-kit|npx github:/, pfad.join("/"));
    assert.ok(text.includes("curl -O https://docs.mwolff.org/install.mjs"), pfad.join("/"));
  }
});

const WEITER = [
  "/einrichtung#issue-tracker-und-code-host",
  "/prozess#push-main",
  "/prozess#merge-production",
  "/einrichtung#team-config-und-personliche-abweichungen",
  "/einstellungen)",
  "/einrichtung#das-commit-gate",
  "/einrichtung#installation",
  "/lokal)",
  "dokumentation.md#drei-bahnen",
  "/runner#die-kette",
  "/wsl2)",
  "/prozess#die-skills",
];

test("„Wie es weitergeht“ verweist auf jede Fortsetzung", () => {
  const text = lies("docs", "quickstart.md");
  const start = text.indexOf("\n## Wie es weitergeht\n");
  assert.ok(start > -1, "der Abschnitt „Wie es weitergeht“ fehlt");
  const teil = text.slice(start);
  for (const ziel of WEITER) assert.ok(teil.includes(ziel), `der Verweis ${ziel} fehlt`);
  assert.match(teil, /siebzehn Skills/);
});
