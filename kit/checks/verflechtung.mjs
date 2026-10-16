#!/usr/bin/env node
/**
 * checks/verflechtung.mjs — erhebt je Testdatei des Arbeitsstands die Quelldateien, die sie
 * laedt, und die, die sie nur nennt (Issue #931, Plan #930, E5; seit Issue #1714 ein
 * mitgelieferter Teil des Kits, Plan #1713 A1 und A2).
 *
 * Der Plan stellt die bereichsbezogene Auswahl der Pruefungen um. Jeder Schnitt
 * legt sich gegen die tatsaechliche Verflechtung von Test und Quelle; ohne
 * Erhebung waere er geraten, und er irrte in die Richtung, in der der Fehler
 * niemandem auffaellt: Ein Bereich, der seine Testgruppe nicht ausloest, ist
 * still gruen.
 *
 * Das Verfahren ist bewusst konservativ und statisch (E5):
 *
 *   1. „laedt": die Import-Kette, verfolgt durch `test/**` hindurch — eine Testdatei
 *      laedt ihre Quellen oft ueber einen Helfer unter `test/helpers/`. Ein
 *      Graph, der an der Helferdatei endet, saehe diese Kopplung nicht (E8).
 *   2. „nennt": jede Erwaehnung eines Quellpfads als Zeichenkette im Dateitext, die
 *      nicht schon geladen wird. Die Kit-Werkzeuge starten einander als Kindprozess;
 *      ein reiner Import-Graph saehe die wichtigste Kopplung des Repos nicht.
 *
 * Beides zaehlt als Kopplung (A2); getrennt geliefert wird es, weil Vorschlag und Abgleich
 * der Pruefbereiche verschieden fragen: Eine Luecke ist eine geladene Datei, ein
 * Geruest-Kandidat eine, die viele Tests nur nennen. Wer die Kopplung insgesamt braucht,
 * nimmt `kopplungVon`.
 *
 * Eine Erwaehnung faelschlich als Kopplung zu zaehlen irrt in die sichere
 * Richtung: Die Auswahl darf nur zu mehr Pruefung irren, nie zu weniger. Fuer die
 * Deckungsfrage ist das richtig, fuer die Auswahl wurde es teuer — ein Wurzelpfad
 * wie `README.md`, den fast jeder Test in seinem Wegwerfprojekt anlegt, zwang die
 * `areas` der Nacht-Gruppe auf `skills-doku` (Issue #937).
 *
 * Deshalb nimmt die Erhebung seit Issue #943 eine Liste von Geruest-Mustern
 * entgegen (`nurGeruest`). Sie wird uebergeben und nicht hier verdrahtet: Welche
 * Dateien ein Projekt als Geruest anlegt, weiss der Aufrufer, und das Kit laeuft
 * auch in fremden Projekten. Ohne Liste bleibt es beim konservativen Verhalten von
 * vorher — wer nichts uebergibt, entscheidet nichts.
 *
 * Die Kette laeuft ausdruecklich NICHT von Quelle zu Quelle weiter. Diese
 * Richtung traegt der Plan ueber die `areas`-Liste je Pruefkommando: Laedt
 * `night.mjs` den Board-Adapter, fuehrt das Nacht-Kommando den Bereich `board`.
 * Beide Wege zugleich beschrieben dieselbe Regel zweimal.
 *
 * Fuer die Teile von Nacht-Runner und Board-Werkzeug heisst das (Issue #1208, Plan
 * #1199, E18): Jede Datei unter `kit/night/` und `kit/board/` ist eine eigene Quelle.
 * Ein Test, der einen Teil laedt, koppelt an diesen Teil; ein Test, der den Einstieg
 * `kit/night.mjs` oder `kit/board.mjs` laedt, koppelt an den Einstieg und damit an
 * dessen Bereich — die Teile dahinter erreicht die Auswahl ueber die abhaengigen
 * Bereiche aus `kit/checks.mjs`, nicht diese Tabelle.
 *
 * Nutzung:
 *   node .claude/kit/checks/verflechtung.mjs   Tabelle auf der Standardausgabe
 *   import { verflechtungErheben }             dieselbe Tabelle als Map
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { globZuRegex, vergleicheText } from "../checks.mjs";
import { TEXTE } from "../texte/checks-verflechtung.mjs";

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

/** Ein Pfad in der Schreibweise der Config: Posix-Trenner, repo-relativ. */
function posix(pfad) {
  return pfad.replaceAll("\\", "/");
}

