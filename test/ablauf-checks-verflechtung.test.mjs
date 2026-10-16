// Ablauf-Pruefung: zwei Faelle pruefen die Kommandozeile von kit/checks/verflechtung.mjs mit Ausgabe und Exitcode.
//
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
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { verflechtungErheben, kopplungVon, TEXTE } from "../kit/checks/verflechtung.mjs";
import { mitRepo, datei, git } from "./helpers/checks-repo.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Die Faelle aus dem Bestand fragen nach der Kopplung insgesamt — „laedt" und „nennt"
// zusammen, wie vor der Trennung (Issue #1714, Plan #1713 A2).
const tabelle = kopplungVon(verflechtungErheben({ repoRoot }));

test("[931] die Erhebung liefert eine nicht leere Tabelle ueber die Testdateien des Arbeitsstands", () => {
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
  // Zusammengesetzt wie der Teil kitstand weiter unten: Als Zeichenkette genannt, koppelte die
  // Erhebung diesen Test an die Einstellungs-Oberflaeche, die er nie laedt (Issue #1714).
  assert.ok(quellen.includes(["kit", "settings.mjs"].join("/")), "der direkte Import fehlt");
});

test("[931] die board-Tests laden kit/board.mjs oder einen seiner Teile", () => {
  // test/board-ui-* prueft kit/board-ui.mjs, nicht kit/board.mjs (Issue #1137). Seit
  // Issue #1211 (Plan #1199, E18) laden die Tests eines Teils den Teil unter kit/board/
  // und nicht mehr den Einstieg.
  const boardTests = [...tabelle.keys()].filter((p) => p.startsWith("test/board-") && !p.startsWith("test/board-ui-"));
  assert.ok(boardTests.length > 0, "keine board-Tests in der Tabelle");
  const laedtBoard = (quelle) => quelle === "kit/board.mjs" || quelle.startsWith("kit/board/");
  const ohneBoard = boardTests.filter((p) => !tabelle.get(p).some(laedtBoard));
  assert.deepEqual(ohneBoard, [], "board-Tests ohne Kopplung an kit/board.mjs oder einen Teil");
});

test("[931] night-kitstand-worktree laedt den Teil kitstand des Nacht-Runners", () => {
  // Das Akzeptanzkriterium des Pakets nennt hier den Einstieg worktree.mjs; der
  // Bestand sagt das Gegenteil (der Einstieg importiert die Worktree-Funktionen,
  // nicht umgekehrt). Seit Issue #1226 liegen sie im Teil kitstand unter kit/night/, und
  // der Test importiert ihn statt des Einstiegs (Plan #1199, E18). Geprueft wird die
  // belegte Kopplung — eine erfundene bescheinigte dem Schnitt eine Absicherung, die
  // es nicht gibt.
  //
  // Der Pfad des Teils steht zusammengesetzt: Als Zeichenkette erwaehnt, zaehlte die
  // Erhebung ihn als Quelle DIESES Tests, und jede Aenderung am Teil loeste die ganze
  // Gruppe der Werkzeug-Tests aus — gelesen wird der Teil hier aber nie.
  const teil = ["kit", "night", "kitstand.mjs"].join("/");
  const quellen = tabelle.get("test/night-kitstand-worktree.test.mjs");
  assert.ok(quellen, "test/night-kitstand-worktree.test.mjs fehlt in der Tabelle");
  assert.ok(quellen.includes(teil), `erwartet: ${teil} — erhoben: ${quellen.join(", ")}`);
});

