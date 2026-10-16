/**
 * checks/bereiche.mjs — leitet Pruefbereiche aus der Messung ab und gleicht eine eingerichtete
 * Zuordnung ab (Issue #1717, Plan #1713 A6 bis A10, E5, E6).
 *
 * Beide Rechnungen sind reine Funktionen ueber Config und Messung. Die Messung bringt der
 * Aufrufer mit: die Dateien des Arbeitsstands, je Test die geladenen und genannten Dateien aus
 * `verflechtung.mjs` und je Eintrag von `buildChecks` das Urteil aus `testauswahl.mjs`, in
 * derselben Reihenfolge. Keine Funktion hier liest oder schreibt eine Datei: Der Vorschlag
 * aendert die Einstellungen nie von selbst (Kriterium 2), der Abgleich meldet nur (Kriterium 12).
 *
 * Kopplung ist „laedt oder nennt" (A2), und die Testdatei selbst zaehlt als geladen (A10). Wer
 * nur „laedt" zaehlte, verloere im Kit die Leser, die eine Nicht-Code-Datei ueber ihren Pfad
 * lesen; die Geruest-Liste nimmt reine Erwaehnungen schon in der Messung heraus.
 *
 * Kommandos, die nicht beurteilbar sind oder nicht aus der Auswertung abgeleitet werden, bleiben
 * unveraendert und ergeben weder einen Vorschlag noch eine Luecke (A6). Ein Test mit Vermerk
 * `unvollstaendig` macht jedes Kommando, das ihn faehrt, nicht beurteilbar: Eine Messung mit
 * Loch ist keine Entwarnung (Kriterium 8).
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { posix as pfad } from "node:path";

import { bereicheVorbereiten, vergleicheText } from "../checks.mjs";
import { URTEIL } from "./testauswahl.mjs";
import { TEXTE } from "../texte/checks-bereiche.mjs";

// Die Texttabelle liegt im Teil texte/ (Issue #1524); exportiert bleibt sie unter ihrem Namen.
export { TEXTE };

// Der Texthelfer aus dem Board-Teil namen (Plan #1420 E13), abgefangen: Fehlt
// board/namen.mjs neben dem Kit, bleiben die Texte deutsch.
const namen = await import(new URL("../board/namen.mjs", import.meta.url).href).catch(() => null);

/** Der Text zu `schluessel` aus `TEXTE` in der Sprache des Prozesses; ohne Register deutsch. */
function t(schluessel, werte = {}) {
  if (namen) return namen.text(TEXTE, schluessel, werte);
  return TEXTE.de[schluessel].replaceAll(/\{([A-Za-z_]\w*)\}/g, (_, name) => String(werte[name]));
}

/** Wie viele Dateien der Text unter „von keinem Test geladen" auffuehrt; JSON traegt alle. */
const OHNE_TEST_IM_TEXT = 20;

const sortiert = (werte) => [...werte].sort(vergleicheText);
const schluesselVon = (gruppen) => sortiert(gruppen).join("\n");

// --- Messung aufbereiten ---

/**
 * Die Messung in der Form, mit der beide Rechnungen arbeiten: Tabelle als Map, je Test die
 * Kopplung samt Testdatei, je Kommando das Urteil nach dem Vermerk `unvollstaendig`.
 */
function aufbereiten(config, messung) {
  const roh = messung.tabelle instanceof Map ? messung.tabelle : new Map(Object.entries(messung.tabelle ?? {}));
  const kopplung = new Map();
  for (const [testdatei, zeile] of roh) {
    kopplung.set(testdatei, new Set([testdatei, ...(zeile.laedt ?? []), ...(zeile.nennt ?? [])]));
  }
  const kommandos = (config.buildChecks ?? []).map((eintrag, i) => kommandoVon(eintrag, messung.kommandos?.[i], roh));
  return { roh, kopplung, kommandos, dateien: sortiert(messung.dateien ?? []) };
}

