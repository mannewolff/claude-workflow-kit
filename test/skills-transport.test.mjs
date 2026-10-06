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

// Die Befehlsstellen mit Dateiweg, EINZELN benannt statt gezaehlt:
// Eine Gesamtzahl bliebe bei einer vierzehnten Stelle gruen, eine Aufzaehlung wird rot.
// #583 stellte /issue-review um, #584 die uebrigen sieben Skills, #585 weitet die
// Pruefung hierauf aus; #574 bringt mit `/task` die dreizehnte Stelle — genau der Fall,
// fuer den die Aufzaehlung gewaehlt wurde. #1025 nimmt die drei Abschlussberichte der
// `implement-*`-Skills heraus: Sie melden seither mit `issue melden` (STELLEN_MELDEN unten).
export const STELLEN = [
  { datei: "skills/issue-review/SKILL.md", befehl: "Befunde", zweck: "befunde" },
  { datei: "skills/issue-review/SKILL.md", befehl: "Body-Schreibung", zweck: "body" },
  { datei: "skills/issue-review/SKILL.md", befehl: "Einarbeitung", zweck: "einarbeitung" },
  { datei: "skills/issues/SKILL.md", befehl: "issue create mit --derived-from" },
  { datei: "skills/issues/SKILL.md", befehl: "issue create" },
  { datei: "skills/fachplan/SKILL.md", befehl: "issue create" },
  { datei: "skills/task/SKILL.md", befehl: "issue create" },
  { datei: "skills/techplan/SKILL.md", befehl: "issue create (mehrzeilig)" },
  { datei: "skills/review/SKILL.md", befehl: "Review-Ergebnis" },
];

// Die Dateien, in denen die Stellen mit Dateiweg liegen.
const DATEIEN = [...new Set(STELLEN.map((stelle) => stelle.datei))];

// Die drei meldenden Skills (Issue #1025, Plan #1015 E8, E14): Der Abschlussbericht geht
// als Argument von `issue melden` ans Board, ohne Zwischendatei — die benannte Ausnahme
// von „Lange Texte ans Board".
export const STELLEN_MELDEN = [
  "skills/implement-next/SKILL.md",
  "skills/implement-ready/SKILL.md",
  "skills/implement-done/SKILL.md",
];

// Die vier Skills, die ihren Auftrag mit `issue auftrag` holen (Plan #1015 E6).
export const STELLEN_AUFTRAG = [...STELLEN_MELDEN, "skills/implement-test/SKILL.md"];

