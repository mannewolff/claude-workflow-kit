// Schutztest der Eingrenzung im Kit selbst (Issue #850, Plan #843, E12).
//
// Das Kit bringt die bereichsbezogene Auswahl seit Issue #422 mit, hat sie aber
// im eigenen Repo nie benutzt: `.claude/workflow.config.json` trug keine
// `checkAreas`, und `node --test` war ein einziger Eintrag. Jeder Pruefstand
// meldete deshalb vollen Umfang — die eigene Leitplanke lief hier ungemessen mit.
//
// Mit den sechs Teilen und den drei Testaufrufen entsteht eine neue Fehlerart,
// und sie ist still: Eine Testdatei mit einem Praefix, das keiner der drei
// `node --test`-Eintraege nennt, LAEUFT NIE — weder vor dem Commit noch im
// Commit-Gate noch in der CI. Gruen hiesse dann „nicht geprueft". Dieselbe
// Richtung wie eine Quelldatei ohne Teil, nur umgekehrt sichtbar: Die faellt
// wenigstens in den vollen Umfang, die Testdatei faellt heraus.
//
// Deshalb prueft diese Datei die ECHTE Config dieses Repos gegen `git ls-files`
// und nicht ein Beispiel: Ein Beispiel bewiese die Regel, nicht den Zustand.
//
// Die Glob-Aufloesung kommt aus `kit/checks.mjs`. Eine zweite Fassung hier
// beantwortete die Frage „trifft dieses Muster diese Datei?" ein zweites Mal —
// und ab der ersten Abweichung bescheinigte der Test eine Abdeckung, die das
// ausfuehrende Kommando nicht sieht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { globZuRegex, bereicheVorbereiten } from "../kit/checks.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const config = JSON.parse(
  readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8"),
);

/**
 * Die versionierten Dateien zu einer Pfadangabe — `:(glob)` davor, damit `*`
 * wie in den Mustern der Config an der Segmentgrenze haltmacht und nicht wie in
 * gits Default-Pathspec darueber hinweglaeuft.
 *
 * Eine leere Antwort ist ein Fehler und kein leerer Fall: Sie entstuende, wenn
 * ein Verzeichnis umbenannt wird — und der Test bescheinigte dann die
 * Abdeckung einer Menge, die er gar nicht mehr sieht.
 */
function versionierte(...pfadangaben) {
  const res = spawnSync("git", ["ls-files", "-z", "--", ...pfadangaben], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  assert.equal(res.status, 0, `git ls-files schlug fehl: ${(res.stderr || "").trim()}`);
  const dateien = res.stdout.split("\0").filter((p) => p.length > 0);
  assert.ok(dateien.length > 0, `git ls-files fand nichts zu ${pfadangaben.join(", ")}`);
  return dateien;
}

/** Die drei Testaufrufe der Config — an ihrem Kommando erkannt, nicht an ihrer Position. */
const testEintraege = (config.buildChecks ?? [])
  .filter((eintrag) => typeof eintrag === "object" && eintrag.cmd.startsWith("node --test"));

test("drei Testaufrufe, jeder einem Teil zugeordnet", () => {
  // Drei, weil sich die Kit-Werkzeuge gegenseitig laden: night.mjs zieht board,
  // checks, aufwand, wirksamkeit und befunde nach, und 49 Nacht-Tests nennen
  // board.mjs. Sechs Aufrufe — einer je Teil — kosteten im vollen Umfang mehr,
  // als die feinere Eingrenzung je einspart.
  assert.equal(testEintraege.length, 3, "erwartet: genau drei node --test-Eintraege");
  for (const eintrag of testEintraege) {
    assert.ok(
      eintrag.areas?.length > 0,
      `Testaufruf ohne Bereich: '${eintrag.cmd}' — er liefe damit immer.`,
    );
  }
});

test("jede versionierte Testdatei wird von einem der drei Aufrufe erfasst", () => {
  const regexe = testEintraege
    .flatMap((eintrag) => [...eintrag.cmd.matchAll(/"([^"]+)"/g)])
    .map((treffer) => globZuRegex(treffer[1]));
  assert.ok(regexe.length > 0, "kein einziges Dateimuster in den Testaufrufen gefunden");

  const ohneAufruf = versionierte(":(glob)test/**/*.test.mjs")
    .filter((pfad) => !regexe.some((regex) => regex.test(pfad)));
  assert.deepEqual(
    ohneAufruf,
    [],
    "Testdateien, die kein Aufruf erfasst — sie liefen nirgends und waeren still gruen",
  );
});

test("jede versionierte Quelldatei liegt in mindestens einem Teil", () => {
  const bereiche = bereicheVorbereiten(config.checkAreas ?? {});
  assert.ok(bereiche.length > 0, ".claude/workflow.config.json traegt keine checkAreas");

  const dateien = versionierte(
    "kit", "tools", "skills", "docs", "templates", ".githooks", "install.mjs", "RELEASING.md",
  );
  const ohneTeil = dateien.filter(
    (pfad) => !bereiche.some((bereich) => bereich.regexe.some((regex) => regex.test(pfad))),
  );
  assert.deepEqual(
    ohneTeil,
    [],
    "Quelldateien ohne Teil — jede Aenderung an ihnen loest den vollen Umfang aus",
  );
});