/** Ein Eintrag von `buildChecks` mit Urteil, Grund und Tests; ein Loch der Messung macht ihn nicht beurteilbar. */
function kommandoVon(eintrag, auswahl, roh) {
  const cmd = typeof eintrag === "string" ? eintrag : eintrag.cmd;
  const areas = typeof eintrag === "string" ? [] : [...(eintrag.areas ?? [])];
  const basis = { cmd, areas, urteil: auswahl?.urteil ?? URTEIL.nichtAbgeleitet, grund: auswahl?.grund ?? null, tests: [] };
  if (basis.urteil !== URTEIL.beurteilbar) return basis;
  const gruende = [];
  for (const testdatei of auswahl.tests) {
    const zeile = roh.get(testdatei);
    if (!zeile) gruende.push(t("nichtGemessen", { test: testdatei }));
    else if (zeile.unvollstaendig) gruende.push(t("unvollstaendig", { grund: zeile.unvollstaendig }));
  }
  if (gruende.length > 0) return { ...basis, urteil: URTEIL.nichtBeurteilbar, grund: gruende.join("; ") };
  return { ...basis, tests: sortiert(auswahl.tests) };
}

const beurteilbare = (kommandos) => kommandos.filter((k) => k.urteil === URTEIL.beurteilbar);

/** Test → die beurteilbaren Kommandos, die ihn fahren. */
function kommandosJeTest(kommandos) {
  const jeTest = new Map();
  for (const kommando of beurteilbare(kommandos)) {
    for (const testdatei of kommando.tests) {
      if (!jeTest.has(testdatei)) jeTest.set(testdatei, []);
      jeTest.get(testdatei).push(kommando);
    }
  }
  return jeTest;
}

// --- Vorschlag ---

/**
 * Die Gruppen nach A7: die beurteilbaren Kommandos, ohne solche die Ordner der Testdateien.
 * Liefert je Test die Namen seiner Gruppen.
 */
function gruppenJeTest(aufbereitet) {
  const kommandos = beurteilbare(aufbereitet.kommandos);
  const jeTest = new Map();
  if (kommandos.length === 0) {
    for (const testdatei of aufbereitet.kopplung.keys()) jeTest.set(testdatei, [pfad.dirname(testdatei)]);
    return { art: "ordner", jeTest };
  }
  for (const [testdatei, liste] of kommandosJeTest(kommandos)) jeTest.set(testdatei, liste.map((k) => k.cmd));
  return { art: "kommandos", jeTest };
}

/** Datei → { gruppen, tests }: welche Gruppen ueber welche Tests sie koppeln. */
function signaturen(aufbereitet, gruppen) {
  const jeDatei = new Map();
  for (const [testdatei, gekoppelt] of aufbereitet.kopplung) {
    const seine = gruppen.jeTest.get(testdatei) ?? [];
    if (seine.length === 0) continue;
    for (const datei of gekoppelt) {
      if (!jeDatei.has(datei)) jeDatei.set(datei, { gruppen: new Set(), tests: new Set() });
      const eintrag = jeDatei.get(datei);
      for (const gruppe of seine) eintrag.gruppen.add(gruppe);
      eintrag.tests.add(testdatei);
    }
  }
  return jeDatei;
}

/** Die Ordner ueber einer Datei, vom naechsten bis zum obersten, ohne die Wurzel. */
function ordnerVon(datei) {
  const ordner = [];
  for (let d = pfad.dirname(datei); d !== "."; d = pfad.dirname(d)) ordner.push(d);
  return ordner;
}

/** Ordner → die eine Signatur aller Dateien darunter, oder `null`, wenn sie verschieden sind. */
function ordnerSignaturen(dateien, schluesselJeDatei) {
  const jeOrdner = new Map();
  for (const datei of dateien) {
    const schluessel = schluesselJeDatei.get(datei) ?? "";
    for (const ordner of ordnerVon(datei)) {
      if (!jeOrdner.has(ordner)) jeOrdner.set(ordner, schluessel);
      else if (jeOrdner.get(ordner) !== schluessel) jeOrdner.set(ordner, null);
    }
  }
  return jeOrdner;
}

