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

// --- Geruest statt Kopplung (Issue #943, Plan #930) ---
//
// Die Erhebung zaehlt jede Erwaehnung eines Quellpfads als Kopplung. Fuer die
// Deckungsfrage der E4-Invariante irrt das in die sichere Richtung; fuer die Auswahl
// nicht mehr: Die Nacht- und Pruef-Tests legen in ihren Wegwerf-Repositories eine
// `.gitignore`, eine `README.md` und eine `workflow.config.json` an, ohne an ihnen etwas
// zu pruefen. Wer das nicht unterscheiden kann, erzwingt breite `areas` — und eine
// Auswahl, die alles zieht, waehlt nichts aus.
//
// Die Muster gelten gegen den Quellpfad, nicht gegen die Testdatei. Ausgeschlossen wird
// damit, was als Geruest ERWAEHNT wird, nicht wer es erwaehnt: Eine Liste, die je
// Testdatei entschiede, waere eine zweite Verflechtungstabelle neben der ersten.

test("[943] ohne Musterliste bleibt die Tabelle die von heute", () => {
  // Die Zeilenzahl gegen `git ls-files` statt gegen eine feste Zahl: Eine Zahl, die bei
  // jeder neuen Testdatei mitgezogen wird, prueft nichts.
  const versionierteTests = spawnSync("git", ["ls-files", "-z", "--", ":(glob)test/**/*.test.mjs"], {
    cwd: repoRoot,
    encoding: "utf-8",
  }).stdout.split("\0").filter((p) => p.length > 0);
  assert.equal(tabelle.size, versionierteTests.length, "die Erhebung deckt nicht jede versionierte Testdatei");

  const leereListe = verflechtungErheben({ repoRoot, nurGeruest: [] });
  assert.equal(leereListe.size, tabelle.size);
  for (const [testdatei, quellen] of tabelle) {
    assert.deepEqual(leereListe.get(testdatei), quellen, testdatei);
  }

  // Die drei benannten Eintraege sind die drei Belege aus Issue #943: ohne Liste zaehlen
  // sie weiter als Kopplung, und genau das ist der unveraenderte Stand.
  const nacht = tabelle.get("test/night-abschlussblock.test.mjs");
  assert.ok(nacht, "test/night-abschlussblock.test.mjs fehlt in der Tabelle");
  assert.ok(nacht.includes(".gitignore"), `.gitignore fehlt: ${nacht.join(", ")}`);
  assert.ok(nacht.includes("README.md"), `README.md fehlt: ${nacht.join(", ")}`);
  const einstellungen = tabelle.get("test/einstellungen-teile.test.mjs");
  assert.ok(einstellungen.includes(".claude/workflow.config.json"), einstellungen.join(", "));
});

test("[943] ein Muster nimmt seinen Quellpfad aus jeder Zeile und laesst jede andere Zeile stehen", () => {
  // `.gitignore` ist der groesste Posten des Bestands: 108 Testdateien nennen den Pfad,
  // die allermeisten, weil sie sich eine eigene in einem Wegwerf-Repo anlegen. Hier steht
  // er als Probe, nicht als Eintrag der Config — welche Muster das Projekt wirklich
  // fuehrt, entscheidet die Messung in `.claude/workflow.config.json`.
  const ohne = verflechtungErheben({ repoRoot, nurGeruest: [".gitignore"] });
  assert.equal(ohne.size, tabelle.size, "die Zahl der Zeilen darf sich nicht aendern");

  let betroffen = 0;
  for (const [testdatei, quellen] of tabelle) {
    const erwartet = quellen.filter((q) => q !== ".gitignore");
    if (erwartet.length !== quellen.length) betroffen += 1;
    assert.deepEqual(ohne.get(testdatei), erwartet, testdatei);
  }
  assert.ok(betroffen > 1, `nur ${betroffen} Zeile(n) betroffen — die Probe belegt nichts`);
});

test("[943] die Muster lesen sich wie die der Bereiche", () => {
  // Dieselbe Glob-Aufloesung wie `checkAreas` und `ohnePruefung`, aus `kit/checks.mjs`
  // geholt und nicht nachgebaut: Zwei Fassungen derselben Frage weichen ab dem ersten
  // Sonderfall voneinander ab, und die Erhebung saehe dann etwas anderes als die Auswahl.
  const ohneSkills = verflechtungErheben({ repoRoot, nurGeruest: ["skills/**"] });
  const vorher = [...tabelle.values()].flat().filter((q) => q.startsWith("skills/"));
  assert.ok(vorher.length > 0, "der Bestand kennt keine Kopplung an skills/ — die Probe belegt nichts");
  assert.deepEqual(
    [...ohneSkills.values()].flat().filter((q) => q.startsWith("skills/")),
    [],
    "das Muster skills/** hat nicht ueber die Segmentgrenze hinweg gegriffen",
  );
});