test("[931] die Kette laeuft durch test/helpers hindurch", () => {
  // `test/einstellungen-oberflaeche.test.mjs` und Nachbarn laden ihre
  // Quelldateien ueber `test/helpers/oberflaeche-vm.mjs`; ein Graph, der an der
  // Helferdatei endet, saehe die Kopplung nicht (E8).
  const ueberHelfer = [...tabelle.entries()].filter(([, quellen]) => quellen.length > 0);
  assert.ok(ueberHelfer.length > 0, "keine einzige Kopplung erhoben");

  // Die Kandidaten kommen aus dem echten Import und nicht aus dem Namenspraefix
  // `test/checks-` (Issue #957). Das Praefix ist die Zuordnungskonvention der
  // Pruefkommandos, nicht eine Aussage darueber, wen dieser Helfer laedt:
  // `test/checks-lint-sortordnung.test.mjs` traegt es und prueft die
  // eslint-Leitplanke, nicht `kit/checks.mjs`. Ueber das Praefix gewaehlt,
  // beanstandete die Invariante genau diese Datei — und zwar erst nach ihrem
  // Commit, weil die Erhebung den Arbeitsstand vorher nicht sah.
  const helfer = "test/helpers/checks-repo.mjs";
  const helferImport = /(?:from|import)[\s(]*["'][^"']*helpers\/checks-repo\.mjs["']/;
  const nutzer = [...tabelle.keys()].filter(
    (p) => helferImport.test(readFileSync(join(repoRoot, p), "utf-8")),
  );
  assert.ok(nutzer.length > 0, `keine Nutzer von ${helfer} in der Tabelle`);
  const ohneChecks = nutzer.filter((p) => !tabelle.get(p).includes("kit/checks.mjs"));
  assert.deepEqual(ohneChecks, [], `Nutzer von ${helfer} ohne Kopplung an kit/checks.mjs`);
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
  const res = spawnSync(process.execPath, [join(repoRoot, "kit", "checks", "verflechtung.mjs")], {
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
  //
  // Gezaehlt wird derselbe Arbeitsstand, den die Erhebung seit Issue #957 sieht:
  // versioniert UND uncommittet neu angelegt. Nur die versionierten zu zaehlen machte
  // diesen Test in genau dem Lauf rot, der eine neue Testdatei mitbringt — also in
  // jedem Paket, das eine anlegt.
  const testDateienVon = (...args) => spawnSync(
    "git",
    ["ls-files", "-z", ...args, "--", ":(glob)test/**/*.test.mjs"],
    { cwd: repoRoot, encoding: "utf-8" },
  ).stdout.split("\0").filter((p) => p.length > 0);
  const imArbeitsstand = new Set([
    ...testDateienVon(),
    ...testDateienVon("--others", "--exclude-standard"),
  ]);
  assert.equal(tabelle.size, imArbeitsstand.size, "die Erhebung deckt nicht jede Testdatei des Arbeitsstands");

  const leereListe = kopplungVon(verflechtungErheben({ repoRoot, nurGeruest: [] }));
  assert.equal(leereListe.size, tabelle.size);
  for (const [testdatei, quellen] of tabelle) {
    assert.deepEqual(leereListe.get(testdatei), quellen, testdatei);
  }

  // Die drei benannten Eintraege sind die drei Belege aus Issue #943: ohne Liste zaehlen
  // sie weiter als Kopplung, und genau das ist der unveraenderte Stand.
  const nacht = tabelle.get("test/ablauf-night-abschlussblock.test.mjs");
  assert.ok(nacht, "test/ablauf-night-abschlussblock.test.mjs fehlt in der Tabelle");
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
  const ohne = kopplungVon(verflechtungErheben({ repoRoot, nurGeruest: [".gitignore"] }));
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
  const ohneSkills = kopplungVon(verflechtungErheben({ repoRoot, nurGeruest: ["skills/**"] }));
  const vorher = [...tabelle.values()].flat().filter((q) => q.startsWith("skills/"));
  assert.ok(vorher.length > 0, "der Bestand kennt keine Kopplung an skills/ — die Probe belegt nichts");
  assert.deepEqual(
    [...ohneSkills.values()].flat().filter((q) => q.startsWith("skills/")),
    [],
    "das Muster skills/** hat nicht ueber die Segmentgrenze hinweg gegriffen",
  );
});

test("[956] Testdateien und Quellpfade kommen in Codepoint-Ordnung", () => {
  // Die Erhebung sortierte Testdateien und Quellpfade mit einem blossen `.sort()`.
  // Die Leitplanke gegen S2871 (eslint.config.mjs, Issue #956) verlangt dort eine
  // Vergleichsfunktion, und die Wahl ist nicht gleichgueltig: `localeCompare`
  // ordnet Sonderzeichen anders — `.claude/…`, `.githooks/…` und `kit/…` stehen
  // damit in anderer Reihenfolge als nach Codepoints. Die Verflechtungstabelle
  // geht in die bereichsbezogene Auswahl der Pruefungen ein; verdrehte Ordnung
  // liefe still weiter und faellt erst auf, wenn ein Bereich seine Gruppe
  // verfehlt. Festgeschrieben wird deshalb die bisherige Ordnung.
  const codepoint = (a, b) => (a < b ? -1 : Number(a > b));

  const testdateien = [...tabelle.keys()];
  assert.deepEqual(testdateien, [...testdateien].sort(codepoint), "Testdateien nicht in Codepoint-Ordnung");

  for (const [testdatei, quellen] of tabelle) {
    assert.deepEqual(quellen, [...quellen].sort(codepoint), `Quellen zu ${testdatei} nicht in Codepoint-Ordnung`);
  }
});

test("[956] die Ordnung unterscheidet sich belegbar von localeCompare", () => {
  // Ohne diesen Nachweis waere der Test darueber zahnlos: Waeren beide Ordnungen
  // hier zufaellig gleich, bliebe ein Wechsel auf `localeCompare` unbemerkt.
  const alle = [...new Set([...tabelle.values()].flat())];
  const codepoint = [...alle].sort((a, b) => (a < b ? -1 : Number(a > b)));
  const locale = [...alle].sort((a, b) => a.localeCompare(b));
  assert.notDeepEqual(codepoint, locale, "beide Ordnungen sind hier gleich — der Schutztest oben belegt nichts");
});

// --- Der Arbeitsstand, nicht nur der Commit (Issue #957) ---
//
// Der Prueflauf eines Arbeitspakets steht VOR dem Commit. Sah die Erhebung nur
// `git ls-files`, war eine in diesem Paket neu angelegte Testdatei fuer jede
// Invariante unsichtbar, die auf ihr aufsitzt — sichtbar wurde sie erst im Lauf der
// naechsten Karte, und der Fund gehoerte dann der falschen. Belegter Vorfall:
// Karte 956 legte `test/checks-lint-sortordnung.test.mjs` an, ihr Paketlauf war
// gruen, und `push main` scheiterte danach an der E4-Invariante.
//
// Geprueft wird hier im Wegwerf-Repo und nicht am Bestand: Ob eine UNCOMMITTETE
// Datei mitzaehlt, laesst sich an einem Repo, das sauber sein soll, nicht zeigen.

test("[957] die Erhebung traegt die committete und die uncommittete Testdatei", () => {
  mitRepo({}, (dir) => {
    datei(dir, "kit/quelle.mjs", "export const eins = 1;\n");
    datei(dir, "test/committet.test.mjs", 'import { eins } from "../kit/quelle.mjs";\nconsole.log(eins);\n');
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "erste Testdatei");

    datei(dir, "test/uncommittet.test.mjs", 'import { eins } from "../kit/quelle.mjs";\nconsole.log(eins);\n');

    const tabelleDort = kopplungVon(verflechtungErheben({ repoRoot: dir }));
    assert.deepEqual(
      tabelleDort.get("test/committet.test.mjs"),
      ["kit/quelle.mjs"],
      "die committete Testdatei fehlt oder traegt die Kopplung nicht",
    );
    assert.deepEqual(
      tabelleDort.get("test/uncommittet.test.mjs"),
      ["kit/quelle.mjs"],
      "die uncommittete Neuanlage fehlt in der Erhebung — der Paketlauf saehe sie nicht",
    );
  });
});

test("[957] eine ignorierte Neuanlage bleibt draussen", () => {
  // `--exclude-standard` ist nicht Beiwerk: Ohne es zaehlten `node_modules/` und
  // jeder lokale Zustand unter `.claude/` als Arbeitsstand mit, und die Quellmenge
  // waere voll von Dateien, die kein Pruefkommando je liest.
  mitRepo({}, (dir) => {
    datei(dir, "kit/quelle.mjs", "export const eins = 1;\n");
    datei(dir, ".gitignore", ".claude/*\n!.claude/workflow.config.json\ntest/ignoriert.test.mjs\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "quelle");

    datei(dir, "test/ignoriert.test.mjs", 'import "../kit/quelle.mjs";\n');
    datei(dir, "test/gesehen.test.mjs", 'import "../kit/quelle.mjs";\n');

    const tabelleDort = kopplungVon(verflechtungErheben({ repoRoot: dir }));
    assert.ok(tabelleDort.has("test/gesehen.test.mjs"), "die nicht ignorierte Neuanlage fehlt");
    assert.ok(
      !tabelleDort.has("test/ignoriert.test.mjs"),
      `ignorierter Pfad in der Tabelle: ${[...tabelleDort.keys()].join(", ")}`,
    );
  });
});

test("[957] ausserhalb eines Repositories wirft die Erhebung weiterhin", () => {
  // Der Fehlerpfad ist die Begruendung der Funktion: Eine Erhebung von null saehe
  // wie „keine Kopplung" aus, und jede Invariante darauf waere still gruen. Der
  // zweite git-Aufruf darf daran nichts aendern — leer ist bei ihm der Normalfall.
  const draussen = mkdtempSync(join(tmpdir(), "verflechtung-ohne-repo-"));
  try {
    assert.throws(() => verflechtungErheben({ repoRoot: draussen }), /git ls-files/);
  } finally {
    rmSync(draussen, { recursive: true, force: true });
  }
});

// --- Teile und Einstiege (Issue #1208, Plan #1199, E18) ---
//
// Zerfallen die Einstiege night.mjs und board.mjs in Teile unter `kit/night/` und
// `kit/board/`, ist jeder Teil eine eigene Quelle. Ein Test, der den Teil laedt,
// koppelt nur an ihn; einer, der den Einstieg laedt, koppelt an den Einstieg und
// nicht an die Teile dahinter — die Kette laeuft nicht von Quelle zu Quelle, die
// Teile erreicht die Auswahl ueber die abhaengigen Bereiche in kit/checks.mjs.

test("[1208] Teile unter kit/night/ und kit/board/ sind eigene Quellen, der Einstieg koppelt an sich selbst", () => {
  mitRepo({}, (dir) => {
    for (const werkzeug of ["night", "board"]) {
      datei(dir, `kit/${werkzeug}/grundlagen.mjs`, "export const g = 1;\n");
      datei(dir, `kit/${werkzeug}.mjs`, `export { g } from "./${werkzeug}/grundlagen.mjs";\n`);
      datei(dir, `test/${werkzeug}-teil.test.mjs`, `import { g } from "../kit/${werkzeug}/grundlagen.mjs";\nconsole.log(g);\n`);
      datei(dir, `test/${werkzeug}-einstieg.test.mjs`, `import { g } from "../kit/${werkzeug}.mjs";\nconsole.log(g);\n`);
    }

    const tabelleDort = kopplungVon(verflechtungErheben({ repoRoot: dir }));
    for (const werkzeug of ["night", "board"]) {
      assert.deepEqual(tabelleDort.get(`test/${werkzeug}-teil.test.mjs`), [`kit/${werkzeug}/grundlagen.mjs`]);
      assert.deepEqual(tabelleDort.get(`test/${werkzeug}-einstieg.test.mjs`), [`kit/${werkzeug}.mjs`]);
    }
  });
});

// --- „laedt" und „nennt" getrennt (Issue #1714, Plan #1713 A2) ---
//
// Der Vorschlag und der Abgleich der Pruefbereiche fragen verschieden: Eine Luecke ist eine
// Datei, die ein Test LAEDT; ein Geruest-Kandidat ist eine, die viele Tests nur NENNEN. Die
// Messung liefert darum je Test zwei Listen. Eine Datei, die der Test laedt, steht nur unter
// „laedt", auch wenn ihr Pfad im Importtext steht: „nennt" sind die Pfade, die der Test als
// Zeichenkette fuehrt, ohne sie zu laden. Gekoppelt bleibt beides, wie vor der Trennung.

test("[1714] je Test getrennte Listen: laedt ueber die Importkette, nennt als Zeichenkette", () => {
  mitRepo({}, (dir) => {
    datei(dir, "kit/geladen.mjs", "export const g = 1;\n");
    datei(dir, "kit/ueber-helfer.mjs", "export const h = 1;\n");
    datei(dir, "kit/alt.cjs", "module.exports = { a: 1 };\n");
    datei(dir, "kit/rolle.md", "Rolle\n");
    datei(dir, "kit/gestartet.mjs", "console.log(1);\n");
    datei(dir, "test/helpers/helfer.mjs", 'export { h } from "../../kit/ueber-helfer.mjs";\nexport const rolle = "kit/rolle.md";\n');
    datei(dir, "test/beides.test.mjs", [
      'import { g } from "../kit/geladen.mjs";',
      'import { h } from "./helpers/helfer.mjs";',
      'const { a } = require("../kit/alt.cjs");',
      'const start = "kit/gestartet.mjs";',
      "console.log(g, h, a, start);",
      "",
    ].join("\n"));

    const messung = verflechtungErheben({ repoRoot: dir });
    assert.deepEqual(messung.get("test/beides.test.mjs"), {
      laedt: ["kit/alt.cjs", "kit/geladen.mjs", "kit/ueber-helfer.mjs"],
      nennt: ["kit/gestartet.mjs", "kit/rolle.md"],
    });
    assert.deepEqual(
      kopplungVon(messung).get("test/beides.test.mjs"),
      ["kit/alt.cjs", "kit/geladen.mjs", "kit/gestartet.mjs", "kit/rolle.md", "kit/ueber-helfer.mjs"],
      "die Kopplung ist die Vereinigung beider Listen",
    );
  });
});

test("[1714] nurGeruest nimmt einen Pfad aus laedt und aus nennt", () => {
  mitRepo({}, (dir) => {
    datei(dir, "geruest/geladen.mjs", "export const g = 1;\n");
    datei(dir, "geruest/genannt.md", "Text\n");
    datei(dir, "kit/bleibt.mjs", "export const b = 1;\n");
    datei(dir, "test/a.test.mjs", [
      'import { g } from "../geruest/geladen.mjs";',
      'import { b } from "../kit/bleibt.mjs";',
      'const pfad = "geruest/genannt.md";',
      "console.log(g, b, pfad);",
      "",
    ].join("\n"));

    const ohne = verflechtungErheben({ repoRoot: dir }).get("test/a.test.mjs");
    assert.deepEqual(ohne, { laedt: ["geruest/geladen.mjs", "kit/bleibt.mjs"], nennt: ["geruest/genannt.md"] });

    const mit = verflechtungErheben({ repoRoot: dir, nurGeruest: ["geruest/**"] }).get("test/a.test.mjs");
    assert.deepEqual(mit, { laedt: ["kit/bleibt.mjs"], nennt: [] });
  });
});

test("[1714] testdateien beschraenkt die Messung auf die genannten Tests", () => {
  mitRepo({}, (dir) => {
    datei(dir, "kit/q.mjs", "export const q = 1;\n");
    datei(dir, "test/eins.test.mjs", 'import "../kit/q.mjs";\n');
    datei(dir, "test/zwei.test.mjs", 'import "../kit/q.mjs";\n');

    const messung = verflechtungErheben({ repoRoot: dir, testdateien: ["test/zwei.test.mjs"] });
    assert.deepEqual([...messung.keys()], ["test/zwei.test.mjs"]);
    assert.deepEqual(messung.get("test/zwei.test.mjs").laedt, ["kit/q.mjs"]);
  });
});

test("[1714] eine Datei ohne Lesart wird nicht nach Importen gelesen, ihre Nennungen zaehlen", () => {
  // Die Lesarten stehen als Tabelle (P13); die erste ist JavaScript. Eine Durchgangsstation
  // in einer anderen Endung (hier JSON unter test/) traegt keine Importe, aber Pfade.
  mitRepo({}, (dir) => {
    datei(dir, "kit/q.mjs", "export const q = 1;\n");
    datei(dir, "test/fixtures/daten.json", '{ "a": "import x from \\"../../kit/q.mjs\\"", "b": "kit/q.mjs" }\n');
    datei(dir, "test/j.test.mjs", 'import daten from "./fixtures/daten.json" with { type: "json" };\nconsole.log(daten);\n');

    assert.deepEqual(verflechtungErheben({ repoRoot: dir }).get("test/j.test.mjs"), { laedt: [], nennt: ["kit/q.mjs"] });
  });
});

test("[1714] die Texttabelle hat in beiden Sprachen dieselben Schluessel", () => {
  assert.deepEqual(Object.keys(TEXTE.en).sort(), Object.keys(TEXTE.de).sort());
});