/** Die Muster eines Bereichs: der oberste einheitliche Ordner als `<dir>/**`, sonst der Einzelpfad. */
function musterVon(dateien, schluessel, jeOrdner) {
  const muster = new Set();
  for (const datei of dateien) {
    const oberster = ordnerVon(datei).findLast((ordner) => jeOrdner.get(ordner) === schluessel);
    muster.add(oberster ? `${oberster}/**` : datei);
  }
  return sortiert(muster);
}

/** Der gemeinsame Ordner einer Liste von Dateien, `""` fuer die Wurzel. */
function gemeinsamerOrdner(dateien) {
  if (dateien.length === 0) return "";
  let teile = pfad.dirname(dateien[0]).split("/");
  for (const datei of dateien.slice(1)) {
    const andere = pfad.dirname(datei).split("/");
    let i = 0;
    while (i < teile.length && teile[i] === andere[i]) i += 1;
    teile = teile.slice(0, i);
  }
  const ordner = teile.join("/");
  return ordner === "." ? "" : ordner;
}

/**
 * Der Name aus dem gemeinsamen Ordner (A7). Liegen die Dateien nur in der Wurzel beisammen,
 * etwa Quelle und Test, zaehlt der gemeinsame Ordner der Dateien, die kein Test sind.
 */
function nameVon(dateien, tests, vergeben) {
  const ordner = gemeinsamerOrdner(dateien) || gemeinsamerOrdner(dateien.filter((d) => !tests.has(d)));
  const basis = ordner.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join("-") || "root";
  let name = basis;
  let n = 1;
  while (vergeben.has(name)) {
    n += 1;
    name = `${basis}-${n}`;
  }
  vergeben.add(name);
  return name;
}

/** Die Bereiche nach A7: Dateien gleicher Signatur, mit Mustern, Gruppen und begruendenden Tests. */
function bereicheAbleiten(aufbereitet, jeDatei) {
  const schluesselJeDatei = new Map([...jeDatei].map(([datei, s]) => [datei, schluesselVon(s.gruppen)]));
  const jeOrdner = ordnerSignaturen(aufbereitet.dateien, schluesselJeDatei);
  const jeSignatur = new Map();
  for (const datei of sortiert(jeDatei.keys())) {
    const schluessel = schluesselJeDatei.get(datei);
    if (!jeSignatur.has(schluessel)) jeSignatur.set(schluessel, []);
    jeSignatur.get(schluessel).push(datei);
  }
  const tests = new Set(aufbereitet.kopplung.keys());
  const vergeben = new Set();
  const bereiche = [...jeSignatur]
    .sort(([, a], [, b]) => vergleicheText(a[0], b[0]))
    .map(([schluessel, dateien]) => ({
      name: nameVon(dateien, tests, vergeben),
      muster: musterVon(dateien, schluessel, jeOrdner),
      gruppen: sortiert(jeDatei.get(dateien[0]).gruppen),
      tests: sortiert(new Set(dateien.flatMap((d) => [...jeDatei.get(d).tests]))),
      dateien,
    }));
  return bereiche.sort((a, b) => vergleicheText(a.name, b.name));
}

/** Je Kommando die vorgeschlagenen `areas`; nicht beurteilbare und nicht abgeleitete bleiben (A6). */
function kommandosVorschlagen(aufbereitet, bereiche, art) {
  return aufbereitet.kommandos.map(({ cmd, urteil, grund, areas }) => {
    if (urteil !== URTEIL.beurteilbar || art !== "kommandos") return { cmd, urteil, grund, areas };
    return { cmd, urteil, grund, areas: sortiert(bereiche.filter((b) => b.gruppen.includes(cmd)).map((b) => b.name)) };
  });
}

