// Die Skill-Zahl in Kurzanleitung und Startseite (Issue #606, Plan #562).
//
// Drei Dateien nennen dieselbe Zahl: die ausfuehrliche Doku, die Kurzanleitung und die
// Startseite der Doku-Website. Sie sind vor diesem Issue auseinandergelaufen — die Doku
// sagte sechzehn, die Kurzanleitung vierzehn, die Startseite zwoelf. Wer das Kit neu
// kennenlernt, liest die beiden hinteren zuerst und bekommt dort die aelteste Zahl.
//
// Geprueft wird deshalb dreierlei. Erstens, dass keine alte Zaehlung mehr dasteht: Eine
// korrigierte Ueberschrift neben einem stehengebliebenen "vierzehn Skills" im Fliesstext
// waere schlimmer als gar keine Aenderung, weil dann beide Zahlen im selben Dokument
// stehen. Zweitens, dass alle drei Dateien dieselbe neue Zahl tragen.
//
// Drittens — und das ist der Test, der ueber dieses Issue hinaus traegt — dass die
// Tabelle der Kurzanleitung so viele Zeilen hat, wie es Skills gibt. Ein Stringliteral
// allein verfaellt still: Kommt ein Skill dazu, bleibt "sechzehn Skills" grammatisch
// heil und wird trotzdem falsch. Der Abgleich gegen `skills/` bricht an dieser Stelle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...teile) => readFileSync(join(repoRoot, ...teile), "utf-8");

// Der Wegweiser `/plan` erstellt keinen Plan, er nennt nur den neuen Namen `/techplan`.
// Er steht bewusst in keiner Skill-Tabelle und zaehlt deshalb nicht mit.
const WEGWEISER = new Set(["plan"]);

const ZAEHLWORT = "sechzehn";
const ALTE_ZAEHLUNG = /vierzehn Skills|zw(ö|oe)lf Skills|f(ü|ue)nfzehn Skills/i;

const DATEIEN = [
  ["docs", "dokumentation.md"],
  ["docs", "quickstart.md"],
  ["docs", "index.md"],
];

for (const teile of DATEIEN) {
  const pfad = teile.join("/");

  test(`${pfad} nennt keine alte Skill-Zaehlung mehr`, () => {
    assert.doesNotMatch(
      lies(...teile),
      ALTE_ZAEHLUNG,
      `${pfad}: eine alte Zaehlung steht noch da — zwei Zahlen fuer dieselbe Menge`,
    );
  });

  test(`${pfad} nennt die Skill-Zahl als '${ZAEHLWORT} Skills'`, () => {
    assert.match(
      lies(...teile),
      new RegExp(`${ZAEHLWORT} Skills`, "i"),
      `${pfad}: das Zaehlwort '${ZAEHLWORT} Skills' fehlt`,
    );
  });
}

test("die Skill-Tabelle der Kurzanleitung fuehrt jeden Skill genau einmal", () => {
  const vorhanden = readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !WEGWEISER.has(e.name))
    .map((e) => e.name)
    .sort();

  const gelistet = lies("docs", "quickstart.md")
    .split("\n")
    .map((zeile) => /^\|\s*`\/([a-z-]+)`/.exec(zeile))
    .filter(Boolean)
    .map((treffer) => treffer[1])
    .sort();

  assert.deepEqual(
    gelistet,
    vorhanden,
    "docs/quickstart.md: die Skill-Tabelle deckt sich nicht mit den Ordnern in skills/",
  );
});

test("die Kurzanleitung verweist auf die Auswahlregel statt sie zu wiederholen", () => {
  assert.match(
    lies("docs", "quickstart.md"),
    /dokumentation\.md#drei-bahnen/,
    "docs/quickstart.md: der Link auf die Auswahlregel 'Drei Bahnen' fehlt",
  );
});
