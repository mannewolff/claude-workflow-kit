// Die Gruendlichkeit einer Aufgabenstufe auf dem Weg zur Session (Issue #846, Plan #843).
//
// Seit Issue #845 traegt eine Stufe neben `modell` optional `effort`. Das Feld stand bis
// hierher nur in der Konfiguration: Die Session startete ohne `--effort`, und im
// Ergebnisstand war nicht zu sehen, wie gruendlich ein Paket gefahren wurde.
//
// Modell und Gruendlichkeit kommen immer als Paar aus EINEM Stufen-Eintrag — darum liest
// `paketWahl` beide aus der wirklich verwendeten Stufe, auch nach einem Ausweichen nach
// oben. Wo die Stufe nicht wirkt, wirkt auch die Gruendlichkeit nicht: beim Modellnamen
// der Karte, beim Modell des Laufs und im Kommando-Zweig, wo ein fremdes Programm startet,
// das das Flag nicht kennt.
//
// `sessionStart` ist dafuer exportiert (Entscheidung des Issues): Der Test-Hook
// NIGHT_CLAUDE_CMD ersetzt den ganzen Aufruf, eine Fake-Session sieht die Argumente der
// echten Kommandozeile also nie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { stufenEinstellung, paketWahl, sessionStart, berichtBauen } from "../kit/night.mjs";
import {
  NUR_POSIX, NIGHT, run, setupProjekt, readyIssue, einheit,
  SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW,
} from "./helpers/ergebnisstand-fixture.mjs";

const ERLAUBT = ["claude-opus-5", "claude-sonnet-5"];

const wahl = (body, stufen, laufModell = "claude-opus-5") =>
  paketWahl({ body, einstellung: stufenEinstellung({ night: { stufen } }), erlaubteModelle: ERLAUBT, laufModell });

// --- Die Einstellung liest das Feld ---

test("[night-42] stufenEinstellung traegt effort in den normalisierten Eintrag", () => {
  const e = stufenEinstellung({
    night: {
      stufen: {
        leicht: { modell: "claude-sonnet-5", effort: "low" },
        mittel: { modell: "claude-opus-5" },
      },
    },
  });
  assert.equal(e.stufen.leicht.effort, "low");
  assert.equal(e.stufen.mittel.effort, null, "ohne Feld steht null, nicht undefined");
  assert.ok("effort" in e.stufen.mittel, "das Feld fehlt ganz, statt null zu tragen");
});

test("[night-42] leerer Text zaehlt wie nicht gesetzt — dieselbe Regel wie bei modell und name", () => {
  const e = stufenEinstellung({ night: { stufen: { leicht: { modell: "claude-sonnet-5", effort: "   " } } } });
  assert.equal(e.stufen.leicht.effort, null);
});

// --- Die Wahl je Paket liefert das Paar aus einem Eintrag ---

test("[night-42] paketWahl liefert die Gruendlichkeit der verwendeten Stufe", () => {
  const w = wahl("Aufgabenstufe: leicht\n", { leicht: { modell: "claude-sonnet-5", effort: "low" } });
  assert.equal(w.modell, "claude-sonnet-5");
  assert.equal(w.stufeVerwendet, "leicht");
  assert.equal(w.effort, "low");
});

test("[night-42] beim Ausweichen nach oben gilt die Gruendlichkeit der Stufe, die das Modell stellt", () => {
  // Modell und Gruendlichkeit sind ein Paar: Wer die eigene Stufe nicht belegt, bekommt
  // beides von der Stufe, die einspringt — nicht das Modell von oben und die
  // Gruendlichkeit von unten.
  const w = wahl("Aufgabenstufe: leicht\n", {
    mittel: { modell: "claude-opus-5", effort: "max" },
  });
  assert.equal(w.stufe, "leicht");
  assert.equal(w.stufeVerwendet, "mittel");
  assert.equal(w.effort, "max");
});

test("[night-42] eine Stufe ohne effort liefert null", () => {
  const w = wahl("Aufgabenstufe: leicht\n", { leicht: { modell: "claude-sonnet-5" } });
  assert.equal(w.effort, null);
});