/** Die Dateien jedes bestehenden Bereichs, getroffen ueber `bereicheVorbereiten` (A10). */
function bestehendeBereiche(config, dateien) {
  return bereicheVorbereiten(config.checkAreas ?? {}).map(({ name, regexe }) => ({
    name,
    dateien: dateien.filter((datei) => regexe.some((regex) => regex.test(datei))),
  }));
}

/** Die gekoppelten Dateien eines Bereichs, nach Signatur gruppiert. */
function teileNachSignatur(dateien, jeDatei) {
  const teile = new Map();
  for (const datei of dateien.filter((d) => jeDatei.has(d))) {
    const { gruppen, tests } = jeDatei.get(datei);
    const schluessel = schluesselVon(gruppen);
    if (!teile.has(schluessel)) teile.set(schluessel, { gruppen: sortiert(gruppen), dateien: [], tests: new Set() });
    const teil = teile.get(schluessel);
    teil.dateien.push(datei);
    for (const testdatei of tests) teil.tests.add(testdatei);
  }
  return [...teile]
    .sort(([a], [b]) => vergleicheText(a, b))
    .map(([, teil]) => ({ gruppen: teil.gruppen, dateien: teil.dateien, tests: sortiert(teil.tests) }));
}

/** A8: Teilung bei verschiedenen Signaturen in einem Bereich, Zusammenlegung bei gleicher in mehreren. */
function bestandPruefen(config, aufbereitet, jeDatei) {
  const teilungen = [];
  const jeSignatur = new Map();
  for (const { name, dateien } of bestehendeBereiche(config, aufbereitet.dateien)) {
    const teile = teileNachSignatur(dateien, jeDatei);
    if (teile.length > 1) teilungen.push({ bereich: name, teile });
    if (teile.length !== 1) continue;
    const schluessel = schluesselVon(teile[0].gruppen);
    if (!jeSignatur.has(schluessel)) jeSignatur.set(schluessel, []);
    jeSignatur.get(schluessel).push({ name, ...teile[0] });
  }
  const zusammenlegungen = [...jeSignatur.values()]
    .filter((liste) => liste.length > 1)
    .map((liste) => ({
      bereiche: sortiert(liste.map((b) => b.name)),
      gruppen: liste[0].gruppen,
      dateien: sortiert(new Set(liste.flatMap((b) => b.dateien))),
      tests: sortiert(new Set(liste.flatMap((b) => b.tests))),
    }));
  return { teilungen, zusammenlegungen };
}

/** Die Wurzel eines Elements im Wald der Vereinigung, mit Pfadverkuerzung. */
function wurzelVon(eltern, x) {
  while (eltern.get(x) !== x) {
    eltern.set(x, eltern.get(eltern.get(x)));
    x = eltern.get(x);
  }
  return x;
}

/** Die Dateien, die mehr als die Haelfte der Tests koppelt: gemeinsame Grundlage, sie trennen nicht (E6). */
function gemeinsameDateien(tests, kopplung) {
  const zaehler = new Map();
  for (const testdatei of tests) {
    for (const datei of kopplung.get(testdatei)) zaehler.set(datei, (zaehler.get(datei) ?? 0) + 1);
  }
  return new Set([...zaehler].filter(([, n]) => n * 2 > tests.length).map(([datei]) => datei));
}

/** Verbindet Tests, die eine Datei ausserhalb der Grundlage teilen; liefert Datei → ihr erster Test. */
function verbinden(tests, kopplung, gemeinsam, eltern) {
  const ersterTest = new Map();
  for (const testdatei of tests) {
    for (const datei of kopplung.get(testdatei)) {
      if (gemeinsam.has(datei)) continue;
      if (ersterTest.has(datei)) eltern.set(wurzelVon(eltern, testdatei), wurzelVon(eltern, ersterTest.get(datei)));
      else ersterTest.set(datei, testdatei);
    }
  }
  return ersterTest;
}

/**
 * E6: Ein Kommando ist teilbar, wenn seine Tests in zwei oder mehr Gruppen mit getrennten
 * gekoppelten Dateien zerfallen, nachdem die Dateien entfallen, die mehr als die Haelfte seiner
 * Tests koppelt. Tests ohne eigene Datei gehoeren zu keinem Teil.
 */
