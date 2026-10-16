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
// `kit/checks/verflechtung.mjs` (ihre Kopplung: „laedt" und „nennt" zusammen).
// Eine zweite Fassung hier beantwortete die Fragen
// „trifft dieses Muster diese Datei?" und „laedt dieser Test jene Quelle?" ein
// zweites Mal — und ab der ersten Abweichung bescheinigte der Test eine
// Abdeckung, die das ausfuehrende Kommando nicht sieht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { globZuRegex, bereicheVorbereiten, anteilJeBereich, aufrufen } from "../kit/checks.mjs";
import { verflechtungErheben, kopplungVon } from "../kit/checks/verflechtung.mjs";
import { normalisiereConfig } from "../kit/board/config-namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Ueber normalisiereConfig gelesen: vor und nach der Umstellung auf englische Schluessel
// dieselben Namen (Issue #1728).
const { config } = normalisiereConfig(JSON.parse(
  readFileSync(join(repoRoot, ".claude", "workflow.config.json"), "utf-8"),
));

/**
 * Die versionierten Dateien zu einer Pfadangabe — `:(glob)` davor, damit `*`
 * wie in den Mustern der Config an der Segmentgrenze haltmacht und nicht wie in
 * gits Default-Pathspec darueber hinweglaeuft.
 *
 * Eine leere Antwort ist ein Fehler und kein leerer Fall: Sie entstuende, wenn
 * ein Verzeichnis umbenannt wird — und der Test bescheinigte dann die
 * Abdeckung einer Menge, die er gar nicht mehr sieht.
 *
 * Neu angelegte, nicht ignorierte Dateien zaehlen mit: Der Abschlusslauf eines Pakets
 * steht vor dem Commit, und eine neue Testdatei ohne Aufruf bliebe sonst bis zum
 * naechsten Paket unsichtbar (Issue #1741).
 */
