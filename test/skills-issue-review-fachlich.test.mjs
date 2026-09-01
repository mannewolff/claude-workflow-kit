// Rollen-Prompts der fachlichen Pruefstufe (Issue #280, fachliche Quelle #272).
//
// Die fachliche Stufe hat den groessten Hebel: Ein Fehler dort pflanzt sich in den
// Plan, in jedes Arbeitspaket und in allen Code fort. Der Maszstab ist die Form —
// das Story-Format aus /fachplan. Ein Pruefer ohne festgelegte Form kann nur
// Geschmack aeussern.
//
// Die Prompts werden EINZELN extrahiert und einzeln geprueft. Ein Treffer im
// falschen Block waere sonst gruen, obwohl der Pruefpunkt in der Rolle fehlt, in
// die er gehoert — genau der Fehler, den ein Test ueber den ganzen Skill macht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

/**
 * Der Promptblock einer Rolle: der erste ```-Block nach der Ueberschrift, die den
 * Rollennamen nennt. Ohne diese Eingrenzung pruefte der Test den ganzen Skill.
 */
function promptBlock(rollenname) {
  const idx = SKILL.indexOf(rollenname);
  assert.ok(idx >= 0, `Rollenname '${rollenname}' kommt im Skill nicht vor`);
  const rest = SKILL.slice(idx);
  const treffer = /```\n([\s\S]*?)```/.exec(rest);
  assert.ok(treffer, `kein Promptblock nach '${rollenname}' gefunden`);
  return treffer[1];
}

test("form-beobachtbarkeit: fuenf Pruefpunkte samt Streich-Frage", () => {
  const p = promptBlock("form-beobachtbarkeit");
  for (const n of [1, 2, 3, 4, 5]) {
    assert.match(p, new RegExp(`^\\s*${n}\\.`, "m"), `Pruefpunkt ${n} fehlt`);
  }
  assert.match(p, /Was kann RAUS/i, "die Streich-Frage fehlt — ohne sie kippt der Roundtrip in Aufblaehung");
  assert.match(p, /\{\{ISSUE_BODY\}\}/, "der Platzhalter fuer den Body fehlt");
});

test("form-beobachtbarkeit: verlangt Beobachtbarkeit aus Nutzersicht, abgegrenzt von technischer Pruefbarkeit", () => {
  const p = promptBlock("form-beobachtbarkeit");
  assert.match(p, /NUTZERSICHT|Nutzersicht/, "die Nutzersicht ist nicht benannt");
  // Der Prompt ist umbrochen: "Nicht\n   technisch pruefbar". Ein Test auf die
  // Wortfolge ohne \s+ liefe daran vorbei.
  assert.match(p, /[Nn]icht\s+technisch\s+prüfbar/,
    "die Abgrenzung zur technischen Pruefbarkeit fehlt — sonst prueft die Stufe die falsche Frage");
});

test("form-beobachtbarkeit: nennt das Story-Format als Maszstab", () => {
  const p = promptBlock("form-beobachtbarkeit");
  for (const abschnitt of ["Ziel", "Fachliche Akzeptanzkriterien", "Nicht-Ziele", "Offene Fragen"]) {
    assert.ok(p.includes(abschnitt), `Abschnitt des Story-Formats fehlt: ${abschnitt}`);
  }
});

// Sonst meldet der Pruefer eine fertig gegroomte Anforderung als unvollstaendig,
// nur weil dort keine Fragen mehr offen sind.
test("form-beobachtbarkeit: 'Keine offenen Fragen' gilt ausdruecklich als in Ordnung", () => {
  const p = promptBlock("form-beobachtbarkeit");
  assert.match(p, /Keine offenen Fragen/,
    "der Fall einer fertig gegroomten Anforderung ist nicht abgedeckt");
});

test("abgrenzung: fuenf Pruefpunkte samt Streich-Frage", () => {
  const p = promptBlock("abgrenzung");
  for (const n of [1, 2, 3, 4, 5]) {
    assert.match(p, new RegExp(`^\\s*${n}\\.`, "m"), `Pruefpunkt ${n} fehlt`);
  }
  assert.match(p, /Was kann RAUS/i, "die Streich-Frage fehlt");
  assert.match(p, /\{\{ISSUE_BODY\}\}/, "der Platzhalter fuer den Body fehlt");
});