function teilbarkeit(kommando, kopplung) {
  const tests = kommando.tests.filter((testdatei) => kopplung.has(testdatei));
  const gemeinsam = gemeinsameDateien(tests, kopplung);
  const eltern = new Map(tests.map((testdatei) => [testdatei, testdatei]));
  const ersterTest = verbinden(tests, kopplung, gemeinsam, eltern);

  const teile = new Map();
  for (const [datei, testdatei] of ersterTest) {
    const wurzel = wurzelVon(eltern, testdatei);
    if (!teile.has(wurzel)) teile.set(wurzel, { tests: new Set(), dateien: new Set() });
    teile.get(wurzel).dateien.add(datei);
  }
  for (const testdatei of tests) teile.get(wurzelVon(eltern, testdatei))?.tests.add(testdatei);
  if (teile.size < 2) return null;
  return {
    cmd: kommando.cmd,
    gemeinsam: sortiert(gemeinsam),
    teile: [...teile.values()]
      .map((teil) => ({ tests: sortiert(teil.tests), dateien: sortiert(teil.dateien) }))
      .sort((a, b) => vergleicheText(a.tests[0], b.tests[0])),
  };
}

/** E5: Pfade, die mindestens ein Viertel aller Tests und mindestens drei nennen und keiner laedt. */
function geruestKandidaten(roh) {
  const geladen = new Set();
  const nenner = new Map();
  for (const [testdatei, { laedt = [], nennt = [] }] of roh) {
    for (const datei of laedt) geladen.add(datei);
    for (const datei of nennt) {
      if (!nenner.has(datei)) nenner.set(datei, []);
      nenner.get(datei).push(testdatei);
    }
  }
  return [...nenner]
    .filter(([datei, tests]) => !geladen.has(datei) && tests.length >= 3 && tests.length * 4 >= roh.size)
    .map(([datei, tests]) => ({ pfad: datei, tests: sortiert(tests) }))
    .sort((a, b) => vergleicheText(a.pfad, b.pfad));
}

/**
 * Der Vorschlag fuer Pruefbereiche (A7 bis A9, E5, E6). Schreibt nichts.
 *
 * @param {{ buildChecks?: Array<string|object>, checkAreas?: Record<string, string[]> }} config
 * @param {{ dateien: string[], tabelle: Map<string, { laedt: string[], nennt: string[], unvollstaendig?: string }>|object,
 *   kommandos: Array<{ urteil: string, grund: string|null, tests: string[] }> }} messung
 */
export function vorschlagErheben(config, messung) {
  const aufbereitet = aufbereiten(config, messung);
  const gruppen = gruppenJeTest(aufbereitet);
  const jeDatei = signaturen(aufbereitet, gruppen);
  const bereiche = bereicheAbleiten(aufbereitet, jeDatei);
  const kommandos = kommandosVorschlagen(aufbereitet, bereiche, gruppen.art);
  return {
    gruppenArt: gruppen.art,
    bereiche,
    kommandos,
    ...bestandPruefen(config, aufbereitet, jeDatei),
    teilbareKommandos: beurteilbare(aufbereitet.kommandos)
      .map((kommando) => teilbarkeit(kommando, aufbereitet.kopplung))
      .filter(Boolean),
    geruestKandidaten: geruestKandidaten(aufbereitet.roh),
    ohneTest: aufbereitet.dateien.filter((datei) => !jeDatei.has(datei)),
    ausschnitt: {
      checkAreas: Object.fromEntries(bereiche.map((b) => [b.name, b.muster])),
      buildChecks: kommandos.map(({ cmd, areas }) => ({ cmd, areas })),
    },
  };
}

// --- Abgleich ---