test("[night-42] der Modellname der Karte bringt keine Gruendlichkeit mit", () => {
  // Die Stufe bleibt an dieser Karte ohne Wirkung — dann darf auch ihre Gruendlichkeit
  // nicht wirken, sonst liefe das Modell der Karte mit dem effort einer fremden Stufe.
  const w = wahl("Empfohlenes Modell: claude-sonnet-5\nAufgabenstufe: leicht\n",
    { leicht: { modell: "claude-opus-5", effort: "max" } });
  assert.equal(w.herkunft, "karte");
  assert.equal(w.effort, null);
});

test("[night-42] beim Modell des Laufs ist die Gruendlichkeit null", () => {
  const ohneStufe = wahl("Kein Hinweis im Body.\n", { leicht: { modell: "claude-sonnet-5", effort: "low" } });
  assert.equal(ohneStufe.herkunft, "lauf");
  assert.equal(ohneStufe.effort, null);

  const ohneEinstellung = wahl("Aufgabenstufe: leicht\n", null);
  assert.equal(ohneEinstellung.herkunft, "lauf");
  assert.equal(ohneEinstellung.effort, null);
});

test("[night-42] eine Kommando-Stufe traegt keine Gruendlichkeit", () => {
  // Das Schema verbietet effort neben kommando (Issue #845). Die Wahl verlaesst sich
  // nicht darauf: Ein fremdes Programm kennt das Flag nicht, und `sessionStart` setzt es
  // im Kommando-Zweig ohnehin nie.
  const w = wahl("Aufgabenstufe: leicht\n", { leicht: { kommando: "sh", name: "lokal", effort: "max" } });
  assert.equal(w.stufeVerwendet, "leicht");
  assert.equal(w.kommando, "sh");
  assert.equal(w.effort, null);
});

// --- Die Kommandozeile der Session ---

const start = (opts, kommando = null) =>
  sessionStart({ testCmd: null, kommando, prompt: "/implement-next #1", modell: "claude-sonnet-5", args: {}, opts });

test("[night-42] sessionStart haengt --effort an, wenn eine Gruendlichkeit gesetzt ist", () => {
  const { cmd, cmdArgs } = start({ effort: "high" });
  assert.equal(cmd, "claude");
  const i = cmdArgs.indexOf("--effort");
  assert.ok(i >= 0, `--effort fehlt in der Kommandozeile: ${cmdArgs.join(" ")}`);
  assert.equal(cmdArgs[i + 1], "high");
});

test("[night-42] ohne Gruendlichkeit bleibt die Kommandozeile wortgleich mit der von vorher", () => {
  assert.deepEqual(start({}).cmdArgs, [
    "-p", "/implement-next #1", "--model", "claude-sonnet-5", "--permission-mode", "acceptEdits",
  ]);
});

test("[night-42] im Kommando-Zweig steht --effort nie", () => {
  // Das Programm ist nicht `claude` und kennt das Flag nicht — dieselbe Begruendung wie
  // beim Weglassen von --model.
  const { cmd, cmdArgs } = start({ effort: "max" }, "mein-runner");
  assert.equal(cmd, "sh");
  assert.ok(!cmdArgs.includes("--effort"), `--effort im Kommando-Zweig: ${cmdArgs.join(" ")}`);
});

test("[night-42] der Test-Hook bleibt unberuehrt", () => {
  const { cmd, cmdArgs } = sessionStart({
    testCmd: "true", kommando: null, prompt: "p", modell: "claude-sonnet-5", args: {}, opts: { effort: "max" },
  });
  assert.equal(cmd, "sh");
  assert.deepEqual(cmdArgs, ["-c", "true"]);
});

// --- Der Ergebnisstand ---

const FAKE_ERFOLG = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW].join("\n");

