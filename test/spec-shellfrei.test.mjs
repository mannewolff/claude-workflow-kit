// kit/spec.mjs bleibt eine eigenstaendig portable Datei (Issue #440, #450).
//
// Muster: test/board-shellfrei.test.mjs — eine strukturelle Leitplanke am
// Quelltext, weil der Verstoss im Betrieb nicht auffiele. Ein Netzzugriff
// funktionierte in diesem Repo tadellos und schluege erst dort fehl, wo die Datei
// allein liegt: in einem fremden Projekt, das nur spec.mjs kopiert hat.
//
// **Was sich mit #450 geaendert hat, und warum.** Bis dahin verbot diese Datei
// jeden Unterprozess und jede Nennung von board.mjs. Beides ist mit `apply`
// nicht mehr zu halten: Die Spec-Wirkung steht im BODY des Arbeitspakets, und der
// liegt bei den Trackern `github` und `gitlab` nicht im Repo (Plan #437, A11).
// Ohne den Adapter kaeme `apply` an seine eigene Datenquelle nicht heran.
//
// Die Zusage, um die es wirklich ging, bleibt: keine Abhaengigkeit ausserhalb der
// Node-Standardbibliothek, kein Netz aus dieser Datei heraus, kein Import fremden
// Codes — und kein Unterprozess ueber eine Shell. Genau das wird hier geprueft.
// Was der Installer ohnehin nebeneinanderlegt (board.mjs unter .claude/kit/),
// darf spec.mjs aufrufen; was es sich selbst mitbringen muesste, nicht.
//
// Kommentarzeilen bleiben draussen, bevor geprueft wird — die Begruendungen im
// Quelltext duerfen die verbotenen Namen ausdruecklich nennen, das ist ihr Sinn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPEC } from "./helpers/spec-fixture.mjs";

function ohneKommentare(quelltext) {
  return quelltext
    .split("\n")
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
    .join("\n");
}

const QUELLE = ohneKommentare(readFileSync(SPEC, "utf-8"));

test("kit/spec.mjs greift nicht aufs Netz zu", () => {
  for (const modul of ["node:http", "node:https", "node:net"]) {
    assert.ok(!QUELLE.includes(modul),
      `${modul} hat in einer Datei nichts zu suchen, die nur specs/ liest`);
  }
  assert.doesNotMatch(QUELLE, /\bfetch\s*\(/,
    "fetch ist der Netzweg ohne Import — auch er bleibt draussen");
});

test("kit/spec.mjs importiert board.mjs nicht, es ruft es auf", () => {
  // Der Unterschied entscheidet ueber die Portabilitaet: Ein Import bindet die
  // Datei zur Ladezeit an einen Pfad, den es in einem fremden Projekt nicht geben
  // muss — dann laeuft nicht einmal `spec.mjs show`. Ein Unterprozess trifft nur
  // den einen Befehl, der ihn braucht, und auch nur, wenn er laeuft.
  assert.doesNotMatch(QUELLE, /import\s[^;]*board\.mjs/,
    "board.mjs gehoert nicht in die Importliste — `apply` startet es als eigenen Prozess");
});

test("kit/spec.mjs importiert nur aus der Node-Standardbibliothek", () => {
  // Auch ein Import aus dem Repo selbst — etwa die Glob-Fassung aus checks.mjs —
  // waere ein Weg nach draussen: Die Datei liesse sich dann nicht mehr einzeln
  // in ein fremdes Projekt kopieren (Issue #445).
  for (const [, modul] of QUELLE.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)) {
    assert.ok(modul.startsWith("node:"),
      `'${modul}' ist kein Standardmodul — spec.mjs traegt seine Abhaengigkeiten selbst`);
  }
});

test("kit/spec.mjs startet keinen Unterprozess ueber eine Shell", () => {
  // `apply` braucht zwei Kindprozesse (git und den Adapter), aber keine Shell:
  // Sie ist der Weg, auf dem ein Aussagetext aus einem fremden Body zu einem
  // Kommando wird. board.mjs hat sie mit Issue #196 aus genau diesem Grund
  // abgeschafft, und spec.mjs holt sie nicht zurueck.
  assert.doesNotMatch(QUELLE, /shell\s*:\s*true/,
    "ein Kindprozess mit Shell macht aus fremdem Text ein Kommando");
  assert.doesNotMatch(QUELLE, /\bexecSync?\s*\(/,
    "exec fuehrt seine Kommandozeile ueber die Shell aus — spawnSync mit Argumentliste ist der Weg");
});
