// Alle drei Pruefstufen duerfen unbeaufsichtigt schreiben (Issue #418).
//
// Bis hierher untersagte der Skill das Schreiben in den Body fuer `fachlich` und
// `plan` — begruendet mit dem Ort: Dort stehen PO-Antworten und architektonische
// Entscheidungen, die ein Mensch getroffen hat. Die Begruendung bleibt richtig,
// die Konsequenz war zu grob: Eine Kette Fachplan -> Plan -> Ticket, die in der
// Mitte nicht schreiben darf, ist strukturell nicht automatisierbar. Geschuetzt
// werden die menschlich gesetzten INHALTE, nicht die Stufen.
//
// Der Waechter-Test unten ist der wertvollste: Das Verbot stand an acht Stellen in
// drei Dateien, nicht an einer. Ein Test, der nur die offensichtliche Sonderregel
// prueft, laesst genau die Widersprueche stehen, die eine Nacht-Session als
// Entwarnung liest — Schritt 6 sagt dann "alle drei Stufen schreiben", zwanzig
// Zeilen tiefer steht das Gegenteil, und alle Tests sind gruen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const SKILL = lies("skills", "issue-review", "SKILL.md");

/** Skill, Doku und Workflow-Register — die drei Orte, an denen das Verbot stand. */
const DATEIEN = [
  ["skills/issue-review/SKILL.md", SKILL],
  ["docs/dokumentation.md", lies("docs", "dokumentation.md")],
  ["templates/CLAUDE-workflow.md", lies("templates", "CLAUDE-workflow.md")],
];

// Gemessen am Stand vom 2026-09-01 traf dieser Ausdruck genau die acht
// Bestandsstellen und nichts sonst: SKILL.md 696, 715, 740, 771, 776, 777 und
// docs/dokumentation.md 674, 867. Die Alternativen sind nicht redundant — jede
// deckt eine andere Formulierung desselben Verbots ab, und die Stelle im
// `label-sync`-Absatz nennt "Schreibverbot" VOR der Stufe, weshalb es die
// Alternative in beiden Richtungen braucht.
const SCHREIBVERBOT =
  /(fachlich|plan)[^.]{0,120}(nie geschrieben|kein Body|`?issue update`? wird nie|weder (der )?Body|weder `issue update`|Schreibverbot|nur Kommentare und nie ein Marker)|Schreibverbot[^.]{0,120}(fachlich|plan)|nie in eine fachliche Anforderung/i;

test("kein Dokument schliesst das Schreiben des Bodys fuer eine Stufe unbeaufsichtigt aus", () => {
  // Erst sammeln, dann melden: Eine Assertion je Zeile bricht beim ersten Treffer
  // ab und verschweigt die restlichen sieben. Genau diese Teilsicht hat das Verbot
  // ueber acht Stellen verteilt ueberleben lassen.
  const funde = [];
  for (const [name, text] of DATEIEN) {
    text.split("\n").forEach((zeile, i) => {
      const treffer = zeile.match(SCHREIBVERBOT);
      if (treffer) funde.push(`${name}:${i + 1}: …${treffer[0].trim()}…`);
    });
  }
  assert.deepEqual(
    funde,
    [],
    `${funde.length} Stelle(n) untersagen einer Stufe weiterhin das Schreiben — geschuetzt sind die Inhalte, nicht die Stufen:\n${funde.join("\n")}`
  );
});

/** Schritt 6 allein — von seiner Ueberschrift bis zum Nachtbetriebs-Abschnitt. */
const schritt6 = SKILL.slice(
  SKILL.indexOf("### 6. Body schärfen"),
  SKILL.indexOf("## Im Nachtbetrieb")
);

