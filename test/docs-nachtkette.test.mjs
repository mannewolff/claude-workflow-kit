// Dokumentation der naechtlichen Erzeugungskette (Issue #525, Plan #513,
// fachliche Quelle #408).
//
// #408 macht die Dokumentation zu einem eigenen Akzeptanzkriterium, nicht zur
// Zugabe am Ende: Der fruehere Anlauf hatte eine Doku-Karte auf Done stehen,
// ohne dass je eine Zeile geschrieben wurde.
//
// Geprueft wird nicht der Wortlaut, sondern dass die vier Dinge im Abschnitt
// stehen, die man zum Starten einer Nacht braucht — Geste, Bedingung,
// Endzustand, Rueckweg — und dass der dokumentierte Aufruf dem Programm
// entspricht. Der Kopf von test/docs-pruefstufen.test.mjs sagt, warum das die
// Reihenfolge der Pakete bestimmt: "Eine Doku, die Werte nennt, die das
// Programm nicht kennt, ist schlimmer als keine."

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const VORLAGE = lies("templates", "CLAUDE-workflow.md");
const DOKU = lies("docs", "dokumentation.md");

const ABSCHNITT = "Dritter Modus: die Erzeugungsnacht";

/** Ein `###`-Abschnitt aus der Doku, bis zur naechsten Ueberschrift gleicher
 *  Ebene. Gleiche Bauart wie `dokuAbschnitt` in docs-pruefstufen.test.mjs. */
function dokuAbschnitt(ueberschrift) {
  const idx = DOKU.indexOf(`### ${ueberschrift}`);
  assert.ok(idx >= 0, `Abschnitt '### ${ueberschrift}' fehlt in docs/dokumentation.md`);
  return DOKU.slice(idx).split(/\n### /)[0];
}

test("die Doku fuehrt den Abschnitt zur Erzeugungsnacht", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  assert.ok(abschnitt.length > 0, "der Abschnitt ist leer");
});

// Die Anker sind die Namen, nach denen morgens jemand sucht: Wer ein Label,
// einen Marker oder einen Zustand am Board sieht, muss ihn in der Doku
// wiederfinden. Umschreibungen ("das Routing-Label des ersten Schritts")
// leisten das nicht.
test("der Abschnitt nennt Gesten, Bedingungen und Endzustaende beim Namen", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  for (const [was, anker] of [
    ["das Routing-Label des ersten Schritts", "kit:nightplan"],
    ["das Routing-Label des zweiten Schritts", "kit:nightissues"],
    ["die Eingangsbedingung der Stufe plan", "Fachplan-Review:"],
    ["die Eingangsbedingung der Stufe issue", "Plan-Review:"],
    ["den Endzustand fertig", "review:fertig"],
    ["den Endzustand klaeren", "kit:klaeren"],
    ["den Endzustand grenze", "review:grenze"],
    ["das Flag des Modus", "--erzeuge"],
    ["die Stopp-Fragen-Bedingung", "## Offene Fragen"],
  ]) {
    assert.ok(abschnitt.includes(anker), `der Abschnitt nennt ${was} ('${anker}') nicht`);
  }
});

// Der Label-Verbrauch ist die eine Regel, die man nicht raten kann: Bleibt das
// Label stehen, wiederholt sich der Schritt in der naechsten Nacht ohne neue
// menschliche Geste. Wer das nicht liest, haelt einen abgebrochenen Lauf fuer
// eine verbrauchte Freigabe und labelt von Hand nach.
test("ein Absatz erklaert, dass das Label beim Abbruch stehen bleibt", () => {
  const abschnitt = dokuAbschnitt(ABSCHNITT);
  const absatz = abschnitt.split(/\n\n/).find((a) => /bleibt stehen/.test(a) && /Label/.test(a));
  assert.ok(absatz, "kein Absatz nennt 'bleibt stehen' zusammen mit 'Label'");
});

// Ohne Kommandozeile kann niemand eine Nacht starten — und ein Flag, das die
// Doku nennt und das Programm nicht kennt, ist schlimmer als keins.
test("night.mjs kennt das dokumentierte Flag --erzeuge", () => {
  const help = execFileSync(process.execPath, [join(repoRoot, "kit", "night.mjs"), "--help"], {
    encoding: "utf-8",
  });
  assert.match(help, /--erzeuge/, "--help weist den Erzeugungsmodus nicht aus");
});

// Die Vorlage ist der Blob, den jede Neuinstallation bekommt. Fehlen die beiden
// Labels dort, ist die Freigabe-Geste im Projekt-Register unsichtbar.
test("der Nachtbetrieb-Block der Vorlage nennt beide Routing-Labels", () => {
  const idx = VORLAGE.indexOf("## Nachtbetrieb");
  assert.ok(idx >= 0, "kein Nachtbetrieb-Abschnitt in der Vorlage");
  const abschnitt = VORLAGE.slice(idx).split(/\n## /)[0];
  for (const label of ["kit:nightplan", "kit:nightissues"]) {
    assert.ok(abschnitt.includes(label),
      `der Nachtbetrieb-Block der Vorlage nennt '${label}' nicht`);
  }
});