/** Eine Liste von Pfaden aus `git ls-files`, in der Schreibweise der Config. */
function lsFiles(repoRoot, args) {
  const res = spawnSync("git", ["ls-files", "-z", ...args], { cwd: repoRoot, encoding: "utf-8" });
  if (res.status !== 0) {
    throw new Error(t("lsFilesFehler", { grund: (res.stderr || "").trim() }));
  }
  return res.stdout.split("\0").filter((p) => p.length > 0).map(posix);
}

/**
 * Die Dateien des Arbeitsstands: versioniert und uncommittet neu angelegt.
 *
 * Der Prueflauf eines Arbeitspakets steht VOR dem Commit (Issue #957). Nur
 * `git ls-files` zu lesen liess jede in diesem Paket neu angelegte Testdatei
 * unsichtbar bleiben — sichtbar wurde sie erst im Lauf der naechsten Karte, und
 * der Fund gehoerte dann der falschen. Die uncommitteten Neuanlagen kommen
 * deshalb dazu, und zwar ohne die ignorierten (`--exclude-standard`): sonst
 * zaehlten `node_modules/` und der lokale Zustand unter `.claude/` als Kopplung.
 *
 * Eine insgesamt leere Antwort ist ein Fehler und kein leerer Fall: Sie entstuende
 * bei einem Aufruf ausserhalb des Repos — und die Erhebung meldete dann eine
 * Verflechtung von null, die wie „keine Kopplung" aussieht. Eine leere zweite
 * Liste allein ist dagegen der Normalfall: ein sauberer Arbeitsbaum.
 *
 * Exportiert fuer `testauswahl.mjs` (Issue #1716): Die Testmenge eines Kommandos sucht in
 * derselben Dateimenge, in der die Messung misst.
 */
export function imArbeitsstand(repoRoot) {
  const dateien = [...new Set([
    ...lsFiles(repoRoot, []),
    ...lsFiles(repoRoot, ["--others", "--exclude-standard"]),
  ])].sort(vergleicheText);
  if (dateien.length === 0) throw new Error(t("lsFilesLeer", { pfad: repoRoot }));
  return dateien;
}

/**
 * Die Import-Angaben einer JavaScript- oder TypeScript-Datei — `from "…"`, `import("…")`,
 * `export … from "…"` und `require("…")`, relativ wie bare.
 */
