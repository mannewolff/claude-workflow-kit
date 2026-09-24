// Der Doku-Absatz "Ein Lauf ohne Arbeit nennt seinen Grund" (Issue #888, Plan #882,
// fachliche Quelle #880).
//
// Geprueft wird zweierlei: dass der Absatz alle sechs Faelle beider Lauf-Arten, den
// Vorrang der Rueckstellung, den Rueckfall-Satz und die Sonderstellung des nicht
// schreibbaren Locks nennt — und dass jeder woertlich zitierte Fallsatz so auch in
// `kit/night.mjs` steht. Eine Doku, die einen Wortlaut nur ungefaehr wiedergibt, laesst
// den Leser morgens einen Satz suchen, den es nicht gibt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const DOKU = lies("docs", "dokumentation.md");
const NIGHT = lies("kit", "night.mjs");

/** Die Darstellung — ab der fetten Ueberschrift bis zum naechsten Thema. Sie umfasst
 *  mehrere Absaetze: die Faelle, den Vorrang und den Sonderfall des Locks. */
const ABSATZ = (() => {
  const start = DOKU.indexOf("**Ein Lauf ohne Arbeit nennt seinen Grund.**");
  if (start === -1) return "";
  const ende = DOKU.indexOf("**Einlieferung ans Board.**", start);
  return DOKU.slice(start, ende === -1 ? undefined : ende);
})();

// Die Fallsaetze, in der Form, in der sie in night.mjs stehen. Fragmente statt ganzer
// Saetze, weil die Saetze dort aus Template-Literalen mit Zahlen und Labels entstehen:
// woertlich vergleichbar ist nur der feste Teil.
const FALLSAETZE = [
  ["Ready leer", "Ready ist leer — nichts zu tun."],
  ["kein Routing-Label", "Karten in Ready traegt das Label"],
  ["alle zurueckgestellt", "wurden am Gate zurueckgestellt"],
  ["Umsetzung belegt", "Die Umsetzung ist belegt:"],
  ["Kette ohne Label", "Keine Kette zu fahren: kein Fachplan traegt das Label"],
  ["Kette uebersprungen", "Fachplaene mit dem Label"],
  ["Rueckfall", "Kein Grund ermittelbar"],
];

test("[docs-ohne-arbeit-1] der Absatz existiert und fuehrt den ueberholten Kettensatz nicht mehr", () => {
  assert.ok(ABSATZ, "der Absatz 'Ein Lauf ohne Arbeit nennt seinen Grund' fehlt in docs/dokumentation.md");
  assert.ok(
    !DOKU.includes("Keine Kette zu fahren — nichts zu tun"),
    "der ueberholte Wortlaut 'Keine Kette zu fahren — nichts zu tun' steht noch in der Doku"
  );
});

test("[docs-ohne-arbeit-2] jeder zitierte Fallsatz steht wortgleich in kit/night.mjs", () => {
  for (const [fall, satz] of FALLSAETZE) {
    assert.ok(ABSATZ.includes(satz), `der Absatz zitiert den Fall '${fall}' nicht (${satz})`);
    assert.ok(NIGHT.includes(satz), `der zitierte Satz zum Fall '${fall}' steht nicht in kit/night.mjs`);
  }
});

test("[docs-ohne-arbeit-3] der Absatz nennt Vorrang, Rueckfall, Lock-Faelle und das fehlende Feld", () => {
  for (const [was, muster] of [
    ["den Vorrang der Rueckstellung vor 'Ready ist leer'", /[Vv]orrang|vor dem Satz/],
    ["dass die Saetze Label und Zahl mitfuehren", /Label und Zahl|Zahl und Label/],
    ["den Rueckfall mit der Bitte um Meldung", /bitte melden/],
    ["die Fehlerklasse des nicht schreibbaren Locks", /`umgebung`/],
    ["den `fehlerText` des harten Stopps", /`fehlerText`/],
    ["dass dort kein `noWorkReason` steht", /ohne `noWorkReason`/],
    ["den belegten Lock als ruhigen Lauf", /belegt\S* Lock/],
    ["dass ein Lauf mit Arbeit das Feld nicht traegt", /Lauf mit Arbeit tr[äa]gt es nicht/],
  ]) {
    assert.match(ABSATZ, muster, `der Absatz nennt ${was} nicht`);
  }
});
