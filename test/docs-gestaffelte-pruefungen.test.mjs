// Dokumentation der gestaffelten Pflichtpruefungen (Issue #761, Plan #753,
// fachliche Quelle #738).
//
// Die Staffelung steht seit Issue #757 im Regeltext und laeuft seit #758 im
// Kommando. Die Doku ist der Ort, an dem jemand sie zum ersten Mal sieht — und der
// einzige, an dem Stufe, Zeitpunkt und Skill nebeneinanderstehen. Ohne diese
// Zuordnung bleibt `stufe: "push"` ein Wort ohne Ort: Man weiss, dass die Pruefung
// spaeter laeuft, aber nicht, wer sie faehrt.
//
// Der heikelste Punkt ist derselbe wie im Regeltext: Eine spaeter laufende Pruefung
// sieht in der Checklist wie eine ausgelassene aus. Steht nirgends, dass die Stufen
// kumulativ sind und vor der Freigabe alle drei laufen, liest das jeder als
// weggenommene Pruefung.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOKU = readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8");

/** Ein `###`-Abschnitt der Doku, bis zur naechsten Ueberschrift gleicher oder hoeherer Ebene. */
function dokuAbschnitt(ueberschrift) {
  const idx = DOKU.indexOf(`### ${ueberschrift}`);
  assert.ok(idx >= 0, `Abschnitt '### ${ueberschrift}' fehlt in docs/dokumentation.md`);
  return DOKU.slice(idx).split(/\n#{2,3} /)[0];
}

/** Der Abschnitt zur Staffelung — ueber seine Ueberschrift gefunden. */
function staffelAbschnitt() {
  const treffer = DOKU.split(/\n(?=### )/).find((a) => /^### .*Gestaffelte Prüfungen/.test(a));
  assert.ok(treffer, "kein ###-Abschnitt 'Gestaffelte Prüfungen' in docs/dokumentation.md");
  return treffer.split(/\n#{2,3} /)[0];
}

test("die Doku fuehrt einen Abschnitt zu den gestaffelten Pruefungen und nennt das Feld", () => {
  const abschnitt = staffelAbschnitt();
  assert.match(abschnitt, /`stufe`/, "der Abschnitt nennt das Feld `stufe` nicht");
});

test("der Abschnitt ordnet jeder Stufe ihren Zeitpunkt und ihren Skill zu", () => {
  const abschnitt = staffelAbschnitt();
  const zeilen = abschnitt.split("\n").filter((z) => z.trim().startsWith("|"));
  assert.ok(zeilen.length >= 5, "die Tabelle Stufe → Zeitpunkt → Skill fehlt");

  const kopf = zeilen[0];
  for (const spalte of [/Stufe/, /Zeitpunkt/, /Skill/]) {
    assert.match(kopf, spalte, `die Kopfzeile nennt die Spalte ${spalte} nicht`);
  }

  for (const [stufe, skill] of [["paket", "/local-check"], ["push", "/push-main"], ["merge", "/merge-production"]]) {
    const zeile = zeilen.find((z) => new RegExp("`" + stufe + "`").test(z));
    assert.ok(zeile, `die Tabelle fuehrt die Stufe '${stufe}' nicht`);
    assert.match(zeile, new RegExp(skill), `die Zeile der Stufe '${stufe}' nennt '${skill}' nicht`);
  }
});

// Ohne diesen Satz liest jeder eine spaeter laufende Pruefung als weggenommene.
test("der Abschnitt sagt, dass die Stufen kumulativ sind und vor der Freigabe alle laufen", () => {
  const abschnitt = staffelAbschnitt();
  assert.match(abschnitt, /kumulativ/i, "die Kumulativitaet ist nicht benannt");
  assert.match(abschnitt, /alle drei/i, "es steht nicht, dass vor der Freigabe alle drei Stufen laufen");
  assert.match(abschnitt, /(entfällt|entfallen|nimmt)[\s\S]{0,160}(keine|nichts|niemandem)|keine[\s\S]{0,120}entfällt/i,
    "es steht nicht, dass keine Pruefung aus dem Prozess entfaellt");
});

test("der Abschnitt sagt, dass ein fehlendes Feld die Paketstufe bedeutet", () => {
  const abschnitt = staffelAbschnitt();
  assert.match(abschnitt, /(fehlt|fehlendes|ohne)[\s\S]{0,120}`paket`|`paket`[\s\S]{0,120}(fehlt|fehlendes Feld)/i,
    "es steht nicht, dass ein fehlendes Feld 'paket' bedeutet");
  assert.match(abschnitt, /unverändert|wie bisher|Bestand/i,
    "es steht nicht, dass der Bestand damit unveraendert bleibt");
});

// Eine Config, in der keine Pruefung die Paketstufe traegt, ist gueltig — und
// nachts trotzdem ein Start ohne Gate. Wer das erst am abgewiesenen Nachtlauf
// merkt, sucht den Grund in der falschen Datei.
test("der Abschnitt verlangt mindestens eine Pruefung auf der Paketstufe", () => {
  const abschnitt = staffelAbschnitt();
  assert.match(abschnitt, /Nacht|nächtlich/i, "der Nachtbetrieb als Grund fehlt");
  assert.match(abschnitt, /Gate|Prüfung vor dem Commit/i, "es steht nicht, dass die Umsetzung sonst kein Gate hat");
});

test("die Skill-Abschnitte nennen ihre Stufe", () => {
  for (const [ueberschrift, muster] of [
    ["/local-check", /Paketstufe/],
    ["/push-main", /--stufe push|Stufe `?push`?/],
    ["/merge-production", /--stufe merge|Stufe `?merge`?|Freigabestufe/],
  ]) {
    const abschnitt = dokuAbschnitt(ueberschrift);
    assert.match(abschnitt, muster, `'${ueberschrift}' nennt seine Stufe nicht`);
  }
});

// Die Stufen der Pflichtpruefungen sind nicht die Pruefstufen des Reviews und
// nicht die Stufen der Nacht-Kette. Der Begriff ist im Kit dreifach besetzt.
test("der Abschnitt grenzt die Stufe gegen die anderen Stufenbegriffe ab", () => {
  const abschnitt = staffelAbschnitt();
  assert.match(abschnitt, /`reviewStufen`/, "die Abgrenzung gegen reviewStufen fehlt");
  assert.match(abschnitt, /Nacht-Kette|Aufgabenstufe/, "die Abgrenzung gegen die Stufen der Nacht-Kette fehlt");
});