function importAngaben(text) {
  return [...text.matchAll(/(?:from|import|require)[\s(]*["']([^"']+)["']/g)].map((treffer) => treffer[1]);
}

/** Eine Angabe, die relativ zur importierenden Datei gilt. */
function relativ(angabe) {
  return angabe.startsWith("./") || angabe.startsWith("../");
}

/**
 * Die relativen Import-Ziele einer JavaScript-Datei — `from "…"`, `import("…")`,
 * `export … from "…"` und `require("…")`.
 */
export function importZiele(text) {
  return importAngaben(text).filter(relativ);
}

/**
 * Durchgangsstationen (Plan #1713 A4): Dateien unter `test/`, `tests/` und `__tests__/`, auf
 * jeder Ebene — damit auch `**\/src/test/`. Sie sind Testhilfen, nie Quellen; die Kette laeuft
 * durch sie weiter.
 */
const DURCHGANG = /(?:^|\/)(?:test|tests|__tests__)\//;

/** Ein Pfad relativ zum Repo, aus einem Ordner und einem Ziel darin; ausserhalb beginnt er mit `..`. */
function imRepo(ordner, ziel, repoRoot) {
  return posix(relative(repoRoot, resolve(repoRoot, ordner, ziel)));
}

/**
 * Bare Specifier sind extern, ausser sie tragen den `name` einer versionierten `package.json`
 * (A3); dann koppeln sie an das Verzeichnis dieses Pakets, also an jede Quelle darunter.
 */
function paketDateien(angabe, ctx) {
  const paket = ctx.pakete().find(({ name }) => angabe === name || angabe.startsWith(`${name}/`));
  if (!paket) return [];
  return [...ctx.quellmenge].filter((pfad) => paket.ordner === "" || pfad.startsWith(`${paket.ordner}/`));
}

/** Die JavaScript-Lesart: relative Importe ohne Aufloesung der Endung, dazu Pakete des Repos. */
function javascriptZiele(datei, text, ctx) {
  const pfade = [];
  for (const angabe of importAngaben(text)) {
    if (relativ(angabe)) pfade.push(imRepo(dirname(datei), angabe, ctx.repoRoot));
    else pfade.push(...paketDateien(angabe, ctx));
  }
  return { pfade, gruende: [] };
}

const TS_ENDUNGEN = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_NACH_TS = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

/**
 * Ein TypeScript-Ziel als Datei des Arbeitsstands, wie der Compiler es aufloest: `.js` nach
 * `.ts`, dann das Ziel selbst, dann ohne Endung, dann die `index`-Datei. `null` ohne Treffer.
 */
function tsAufloesen(pfad, ctx) {
  const endung = Object.keys(JS_NACH_TS).find((e) => pfad.endsWith(e));
  const kandidaten = [
    ...(endung ? JS_NACH_TS[endung].map((ts) => pfad.slice(0, -endung.length) + ts) : []),
    pfad,
    ...TS_ENDUNGEN.map((e) => pfad + e),
    ...TS_ENDUNGEN.map((e) => `${pfad}/index${e}`),
  ];
  return kandidaten.find((kandidat) => ctx.alle.has(kandidat)) ?? null;
}

/**
 * JSON mit Kommentaren und Komma am Ende, wie eine tsconfig es erlaubt. Zeichenketten bleiben
 * unberuehrt — `"@/*"` ist ein Pfad, kein Kommentar.
 */
function jsoncLesen(text) {
  const zeichenkette = String.raw`"(?:\\.|[^"\\])*"`;
  const ohneKommentare = text.replaceAll(
    new RegExp(String.raw`${zeichenkette}|\/\/[^\n]*|\/\*(?:[^*]|\*(?!\/))*\*\/`, "g"),
    (treffer) => (treffer.startsWith('"') ? treffer : " "),
  );
  return JSON.parse(ohneKommentare.replaceAll(
    new RegExp(String.raw`${zeichenkette}|,(?=\s*[}\]])`, "g"),
    (treffer) => (treffer === "," ? "" : treffer),
  ));
}

/**
 * Die wirksamen Aliase einer tsconfig samt ihrer Kette ueber relative `extends`: `baseUrl`
 * gilt relativ zur Datei, die es setzt, `paths` relativ zu `baseUrl` oder, ohne es, zur
 * Datei, die `paths` setzt. Ein `extends` auf ein Paket liest die Messung nicht.
 */
function tsconfigLesen(pfad, ctx, gesehen = new Set()) {
  if (gesehen.has(pfad)) return {};
  gesehen.add(pfad);
  const text = ctx.textVon(pfad);
  if (text === null) return {};
  const json = jsoncLesen(text);
  const eltern = [json.extends ?? []].flat().filter((e) => typeof e === "string" && e.startsWith("."));
  let wirksam = {};
  for (const e of eltern) {
    const ziel = imRepo(dirname(pfad), e, ctx.repoRoot);
    wirksam = { ...wirksam, ...tsconfigLesen(ctx.alle.has(ziel) ? ziel : `${ziel}.json`, ctx, gesehen) };
  }
  const optionen = json.compilerOptions ?? {};
  if (typeof optionen.baseUrl === "string") wirksam.baseUrl = imRepo(dirname(pfad), optionen.baseUrl, ctx.repoRoot);
  if (optionen.paths && typeof optionen.paths === "object") {
    wirksam.paths = optionen.paths;
    wirksam.pathsOrdner = dirname(pfad);
  }
  return wirksam;
}

/** Die naechste tsconfig.json ueber einer Datei, gelesen — oder `null`. */
function tsconfigVon(datei, ctx) {
  for (let ordner = dirname(datei); ; ordner = dirname(ordner)) {
    const pfad = ordner === "." ? "tsconfig.json" : `${ordner}/tsconfig.json`;
    if (ctx.alle.has(pfad)) {
      if (!ctx.tsconfigs.has(pfad)) {
        let config;
        try {
          config = { datei: pfad, ...tsconfigLesen(pfad, ctx) };
        } catch (fehler) {
          config = { datei: pfad, fehler: fehler.message };
        }
        ctx.tsconfigs.set(pfad, config);
      }
      return ctx.tsconfigs.get(pfad);
    }
    if (ordner === ".") return null;
  }
}

/** Die Ersetzungen des laengsten passenden Musters aus `paths`, oder `null`. */
function aliasTreffer(angabe, paths) {
  let bester = null;
  for (const [muster, ziele] of Object.entries(paths ?? {})) {
    const stern = muster.indexOf("*");
    const vorn = stern < 0 ? muster : muster.slice(0, stern);
    const hinten = stern < 0 ? "" : muster.slice(stern + 1);
    const passt = stern < 0
      ? angabe === muster
      : angabe.length >= vorn.length + hinten.length && angabe.startsWith(vorn) && angabe.endsWith(hinten);
    if (!passt || (bester && bester.vorn.length >= vorn.length)) continue;
    const rest = stern < 0 ? "" : angabe.slice(vorn.length, angabe.length - hinten.length);
    bester = { vorn, ersetzungen: [ziele].flat().map((ziel) => String(ziel).replace("*", rest)) };
  }
  return bester?.ersetzungen ?? null;
}

/**
 * Die TypeScript-Lesart: relative Importe mit der Aufloesung des Compilers, Aliase aus der
 * naechsten tsconfig.json, `baseUrl`, dann Pakete des Repos; alles uebrige ist extern. Ein
 * Alias, der passt und keine Datei trifft, ist ein Grund fuer den Vermerk (A6).
 */
function typescriptZiele(datei, text, ctx) {
  const pfade = [];
  const gruende = [];
  const config = tsconfigVon(datei, ctx);
  for (const angabe of importAngaben(text)) {
    const { treffer, grund } = typescriptZiel(datei, angabe, config, ctx);
    pfade.push(...treffer);
    if (grund) gruende.push(grund);
  }
  return { pfade, gruende };
}

/** Die Dateien zu einer TypeScript-Angabe, oder der Grund, warum sie offen bleibt. */
function typescriptZiel(datei, angabe, config, ctx) {
  const aufgeloest = (basis, ziel) => tsAufloesen(imRepo(basis, ziel, ctx.repoRoot), ctx);
  if (relativ(angabe)) return { treffer: [aufgeloest(dirname(datei), angabe)].filter(Boolean) };
  if (config?.fehler) {
    return { treffer: [], grund: t("tsconfigUnlesbar", { datei, tsconfig: config.datei, grund: config.fehler }) };
  }
  const ersetzungen = aliasTreffer(angabe, config?.paths);
  if (ersetzungen) {
    const treffer = ersetzungen.map((ziel) => aufgeloest(config.baseUrl ?? config.pathsOrdner, ziel)).find(Boolean);
    if (treffer) return { treffer: [treffer] };
    return { treffer: [], grund: t("aliasOhneTreffer", { datei, ziel: angabe, tsconfig: config.datei }) };
  }
  const ueberBasis = config?.baseUrl === undefined ? null : aufgeloest(config.baseUrl, angabe);
  return { treffer: ueberBasis ? [ueberBasis] : paketDateien(angabe, ctx) };
}

/**
 * Die Klassen des Arbeitsstands unter allen Quellwurzeln `**\/src/main/java/` und
 * `**\/src/test/java/`: je voll qualifiziertem Namen (mit `/`) die Dateien, je Paket die
 * Klassen. Ein Name darf in mehreren Wurzeln stehen; dann zaehlt jede Datei.
 */
function javaVerzeichnis(alle) {
  const klassen = new Map();
  const pakete = new Map();
  for (const pfad of alle) {
    const wurzel = /(?:^|\/)src\/(?:main|test)\/java\//.exec(pfad);
    if (!wurzel || !pfad.endsWith(".java")) continue;
    const name = pfad.slice(wurzel.index + wurzel[0].length, -".java".length);
    const paket = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
    klassen.set(name, [...(klassen.get(name) ?? []), pfad]);
    pakete.set(paket, [...(pakete.get(paket) ?? []), { name: name.slice(paket.length ? paket.length + 1 : 0), pfad }]);
  }
  return { klassen, pakete };
}

/** Die Dateien zu einem voll qualifizierten Namen; ein Mitglied oder eine innere Klasse faellt ab. */
function javaName(name, verzeichnis) {
  const teile = name.split(".");
  for (let n = teile.length; n > 0; n--) {
    const dateien = verzeichnis.klassen.get(teile.slice(0, n).join("/"));
    if (dateien) return dateien;
  }
  return [];
}

/**
 * Die Java-Lesart: Einzel-, Stern- und statische Importe, Namen aus dem eigenen Paket und voll
 * qualifizierte Namen im Text. Aus einem Paket zaehlen nur die Klassen, deren Name im Text
 * steht — ohne Import erreicht Java eine Klasse nicht anders. Was keine Datei trifft, ist extern.
 */
function javaZiele(datei, text, ctx) {
  const verzeichnis = ctx.java();
  const woerter = new Set(text.match(/\b[A-Z]\w*/g) ?? []);
  const ausPaket = (paket) => (verzeichnis.pakete.get(paket.replaceAll(".", "/")) ?? [])
    .filter((klasse) => woerter.has(klasse.name)).map((klasse) => klasse.pfad);
  const pfade = ausPaket(/^[ \t]*package[ \t]+([\w.]+)[ \t]*;/m.exec(text)?.[1] ?? "");
  for (const [, ziel, stern] of text.matchAll(/^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+)(\.\*)?[ \t]*;/gm)) {
    if (stern) pfade.push(...(verzeichnis.klassen.get(ziel.replaceAll(".", "/")) ?? ausPaket(ziel)));
    else pfade.push(...javaName(ziel, verzeichnis));
  }
  for (const [name] of text.matchAll(/\b[a-z_]\w*(?:\.[a-z_]\w*)*\.[A-Z]\w*/g)) pfade.push(...javaName(name, verzeichnis));
  return { pfade: pfade.filter((pfad) => pfad !== datei), gruende: [] };
}

