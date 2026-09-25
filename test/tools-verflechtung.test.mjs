// Schutztest der Verflechtungserhebung (Issue #931, Plan #930, E5).
//
// Der Plan legt jeden Schnitt der bereichsbezogenen Auswahl gegen die
// tatsaechliche Verflechtung von Testdateien und Quelldateien. Wer diese
// Verflechtung raet statt sie zu erheben, irrt in die Richtung, in der der
// Fehler niemandem auffaellt: Ein Bereich, der eine Testgruppe nicht ausloest,
// ist still gruen.
//
// Geprueft wird deshalb an belegten Faellen aus dem Bestand und nicht an einem
// Beispielprojekt — ein Beispiel bewiese die Regel, nicht den Zustand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { verflechtungErheben } from "../tools/verflechtung.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const tabelle = verflechtungErheben({ repoRoot });

test("[931] die Erhebung liefert eine nicht leere Tabelle ueber versionierte Testdateien", () => {
  assert.ok(tabelle.size > 0, "die Verflechtungstabelle ist leer");
  for (const [testdatei, quellen] of tabelle) {
    assert.match(testdatei, /^test\/.*\.test\.mjs$/, `kein Testpfad: ${testdatei}`);
    assert.ok(Array.isArray(quellen), `keine Quellliste zu ${testdatei}`);
  }
});

test("[931] einstellungen-teile laedt die echte Projektkonfiguration", () => {
  // Zeile 32 der Testdatei liest `../.claude/workflow.config.json`. Der Plan
  // haengt daran den neuen Bereich `konfiguration` (E9); saehe die Erhebung die
  // Kopplung nicht, entstuende der Bereich ohne die Gruppe, die ihn braucht.
  const quellen = tabelle.get("test/einstellungen-teile.test.mjs");
  assert.ok(quellen, "test/einstellungen-teile.test.mjs fehlt in der Tabelle");
  assert.ok(
    quellen.includes(".claude/workflow.config.json"),
    `erwartet: .claude/workflow.config.json — erhoben: ${quellen.join(", ")}`,
  );
  assert.ok(quellen.includes("kit/einstellungen.mjs"), "der direkte Import fehlt");
});

test("[931] die board-Tests laden kit/board.mjs", () => {
  const boardTests = [...tabelle.keys()].filter((p) => p.startsWith("test/board-"));
  assert.ok(boardTests.length > 0, "keine board-Tests in der Tabelle");
  const ohneBoard = boardTests.filter((p) => !tabelle.get(p).includes("kit/board.mjs"));
  assert.deepEqual(ohneBoard, [], "board-Tests ohne Kopplung an kit/board.mjs");
});

test("[931] night-kette-worktree laedt kit/night.mjs", () => {
  // Das Akzeptanzkriterium des Pakets nennt hier `kit/worktree.mjs`; der
  // Bestand sagt das Gegenteil (Zeile 40 von kit/worktree.mjs importiert
  // ./night.mjs, nicht umgekehrt, und die Worktree-Funktionen liegen in
  // night.mjs). Geprueft wird die belegte Kopplung — eine erfundene bescheinigte
  // dem spaeteren Schnitt eine Absicherung, die es nicht gibt.
  const quellen = tabelle.get("test/night-kette-worktree.test.mjs");
  assert.ok(quellen, "test/night-kette-worktree.test.mjs fehlt in der Tabelle");
  assert.ok(
    quellen.includes("kit/night.mjs"),
    `erwartet: kit/night.mjs — erhoben: ${quellen.join(", ")}`,
  );
});

test("[931] die Kette laeuft durch test/helpers hindurch", () => {
  // `test/einstellungen-oberflaeche.test.mjs` und Nachbarn laden ihre
  // Quelldateien ueber `test/helpers/oberflaeche-vm.mjs`; ein Graph, der an der
  // Helferdatei endet, saehe die Kopplung nicht (E8).
  const ueberHelfer = [...tabelle.entries()].filter(([, quellen]) => quellen.length > 0);
  assert.ok(ueberHelfer.length > 0, "keine einzige Kopplung erhoben");

  const helfer = "test/helpers/checks-repo.mjs";
  const nutzer = [...tabelle.keys()].filter((p) => p.startsWith("test/checks-"));
  assert.ok(nutzer.length > 0, `keine Nutzer von ${helfer} in der Tabelle`);
  const ohneChecks = nutzer.filter((p) => !tabelle.get(p).includes("kit/checks.mjs"));
  assert.deepEqual(ohneChecks, [], "checks-Tests ohne Kopplung an kit/checks.mjs");
});

test("[931] eine Quelldatei erscheint nie als eigene Quelle und nie doppelt", () => {
  for (const [testdatei, quellen] of tabelle) {
    assert.deepEqual(
      [...new Set(quellen)].sort(),
      [...quellen].sort(),
      `doppelte Eintraege bei ${testdatei}`,
    );
    assert.ok(
      !quellen.some((q) => q.startsWith("test/")),
      `Testdateien gehoeren nicht in die Quellmenge: ${testdatei}`,
    );
  }
});

test("[931] der direkte Aufruf gibt die Tabelle aus", () => {
  const res = spawnSync(process.execPath, [join(repoRoot, "tools", "verflechtung.mjs")], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  assert.equal(res.status, 0, `Exitcode ${res.status}: ${(res.stderr || "").trim()}`);
  assert.match(res.stdout, /test\/board-.*\.test\.mjs/, "die Ausgabe nennt keine Testdatei");
  assert.match(res.stdout, /kit\/board\.mjs/, "die Ausgabe nennt keine Quelldatei");
});
