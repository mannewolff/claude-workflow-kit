// Haelt die erzeugte Kommandozeile des Vorflug-Prompts woertlich fest (Issue #402, #986)
// und den Namen, den der Befund tragen muss (Issue #409).
//
// Der erste Teil hielt anfangs die printf-Zeile fest (Issue #402). Seit Issue #986
// steht der Probe-Prompt als Argument an der Zeile, ohne Pipe und ohne Umleitung.
//
// Der zweite Teil (Issue #409) haelt fest, welchen Namen der Befund tragen muss. Die
// Vorflug-Session hatte den Modellnamen aus der Kommandozeile gemeldet (`gpt-5.6-sol`)
// statt des Reviewer-Namens aus der Config (`gpt-sol`); `normalisiereVorflug` gleicht
// ueber den Config-Namen ab, fand nichts und meldete verfuegbare Reviewer als fehlend.
// Geschaerft wird der Prompt — die Abgleichregel bleibt streng, was die beiden
// Charakterisierungstests am Ende festhalten.

import { test } from "node:test";
import assert from "node:assert/strict";

import { vorflugPrompt, normalisiereVorflug } from "../kit/night/session.mjs";

// Seit Issue #986 ohne printf, ohne Pipe und ohne Umleitung: Claude Code nimmt einen
// zusammengesetzten Befehl ab 2.1.277 nur noch aus der Sandbox, wenn jeder Teil zu einem
// Eintrag in `sandbox.excludedCommands` passt. `codex *` steht dort, `printf` nicht — die
// Pipe lief ganz in der Sandbox, und codex scheiterte. Eine Umleitung aus einer Datei hob
// die Ausnahme unter 2.1.283 ebenso auf. Der Prompt steht darum als Argument an der Zeile.
test("der Vorflug-Prompt haengt den Probe-Prompt als Argument an das Reviewer-Kommando", () => {
  const prompt = vorflugPrompt([{ name: "codex", command: "codex exec --model gpt-5" }], null);
  const zeile = prompt.split("\n").find((z) => z.includes("codex exec"));

  assert.ok(zeile, "keine Reviewer-Zeile im Prompt gefunden");
  assert.equal(
    zeile,
    "  codex exec --model gpt-5 'Antworte nur mit dem Wort OK.'   # Reviewer-Name fuer den Befund: codex",
  );
});

test("keine Reviewer-Zeile enthaelt printf, eine Pipe oder eine Umleitung", () => {
  const prompt = vorflugPrompt(
    [
      { name: "gpt-astra", command: 'codex exec --model gpt-6-astra -c model_reasoning_effort="high"' },
      { name: "gpt-sol", command: 'codex exec --model gpt-5.6-sol -c model_reasoning_effort="high"' },
    ],
    "311",
  );
  const zeilen = prompt.split("\n").filter((z) => z.startsWith("  ") && z.includes("# Reviewer-Name fuer den Befund:"));
  assert.equal(zeilen.length, 2);
  for (const z of zeilen) {
    assert.doesNotMatch(z.slice(0, z.indexOf("#")), /printf|\||</, `printf, Pipe oder Umleitung in: ${z}`);
  }
});

test("ohne command-Reviewer entsteht keine Kommandozeile", () => {
  const prompt = vorflugPrompt([], null);
  assert.ok(!prompt.includes("printf"), "ohne Reviewer darf keine Kommandozeile entstehen");
  assert.ok(!prompt.includes("   # Reviewer-Name fuer den Befund:"), "ohne Reviewer darf keine Kommandozeile entstehen");
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

// Issue #1107: Der Auftrag sagt, woran die Session den Exit-Code erkennt. Das Bash-Werkzeug
// meldet einen Exit-Code ungleich 0 als Zeile `Exit code N`; ohne diese Angabe riet die
// Vorflug-Session am 2026-09-17 aus drei Warnzeilen auf "nicht verfuegbar" (Idee #690).
const ZWEI_REVIEWER = [
  { name: "gpt-astra", command: 'codex exec --model gpt-6-astra -c model_reasoning_effort="high"' },
  { name: "gpt-sol", command: 'codex exec --model gpt-5.6-sol -c model_reasoning_effort="high"' },
];

function schritt(prompt, nummer) {
  const start = prompt.indexOf(`SCHRITT ${nummer}`);
  const ende = prompt.indexOf(`SCHRITT ${nummer + 1}`);
  return prompt.slice(start, ende === -1 ? undefined : ende);
}

test("[#1107] Schritt 1 nennt die Zeile 'Exit code N' und ihr Fehlen als Exit-Code 0", () => {
  const teil = schritt(vorflugPrompt(ZWEI_REVIEWER, "311"), 1);
  assert.match(teil, /`Exit code N`/);
  assert.match(teil, /Fehlt diese Zeile, war der Exit-Code 0/);
});

test("[#1107] Schritt 1 nennt Warnzeilen und Meldungen in eckigen Klammern ausdruecklich als kein Fehler", () => {
  const teil = schritt(vorflugPrompt(ZWEI_REVIEWER, "311"), 1);
  assert.match(teil, /Warnzeilen, Hinweise und Meldungen in eckigen Klammern/);
  assert.match(teil, /\[claude-code:unrecognized_model\]/);
  assert.match(teil, /sind kein Fehler/);
});

test("[#1107] Schritt 1 macht die Zeile OK zur Bedingung der Verfuegbarkeit, mit eigenem Grund", () => {
  const teil = schritt(vorflugPrompt(ZWEI_REVIEWER, "311"), 1);
  assert.match(teil, /eine Zeile `OK` enthaelt/);
  assert.match(teil, /fehlende `OK`-Zeile ergeben "verfuegbar": false/);
  assert.match(teil, /"keine Antwort OK"/);
});

for (const trackerId of ["311", null]) {
  test(`[#1107] Schritt 2 erkennt Exit-Code 0 ebenso und nennt Warnzeilen als kein Fehler (trackerId ${trackerId})`, () => {
    const teil = schritt(vorflugPrompt(ZWEI_REVIEWER, trackerId), 2);
    assert.match(teil, /keine `Exit code`-Zeile/);
    assert.match(teil, /Warnzeilen sind kein Fehler/);
  });
}

test("[#1107] die Probezeilen bleiben unveraendert, ohne Pipe und ohne Umleitung", () => {
  const prompt = vorflugPrompt(ZWEI_REVIEWER, "311");
  const zeilen = prompt.split("\n").filter((z) => z.startsWith("  ") && z.includes("# Reviewer-Name fuer den Befund:"));
  assert.deepEqual(zeilen, [
    `  codex exec --model gpt-6-astra -c model_reasoning_effort="high" 'Antworte nur mit dem Wort OK.'   # Reviewer-Name fuer den Befund: gpt-astra`,
    `  codex exec --model gpt-5.6-sol -c model_reasoning_effort="high" 'Antworte nur mit dem Wort OK.'   # Reviewer-Name fuer den Befund: gpt-sol`,
  ]);
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