/**
 * Die Lesarten: je Sprache die Endungen ihrer Dateien, wie aus dem Text Pfade werden und ob
 * die Kette von Quelle zu Quelle weiterlaeuft (Plan #1713 A3, A4, P13). Eine Tabelle und nicht
 * je Sprache eine gleich gebaute Funktion, damit keine Kopie fuer die Duplikatsmessung
 * entsteht. Eine Datei ohne Lesart traegt keine Importe; ihre Nennungen zaehlen trotzdem.
 *
 * `huelle`: Fuer JavaScript leitet die Auswahl abhaengige Bereiche schon aus dem Importgraphen
 * ab (`docs/pruefbereiche.md`), fuer TypeScript und Java nicht — ohne die Huelle bliebe eine
 * mittelbar geladene Klasse still ohne Pruefung.
 */
const LESARTEN = Object.freeze([
  Object.freeze({ sprache: "javascript", endungen: Object.freeze([".js", ".mjs", ".cjs", ".jsx"]), huelle: false, ziele: javascriptZiele }),
  Object.freeze({ sprache: "typescript", endungen: Object.freeze([".ts", ".tsx", ".mts", ".cts"]), huelle: true, ziele: typescriptZiele }),
  Object.freeze({ sprache: "java", endungen: Object.freeze([".java"]), huelle: true, ziele: javaZiele }),
]);

