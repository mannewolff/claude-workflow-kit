// Schutztest der Eingrenzung im Kit selbst (Issue #850, Plan #843, E12).
//
// Das Kit bringt die bereichsbezogene Auswahl seit Issue #422 mit, hat sie aber
// im eigenen Repo nie benutzt: `.claude/workflow.config.json` trug keine
// `checkAreas`, und `node --test` war ein einziger Eintrag. Jeder Pruefstand
// meldete deshalb vollen Umfang — die eigene Leitplanke lief hier ungemessen mit.
//
// Mit den Teilen und den aufgeteilten Testaufrufen entsteht eine neue Fehlerart,
// und sie ist still: Eine Testdatei mit einem Praefix, das keiner der
// `node --test`-Eintraege nennt, LAEUFT NIE — weder vor dem Commit noch im
// Commit-Gate noch in der CI. Gruen hiesse dann „nicht geprueft". Dieselbe
// Richtung wie eine Quelldatei ohne Teil, nur umgekehrt sichtbar: Die faellt
// wenigstens in den vollen Umfang, die Testdatei faellt heraus.
//
// Seit Issue #933 (Plan #930, E4) prueft diese Datei zusaetzlich die Deckung
// selbst: Nicht mehr die Zahl der Aufrufe ist die Aussage, sondern dass jede
// gemessene Kopplung von Testdatei und Quelldatei ein Kommando findet, das sie
// auch wirklich ausloest. Eine feste Zahl, die bei jeder Aenderung mitgezogen
// wird, prueft nichts.
//
// Deshalb prueft diese Datei die ECHTE Config dieses Repos gegen `git ls-files`
// und nicht ein Beispiel: Ein Beispiel bewiese die Regel, nicht den Zustand.
//
// Die Glob-Aufloesung kommt aus `kit/checks.mjs`, die Verflechtung aus
// `tools/verflechtung.mjs`. Eine zweite Fassung hier beantwortete die Fragen
// „trifft dieses Muster diese Datei?" und „laedt dieser Test jene Quelle?" ein
// zweites Mal — und ab der ersten Abweichung bescheinigte der Test eine
// Abdeckung, die das ausfuehrende Kommando nicht sieht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { globZuRegex, bereicheVorbereiten } from "../kit/checks.mjs";
import { verflechtungErheben } from "../tools/verflechtung.mjs";

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

/** Die Testaufrufe der Config — an ihrem Kommando erkannt, nicht an ihrer Position. */
const testEintraege = (config.buildChecks ?? [])
  .filter((eintrag) => typeof eintrag === "object" && eintrag.cmd.startsWith("node --test"));

/** Die Dateimuster eines Testaufrufs als Regexe — die Argumente in Anfuehrungszeichen. */
function globeVon(eintrag) {
  return [...eintrag.cmd.matchAll(/"([^"]+)"/g)].map((treffer) => globZuRegex(treffer[1]));
}

test("jeder Testaufruf ist mindestens einem Teil zugeordnet", () => {
  // Bewusst ohne Zahl (Issue #933, E6 des Plans #930): Nach der Zerlegung ist nicht
  // mehr die Anzahl der Aufrufe die Aussage, sondern ihre Deckung. Eine Zahl, die bei
  // jeder Aenderung mitgezogen wird, prueft nichts.
  assert.ok(testEintraege.at(0), "kein einziger node --test-Eintrag in buildChecks");
  for (const eintrag of testEintraege) {
    assert.ok(
      eintrag.areas?.length > 0,
      `Testaufruf ohne Bereich: '${eintrag.cmd}' — er liefe damit immer.`,
    );
  }
});

test("jede versionierte Testdatei wird von einem der Aufrufe erfasst", () => {
  const regexe = testEintraege.flatMap(globeVon);
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

test("jede gemessene Kopplung unter kit/ und tools/ hat ein Kommando, das sie ausloest", () => {
  // Die Invariante aus E4 (Issue #933, Plan #930). Sie sagt, was die gefallene
  // Zahl der Aufrufe nie sagen konnte:
  //
  //   Laedt eine Testdatei eine Quelldatei, dann gibt es fuer JEDES Muster, das
  //   diese Quelldatei einem Bereich zuordnet, mindestens ein Pruefkommando, das
  //   diesen Bereich in `areas` fuehrt UND dessen Globs diese Testdatei erfassen.
  //
  // Ohne sie ist der Bereichsschnitt frei erfindbar: Ein Bereich, dessen
  // Testgruppe kein Kommando ausloest, ist still gruen — genau die Richtung, in
  // der ein Fehler niemandem auffaellt. Die Zahl der Aufrufe war dafuer nur ein
  // Stellvertreter; die Deckung ist die Sache selbst.
  //
  // Zunaechst nur fuer `kit/` und `tools/`: Dort legt Issue #933 den Schnitt neu.
  // Auf alle versionierten Quelldateien weitet Issue #936 sie aus.
  const tabelle = verflechtungErheben({ repoRoot });
  assert.ok(tabelle.size > 0, "die Verflechtungserhebung lieferte keine Zeile");

  const bereiche = bereicheVorbereiten(config.checkAreas ?? {});
  assert.ok(bereiche.length > 0, ".claude/workflow.config.json traegt keine checkAreas");

  const kommandos = testEintraege.map((eintrag) => ({
    areas: new Set(eintrag.areas ?? []),
    regexe: globeVon(eintrag),
  }));

  // Die drei Schritte stehen als eigene Funktionen da, nicht als drei ineinander
  // geschachtelte Schleifen: Der Linter zaehlt die Verschachtelung, und die Namen
  // sagen ohnehin besser, was der Schritt bedeutet.
  const geschnitten = (quelle) => quelle.startsWith("kit/") || quelle.startsWith("tools/");
  const bereicheVon = (quelle) => bereiche.filter((b) => b.regexe.some((r) => r.test(quelle)));
  const gedeckt = (bereich, testdatei) => kommandos.some(
    (k) => k.areas.has(bereich.name) && k.regexe.some((r) => r.test(testdatei)),
  );

  const luecken = new Set();
  for (const [testdatei, quellen] of tabelle) {
    for (const quelle of quellen.filter(geschnitten)) {
      for (const bereich of bereicheVon(quelle)) {
        if (!gedeckt(bereich, testdatei)) luecken.add(`${bereich.name}: ${quelle} braucht ${testdatei}`);
      }
    }
  }

  assert.deepEqual(
    [...luecken].sort(),
    [],
    "Bereiche, deren Aenderung eine Testdatei nicht ausloest, die die Quelle laedt — still gruen",
  );
});
