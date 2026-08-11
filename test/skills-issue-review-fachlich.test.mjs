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

test("Stop-Punkt: kein Schreiben in eine fachliche Anforderung ohne Aufsicht", () => {
  const stop = SKILL.split(/##\s*Stop-Punkte/)[1];
  assert.ok(stop, "kein Stop-Punkte-Abschnitt gefunden");
  const zeile = stop.split("\n").find((z) => /fachlich/i.test(z) && /unbeaufsichtigt/i.test(z));
  assert.ok(zeile, "der Stop-Punkt fuer die fachliche Stufe fehlt in der Liste");
});

// Der eigentliche Fund des Reviews zu diesem Issue: Ein Satz in den Stop-Punkten
// reicht nicht, weil der Abschnitt "Im Nachtbetrieb" die generische Marker-Regel
// traegt — und die schreibt in den Body.
test("die naechtliche Marker-Regel ist auf plan und issue eingeschraenkt", () => {
  const nacht = SKILL.split(/##\s*Im Nachtbetrieb/)[1];
  assert.ok(nacht, "kein Nachtbetrieb-Abschnitt gefunden");
  const absatz = nacht.split(/\n\n/).find((a) => /Marker/i.test(a) && /(plan|issue)/.test(a) && /fachlich/i.test(a));
  assert.ok(absatz, "die Marker-Regel nennt die Stufen nicht");
  assert.match(absatz, /(nur fuer|nur für|gilt fuer|gilt für|eingeschr)/i,
    "die Einschraenkung auf plan und issue ist nicht ausgesprochen");
});