/** Die Lesart einer Datei nach ihrer Endung, oder `null`. */
function lesartVon(datei) {
  return LESARTEN.find((lesart) => lesart.endungen.some((endung) => datei.endsWith(endung))) ?? null;
}

/**
 * Die Importe einer Datei, getrennt nach Blatt und Durchgangsstation, dazu die Gruende fuer
 * den Vermerk „unvollstaendig". Ein Blatt, dessen Lesart die Huelle traegt, ist zugleich
 * Station: Die Kette laeuft durch es weiter (A4).
 *
 * @returns {{ quellen: string[], weiter: string[], gruende: string[] }}
 */
function importeAuswerten(datei, text, ctx) {
  const quellen = [];
  const weiter = [];
  const lesart = lesartVon(datei);
  if (!lesart) return { quellen, weiter, gruende: [] };
  const { pfade, gruende } = lesart.ziele(datei, text, ctx);
  for (const pfad of pfade) {
    if (DURCHGANG.test(pfad)) weiter.push(pfad);
    else if (ctx.quellmenge.has(pfad)) {
      quellen.push(pfad);
      if (lesartVon(pfad)?.huelle) weiter.push(pfad);
    }
  }
  return { quellen, weiter, gruende };
}

/** Jede Quelldatei, deren Pfad als Zeichenkette im Text steht (E5, zweite Haelfte). */
function erwaehnte(text, quellmenge) {
  const gefunden = [];
  for (const quelle of quellmenge) {
    if (text.includes(quelle)) gefunden.push(quelle);
  }
  return gefunden;
}

