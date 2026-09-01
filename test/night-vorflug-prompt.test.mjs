// Haelt die erzeugte Kommandozeile des Vorflug-Prompts woertlich fest (Issue #402)
// und den Namen, den der Befund tragen muss (Issue #409).
//
// Der Anlass des ersten Tests ist eine Umstellung auf `String.raw`: Im Quelltext steht
// heute `'%s\\n'` — im Template-Literal also die zwei Zeichen `\` und `n`, kein
// Zeilenumbruch. `String.raw` mit einfachem `\n` erzeugt denselben String, die
// Umstellung ist damit verhaltensneutral. Dieser Test belegt das, statt es zu
// behaupten: Er lief vor der Umstellung gruen und muss es danach bleiben.
//
// Warum das zaehlt: Die Zeile wird einem Modell als auszufuehrendes Kommando
// vorgelegt. `printf '%s\n'` haengt einen Zeilenumbruch an die Ausgabe — stuende
// dort ein echter Umbruch, zerfiele das Format-Argument in zwei Zeilen und der
// Reviewer bekaeme etwas anderes zu sehen.
//
// Der zweite Teil (Issue #409) haelt fest, welchen Namen der Befund tragen muss. Die
// Vorflug-Session hatte den Modellnamen aus der Kommandozeile gemeldet (`gpt-5.6-sol`)
// statt des Reviewer-Namens aus der Config (`gpt-sol`); `normalisiereVorflug` gleicht
// ueber den Config-Namen ab, fand nichts und meldete verfuegbare Reviewer als fehlend.
// Geschaerft wird der Prompt — die Abgleichregel bleibt streng, was die beiden
// Charakterisierungstests am Ende festhalten.

import { test } from "node:test";
import assert from "node:assert/strict";

import { vorflugPrompt, normalisiereVorflug } from "../kit/night.mjs";

test(String.raw`der Vorflug-Prompt baut die printf-Zeile mit maskiertem \n`, () => {
  const prompt = vorflugPrompt([{ name: "codex", command: "codex exec --model gpt-5" }], null);
  const zeile = prompt.split("\n").find((z) => z.includes("printf"));

  assert.ok(zeile, "keine printf-Zeile im Prompt gefunden");
  assert.equal(
    zeile,
    String.raw`  printf '%s\n' 'Antworte nur mit dem Wort OK.' | codex exec --model gpt-5   # Reviewer-Name fuer den Befund: codex`
  );
  // Der Kern: zwei Zeichen, kein Umbruch. Ein echter Umbruch wuerde die Zeile
  // beim split oben zerreissen und die Zusicherung darueber fallen lassen.
  assert.ok(zeile.includes(String.raw`%s\n`), String.raw`das Format-Argument traegt kein maskiertes \n`);
});

test("ohne command-Reviewer entsteht keine printf-Zeile", () => {
  const prompt = vorflugPrompt([], null);
  assert.ok(!prompt.includes("printf"), "ohne Reviewer darf keine Kommandozeile entstehen");
});

test("der Befund-Teil zaehlt die Reviewer-Namen auf und schliesst den Modellnamen aus", () => {
  const prompt = vorflugPrompt(
    [
      { name: "gpt-sol", command: "codex exec --model gpt-5.6-sol -c foo=bar" },
      { name: "gpt", command: "codex exec --model gpt-5.5" },
    ],
    "666",
  );
  const befundTeil = prompt.slice(prompt.indexOf("SCHRITT 3"));

  assert.ok(befundTeil.includes(`"gpt-sol"`), "der Reviewer-Name gpt-sol fehlt im Befund-Teil");
  assert.ok(befundTeil.includes(`"gpt"`), "der Reviewer-Name gpt fehlt im Befund-Teil");
  // Die Modellnamen kennt der Prompt nicht als eigenen Wert — sie stecken unparsbar im
  // Kommandostring. Zugesichert ist deshalb der Satz, nicht die Aufzaehlung der Modelle.
  assert.match(
    befundTeil,
    /AUF KEINEN FALL den Modellnamen aus der Kommandozeile/,
    "der Befund-Teil sagt nicht, dass der Modellname nicht zurueckgegeben wird",
  );
});

// Charakterisierung: haelt den heutigen Fall fest. Von Anfang an gruen — das ist gewollt,
// die Abgleichregel wird von diesem Issue ausdruecklich nicht angefasst.
test("normalisiereVorflug: Modellnamen statt Reviewer-Namen bleiben nicht verfuegbar", () => {
  const reviewers = [
    { name: "gpt-sol", kind: "command" },
    { name: "gpt", kind: "command" },
  ];
  const { reviewers: befunde } = normalisiereVorflug(
    {
      reviewers: [
        { name: "gpt-5.6-sol", verfuegbar: true, grund: "" },
        { name: "gpt-5.5", verfuegbar: true, grund: "" },
      ],
    },
    reviewers,
  );

  assert.deepEqual(befunde.map((b) => b.verfuegbar), [false, false]);
  assert.match(befunde[0].grund, /nichts gemeldet/);
});

test("normalisiereVorflug: die Reviewer-Namen aus der Config ergeben verfuegbar", () => {
  const reviewers = [
    { name: "gpt-sol", kind: "command" },
    { name: "gpt", kind: "command" },
  ];
  const { reviewers: befunde } = normalisiereVorflug(
    {
      reviewers: [
        { name: "gpt-sol", verfuegbar: true, grund: "" },
        { name: "gpt", verfuegbar: true, grund: "" },
      ],
    },
    reviewers,
  );

  assert.deepEqual(befunde.map((b) => b.verfuegbar), [true, true]);
});
