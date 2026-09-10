// Transportweg langer Texte ans Board (Issue #583, Plan #580, fachlich #579).
//
// Am 2026-09-10 gingen zwei vollstaendig gelaufene Pruefrunden verloren, weil der
// Befehls-Parser den Board-Aufruf mit dem Befundtext im Heredoc abwies. Belegt:
// Board-Aufrufe bis 9.722 Zeichen gingen durch, ab 10.154 kam "Parser aborted
// (timeout, resource limit, or over-length)". Die Skills schreiben seither den
// Dateiweg vor: stueckweise per Shell in eine Datei ausserhalb des
// Projektverzeichnisses, dann `--text-file`/`--body-file` in EINEM Aufruf.
//
// Geprueft wird der Skill-TEXT, nicht die Laufzeit — und ausschliesslich die
// Quelle unter `skills/`, nicht die Dogfooding-Kopie unter `.claude/skills/`: Die
// ist per `.gitignore` ausgeschlossen und fehlt in jedem frischen Checkout; dass
// Quelle und Kopie zusammenpassen, prueft `tools/sync-blobs.mjs --check`.
//
// Die Stellen werden EINZELN benannt, nicht gezaehlt: Eine Gesamtzahl bliebe bei
// einer dreizehnten Stelle gruen, eine Aufzaehlung wird rot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

// Paket #583 stellt `/issue-review` um; #584 die uebrigen sieben Skills, #585
// weitet diese Tabelle auf alle zwoelf Stellen aus.
export const STELLEN = [
  { datei: "skills/issue-review/SKILL.md", befehl: "Befunde", zweck: "befunde" },
  { datei: "skills/issue-review/SKILL.md", befehl: "Synthese", zweck: "synthese" },
  { datei: "skills/issue-review/SKILL.md", befehl: "Body-Schreibung", zweck: "body" },
  { datei: "skills/issue-review/SKILL.md", befehl: "Body-Vorschlag", zweck: "vorschlag" },
];

// Eine Board-Schreibzeile: `board.mjs issue create|update|comment` mit --text/--body.
const BOARD_SCHREIBZEILE = /^.*board\.mjs issue (?:create|update|comment).*--(?:text|body)\b.*$/gm;

/** Alle Board-Schreibzeilen einer Datei, ohne die Zeilen im Register-Beispiel. */
function boardSchreibzeilen(text) {
  return text.match(BOARD_SCHREIBZEILE) ?? [];
}

for (const { datei, befehl } of STELLEN) {
  test(`[skills-9] ${datei} — ${befehl}: der Board-Aufruf nimmt eine Datei, keinen Heredoc`, () => {
    const text = lies(datei);
    const zeilen = boardSchreibzeilen(text);
    assert.ok(zeilen.length > 0, `keine Board-Schreibzeile in ${datei} gefunden`);
    for (const zeile of zeilen) {
      assert.ok(
        /--(?:text|body)-file\b/.test(zeile),
        `Board-Aufruf ohne --text-file/--body-file in ${datei}: ${zeile.trim()}`
      );
      assert.ok(!/<</.test(zeile), `Heredoc am Board-Aufruf in ${datei}: ${zeile.trim()}`);
      assert.ok(!/\|/.test(zeile), `Pipe am Board-Aufruf in ${datei}: ${zeile.trim()}`);
      assert.ok(
        !/--(?:text|body)\s+-(?:\s|$)/.test(zeile),
        `stdin-Weg am Board-Aufruf in ${datei}: ${zeile.trim()}`
      );
    }
  });
}

test("[skills-9] issue-review: der Zielpfad steht als Platzhalter, nie als Variable", () => {
  const text = lies("skills/issue-review/SKILL.md");
  assert.ok(
    !/\$TMPDIR|\$\{TMPDIR\}/.test(text),
    "der Skill nennt $TMPDIR — nachts wird ein Variablen-Redirect als 'path is runtime-determined' abgewiesen"
  );
  for (const { zweck } of STELLEN) {
    assert.ok(
      text.includes(`<tmpdir>/<id>-${zweck}.md`),
      `Platzhalter <tmpdir>/<id>-${zweck}.md fehlt`
    );
  }
});

test("[skills-9] issue-review: jede Stelle sagt, dass jeder Block ein eigener Werkzeugaufruf ist", () => {
  const text = lies("skills/issue-review/SKILL.md");
  const treffer = text.match(/eigener\*{0,2} Werkzeugaufruf/g) ?? [];
  assert.ok(
    treffer.length >= STELLEN.length,
    `Satz zum eigenen Werkzeugaufruf steht ${treffer.length}-mal, erwartet mindestens ${STELLEN.length}`
  );
});

test("[skills-9] issue-review: die Begruendung zu Issue #270 ist fortgeschrieben, nicht geloescht", () => {
  const text = lies("skills/issue-review/SKILL.md");
  assert.match(text, /Issue #270/, "die Begruendung zu #270 fehlt ganz");
  assert.match(
    text,
    /st(?:ue|ü)ckweise in eine Datei/,
    "die Schlussfolgerung wurde nicht auf den Dateiweg umgestellt"
  );
  assert.ok(
    !/ber stdin, nicht als Argument/.test(text),
    "der alte stdin-Schluss steht noch da"
  );
});

test("[skills-9] issue-review: die Ausfall-Form gilt nur vor dem Befunde-Kommentar", () => {
  const text = lies("skills/issue-review/SKILL.md");
  const i = text.indexOf("Ausfall: Ergebnis nicht ans Board gebracht");
  assert.ok(i > 0, "die Ausfall-Form fehlt");
  const absatz = text.slice(Math.max(0, i - 1200), i + 1200);
  assert.match(
    absatz,
    /Befunde-Kommentar/,
    "die Ausfall-Form ist nicht auf den Fall 'Befunde-Kommentar kommt nicht an' begrenzt"
  );
});

test("[skills-9] issue-review: der Ausfall steht in Zeile 2, auch im Nacht-Abschnitt", () => {
  const text = lies("skills/issue-review/SKILL.md");
  assert.ok(
    !/\*\*erste Zeile\*\* des Board-Kommentars nennt den Ausfall/.test(text),
    "Zeile 692 sagt weiterhin 'erste Zeile' — reviewZustand liest Zeile 2"
  );
});

test("[skills-9] Register: der Abschnitt 'Lange Texte ans Board' traegt Regel und Belege", () => {
  const text = lies("templates/CLAUDE-workflow.md");
  const abschnitt = /## Lange Texte ans Board[\s\S]*?(?=\n## |$)/.exec(text)?.[0] ?? "";
  assert.notEqual(abschnitt, "", "der Abschnitt fehlt im Register");
  for (const beleg of [String.raw`6\.000`, "printenv TMPDIR", String.raw`9\.722`, String.raw`10\.154`, "Beobachtung"]) {
    assert.match(abschnitt, new RegExp(beleg), `Beleg fehlt im Register-Abschnitt: ${beleg}`);
  }
  assert.doesNotMatch(
    abschnitt,
    /night-run/,
    "der Abschnitt verweist auf eine Logdatei — das Register wird in Projekte installiert, wo sie nicht existiert"
  );
});