/**
 * Die Quelldateien, die eine Testdatei laedt, und die, die sie nur nennt.
 *
 * `gelesen` verhindert die Endlosschleife bei zwei Helfern, die sich
 * gegenseitig laden; ohne sie haengt die Erhebung, statt zu irren. Genannt zaehlt nur, was
 * der Test oder eine Durchgangsstation nennt — eine Quelle der Huelle nennt fuer sich selbst.
 * Gruende fuer den Vermerk zaehlen aus der ganzen Kette: Fehlt ein Glied, fehlt es dem Test.
 *
 * @returns {{ laedt: string[], nennt: string[], unvollstaendig?: string }}
 */
function quellenZu(testdatei, ctx) {
  const laedt = new Set();
  const genannt = new Set();
  const gruende = new Set();
  const offen = [testdatei];
  const gelesen = new Set([testdatei]);

  while (offen.length > 0) {
    const datei = offen.pop();
    const text = ctx.textVon(datei);
    if (text === null) continue;

    const { quellen: blaetter, weiter, gruende: hier } = importeAuswerten(datei, text, ctx);
    blaetter.forEach((pfad) => laedt.add(pfad));
    hier.forEach((grund) => gruende.add(grund));
    const neu = weiter.filter((pfad) => !gelesen.has(pfad));
    neu.forEach((pfad) => gelesen.add(pfad));
    offen.push(...neu);
    if (!ctx.quellmenge.has(datei)) erwaehnte(text, ctx.quellmenge).forEach((pfad) => genannt.add(pfad));
  }

  // Codepoint-Ordnung, nicht die der Locale: Die Tabelle geht in die
  // bereichsbezogene Auswahl der Pruefungen ein und muss auf jeder Maschine
  // dieselbe sein (Issue #956, S2871).
  const ergebnis = {
    laedt: [...laedt].sort(vergleicheText),
    nennt: [...genannt].filter((pfad) => !laedt.has(pfad)).sort(vergleicheText),
  };
  if (gruende.size > 0) ergebnis.unvollstaendig = [...gruende].sort(vergleicheText).join("; ");
  return ergebnis;
}

/**
 * Die Verflechtungstabelle: je Testdatei des Arbeitsstands die sortierten Listen der
 * Quelldateien, die sie laedt und die sie nur nennt — versioniert wie uncommittet neu
 * angelegt (#957). Laesst sich ein Import eines Tests nicht aufloesen (ein Alias ohne
 * Treffer), traegt seine Zeile zusaetzlich `unvollstaendig` mit dem Grund (Plan #1713 A6):
 * Eine Messung mit Luecke ist keine Entwarnung.
 *
 * `nurGeruest` sind Pfadmuster in der Schreibweise von `checkAreas` — dieselbe
 * Aufloesung aus `kit/checks.mjs`, nicht eine zweite hier. Ein getroffener
 * Quellpfad faellt vor der Erhebung aus der Quellmenge und erscheint damit in
 * KEINER Zeile und in keiner der beiden Listen: Das Muster gilt gegen den Quellpfad,
 * nicht gegen die Testdatei. Ausgeschlossen wird, was als Geruest erwaehnt wird, nicht
 * wer es erwaehnt — eine Liste je Testdatei waere eine zweite Verflechtungstabelle
 * neben der ersten.
 *
 * `testdateien` beschraenkt die Messung auf diese Tests (repo-relativ), in jeder Sprache der
 * Lesarten; ohne sie gilt jede Datei `test/**\/*.test.mjs` des Arbeitsstands. Weder ein Test
 * noch eine Datei unter den Testhilfe-Ordnern (A4) ist je eine Quelle.
 *
 * @param {{ repoRoot?: string, nurGeruest?: string[], testdateien?: string[] }} [optionen]
 * @returns {Map<string, { laedt: string[], nennt: string[], unvollstaendig?: string }>} Testpfad → Quellpfade, repo-relativ
 */