function versionierte(...pfadangaben) {
  const res = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pfadangaben], {
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

test("genau die Testaufrufe ohne vorab tragen gleichzeitig: true", () => {
  // Issue #1074 (Plan #1066, A1, E3): Die Testgruppen laufen nebeneinander, alles andere
  // danach allein — Lint, Drift-Pruefung und der frische Checkout messen den Stand, den die
  // Tests hinterlassen, und teilen sich keine Last mit ihnen. Dieselbe Erkennung wie
  // `testEintraege`: am Kommando, nicht an der Position. Ein schneller Testaufruf mit
  // `vorab` laeuft davor allein (Issue #1519) und traegt das Kennzeichen darum nicht.
  const eintraege = (config.buildChecks ?? [])
    .map((eintrag) => (typeof eintrag === "string" ? { cmd: eintrag } : eintrag));
  const falsch = eintraege
    .filter((eintrag) => (eintrag.gleichzeitig === true) !== (eintrag.cmd.startsWith("node --test") && eintrag.vorab !== true))
    .map((eintrag) => `${eintrag.cmd}: gleichzeitig=${eintrag.gleichzeitig === true}`);
  assert.deepEqual(falsch, [], "Eintraege, deren Kennzeichen gleichzeitig nicht zu ihrem Kommando passt");
});

test("genau sync-blobs --check, eslint und checks-leichtigkeit tragen vorab: true und stehen vorn", () => {
  // Issue #1519: Ihr Rot ist nach Sekunden bekannt statt erst nach den gleichzeitigen.
  const eintraege = (config.buildChecks ?? [])
    .map((eintrag) => (typeof eintrag === "string" ? { cmd: eintrag } : eintrag));
  // Am Kennwort erkannt, nicht am vollen Kommando: Ein Programmpfad im Testtext liest die
  // Leichtigkeitspruefung als Prozessstart.
  const kennwoerter = ["sync-blobs.mjs --check", "npx eslint ", "checks-leichtigkeit.test.mjs"];
  const kennwort = (eintrag) => kennwoerter.find((wort) => eintrag.cmd.includes(wort)) ?? eintrag.cmd;
  assert.deepEqual(eintraege.filter((eintrag) => eintrag.vorab === true).map(kennwort), kennwoerter);
  assert.deepEqual(eintraege.slice(0, kennwoerter.length).map(kennwort), kennwoerter);
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

/**
 * Die Freistellungen der Config als Regexe — dieselbe Glob-Aufloesung wie bei den
 * Bereichen, aus `kit/checks.mjs` geholt und nicht nachgebaut.
 */
const freistellungen = (config.ohnePruefung ?? []).map((eintrag) => ({
  muster: eintrag.muster,
  regex: globZuRegex(eintrag.muster),
}));

/**
 * Die Geruest-Liste der Config (Issue #943, Plan #930): Pfade, die Testdateien nur
 * anlegen, ohne an ihnen etwas zu pruefen. Ihre Erwaehnung belegt keine Kopplung.
 *
 * Die Invariante weiter unten liest dieselbe Liste wie `areas suggest` und
 * `areas compare` — sonst pruefte sie eine andere Verflechtung als die, nach der
 * ausgewaehlt wird, und diese Zweiteilung ist genau das, was die Liste verhindert.
 */
const geruestMuster = (config.nurGeruest ?? []).map((eintrag) => eintrag.muster);
const geruestRegexe = geruestMuster.map((muster) => globZuRegex(muster));

test("jede versionierte Quelldatei liegt in mindestens einem Teil", () => {
  const bereiche = bereicheVorbereiten(config.checkAreas ?? {});
  assert.ok(bereiche.length > 0, ".claude/workflow.config.json traegt keine checkAreas");

  // Seit Issue #935 (Plan #930, E8/E9/E10) stehen `test/helpers/**` und die
  // Markdown-Dateien der Wurzel mit in der Menge: Sie waren bisher der groesste
  // Posten unter den Dateien, die bei jeder Aenderung den vollen Umfang zogen —
  // und eine Menge, die sie auslaesst, bescheinigt eine Deckung, die es nicht gibt.
  // Seit Issue #1008 (Plan #1001, E9) gehoert `test/fixtures/**` dazu: Die Dateien dort
  // waren die letzten, die im Inventar „ohne jede Zuordnung" standen.
  const dateien = versionierte(
    "kit", "tools", "skills", "docs", "templates", ".githooks", "install.mjs", "RELEASING.md",
    ":(glob)test/helpers/**", ":(glob)test/fixtures/**", ":(glob)*.md",
  );

  // Eine Datei ist zugeordnet, wenn sie ein `checkAreas`-Muster ODER ein
  // `ohnePruefung`-Muster trifft. Die Freistellung ist die dritte Antwort auf
  // dieselbe Frage (Issue #934) — sie hier nicht zu zaehlen hiesse, die
  // begruendete Antwort „nichts zu pruefen" als Luecke auszuweisen.
  const zugeordnet = (pfad) => bereiche.some((b) => b.regexe.some((r) => r.test(pfad)))
    || freistellungen.some((f) => f.regex.test(pfad));

  assert.deepEqual(
    dateien.filter((pfad) => !zugeordnet(pfad)),
    [],
    "Quelldateien ohne Teil — jede Aenderung an ihnen loest den vollen Umfang aus",
  );
});

test("jede Datei unter kit/night/ und kit/board/ liegt in genau einem Teilbereich", () => {
  // Die Teilzuordnung (Issue #1236, Plan #1199, E5): Ein Teil ist ein Bereich. Liegt eine
  // Datei eines Teils in zwei Bereichen, loest ihre Aenderung die Pruefungen eines fremden
  // Teils mit aus; liegt sie in keinem, zieht sie den vollen Umfang. Beides macht
  // Kriterium 4 unwahr, ohne dass ein anderer Test es meldet.
  const bereiche = bereicheVorbereiten(config.checkAreas ?? {});
  const falsch = versionierte("kit/night", "kit/board")
    .map((pfad) => ({ pfad, namen: bereiche.filter((b) => b.regexe.some((r) => r.test(pfad))).map((b) => b.name) }))
    .filter(({ namen }) => namen.length !== 1)
    .map(({ pfad, namen }) => `${pfad}: ${namen.length === 0 ? "kein Bereich" : namen.join(", ")}`);
  assert.deepEqual(falsch, [], "Dateien eines Teils, die nicht in genau einem Bereich liegen");
});

test("keine Datei steht zugleich in ohnePruefung und in einem Teil", () => {
  // `checkAreas` hat Vorrang (Issue #934): Trifft eine Datei beide Musterarten,
  // gilt sie als beruehrt und die Freistellung bleibt wirkungslos. Ein solches
  // Paar ist deshalb kein Fehler im Lauf, sondern eine Luege in der Config —
  // der Grund verspricht „hier ist nichts zu pruefen", und geprueft wird doch.
  assert.ok(freistellungen.length > 0, ".claude/workflow.config.json traegt kein ohnePruefung");
  const bereiche = bereicheVorbereiten(config.checkAreas ?? {});

  const doppelt = [];
  for (const pfad of versionierte(".")) {
    const frei = freistellungen.find((f) => f.regex.test(pfad));
    if (!frei) continue;
    const teil = bereiche.find((b) => b.regexe.some((r) => r.test(pfad)));
    if (teil) doppelt.push(`${pfad}: ohnePruefung '${frei.muster}' und Teil '${teil.name}'`);
  }

  assert.deepEqual(
    doppelt.sort(),
    [],
    "Dateien in beiden Musterlisten — die Freistellung bliebe dort wirkungslos",
  );
});

// --- Die Invariante aus E4 (Issue #933, Plan #930), seit Issue #1722 ueber areas compare ---
//
// Sie sagt, was die gefallene Zahl der Aufrufe nie sagen konnte:
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
// Seit Issue #1722 (Plan #1713, Kriterium 5) rechnet sie nicht mehr selbst, sondern
// liest die Luecken aus `areas compare --json` — demselben Werkzeug, das ein anderes
// Projekt mitbekommt. Die bisherige Rechnung bleibt als Gegenprobe stehen: Sie muss am
// Kit-Repo und mit einem entfernten Bereich dieselben Luecken finden.
//
// Nur fuer `kit/` und `tools/` — ausgeweitet mit Issue #936 und mit Issue #937
// wieder eingeschraenkt. Die Ausweitung war richtig gedacht und messbar schaedlich:
// Sie erzwang breitere `areas`, weil die Erhebung JEDE Erwaehnung eines Quellpfads
// zaehlt und die Nacht-Tests in ihren Wegwerf-Repos `README.md` und
// `templates/CLAUDE-workflow.md` anlegen. Das Nacht-Kommando trug seither
// `skills-doku`, und eine Aenderung an einer Skill-Datei kostete 83 s statt 3 s
// (Referenzmessung R4 an Issue #937).
//
// `areas compare` selbst bleibt ohne Pfadbeschraenkung (E14). Damit es am Kit-Repo
// ruhig bleibt, stehen `.gitignore`, `README.md` und `.claude/workflow.config.json`
// seit Issue #1722 in `nurGeruest` (E9): Die Wegwerf-Repos der Tests legen sie an, und
// keine Testdatei laedt sie. Dass einzelne Tests sie wirklich pruefen (Messung an Issue
// #943), sieht die Erhebung dadurch nicht mehr — das ist der Preis, den E9 bewusst
// zahlt; breitere Bereiche kosteten 80 Sekunden je Doku-Aenderung.

/** Liegt eine Quelle im Schnitt der Invariante? */
const geschnitten = (quelle) => quelle.startsWith("kit/") || quelle.startsWith("tools/");

/** Eine Luecke in der Form, in der beide Rechnungen sie nennen. */
const lueckeText = (bereich, quelle, testdatei) => `${bereich}: ${quelle} braucht ${testdatei}`;

/**
 * Die bisherige Rechnung (Issue #933 bis #1722), nur noch als Gegenprobe: je gemessene
 * Kopplung unter `kit/` und `tools/` jeder Bereich der Quelle, den kein Testaufruf fuehrt,
 * dessen Globs die Testdatei erfassen.
 */
function bisherigeLuecken(cfg, wurzel) {
  const nurGeruest = (cfg.nurGeruest ?? []).map((eintrag) => eintrag.muster);
  const tabelle = kopplungVon(verflechtungErheben({ repoRoot: wurzel, nurGeruest }));
  assert.ok(tabelle.size > 0, "die Verflechtungserhebung lieferte keine Zeile");

  const bereiche = bereicheVorbereiten(cfg.checkAreas ?? {});
  assert.ok(bereiche.length > 0, "die Config traegt keine checkAreas");

  const kommandos = (cfg.buildChecks ?? [])
    .filter((eintrag) => typeof eintrag === "object" && eintrag.cmd.startsWith("node --test"))
    .map((eintrag) => ({ areas: new Set(eintrag.areas ?? []), regexe: globeVon(eintrag) }));

  // Die drei Schritte stehen als eigene Funktionen da, nicht als drei ineinander
  // geschachtelte Schleifen: Der Linter zaehlt die Verschachtelung, und die Namen
  // sagen ohnehin besser, was der Schritt bedeutet.
  const bereicheVon = (quelle) => bereiche.filter((b) => b.regexe.some((r) => r.test(quelle)));
  const gedeckt = (bereich, testdatei) => kommandos.some(
    (k) => k.areas.has(bereich.name) && k.regexe.some((r) => r.test(testdatei)),
  );

  const luecken = new Set();
  for (const [testdatei, quellen] of tabelle) {
    for (const quelle of quellen.filter(geschnitten)) {
      for (const bereich of bereicheVon(quelle)) {
        if (!gedeckt(bereich, testdatei)) luecken.add(lueckeText(bereich.name, quelle, testdatei));
      }
    }
  }
  return [...luecken].sort();
}

/** Der Abgleich `areas compare --json` ueber `kit/checks.mjs`, im selben Prozess. */
async function abgleich(wurzel) {
  const res = await aufrufen(["areas", "compare", "--json"], { cwd: wurzel });
  assert.equal(res.status, 0, `checks.mjs areas compare schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/**
 * Die Luecken des Abgleichs unter `kit/` und `tools/`. `areas compare` nennt eine Luecke
 * je Kommando des Tests; die Invariante fragt nur, ob es sie gibt.
 */
function abgleichLuecken(ergebnis) {
  return [...new Set(ergebnis.luecken
    .filter((l) => geschnitten(l.datei))
    .map((l) => lueckeText(l.bereich, l.datei, l.test)))].sort();
}

test("jede gemessene Kopplung unter kit/ und tools/ hat ein Kommando, das sie ausloest (areas compare)", async () => {
  const ergebnis = await abgleich(repoRoot);
  assert.deepEqual(ergebnis.nichtBeurteilbar, [], "areas compare kann Kommandos des Kit-Repos nicht beurteilen");
  assert.deepEqual(
    abgleichLuecken(ergebnis),
    [],
    "Bereiche, deren Aenderung eine Testdatei nicht ausloest, die die Quelle laedt — still gruen",
  );
});

test("Gegenprobe: areas compare findet am Kit-Repo dieselben Luecken unter kit/ und tools/ wie die bisherige Rechnung", async () => {
  assert.deepEqual(abgleichLuecken(await abgleich(repoRoot)), bisherigeLuecken(config, repoRoot));
});

test("die Wurzeldateien der Wegwerf-Repos aus E9 ergeben in areas compare keine Luecke", async () => {
  // E9 (Plan #1713): `areas compare` laeuft ohne Pfadbeschraenkung. Ohne die drei Eintraege
  // in `nurGeruest` meldete es am Kit-Repo jede Testdatei, die ein Wegwerf-Repo anlegt.
  const wurzeldateien = new Set([".gitignore", "README.md", ".claude/workflow.config.json"]);
  const gemeldet = (await abgleich(repoRoot)).luecken
    .filter((l) => wurzeldateien.has(l.datei))
    .map((l) => `${l.test}: ${l.datei}`);
  assert.deepEqual([...new Set(gemeldet)].sort(), []);
});

/**
 * Eine Kopie des Arbeitsstands in ein frisches Repo: die versionierten und die nicht
 * ignorierten neuen Dateien, wie `areas compare` sie misst. Die Kopie braucht keinen
 * Commit — die Messung liest auch nicht versionierte Dateien.
 */
function arbeitsstandKopieren(ziel) {
  const res = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  assert.equal(res.status, 0, `git ls-files schlug fehl: ${(res.stderr || "").trim()}`);
  for (const pfad of new Set(res.stdout.split("\0").filter((p) => p.length > 0))) {
    if (!existsSync(join(repoRoot, pfad))) continue;
    mkdirSync(dirname(join(ziel, pfad)), { recursive: true });
    copyFileSync(join(repoRoot, pfad), join(ziel, pfad));
  }
  const init = spawnSync("git", ["init", "-q"], { cwd: ziel, encoding: "utf-8" });
  assert.equal(init.status, 0, `git init schlug fehl: ${(init.stderr || "").trim()}`);
}

test("Gegenprobe: mit einem entfernten Bereich finden areas compare und die bisherige Rechnung dieselben Luecken", async () => {
  // Ohne sie hinge die leere Liste oben an zwei Rechnungen, die beide nichts finden koennen.
  // `board-einstieg` faellt aus dem einzigen Kommando, das die Ablauf-Tests des Boards faehrt:
  // Jede ihrer Kopplungen an den Board-Einstieg wird damit eine Luecke.
  const ziel = mkdtempSync(join(tmpdir(), "config-teile-"));
  try {
    arbeitsstandKopieren(ziel);
    const ohneBereich = {
      ...config,
      buildChecks: (config.buildChecks ?? []).map((eintrag) => (
        typeof eintrag === "object" && eintrag.cmd.includes("test/ablauf-board-*.test.mjs")
          ? { ...eintrag, areas: eintrag.areas.filter((name) => name !== "board-einstieg") }
          : eintrag)),
    };
    writeFileSync(join(ziel, ".claude", "workflow.config.json"), `${JSON.stringify(ohneBereich, null, 2)}\n`);

    const bisher = bisherigeLuecken(ohneBereich, ziel);
    assert.ok(bisher.some((l) => l.startsWith("board-einstieg: ")), `keine Luecke im Board-Einstieg: ${bisher.join(", ")}`);
    assert.deepEqual(abgleichLuecken(await abgleich(ziel)), bisher);
  } finally {
    rmSync(ziel, { recursive: true, force: true });
  }
});

test("die Erhebung der Invariante kennt die Geruest-Liste der Config", () => {
  assert.ok(geruestMuster.length > 0, ".claude/workflow.config.json traegt kein nurGeruest");

  const mitListe = kopplungVon(verflechtungErheben({ repoRoot, nurGeruest: geruestMuster }));
  const uebrig = [];
  for (const [testdatei, quellen] of mitListe) {
    for (const quelle of quellen.filter((q) => geruestRegexe.some((r) => r.test(q)))) {
      uebrig.push(`${testdatei}: ${quelle}`);
    }
  }
  assert.deepEqual(uebrig.sort(), [], "Geruest zaehlt weiter als Kopplung — die Liste greift nicht");

  // Und die Gegenrichtung: Ohne die Liste steht mindestens ein Eintrag noch in der
  // Tabelle. Ein Muster, das nie etwas trifft, waere kein Schutz, sondern Zierat — und
  // niemand merkte, wenn es beim naechsten Umbau seine Wirkung verloere.
  const roh = kopplungVon(verflechtungErheben({ repoRoot }));
  assert.ok(
    [...roh.values()].some((quellen) => quellen.some((q) => geruestRegexe.some((r) => r.test(q)))),
    `kein Muster aus nurGeruest kommt in der rohen Erhebung vor: ${geruestMuster.join(", ")}`,
  );
});

test("jeder Eintrag von nurGeruest traegt ein Muster und einen Grund", () => {
  // Dieselbe Pflicht wie bei `ohnePruefung` (Issue #934): Eine Ausnahme von der Regel
  // „jede Erwaehnung zaehlt" ist nur ertraeglich, wenn sie sich begruendet — und der
  // Grund steht dort, wo der Eintrag steht, nicht in einer Commit-Botschaft.
  for (const eintrag of config.nurGeruest ?? []) {
    assert.ok(eintrag.muster?.length > 0, `Eintrag ohne Muster: ${JSON.stringify(eintrag)}`);
    assert.ok(eintrag.grund?.length > 0, `${eintrag.muster} nennt keinen Grund`);
  }
});

// --- Gekoppelte Bereiche (Issue #1008, Plan #1001, E8, E14) -------------------
//
// `gekoppelteBereiche` erlaubt einem Bereich, hervorgehoben zu bleiben — in allen
// oder allen bis auf einem bereichsgebundenen Kommando —, wenn eine gemessene
// Kopplung ihn dorthin zwingt. Damit das Feld kein stummer Ausschalter wird, gilt
// es in beiden Richtungen: Ein hervorgehobener Bereich ohne Eintrag ist ein Zuschnitt,
// der nichts mehr herausschneidet, und ein Eintrag ohne Kopplung ist eine Ausrede.
//
// Die Hervorhebung kommt aus `anteilJeBereich` in kit/checks.mjs, nicht aus einer zweiten Rechnung
// hier: Dieselbe Regel zweimal beschrieben wiche ab der ersten Aenderung voneinander ab.

/**
 * Der Anteil je Bereich, den `checks.mjs areas` meldet, fuer die Config dieses Repos —
 * im selben Prozess ueber `anteilJeBereich`, dieselbe Funktion, die das Kommando ruft
 * (Issue #1235, Plan #1199, E6).
 */
function bereicheAuswertung() {
  return anteilJeBereich(config);
}

/** Hervorgehobene Bereiche, die `gekoppelteBereiche` der Config nicht nennt. */
function hervorgehobenOhneEintrag(auswertung, cfg) {
  const eingetragen = new Set((cfg.gekoppelteBereiche ?? []).map((e) => e.bereich));
  return auswertung.bereiche
    .filter((b) => b.hervorgehoben && !eingetragen.has(b.name))
    .map((b) => b.name)
    .sort();
}

/**
 * Je Eintrag in `gekoppelteBereiche` die Testaufrufe, die ihn in `areas` fuehren, ohne
 * dass eine ihrer Testdateien nach der Verflechtung eine Quelle dieses Bereichs laedt.
 */
function eintraegeOhneKopplung(cfg, tabelle) {
  const bereiche = bereicheVorbereiten(cfg.checkAreas ?? {});
  const aufrufe = (cfg.buildChecks ?? [])
    .filter((eintrag) => typeof eintrag === "object" && eintrag.cmd.startsWith("node --test"));
  const testdateien = [...tabelle.keys()];

  const ohne = [];
  for (const { bereich } of cfg.gekoppelteBereiche ?? []) {
    const regexe = bereiche.find((b) => b.name === bereich)?.regexe ?? [];
    const laedt = (testdatei) => tabelle.get(testdatei).some((q) => regexe.some((r) => r.test(q)));
    for (const aufruf of aufrufe.filter((a) => (a.areas ?? []).includes(bereich))) {
      const eigene = testdateien.filter((t) => globeVon(aufruf).some((r) => r.test(t)));
      if (!eigene.some(laedt)) ohne.push(`${bereich}: ${aufruf.cmd}`);
    }
  }
  return ohne.sort();
}

// Scharf seit Issue #1236: Nach der Zerlegung (Plan #1199) ist kein Bereich mehr
// hervorgehoben, und der Eintrag fuer den Board-Einstieg ist entfallen.
test("jeder hervorgehobene Bereich steht in gekoppelteBereiche", () => {
  const auswertung = bereicheAuswertung();
  assert.ok(auswertung.kommandos >= 3, "weniger als drei bereichsgebundene Kommandos — keine Hervorhebung messbar");
  assert.deepEqual(
    hervorgehobenOhneEintrag(auswertung, config),
    [],
    "hervorgehobene Bereiche ohne gemessene Kopplung als Grund — sie schneiden nichts mehr heraus",
  );

  // Gegenprobe: Ein Bereich, den jedes bereichsgebundene Kommando fuehrt, wird ohne Eintrag
  // gemeldet und mit Eintrag nicht. Ohne sie hinge die leere Liste oben an einer Pruefung,
  // die gar nichts finden kann.
  const ueberall = {
    ...config,
    checkAreas: { ...config.checkAreas, gegenprobe: ["gibt-es-nicht/**"] },
    buildChecks: (config.buildChecks ?? []).map((eintrag) => (
      typeof eintrag === "object" && eintrag.areas ? { ...eintrag, areas: [...eintrag.areas, "gegenprobe"] } : eintrag)),
  };
  const breit = anteilJeBereich(ueberall);
  assert.deepEqual(hervorgehobenOhneEintrag(breit, ueberall), ["gegenprobe"]);
  const mitEintrag = { ...ueberall, gekoppelteBereiche: [{ bereich: "gegenprobe", grund: "Gegenprobe" }] };
  assert.deepEqual(hervorgehobenOhneEintrag(breit, mitEintrag), []);
});

test("jeder Eintrag in gekoppelteBereiche ist in jeder Gruppe, die ihn nennt, gemessen gekoppelt", () => {
  // Die Liste darf leer sein (Issue #1236): Ohne hervorgehobenen Bereich braucht es keinen Eintrag.
  for (const eintrag of config.gekoppelteBereiche ?? []) {
    assert.ok(eintrag.grund?.length > 0, `${eintrag.bereich} nennt keinen Grund`);
  }

  const tabelle = kopplungVon(verflechtungErheben({ repoRoot, nurGeruest: geruestMuster }));
  assert.deepEqual(
    eintraegeOhneKopplung(config, tabelle),
    [],
    "Eintraege in gekoppelteBereiche, die eine Gruppe ohne gemessene Kopplung fuehrt",
  );

  // Gegenprobe: Ein Bereich ohne jede Kopplung, zusaetzlich eingetragen und von einer
  // Gruppe gefuehrt, wird gemeldet. Ohne sie bewiese das leere Ergebnis oben nur, dass
  // die Pruefung nichts findet — nicht, dass es nichts zu finden gibt.
  const [erster, ...rest] = testEintraege;
  const mitUngekoppeltem = {
    ...config,
    checkAreas: { ...config.checkAreas, gegenprobe: ["gibt-es-nicht/**"] },
    buildChecks: [{ ...erster, areas: [...erster.areas, "gegenprobe"] }, ...rest],
    gekoppelteBereiche: [...(config.gekoppelteBereiche ?? []), { bereich: "gegenprobe", grund: "Gegenprobe" }],
  };
  assert.deepEqual(eintraegeOhneKopplung(mitUngekoppeltem, tabelle), [`gegenprobe: ${erster.cmd}`]);
});

// --- Kriterien 4 und 7 an der echten Config (Issue #1236, Plan #1199, E3, E5) ----------
//
// Die Auswahl selbst, nicht ein Nachbau: `checks.mjs plan --finish` im selben Prozess
// (E6) gegen die versionierte Config und den Importgraphen dieses Repos. Nur git wird
// ersetzt, und nur in der Frage, was sich geaendert hat — so misst die Probe eine Aenderung
// an genau einer Datei, gleich was gerade im Arbeitsbaum liegt.

/**
 * Die Quelldatei eines Teils, wie `checkAreas` sie dem Bereich zuordnet — genau eine
 * unter `kit/`. Die Probe nennt den Teil ueber seinen Bereich und nicht ueber einen
 * Pfad: So haengt sie an der Teilzuordnung der Config, die sie belegen soll. Die Texttabelle
 * des Teils unter `kit/texte/` zaehlt nicht mit: Sie steht neben ihrem Modul im Bereich
 * (Issue #1526), ist aber keine eigene Quelle des Teils.
 */
function teilDatei(bereich) {
  const quellen = (config.checkAreas?.[bereich] ?? [])
    .filter((muster) => muster.startsWith("kit/") && !muster.startsWith("kit/texte/"));
  assert.equal(quellen.length, 1, `Bereich ${bereich} ordnet nicht genau eine Quelldatei unter kit/ zu: ${quellen.join(", ")}`);
  return quellen[0];
}

/** Die Auswahl, als haette sich seit HEAD nur `pfad` geaendert. */
function auswahlFuer(pfad) {
  const git = (args, optionen) => {
    if (args[0] === "diff" && args[1] === "--name-status") return { status: 0, stdout: `M\0${pfad}\0`, stderr: "" };
    if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
    return spawnSync("git", args, optionen);
  };
  const res = aufrufen(["plan", "--finish"], { cwd: repoRoot, git });
  assert.equal(res.status, 0, `checks.mjs plan schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Laeuft ein Eintrag der Config bei den beruehrten Bereichen auf der Paketstufe? */
function erwartetLaufend(eintrag, bereiche) {
  if (typeof eintrag === "string") return true;
  if ((eintrag.stufe ?? "paket") !== "paket" || eintrag.nichtBeimAbschluss) return false;
  if (eintrag.always || !eintrag.areas) return true;
  return eintrag.areas.some((bereich) => bereiche.has(bereich));
}

test("Kriterien 4/7: eine Aenderung nur am Board-Teil testhinweise waehlt ihren Teil, die abhaengigen Bereiche und die Pflicht", () => {
  const teil = teilDatei("board-testhinweise");
  const auswahl = auswahlFuer(teil);
  assert.equal(auswahl.vollerUmfang, false, "die Datei hat einen Teil — kein voller Umfang");
  assert.deepEqual(auswahl.geaendert, [teil]);

  // Beruehrt sind der eigene Bereich und genau die, die nach dem Importgraphen davon abhaengen.
  const abhaengig = auswahl.abhaengig ?? [];
  assert.ok(abhaengig.some((a) => a.bereich === "board-einstieg"), "der Board-Einstieg importiert den Teil — board-einstieg fehlt");
  for (const a of abhaengig) assert.ok(a.ueber?.length > 0, `${a.bereich} nennt keinen Importweg`);
  const bereiche = new Set(["board-testhinweise", ...abhaengig.map((a) => a.bereich)]);
  assert.deepEqual(auswahl.bereiche, [...bereiche].sort());

  const erwartet = (config.buildChecks ?? [])
    .filter((eintrag) => erwartetLaufend(eintrag, bereiche))
    .map((eintrag) => (typeof eintrag === "string" ? eintrag : eintrag.cmd));
  assert.deepEqual(auswahl.laufen.map((e) => e.cmd).sort(), erwartet.sort());

  // Die Teile, von denen testhinweise nur abhaengt, laufen nicht mit.
  const ausgelassen = auswahl.ausgelassen.map((e) => e.cmd);
  for (const fremd of ["board-grundlagen", "board-adapter", "nacht-kette", "nacht-tag"]) {
    assert.ok(ausgelassen.some((cmd) => cmd.includes(`test/${fremd.replace("nacht-", "night-")}-*.test.mjs`)),
      `die Gruppe des Teils ${fremd} laeuft mit, obwohl er nicht beruehrt ist`);
  }
  for (const eintrag of [...auswahl.laufen, ...auswahl.ausgelassen]) {
    assert.ok(eintrag.grund?.length > 0, `${eintrag.cmd} traegt keinen Grund`);
  }
});

test("Kriterium 7, Gegenprobe: eine neue Testdatei des Board-Teils testhinweise fehlt in der Auswahl einer Aenderung nur am Nacht-Teil tag", () => {
  const neu = "test/board-testhinweise-x.test.mjs";
  const erfasst = (eintrag) => [...eintrag.cmd.matchAll(/"([^"]+)"/g)].some((t) => globZuRegex(t[1]).test(neu));

  const auswahl = auswahlFuer(teilDatei("nacht-tag"));
  assert.equal(auswahl.vollerUmfang, false, "die Datei hat einen Teil — kein voller Umfang");
  assert.ok(auswahl.bereiche.includes("nacht-tag"), `nacht-tag fehlt: ${auswahl.bereiche.join(", ")}`);
  assert.deepEqual(auswahl.laufen.filter(erfasst).map((e) => e.cmd), [],
    "ein laufendes Kommando erfasst die neue Testdatei des Teils testhinweise");

  // Die Datei waere sonst gar nicht erfasst, und die Probe bewiese nichts.
  assert.ok(auswahl.ausgelassen.some(erfasst), "kein Kommando der Config erfasst die neue Testdatei");
});