// Die Kontextlosigkeit, die den Review traegt, produziert an dieser Stelle
// zuverlaessig Fehlalarme: Der Pruefer kennt die PO-Gespraeche nicht und haelt
// Entschiedenes fuer offen.
test("abgrenzung: verbietet, Entscheidungen zu unterstellen, die nicht im Body stehen", () => {
  const p = promptBlock("abgrenzung");
  assert.match(p, /[Uu]nterstelle\s+keine\s+Entscheidungen/,
    "die Warnung vor unterstellten Entscheidungen fehlt");
});

test("beide Rollennamen sind ihren Promptbloecken eindeutig zugeordnet", () => {
  const a = promptBlock("form-beobachtbarkeit");
  const b = promptBlock("abgrenzung");
  assert.notEqual(a, b, "beide Rollen zeigen auf denselben Block");
  assert.match(a, /Story-Format/, "der Formblock ist nicht der der Rolle form-beobachtbarkeit");
  assert.match(b, /Nicht-Ziele/, "der Abgrenzungsblock nennt die Scope-Grenze nicht");
});

test("ein Rollenname ohne Prompt fuehrt zum Abbruch vor dem Reviewer-Start", () => {
  // Mehrere Absaetze sprechen ueber Rollennamen; gesucht ist der eine, der den
  // Fehlerpfad beschreibt. .find() nahm den erstbesten und pruefte den falschen.
  const kandidaten = SKILL.split(/\n\n/).filter(
    (a) => /Rollenname/i.test(a) && /(kein|keinen) Prompt/i.test(a)
  );
  assert.ok(kandidaten.length > 0, "kein Fehlerpfad fuer einen unbekannten Rollennamen beschrieben");
  const treffer = kandidaten.find(
    (a) => /(bricht|Abbruch)/i.test(a) && /vor dem Reviewer-Start|vor dem Start/i.test(a)
  );
  assert.ok(treffer, "kein Absatz nennt Abbruch UND Zeitpunkt — nach dem Start waere die Session bereits verbrannt");
});

// Seit Issue #418 schreibt der unbeaufsichtigte Lauf auch in eine fachliche
// Anforderung. Geschuetzt wird nicht mehr die Stufe, sondern der Inhalt: Die
// Antworten des Product Owners bleiben unangetastet, ein Fund darauf ruft einen
// Menschen. Der Stop-Punkt haelt genau diese Verlagerung fest.
test("Stop-Punkt: kein Anwenden eines Funds auf eine dokumentierte PO-Antwort", () => {
  const stop = SKILL.split(/##\s*Stop-Punkte/)[1];
  assert.ok(stop, "kein Stop-Punkte-Abschnitt gefunden");
  const zeile = stop
    .split("\n")
    .find((z) => /Offene Fragen an den PO|PO-Antwort/.test(z) && /kit:klaeren/.test(z));
  assert.ok(zeile, "der Stop-Punkt zum Schutz der PO-Antworten fehlt in der Liste");
  assert.match(zeile, /nicht angewendet/,
    "es steht nicht, dass ein solcher Fund nicht angewendet wird");
});

// Der eigentliche Fund des Reviews zu Issue #280: Ein Satz in den Stop-Punkten
// reicht nicht, weil der Abschnitt "Im Nachtbetrieb" die generische Marker-Regel
// traegt — und die schreibt in den Body. Seit #418 traegt sie fuer alle drei
// Stufen; die Zusicherung prueft deshalb, dass sie das ausdruecklich sagt, statt
// die fachliche Stufe stillschweigend mitzumeinen.
test("die naechtliche Marker-Regel benennt die Geltung fuer alle drei Stufen", () => {
  const nacht = SKILL.split(/##\s*Im Nachtbetrieb/)[1];
  assert.ok(nacht, "kein Nachtbetrieb-Abschnitt gefunden");
  const absatz = nacht.split(/\n\n/).find((a) => /Marker-Regel/i.test(a) && /alle drei Stufen/i.test(a));
  assert.ok(absatz, "die Marker-Regel sagt nicht, fuer welche Stufen sie gilt");
  assert.match(absatz, /`Fachplan-Review:`/,
    "der Marker der fachlichen Stufe ist nicht benannt");
});
