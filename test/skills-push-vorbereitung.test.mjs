// Der Modus `vorbereiten` von `/push-main` und die Übernahme am Morgen (Issue #1253,
// Plan #1243 A5, E9, E10, E14, E15, E17).
//
// Nachts fährt der Nacht-Runner `/push-main vorbereiten`: Schritte 1 bis 6 in einem eigenen
// Worktree, kein Push. Morgens übernimmt `/push-main` einen unveränderten Stand, ohne
// erneut zu prüfen oder zu bumpen. Die Kommandos dazu baut #1246 in kit/worktree.mjs.
//
// Geprüft wird Text, nicht Verhalten — wie in test/skills-push-main.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Datei als Text mit LF, damit ein Checkout mit CRLF den Vergleich nicht verfälscht. */
function lies(...teile) {
  return readFileSync(join(repoRoot, ...teile), "utf-8").replaceAll("\r\n", "\n");
}

const PUSH = lies("skills", "push-main", "SKILL.md");

/** Der Abschnitt ab einer Überschrift bis zur nächsten derselben oder höheren Ebene. */
function abschnitt(text, ueberschrift) {
  const start = text.indexOf(ueberschrift);
  if (start < 0) return null;
  const ebene = ueberschrift.match(/^#+/)[0].length;
  const rest = text.slice(start + ueberschrift.length);
  const ende = rest.search(new RegExp(`\\n#{1,${ebene}} `));
  return ende < 0 ? text.slice(start) : text.slice(start, start + ueberschrift.length + ende);
}

/** Text ohne Zeilenumbrüche und Mehrfach-Leerzeichen, damit Sätze über Zeilen hinweg passen. */
const flach = (text) => text.replaceAll(/\s+/g, " ");

const MODUS = abschnitt(PUSH, "## Modus `vorbereiten` (unbeaufsichtigt)");
const SCHRITT3 = abschnitt(PUSH, "### 3. Worktree anlegen und mit `origin` zusammenführen");
const NICHT = abschnitt(PUSH, "## Was dieser Skill nicht tut");
const TRIGGER = abschnitt(PUSH, "## Trigger-Phrase");
const KOPF = PUSH.slice(0, PUSH.indexOf("\n---", 4));

test("der Modus vorbereiten hat einen eigenen Abschnitt", () => {
  assert.ok(MODUS, "Abschnitt „## Modus `vorbereiten` (unbeaufsichtigt)“ fehlt");
});

test("der Modus vorbereiten pusht nicht, auch nicht auf den Prüfzweig oder einen Vorab-Zweig", () => {
  const m = flach(MODUS);
  assert.match(m, /Kein Push/, "der Modus sagt nicht ausdrücklich „Kein Push“");
  assert.match(m, /kein Prüfzweig|auch nicht auf den Prüfzweig/, "der Modus schließt den Prüfzweig nicht aus");
  assert.match(m, /kein Vorab-Zweig/, "der Modus schließt den Vorab-Zweig nicht aus");
  const n = flach(NICHT);
  assert.match(n, /Kein Push im Modus `vorbereiten`, auch nicht auf den Prüfzweig/,
    "„Was dieser Skill nicht tut“ nennt den Modus vorbereiten nicht");
});

test("der Modus vorbereiten ist die einzige Ausnahme von der Trigger-Phrase", () => {
  for (const [name, text] of [["description", KOPF], ["Trigger-Phrase", TRIGGER]]) {
    const t = flach(text);
    assert.match(t, /vorbereiten/, `${name} nennt den Modus vorbereiten nicht`);
    assert.match(t, /pusht nicht/, `${name} begründet die Ausnahme nicht damit, dass er nicht pusht`);
    assert.match(t, /Nacht-Runner/, `${name} nennt nicht, wer den Modus ohne Phrase startet`);
  }
  assert.match(flach(TRIGGER), /einzige Ausnahme/i, "die Trigger-Phrase nennt den Modus nicht als einzige Ausnahme");
});

test("Schritt 3: Fetch, dann vorbereitung-pruefen, dann anlegen", () => {
  assert.ok(SCHRITT3, "Schritt 3 fehlt");
  const fetch = SCHRITT3.indexOf("git fetch origin <mainBranch>");
  const pruefen = SCHRITT3.indexOf("node .claude/kit/worktree.mjs vorbereitung-pruefen");
  const anlegen = SCHRITT3.indexOf("node .claude/kit/worktree.mjs anlegen");
  assert.ok(fetch >= 0, "Schritt 3 holt origin nicht");
  assert.ok(pruefen >= 0, "Schritt 3 ruft vorbereitung-pruefen nicht");
  assert.ok(anlegen >= 0, "Schritt 3 legt keinen Worktree an");
  assert.ok(fetch < pruefen && pruefen < anlegen, "die Reihenfolge ist nicht Fetch → vorbereitung-pruefen → anlegen");
  assert.match(SCHRITT3, /anlegen --praefix release --ref refs\/kit\/push-vorbereitet/,
    "bei Übernahme entsteht der Worktree nicht auf der vorbereiteten Referenz");
  assert.match(SCHRITT3, /anlegen --praefix release --ref <mainBranch>/, "ohne Übernahme fehlt der heutige Weg");
  assert.match(SCHRITT3, /git -C <pfad> rebase origin\/<mainBranch>/, "das Rebase im Worktree fehlt");
});

test("im Modus vorbereiten wird erst unter gehaltener Umsetzungssperre geholt, ein Fehlschlag hält nicht an", () => {
  const m = flach(MODUS);
  assert.match(m, /--praefix vorbereitung/, "der Modus legt den Worktree nicht mit dem Präfix vorbereitung an");
  assert.match(m, /git fetch origin <mainBranch>/, "der Modus holt origin nicht");
  assert.match(m, /Umsetzungssperre/, "der Modus begründet den Fetch nicht mit der gehaltenen Umsetzungssperre");
  assert.match(m, /vorhandene Referenz `origin\/<mainBranch>`/, "der Modus rebased nach gescheitertem Fetch nicht auf die vorhandene Referenz");
  assert.match(m, /--fetch fehlgeschlagen/, "der Modus übergibt den gescheiterten Fetch nicht");
  assert.match(m, /node \.claude\/kit\/worktree\.mjs vorbereitung-festhalten <pfad> --ergebnis/,
    "der Modus hält die Vorbereitung nicht fest");
  assert.match(m, /--offen "<Text>"/, "der Modus übergibt offene Prüfungen nicht");
  assert.match(m, /RELEASING\.md/, "der Modus nennt den Fall ohne RELEASING.md nicht");
});

test("im Modus vorbereiten ist auf dem Weg über den Build-Dienst Schritt 5 der Nachweislauf der Paketstufe", () => {
  const m = flach(MODUS);
  assert.match(m, /Weg über den Build-Dienst/, "der Modus nennt den Weg über den Build-Dienst nicht");
  assert.match(m, /Nachweislauf der Paketstufe/, "der Modus nennt den Nachweislauf der Paketstufe nicht");
  assert.match(m, /checks\.mjs run --in <pfad> --since HEAD --wiederholen/, "der Modus nennt das Kommando des Nachweislaufs mit --wiederholen nicht");
  assert.match(m, /Build-Dienst-Punkt setzt das Kommando selbst/, "der Modus lässt die Session den Build-Dienst-Punkt setzen");
});

test("die Übernahme am Morgen nennt den Stand der Nacht und lässt die Schritte 4 bis 6 aus", () => {
  const s = flach(PUSH);
  assert.match(s, /Übernimmt den Stand der Nacht vom <zeitpunkt> \(<commit>\)/, "die Übernahmezeile fehlt");
  assert.match(flach(SCHRITT3), /entfallen die Schritte 4 bis 6/, "bei Übernahme entfallen die Schritte 4 bis 6 nicht");
});

test("morgens fährt Schritt 7 auf dem Weg über den Build-Dienst den Prüfzweig", () => {
  const s = flach(SCHRITT3);
  assert.match(s, /Prüfzweig/, "die Übernahme nennt den Prüfzweig in Schritt 7 nicht");
  assert.match(s, /Warten auf den Build-Dienst/, "die Übernahme wartet nicht auf den Build-Dienst");
  assert.match(s, /„Weg über den Build-Dienst"/, "die Übernahme verweist nicht auf den Abschnitt mit ci-status");
  assert.match(s, /nur bei Grün/, "die Übernahme pusht <mainBranch> nicht nur bei Grün");
  assert.match(s, /UI-Prüfung[^.]*Frage an den Menschen/, "eine offene UI-Prüfung wird nicht als Frage gestellt");
});

test("nach dem Push und bei jedem Nicht-Übernehmen wird verworfen", () => {
  assert.match(PUSH, /node \.claude\/kit\/worktree\.mjs vorbereitung-pruefen --verwerfen/, "--verwerfen fehlt");
  const s = flach(PUSH);
  assert.match(s, /Nach dem Push und bei jedem Nicht-Übernehmen/, "der Skill sagt nicht, wann verworfen wird");
});

test("[1401] ein offener Wackler aus der Nacht wird vor dem Push in Schritt 7 mit der Frage aus Schritt 5 erfragt", () => {
  const s = flach(SCHRITT3);
  assert.match(s, /`Gewackelt: <cmd> — Entscheidung beim push main`/, "Schritt 3 nennt den offenen Wackler-Punkt nicht");
  assert.match(s, /Gewackelt: <cmd>[^.]*Schritt 7[^.]*Frage aus Schritt 5|Gewackelt: <cmd>[^.]*Frage aus Schritt 5[^.]*Schritt 7/,
    "der Wackler-Punkt wird nicht in Schritt 7 mit der Frage aus Schritt 5 erfragt");
});

test("[1401] im Modus vorbereiten hält ein Wackler nicht an, er wird zum offenen Punkt", () => {
  assert.match(flach(MODUS), /Wackler[^.]*offenen Punkt/, "der Modus sagt nicht, was aus einem Wackler wird");
});