test("die Fallunterscheidung in Schritt 6 haengt allein an der Betriebsart", () => {
  assert.notEqual(schritt6, "", "der Schritt-6-Abschnitt wurde nicht gefunden");

  // Die Tabelle mit den Stufenspalten ist die eigentliche Fehlerquelle: Sie liest
  // sich wie zwei Regeln, obwohl es nur noch eine gibt.
  assert.doesNotMatch(
    schritt6,
    /\|\s*Stufe `issue`\s*\|/,
    "Schritt 6 traegt weiterhin eine Tabelle mit Stufenspalten"
  );
  assert.doesNotMatch(
    schritt6,
    /rechte Spalte/i,
    "der Verweis auf die rechte Tabellenspalte steht noch da"
  );

  const unbeaufsichtigt = schritt6
    .split(/\n\n/)
    .find((a) => /^\*\*Unbeaufsichtigt\*\*/.test(a) && /KIT_AGENT_MODEL/.test(a));
  assert.ok(unbeaufsichtigt, "der unbeaufsichtigte Fall steht nicht als eigener Absatz in Schritt 6");
  assert.match(unbeaufsichtigt, /Alle Funde `korrektur`|alle Funde `korrektur`/,
    "der befundfreie Fall (alle Funde `korrektur`) fehlt");
  assert.match(unbeaufsichtigt, /Marker gesetzt|Marker wird gesetzt|und der Marker gesetzt/,
    "es steht nicht, dass dabei der Marker gesetzt wird");
  assert.match(unbeaufsichtigt, /`gate`, `alternativen` oder klassenlos|gate.{0,40}alternativen.{0,40}klassenlos/,
    "der Klaerungsfall nennt die drei Klassen nicht");
  assert.match(unbeaufsichtigt, /kit:klaeren/, "das Zeichnen mit kit:klaeren fehlt");
});

// Die Verlagerung vom Ort auf den Inhalt steht und faellt mit dieser Regel: Ohne
// sie waere die Oeffnung eine Erlaubnis, PO-Antworten zu ueberschreiben.
test("die Schutzregel fuer menschlich gesetzte Inhalte steht in Schritt 6", () => {
  const absatz = schritt6
    .split(/\n\n/)
    .find((a) => /Offene Fragen an den PO/.test(a) && /Architektonische Entscheidungen/.test(a));
  assert.ok(absatz, "kein Absatz in Schritt 6 schuetzt PO-Antworten und Architekturentscheidungen");

  assert.match(absatz, /ist kein `korrektur`-Fund|kein `korrektur`-Fund/,
    "es steht nicht, dass ein solcher Fund kein `korrektur`-Fund ist");
  assert.match(absatz, /nicht angewendet|wird nicht angewendet/,
    "es steht nicht, dass der Fund nicht angewendet wird");
  assert.match(absatz, /kit:klaeren/, "das Zeichnen mit kit:klaeren fehlt");
  assert.match(absatz, /Marker/, "die Wirkung auf den Marker ist nicht benannt");
});

test("der Stop-Punkte-Abschnitt traegt die Schutzregel statt des Stufenverbots", () => {
  const stop = SKILL.slice(SKILL.indexOf("## Stop-Punkte"));
  const zeile = stop
    .split("\n")
    .find((z) => /PO-Antwort|Offene Fragen an den PO/.test(z) && /kit:klaeren/.test(z));
  assert.ok(zeile, "kein Stop-Punkt schuetzt die menschlich gesetzten Inhalte");
  assert.match(zeile, /architektonisch/i,
    "der Stop-Punkt nennt die architektonischen Entscheidungen nicht");
});

// Ohne Marker bliebe ein geschriebenes Dokument auf `review:offen` stehen und
// saehe ungeprueft aus, obwohl sein Body den Review bereits traegt.
test("der Marker wird auf allen drei Stufen gesetzt, und die Doku begruendet, warum das gefahrlos ist", () => {
  const nacht = SKILL.slice(SKILL.indexOf("## Im Nachtbetrieb"));
  const absatz = nacht.split(/\n\n/).find((a) => /Marker/.test(a) && /alle drei Stufen|jeder Stufe/i.test(a));
  assert.ok(absatz, "der Skill sagt nicht, dass der Marker auf allen drei Stufen gesetzt wird");
  assert.match(absatz, /requiredBeforeReady/,
    "die Begruendung ueber das Gate fehlt — an `Fachplan-Review:` und `Plan-Review:` haengt keines");
  assert.match(absatz, /`Issue-Review:`/,
    "es steht nicht, dass das Gate allein an `Issue-Review:` haengt");
});