/** Die Luecken eines Tests nach A10: je getroffenem Bereich, den keines seiner Kommandos nennt. */
function lueckenVon(testdatei, gekoppelt, kommandos, bereiche) {
  const luecken = [];
  for (const datei of sortiert(gekoppelt)) {
    for (const bereich of bereiche.filter((b) => b.regexe.some((regex) => regex.test(datei)))) {
      if (kommandos.some((k) => k.areas.includes(bereich.name))) continue;
      for (const kommando of kommandos) luecken.push({ test: testdatei, datei, bereich: bereich.name, kommando: kommando.cmd });
    }
  }
  return luecken;
}

/** „Zu viel" je Kommando: ein genannter Bereich, dessen Dateien keiner seiner Tests koppelt. */
function zuVielVon(kommando, kopplung, bestehend) {
  const gekoppelt = new Set(kommando.tests.flatMap((testdatei) => [...(kopplung.get(testdatei) ?? [])]));
  return kommando.areas
    .filter((name) => !(bestehend.get(name) ?? []).some((datei) => gekoppelt.has(datei)))
    .map((bereich) => ({ kommando: kommando.cmd, bereich }));
}

/**
 * Der Abgleich der eingerichteten Zuordnung (A10). `nurTests` beschraenkt die Luecken auf diese
 * Tests; „zu viel" gilt immer fuer alle Tests eines Kommandos. Aendert nichts.
 *
 * @param {object} config
 * @param {object} messung wie bei `vorschlagErheben`
 * @param {{ nurTests?: string[] }} [optionen]
 */
export function abgleichErheben(config, messung, { nurTests } = {}) {
  const aufbereitet = aufbereiten(config, messung);
  const bereiche = bereicheVorbereiten(config.checkAreas ?? {});
  const jeTest = kommandosJeTest(aufbereitet.kommandos);
  const auswahl = nurTests ? new Set(nurTests) : null;

  const luecken = [];
  const ohneKommando = [];
  for (const [testdatei, gekoppelt] of [...aufbereitet.kopplung].sort(([a], [b]) => vergleicheText(a, b))) {
    if (auswahl && !auswahl.has(testdatei)) continue;
    const kommandos = jeTest.get(testdatei);
    if (kommandos) luecken.push(...lueckenVon(testdatei, gekoppelt, kommandos, bereiche));
    else ohneKommando.push(testdatei);
  }

  const bestehend = new Map(bestehendeBereiche(config, aufbereitet.dateien).map((b) => [b.name, b.dateien]));
  const mitUrteil = (urteil) => aufbereitet.kommandos.filter((k) => k.urteil === urteil).map(({ cmd, grund }) => ({ cmd, grund }));
  return {
    luecken,
    zuViel: beurteilbare(aufbereitet.kommandos).flatMap((k) => zuVielVon(k, aufbereitet.kopplung, bestehend)),
    nichtBeurteilbar: mitUrteil(URTEIL.nichtBeurteilbar),
    nichtAbgeleitet: mitUrteil(URTEIL.nichtAbgeleitet),
    ohneKommando,
  };
}

// --- Darstellung ---

const liste = (werte) => (werte.length > 0 ? werte.join(", ") : t("keine"));

/** Dieselben Daten maschinenlesbar, fuer Vorschlag wie Abgleich. */
export function alsJson(ergebnis) {
  return `${JSON.stringify(ergebnis, null, 2)}\n`;
}

/** Ein Abschnitt aus Kopf und Zeilen; ohne Zeilen entfaellt er. */
function abschnitt(kopf, zeilen) {
  return zeilen.length > 0 ? ["", kopf, ...zeilen] : [];
}

function bereichZeilen(bereiche) {
  if (bereiche.length === 0) return ["", t("keineBereiche")];
  return ["", t("bereicheKopf"), ...bereiche.flatMap((b) => [
    t("bereich", { name: b.name, muster: b.muster.join(", ") }),
    t("bereichGruppen", { liste: liste(b.gruppen) }),
    t("bereichTests", { liste: liste(b.tests) }),
    t("bereichDateien", { liste: liste(b.dateien) }),
  ])];
}

