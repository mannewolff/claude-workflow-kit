// Der Pfadvergleich des Installers unter jeder Plattform (Issue #873).
//
// `core.hooksPath` gegen das eigene `.githooks` zu halten, ist ein Vergleich von
// Verzeichnissen und nicht von Zeichenketten. Unter Windows schrieb git den Wert mit
// Schraegstrich, `join` mit Rueckstrich, und der Laufwerksbuchstabe kam mal gross,
// mal klein: Der Installer hielt sein eigenes Gate fuer einen fremden Hook-Manager
// und meldete es nicht als gesetzt. Der Fehler traf Windows-Nutzer real und nicht nur
// die CI.
//
// Darum nimmt `pfadeGleich` die Plattform als Parameter: Die Windows-Regel — Trenner
// egal, Gross-/Kleinschreibung egal — ist hier auf jedem Host pruefbar, auch auf dem
// macOS-Rechner, auf dem der Fehler nie auftrat.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pfadeGleich } from "../install.mjs";

test("[installer-2] unter Windows gilt derselbe Ort in unterschiedlicher Schreibweise als gleich", () => {
  assert.equal(pfadeGleich(String.raw`D:\a\repo\.githooks`, "D:/a/repo/.githooks", "win32"), true,
    "git liefert den Pfad mit Schraegstrich, join baut ihn mit Rueckstrich — dasselbe Verzeichnis");
  assert.equal(pfadeGleich(String.raw`d:\a\repo\.githooks`, String.raw`D:\a\repo\.githooks`, "win32"), true,
    "der Laufwerksbuchstabe entscheidet nicht ueber die Identitaet");
  assert.equal(pfadeGleich(String.raw`C:\Users\Runner\.githooks`, String.raw`c:\users\runner\.githooks`, "win32"), true,
    "das Dateisystem unterscheidet dort keine Gross-/Kleinschreibung");
  assert.equal(pfadeGleich(String.raw`D:\a\repo\.\.githooks`, String.raw`D:\a\repo\.githooks`, "win32"), true,
    "ein Punkt im Pfad ist kein anderer Ort");
});

test("[installer-2] unter Windows bleiben verschiedene Orte verschieden", () => {
  assert.equal(pfadeGleich(String.raw`D:\a\repo\.githooks`, String.raw`D:\a\repo\anderswo\.githooks`, "win32"), false,
    "der Name allein entscheidet nicht — ein fremdes .githooks bleibt fremd");
  assert.equal(pfadeGleich(String.raw`D:\a\repo\.githooks`, String.raw`E:\a\repo\.githooks`, "win32"), false,
    "ein anderes Laufwerk ist ein anderer Ort");
});

test("[installer-2] unter POSIX bleibt die Gross-/Kleinschreibung Teil des Namens", () => {
  assert.equal(pfadeGleich("/a/repo/.githooks", "/a/repo/./.githooks", "linux"), true,
    "normalisiert wird auch dort");
  assert.equal(pfadeGleich("/a/Repo/.githooks", "/a/repo/.githooks", "linux"), false,
    "zwei Verzeichnisse, die sich nur in der Schreibweise unterscheiden, sind dort zwei");
  assert.equal(pfadeGleich("/a/repo/.githooks", "/a/repo/.githooks", "darwin"), true);
});
