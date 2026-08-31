// Haelt die erzeugte Kommandozeile des Vorflug-Prompts woertlich fest (Issue #402).
//
// Der Anlass ist eine Umstellung auf `String.raw`: Im Quelltext steht heute
// `'%s\\n'` — im Template-Literal also die zwei Zeichen `\` und `n`, kein
// Zeilenumbruch. `String.raw` mit einfachem `\n` erzeugt denselben String, die
// Umstellung ist damit verhaltensneutral. Dieser Test belegt das, statt es zu
// behaupten: Er lief vor der Umstellung gruen und muss es danach bleiben.
//
// Warum das zaehlt: Die Zeile wird einem Modell als auszufuehrendes Kommando
// vorgelegt. `printf '%s\n'` haengt einen Zeilenumbruch an die Ausgabe — stuende
// dort ein echter Umbruch, zerfiele das Format-Argument in zwei Zeilen und der
// Reviewer bekaeme etwas anderes zu sehen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { vorflugPrompt } from "../kit/night.mjs";

test("der Vorflug-Prompt baut die printf-Zeile mit maskiertem \\n", () => {
  const prompt = vorflugPrompt([{ name: "codex", command: "codex exec --model gpt-5" }], null);
  const zeile = prompt.split("\n").find((z) => z.includes("printf"));

  assert.ok(zeile, "keine printf-Zeile im Prompt gefunden");
  assert.equal(
    zeile,
    "  printf '%s\\n' 'Antworte nur mit dem Wort OK.' | codex exec --model gpt-5   # Reviewer: codex"
  );
  // Der Kern: zwei Zeichen, kein Umbruch. Ein echter Umbruch wuerde die Zeile
  // beim split oben zerreissen und die Zusicherung darueber fallen lassen.
  assert.ok(zeile.includes("%s\\n"), "das Format-Argument traegt kein maskiertes \\n");
});

test("ohne command-Reviewer entsteht keine printf-Zeile", () => {
  const prompt = vorflugPrompt([], null);
  assert.ok(!prompt.includes("printf"), "ohne Reviewer darf keine Kommandozeile entstehen");
});
