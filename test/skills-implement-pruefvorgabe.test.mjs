// Drei Zustaende statt zwei in den implement-Skills (Issue #306, Plan #300,
// fachliche Quelle #285).
//
// Das Gate im Nacht-Runner (Issue #304) allein genuegt nicht: `/implement-next`
// und `/implement-ready` melden bisher JEDES Ticket ohne `Issue-Review:`-Marker
// als ungeprueft — auch eines, das der Mensch per `Pruefung: Verzicht` bewusst
// ohne Pruefung freigegeben hat. Der Bericht behauptet dann das Gegenteil dessen,
// was entschieden wurde.
//
// Ebenso wenig darf eine verfallene Vorgabe mit "nie geprueft" verschmelzen:
// "entschieden, aber ueberholt" ist eine andere Lage als "nie entschieden"
// (dieselbe Unterscheidung traegt `vorgabeQuelle: "verfallen"` in kit/board.mjs).
//
// Geprueft wird Skill-TEXT, nicht Verhalten: Was dort nicht steht, tut die
// Session nicht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SKILLS = ["implement-next", "implement-ready"];

const quelle = (name) => join(repoRoot, "skills", name, "SKILL.md");
const kopie = (name) => join(repoRoot, ".claude", "skills", name, "SKILL.md");
const text = (name) => readFileSync(quelle(name), "utf-8");

/**
 * Der Abschnitt "Ungepruefte Issues" bis zur naechsten Ueberschrift.
 *
 * Er beginnt an der fett gesetzten Marke und endet an `### ` — in beiden Skills
 * steht er als letzter Absatz von Schritt 0.
 */
function abschnitt(name) {
  const t = text(name);
  const start = t.indexOf("**Ungepruefte Issues");
  assert.notEqual(start, -1, `${name}: Abschnitt "Ungepruefte Issues" fehlt`);
  const rest = t.slice(start);
  return rest.split(/\n#{2,4} /)[0];
}

for (const name of SKILLS) {
  test(`${name}: der Marker-Fall bleibt ohne Hinweis`, () => {
    const a = abschnitt(name);
    assert.match(a, /`Issue-Review:`/, "die Marker-Zeile wird nicht mehr genannt");
    const absaetze = a.split(/\n\n/).filter((p) => /Issue-Review:/.test(p));
    assert.ok(
      absaetze.some((p) => /kein(en)? Hinweis|nichts zu melden|wie bisher/i.test(p)),
      "Fall 1 (Marker vorhanden → kein Hinweis) ist nicht ausdruecklich beschrieben"
    );
  });

  test(`${name}: der gueltige Verzicht ist ein eigener Zustand ohne Rueckfrage`, () => {
    const a = abschnitt(name);
    assert.match(a, /`Pruefung: Verzicht`/,
      "die Zeile `Pruefung: Verzicht` wird nicht genannt — dann ist der Zustand nicht erkennbar");
    assert.match(a, /bewusst ohne Pruefung freigegeben/,
      "die Meldung \"bewusst ohne Pruefung freigegeben\" fehlt (Wortlaut aus kit/night.mjs)");

    const absatz = a.split(/\n\n/).find((p) => /Verzicht/.test(p) && /freigegeben/.test(p));
    assert.ok(absatz, "kein Absatz beschreibt den Verzicht als eigenen Zustand");
    assert.match(absatz, /keine Rueckfrage|keine Rückfrage|ohne Rueckfrage|ohne Rückfrage/i,
      "beim Verzicht darf nicht nachgefragt werden — das ist die Entscheidung des Menschen");
    assert.match(absatz, /nicht verfallen|gueltig|gültig/i,
      "ohne die Gueltigkeit bliebe offen, welcher Verzicht traegt und welcher nicht");
  });

  test(`${name}: der verfallene Zustand wird getrennt von "nie geprueft" benannt`, () => {
    const a = abschnitt(name);
    assert.match(a, /verfallen/i, "der Verfall kommt im Abschnitt nicht vor");

    const absatz = a.split(/\n\n/).find((p) => /verfallen/i.test(p) && !/Verzicht.*freigegeben/.test(p));
    assert.ok(absatz, "der Verfall hat keinen eigenen Absatz — er verschmilzt mit einem anderen Fall");
    assert.match(absatz, /nie geprueft|nie geprüft|noch nicht geprueft|noch nicht geprüft/i,
      "die Abgrenzung zu \"nie geprueft\" fehlt — genau sie ist der Punkt");
    assert.match(absatz, /inhaltlich|Aenderung|Änderung/i,
      "der Grund des Verfalls (inhaltliche Aenderung) fehlt");
  });

  test(`${name}: der bestehende Hinweis fuer Fall 3 ist erhalten`, () => {
    const a = abschnitt(name);
    assert.match(a, /\*\*halte aber nicht von dir aus an\*\*/,
      "der Satz \"halte aber nicht von dir aus an\" ist verschwunden");
    assert.match(a, /issueReview\.requiredBeforeReady/,
      "der Verweis auf das Nacht-Gate fehlt");
    assert.match(a, /Asymmetrie/,
      "die Begruendung der Asymmetrie (interaktiv Hinweis, nachts keine Rueckfrage) fehlt");
    assert.match(a, /#223/, "der Verweis auf Issue #223 fehlt");
  });

  test(`${name}: alle drei Zustaende sind als solche ausgewiesen`, () => {
    const a = abschnitt(name);
    assert.match(a, /drei Zust(ae|ä)nde/i,
      "der Abschnitt benennt die Dreiteilung nicht — dann liest sie sich als Aufzaehlung von Sonderfaellen");
  });

  test(`${name}: die Dogfooding-Kopie unter .claude ist identisch`, () => {
    assert.equal(readFileSync(kopie(name), "utf-8"), text(name),
      "sync-blobs wurde nicht ausgefuehrt");
  });
}