/** Der Meldeschritt: vom Kopf `### <n>. Melden …` bis zum naechsten `### `. */
function meldeschritt(text) {
  const start = text.search(/^### \d+\. Melden\b/m);
  if (start < 0) return "";
  const rest = text.slice(start + 4);
  const ende = rest.search(/^### /m);
  return ende < 0 ? text.slice(start) : text.slice(start, start + 4 + ende);
}

// Nur Zeilen INNERHALB von ```bash-Bloecken zaehlen. Fliesstext, der den Befehl
// erwaehnt ("`board.mjs issue create` legt kein Issue an, wenn …"), ist kein Aufruf —
// ein Test, der ihn mitliest, ist rot, ohne dass etwas kaputt waere.
const BASH_BLOCK = /```bash\n([\s\S]*?)```/g;
const BOARD_SCHREIBZEILE = /board\.mjs issue (?:create|update|comment)\b/;

/** Alle Board-Schreibzeilen aus den bash-Bloecken einer Datei. */
function boardSchreibzeilen(text) {
  const zeilen = [];
  for (const [, block] of text.matchAll(BASH_BLOCK)) {
    // Mehrzeilige Aufrufe (Backslash-Fortsetzung) zu einer Zeile zusammenziehen.
    const entfaltet = block.replaceAll(/\\\n\s*/g, " ");
    for (const zeile of entfaltet.split("\n")) {
      if (BOARD_SCHREIBZEILE.test(zeile)) zeilen.push(zeile);
    }
  }
  return zeilen;
}

for (const { datei, befehl } of STELLEN) {
  test(`[skills-9] ${datei} — ${befehl}: der Board-Aufruf nimmt eine Datei, keinen Heredoc`, () => {
    const text = lies(datei);
    const zeilen = boardSchreibzeilen(text);
    assert.ok(zeilen.length > 0, `keine Board-Schreibzeile in ${datei} gefunden`);
    // Ein kurzer Text als Argument (`--text "Plan erstellt von …"`) bleibt erlaubt —
    // die Regel gilt fuer LANGE Texte, und die Ausfall-Form ist ausdruecklich eine
    // zweizeilige Ausnahme. Verboten ist nur, was den ganzen Text durch den
    // Befehls-Parser zwingt.
    for (const zeile of zeilen) {
      assert.ok(!/<</.test(zeile), `Heredoc am Board-Aufruf in ${datei}: ${zeile.trim()}`);
      assert.ok(!/\|/.test(zeile), `Pipe am Board-Aufruf in ${datei}: ${zeile.trim()}`);
      assert.ok(
        !/--(?:text|body)\s+-(?:\s|$)/.test(zeile),
        `stdin-Weg am Board-Aufruf in ${datei}: ${zeile.trim()}`
      );
    }
    // Und die Datei muss den Dateiweg mindestens einmal zeigen.
    assert.ok(
      zeilen.some((zeile) => /--(?:text|body)-file\b/.test(zeile)),
      `${datei} zeigt nirgends --text-file/--body-file`
    );
  });
}

test("[skills-9] issue-review: der Zielpfad steht als Platzhalter, nie als Variable", () => {
  const text = lies("skills/issue-review/SKILL.md");
  assert.ok(
    !/\$TMPDIR|\$\{TMPDIR\}/.test(text),
    "der Skill nennt $TMPDIR — nachts wird ein Variablen-Redirect als 'path is runtime-determined' abgewiesen"
  );
  for (const { zweck } of STELLEN.filter((stelle) => stelle.zweck)) {
    assert.match(
      text,
      new RegExp(`<tmpdir>/<id>-${zweck}\\.md`),
      `Platzhalter <tmpdir>/<id>-${zweck}.md fehlt`
    );
  }
});

test("[skills-9] issue-review: die Transportregel nennt den eigenen Werkzeugaufruf", () => {
  const text = lies("skills/issue-review/SKILL.md");
  // Seit Issue #629 steht die Transportregel einmal, als eigener Abschnitt.
  const treffer = text.match(/\*{0,2}eigene[rnm]\*{0,2} Werkzeugaufruf/g) ?? [];
  assert.ok(treffer.length >= 1, "der Satz zum eigenen Werkzeugaufruf fehlt");
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

for (const datei of STELLEN_MELDEN) {
  test(`[skills-1025] ${datei} — Meldeschritt: ein Aufruf issue melden, Bericht als Argument`, () => {
    const schritt = meldeschritt(lies(datei));
    assert.notEqual(schritt, "", `${datei}: kein Abschnitt '### <n>. Melden …'`);
    assert.match(schritt, /board\.mjs issue melden <id> --text '/, `${datei}: der Aufruf issue melden --text '…' fehlt`);
    assert.match(schritt, /board\.mjs issue melden <id> --teil <n> --text '/, `${datei}: die Stueckform mit --teil fehlt`);
    assert.match(schritt, /^node \.claude\/kit\/board\.mjs issue melden <id>$/m, `${datei}: der Abschlussaufruf ohne --text fehlt`);
    assert.ok(schritt.includes(String.raw`'\''`), `${datei}: die Maskierungsregel '\\'' fehlt im Meldeschritt`);
    assert.match(schritt, /Wiederholung[^.]*Abschlussaufruf/, `${datei}: die Wiederholung nach Fehlschlag fehlt`);
    assert.doesNotMatch(schritt, /issue comment[^\n]*--text-file/, `${datei}: der Meldeschritt nennt noch issue comment --text-file`);
    assert.doesNotMatch(schritt, /printenv TMPDIR|cat +>/, `${datei}: der Meldeschritt baut noch eine Zwischendatei`);
    assert.doesNotMatch(schritt, /issue move <id> in_review/, `${datei}: der Meldeschritt zieht noch selbst nach In review`);
    for (const [, block] of schritt.matchAll(BASH_BLOCK)) {
      assert.doesNotMatch(block, /<</, `${datei}: Heredoc im Meldeschritt`);
      assert.doesNotMatch(block, /\|/, `${datei}: Pipe im Meldeschritt`);
    }
  });
}

test("[skills-1025] die vier implement-Skills holen den Auftrag mit issue auftrag", () => {
  for (const datei of STELLEN_AUFTRAG) {
    assert.match(lies(datei), /board\.mjs issue auftrag <id>/, `${datei}: nennt issue auftrag nicht`);
  }
  assert.match(lies("skills/implement-done/SKILL.md"), /issue auftrag <id> --spalte in_progress/,
    "implement-done fragt nicht mit --spalte in_progress nach");
});

test("[skills-1025] die Backlog-Kommentartexte stehen nur noch in kit/board.mjs, in keinem Skill", async () => {
  const { AUFTRAG_BACKLOG_TEXTE } = await import("../kit/board/dokumente.mjs");
  for (const datei of STELLEN_AUFTRAG) {
    const text = lies(datei);
    for (const [art, textFn] of Object.entries(AUFTRAG_BACKLOG_TEXTE)) {
      // Der Wortlaut ohne die Kartennummer, damit weder `#N` noch `#<id>` ihn verbirgt.
      const kern = textFn("N").split(" — ")[1].split("#")[0];
      assert.ok(!text.includes(kern), `${datei}: traegt noch den Backlog-Kommentar '${art}' (${kern})`);
    }
  }
});

test("[skills-1025] Register: benannte Ausnahme fuer issue melden, Bericht-Lauf vom Kit gesetzt", () => {
  const text = lies("templates/CLAUDE-workflow.md");
  const abschnitt = /## Lange Texte ans Board[\s\S]*?(?=\n## |$)/.exec(text)?.[0] ?? "";
  assert.match(abschnitt, /Ausnahme[\s\S]*issue melden[\s\S]*--teil/, "die Ausnahme fuer issue melden --text/--teil fehlt");
  assert.match(abschnitt, /issue create[\s\S]*update[\s\S]*comment/, "der Satz, dass die Regel fuer create/update/comment bleibt, fehlt");
  const format = /## Abschlussbericht-Format[\s\S]*?(?=\n## |$)/.exec(text)?.[0] ?? "";
  assert.match(format, /Bericht-Lauf:/, "das Format nennt die Zeile Bericht-Lauf: nicht");
});

test("[skills-1025] /issues schreibt die Kontext-Zeile Plan-Entscheidungen", () => {
  const text = lies("skills/issues/SKILL.md");
  assert.match(text, /^Plan-Entscheidungen: E<n>/m, "die Zeile steht nicht im Muster der Rueckverweise");
  assert.match(text, /issue auftrag/, "der Satz, wozu issue auftrag die Zeile liest, fehlt");
});

test("[skills-9] [skills-10] in keiner der neun Dateien steht eine Variable im Redirect-Ziel", () => {
  for (const datei of [...DATEIEN, ...STELLEN_MELDEN]) {
    assert.doesNotMatch(
      lies(datei),
      /\$TMPDIR|\$\{TMPDIR\}/,
      `${datei}: nennt $TMPDIR — ein Variablen-Redirect wird unbeaufsichtigt als 'path is runtime-determined' abgewiesen`
    );
  }
});

test("[skills-10] jede der neun Dateien nennt den eigenen Werkzeugaufruf und den Fehlerpfad", () => {
  for (const datei of DATEIEN) {
    const text = lies(datei);
    assert.match(text, /\*{0,2}eigene[rnm]\*{0,2} Werkzeugaufruf/, `${datei}: Satz zum eigenen Werkzeugaufruf fehlt`);
    // Umlaute und Fettung variieren zwischen den Dateien; gesucht ist die Aussage.
    assert.match(text, /unvollst(?:ae|ä)ndige Datei[^.]{0,40}(?:ue|ü)bertragen/,
      `${datei}: Fehlerpfad fehlt`);
  }
});
