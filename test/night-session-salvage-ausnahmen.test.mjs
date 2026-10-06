// Salvage-Prompt und Rest-Guard urteilen nach derselben Regel (Issue #818).
//
// Der Prompt der Salvage-Session verlangte bis #818 ein vollstaendig leeres
// `git status --porcelain`, bevor sie das Board bewegt. Der Runner misst
// Sauberkeit dagegen mit `gitReste()`, und das nimmt eine Reihe von Pfaden
// ausdruecklich aus — `night-run-*`, den Umsetzungs-Lock, `wegmarken.tsv` und
// die uebrigen Laufzeit-Dateien unter `.claude/`. In einem Projekt ohne den
// `.claude/*`-Block in `.gitignore` liegen die waehrend des Salvage im Baum:
// Die Session committete, liess das Board unberuehrt, weil `git status` nicht
// leer war, und der Runner meldete danach "SALVAGE UNVOLLSTAENDIG" mit hartem
// Stopp. Die Rettung scheiterte an einem Widerspruch zwischen zwei Regeln
// desselben Werkzeugs.
//
// Beide Seiten leiten ihre Pruefung jetzt aus `gitResteAusnahmen()` ab. Hier steht der
// Abgleich am Prompt selbst; den Lauf im Projekt ohne Ignore-Block faehrt
// test/ablauf-night-session-salvage-ausnahmen.test.mjs (Issue #1229).

import { test } from "node:test";
import assert from "node:assert/strict";

import { gitResteAusnahmen, salvageSauberkeitsKommando } from "../kit/night/grundlagen.mjs";
import { salvagePrompt } from "../kit/night/session.mjs";

test("[night-66] jede Ausnahme von gitReste() steht als Ausschluss im Kommando des Salvage-Prompts", () => {
  const ausnahmen = gitResteAusnahmen();
  assert.ok(ausnahmen.length > 1, "die Ausnahmeliste ist leer — dann prueft dieser Test nichts");

  const prompt = salvagePrompt("42", "alles gruen", null);
  for (const pfad of ausnahmen) {
    assert.ok(prompt.includes(`:(exclude)${pfad}`),
      `die Ausnahme '${pfad}' fehlt als Ausschluss im Salvage-Prompt:\n${prompt}`);
  }

  // Die einzige trackerabhaengige Ausnahme geht denselben Weg: Beim lokalen Tracker
  // sind Board-Moves Dateiaenderungen unter issuesDir, und der Runner wertet sie
  // nicht als Rest. Also darf die Session sie auch nicht als Rest sehen.
  const lokal = gitResteAusnahmen({ issueTracker: "local", local: { issuesDir: "meine-issues" } });
  assert.ok(lokal.includes("meine-issues"), `issuesDir fehlt in der Liste: ${lokal.join(", ")}`);
  assert.ok(salvageSauberkeitsKommando(lokal).includes(":(exclude)meine-issues"),
    "die issuesDir-Ausnahme fehlt im Kommando");
});