function kommandoZeile({ cmd, urteil, grund, areas }) {
  const werte = { cmd, grund, areas: liste(areas) };
  if (urteil === URTEIL.nichtBeurteilbar) return t("kommandoNichtBeurteilbar", werte);
  if (urteil === URTEIL.nichtAbgeleitet) return t("kommandoNichtAbgeleitet", werte);
  return t("kommandoAbgeleitet", werte);
}

function bestandZeilen(vorschlag) {
  return [
    ...abschnitt(t("teilungenKopf"), vorschlag.teilungen.flatMap(({ bereich, teile }) => [
      t("teilung", { bereich }),
      ...teile.map((teil) => t("teil", { gruppen: liste(teil.gruppen), dateien: liste(teil.dateien), tests: liste(teil.tests) })),
    ])),
    ...abschnitt(t("zusammenlegungenKopf"), vorschlag.zusammenlegungen.map((z) => t("zusammenlegung", {
      bereiche: z.bereiche.join(", "), gruppen: liste(z.gruppen), dateien: liste(z.dateien), tests: liste(z.tests),
    }))),
    ...abschnitt(t("teilbarKopf"), vorschlag.teilbareKommandos.flatMap((k) => [
      t("teilbar", { cmd: k.cmd, anzahl: k.teile.length, gemeinsam: liste(k.gemeinsam) }),
      ...k.teile.map((teil, i) => t("teilbarTeil", { nummer: i + 1, tests: liste(teil.tests) })),
    ])),
    ...abschnitt(t("geruestKopf"), vorschlag.geruestKandidaten.map((g) => t("geruest", {
      pfad: g.pfad, anzahl: g.tests.length, tests: liste(g.tests),
    }))),
  ];
}

function ohneTestZeilen(ohneTest) {
  const weitere = ohneTest.length - OHNE_TEST_IM_TEXT;
  return abschnitt(t("ohneTestKopf", { anzahl: ohneTest.length }), [
    ...ohneTest.slice(0, OHNE_TEST_IM_TEXT).map((datei) => `- ${datei}`),
    ...(weitere > 0 ? [t("ohneTestWeitere", { anzahl: weitere })] : []),
  ]);
}

/** Der Vorschlag als Text in der Projektsprache; er endet mit einem kopierbaren JSON-Ausschnitt. */
export function vorschlagText(vorschlag) {
  return [
    t("vorschlagKopf"),
    t(vorschlag.gruppenArt === "ordner" ? "gruppenOrdner" : "gruppenKommandos"),
    ...bereichZeilen(vorschlag.bereiche),
    ...abschnitt(t("kommandosKopf"), vorschlag.kommandos.map(kommandoZeile)),
    ...bestandZeilen(vorschlag),
    ...ohneTestZeilen(vorschlag.ohneTest),
    "",
    t("ausschnittKopf"),
    JSON.stringify(vorschlag.ausschnitt, null, 2),
    "",
  ].join("\n");
}

/** Der Abgleich als Text in der Projektsprache: Luecken getrennt vom Hinweis „zu viel". */
export function abgleichText(abgleich) {
  const grundZeile = ({ cmd, grund }) => t("kommandoGrund", { cmd, grund });
  return [
    t("abgleichKopf"),
    ...(abgleich.luecken.length > 0
      ? ["", t("lueckenKopf"), ...abgleich.luecken.map((l) => t("luecke", l))]
      : ["", t("keineLuecken")]),
    ...abschnitt(t("zuVielKopf"), abgleich.zuViel.map((z) => t("zuViel", z))),
    ...abschnitt(t("nichtBeurteilbarKopf"), abgleich.nichtBeurteilbar.map(grundZeile)),
    ...abschnitt(t("nichtAbgeleitetKopf"), abgleich.nichtAbgeleitet.map(grundZeile)),
    ...abschnitt(t("ohneKommandoKopf"), abgleich.ohneKommando.map((datei) => `- ${datei}`)),
    "",
  ].join("\n");
}
