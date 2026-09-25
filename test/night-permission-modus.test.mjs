// Der Permission-Modus der Nacht-Sessions (Issue #940).
//
// Die Sessions liefen mit `--permission-mode acceptEdits`. In diesem Modus greift eine
// eingebaute Sperre fuer sensible Dateien, die ein `permissions.allow`-Eintrag nicht
// aufhebt: Am 2026-09-25 scheiterte Paket #933 zweimal daran, dass die Session
// `.claude/workflow.config.json` nicht schreiben durfte — obwohl der Eintrag
// `Edit(.claude/workflow.config.json)` gesetzt war und derselbe Zugriff interaktiv im
// auto mode durchlief.
//
// `auto` allein waere schlimmer als der alte Zustand: Dort entscheidet ein Klassifikator,
// und was er nicht entscheiden kann, wird zur Rueckfrage. `--permission-prompts` steht per
// Vorgabe auf `host`; der Runner startet `claude` ohne SDK-Host, die Rueckfrage haette dort
// niemanden, und die Session hinge bis zum Rundenzeitlimit. `none` beantwortet das:
// "nobody: anything that would prompt is denied automatically; the permission mode still
// decides everything else". Aus einem stillen Haenger wird wieder eine klare Ablehnung.
//
// Beide Aufrufstellen — Session-Start und Vorflug — bilden denselben Ausdruck. Er steht
// darum in EINER Funktion: Zwei Orte fuer dieselbe Entscheidung driften auseinander, und
// genau diese Doppelung hat diese Umstellung erst zu einer Aenderung an zwei Stellen
// gemacht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { permissionArgs } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const quelle = readFileSync(join(repoRoot, "kit", "night.mjs"), "utf-8");

test("[night-940] ohne --yolo laeuft die Session im auto mode, Rueckfragen werden abgelehnt", () => {
  assert.deepEqual(permissionArgs(false), [
    "--permission-mode", "auto",
    "--permission-prompts", "none",
  ]);
});

test("[night-940] --yolo bleibt unveraendert und setzt keinen Modus", () => {
  const args = permissionArgs(true);
  assert.deepEqual(args, ["--dangerously-skip-permissions"]);
  // Ausdruecklich: Der Yolo-Zweig darf die beiden Flags NICHT mitfuehren. Ein
  // `--permission-mode` neben `--dangerously-skip-permissions` waere eine zweite
  // Aussage ueber dieselbe Sache.
  assert.ok(!args.includes("--permission-mode"), "yolo darf keinen Modus setzen");
  assert.ok(!args.includes("--permission-prompts"), "yolo darf keine Prompt-Regel setzen");
});

test("[night-940] acceptEdits kommt in der Quelle nicht mehr vor", () => {
  assert.equal(
    quelle.includes("acceptEdits"),
    false,
    "kit/night.mjs nennt noch acceptEdits — Hilfetext oder Aufrufstelle wurde vergessen",
  );
});

test("[night-940] beide Aufrufstellen nutzen dieselbe Funktion, keine eigene Liste", () => {
  // Die Zahl ist hier die Aussage: genau ein Ort, der die Flags bildet (die Definition),
  // und die Aufrufstellen daneben. Eine zweite Liste im Quelltext waere die Doppelung,
  // die dieses Paket beseitigt.
  const definitionen = [...quelle.matchAll(/function permissionArgs\b/g)].length;
  assert.equal(definitionen, 1, "permissionArgs ist nicht genau einmal definiert");

  const aufrufe = [...quelle.matchAll(/permissionArgs\(/g)].length;
  assert.ok(aufrufe >= 3, `erwartet: Definition + mindestens zwei Aufrufstellen, gefunden: ${aufrufe}`);

  assert.equal(
    quelle.includes('"--dangerously-skip-permissions"'),
    true,
    "der Yolo-Zweig steht nicht mehr im Quelltext",
  );
  const yoloStellen = [...quelle.matchAll(/"--dangerously-skip-permissions"/g)].length;
  assert.equal(yoloStellen, 1, "der Yolo-Zweig steht mehr als einmal — die Doppelung ist zurueck");
});