export function verflechtungErheben({ repoRoot = process.cwd(), nurGeruest = [], testdateien } = {}) {
  const alle = imArbeitsstand(repoRoot);
  const tests = (testdateien ?? alle.filter((p) => /^test\/.*\.test\.mjs$/.test(p))).map(posix).sort(vergleicheText);
  const geruest = nurGeruest.map((muster) => globZuRegex(muster));
  const testmenge = new Set(tests);
  const quellmenge = new Set(alle.filter(
    (p) => !DURCHGANG.test(p) && !testmenge.has(p) && !geruest.some((regex) => regex.test(p)),
  ));

  const zwischenspeicher = new Map();
  const textVon = (datei) => {
    if (zwischenspeicher.has(datei)) return zwischenspeicher.get(datei);
    let text = null;
    try {
      text = readFileSync(join(repoRoot, datei), "utf-8");
    } catch {
      // Ein Import, der auf keine versionierte Datei zeigt (Verzeichnis-Index,
      // nicht versionierte Hilfsdatei): kein Fehler, nur keine Kopplung.
      text = null;
    }
    zwischenspeicher.set(datei, text);
    return text;
  };

  // Pakete und Java-Klassen erst auf Nachfrage: Ein reines JavaScript-Projekt ohne Bare
  // Specifier liest keine package.json und sucht keine Quellwurzel.
  let pakete = null;
  let java = null;
  const ctx = {
    repoRoot,
    alle: new Set(alle),
    quellmenge,
    textVon,
    tsconfigs: new Map(),
    pakete: () => (pakete ??= paketeVon(alle, textVon)),
    java: () => (java ??= javaVerzeichnis(alle)),
  };

  const tabelle = new Map();
  for (const testdatei of tests) {
    tabelle.set(testdatei, quellenZu(testdatei, ctx));
  }
  return tabelle;
}

/** Die versionierten package.json mit `name`: Name und Ordner, repo-relativ (Wurzel `""`). */
function paketeVon(alle, textVon) {
  const pakete = [];
  for (const pfad of alle.filter((p) => /(?:^|\/)package\.json$/.test(p))) {
    try {
      const { name } = JSON.parse(textVon(pfad) ?? "{}");
      if (typeof name === "string" && name) pakete.push({ name, ordner: pfad.includes("/") ? dirname(pfad) : "" });
    } catch {
      // Eine unlesbare package.json traegt keinen Namen, an den ein Import koppeln koennte.
    }
  }
  return pakete;
}

/**
 * Die Kopplung insgesamt: je Test die Vereinigung aus „laedt" und „nennt", sortiert — die
 * eine Liste, die die Erhebung vor der Trennung lieferte (Plan #1713 A2).
 *
 * @param {Map<string, { laedt: string[], nennt: string[] }>} tabelle
 * @returns {Map<string, string[]>}
 */
export function kopplungVon(tabelle) {
  const kopplung = new Map();
  for (const [testdatei, { laedt, nennt }] of tabelle) {
    kopplung.set(testdatei, [...laedt, ...nennt].sort(vergleicheText));
  }
  return kopplung;
}

/** Die Tabelle als Markdown — so, wie sie als Kommentar ans Arbeitspaket geht. */
export function tabelleAlsMarkdown(tabelle) {
  const liste = (pfade) => pfade.map((q) => "`" + q + "`").join(", ") || "—";
  const zeilen = [t("kopf"), "|---|---|---|---|"];
  for (const [testdatei, { laedt, nennt }] of tabelle) {
    zeilen.push(`| \`${testdatei}\` | ${liste(laedt)} | ${liste(nennt)} | ${laedt.length + nennt.length} |`);
  }
  return zeilen.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tabelle = verflechtungErheben();
  process.stdout.write(`${tabelleAlsMarkdown(tabelle)}\n`);
}