test("[night-42] ein Nachtlauf schreibt die Gruendlichkeit in die Einheit und nennt sie im Protokoll", NUR_POSIX, () => {
  const dir = setupProjekt("night-effort-stand-", {
    modelle: ERLAUBT,
    stufen: { leicht: { modell: "claude-sonnet-5", effort: "low" } },
  });
  try {
    const id = readyIssue(dir, "Leichtes Paket", "Aufgabenstufe: leicht\n\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--model", "claude-opus-5"],
      { NIGHT_CLAUDE_CMD: FAKE_ERFOLG });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.effort, "low", "die Gruendlichkeit fehlt in der Einheit");
    assert.deepEqual(
      Object.keys(e).slice(0, 8),
      ["id", "titel", "modell", "modellHerkunft", "modellGrund", "stufe", "stufeVerwendet", "effort"],
      `die Feldreihenfolge der Einheit hat sich verschoben: ${Object.keys(e).join(", ")}`,
    );
    assert.match(res.stdout, /Gruendlichkeit low/, `die Hinweiszeile nennt die Gruendlichkeit nicht:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-42] ohne Gruendlichkeit steht null in der Einheit und die Hinweiszeile bleibt wortgleich", NUR_POSIX, () => {
  const dir = setupProjekt("night-effort-ohne-", {
    modelle: ERLAUBT,
    stufen: { leicht: { modell: "claude-sonnet-5" } },
  });
  try {
    const id = readyIssue(dir, "Leichtes Paket", "Aufgabenstufe: leicht\n\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--model", "claude-opus-5"],
      { NIGHT_CLAUDE_CMD: FAKE_ERFOLG });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.equal(e.effort, null);
    assert.ok("effort" in e, "das Feld fehlt ganz, statt null zu tragen");
    assert.ok(!res.stdout.includes("Gruendlichkeit"), `die Hinweiszeile nennt eine Gruendlichkeit:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Die Vorschau ---

test("[night-42] --dry-run nennt die Gruendlichkeit der Stufe", NUR_POSIX, () => {
  const dir = setupProjekt("night-effort-dryrun-", {
    modelle: ERLAUBT,
    stufen: { leicht: { modell: "claude-sonnet-5", effort: "low" }, schwer: { modell: "claude-opus-5" } },
  });
  try {
    readyIssue(dir, "Leichtes Paket", "Aufgabenstufe: leicht\n\n");
    readyIssue(dir, "Mittleres Paket", "Aufgabenstufe: mittel\n\n");
    const res = run(dir, process.execPath, [NIGHT, "--dry-run", "--label", "none", "--max", "2", "--model", "claude-opus-5"]);
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    assert.match(res.stdout, /Leichtes Paket -> Session \d+, Stufe leicht, Modell claude-sonnet-5 \(Stufe leicht\), Gruendlichkeit low$/m,
      `die Gruendlichkeit fehlt im Dry-Run:\n${res.stdout}`);
    assert.match(res.stdout, /Mittleres Paket -> Session \d+, Stufe mittel nicht belegt, Modell claude-opus-5 \(Stufe schwer\)$/m,
      `die Zeile ohne Gruendlichkeit hat sich veraendert:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Der Bericht der Umsetzungsstufe ---

const umsetzungsBericht = (eintrag) => berichtBauen(
  { id: "1", ausgang: "fertig", variante: "B", stufen: { umsetzung: { umgesetzt: [eintrag], angehalten: [], nichtBegonnen: [] } } },
  { pakete: [{ id: "10", title: "P1" }], stempel: "s" },
);

test("[night-42] der Bericht der Umsetzungsstufe nennt die Gruendlichkeit eines Pakets", () => {
  const text = umsetzungsBericht({ id: "10", stufe: "leicht", stufeVerwendet: "leicht", modell: "claude-sonnet-5", effort: "high" });
  assert.match(text, /- umgesetzt: #10 P1 \(Aufgabenstufe leicht, Modell claude-sonnet-5, Gruendlichkeit high\)\.\n/);
});

test("[night-42] ohne Gruendlichkeit bleibt der Klammerzusatz zeichengleich zum Bestand", () => {
  const text = umsetzungsBericht({ id: "10", stufe: "leicht", stufeVerwendet: "leicht", modell: "claude-sonnet-5" });
  assert.match(text, /- umgesetzt: #10 P1 \(Aufgabenstufe leicht, Modell claude-sonnet-5\)\.\n/);
});
