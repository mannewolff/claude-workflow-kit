// Die Sidebar der Doku-Seite zeigt nur auf Anker, die es gibt (Issue #1340).
//
// Die Sidebar in `docs-site/.vitepress/config.ts` verlinkt Abschnitte der Doku ueber ihren
// Anker, und der Anker entsteht aus der Ueberschrift. Wird eine Ueberschrift umbenannt,
// zeigt der Link ins Leere — VitePress meldet das beim Build nicht, die Seite oeffnet
// sich einfach oben. So stand der Link "Die sechzehn Skills" noch auf
// `#die-zwolf-skills-und-der-9-schritt-kernprozess`, lange nachdem die Ueberschrift
// anders hiess (Issue #1336).
//
// Geprueft wird ohne Abhaengigkeit von `docs-site/`, wie in
// `test/docs-vitepress-sicher.test.mjs`: Die Slug-Regel von VitePress ist hier klein
// nachgebildet und hat eigene Faelle, damit eine Abweichung von ihr auffaellt und nicht
// still jeden Anker fuer tot oder lebendig erklaert.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(repoRoot, "docs-site", ".vitepress", "config.ts");
const DOCS = join(repoRoot, "docs");

/**
 * Der Anker einer Ueberschrift, nachgebildet nach VitePress: Unicode NFKD, Akzente weg,
 * klein, jede Folge anderer Zeichen als Buchstabe und Ziffer wird `-`, `-` am Rand weg,
 * vor einer fuehrenden Ziffer steht `_` (die nummerierten Schritte des Einstiegs, Issue #1757).
 */
function slug(ueberschrift) {
  return ueberschrift
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-/, "")
    .replace(/-$/, "")
    .replace(/^(\d)/, "_$1");
}

/** Alle Sidebar-Links mit Anker: `{ text, link: "/<seite>#<anker>" }`. */
function ankerLinks(configText) {
  const muster = /text:\s*"([^"]*)",\s*link:\s*"\/([^"#]+)#([^"]+)"/g;
  return [...configText.matchAll(muster)].map(([, text, seite, anker]) => ({ text, seite, anker }));
}

/** Die Anker aller Ueberschriften einer Markdown-Datei, Codebloecke ausgenommen. */
function ankerDerSeite(markdown) {
  const anker = new Set();
  let imCode = false;
  for (const zeile of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(zeile)) {
      imCode = !imCode;
      continue;
    }
    if (imCode) continue;
    const treffer = /^#{1,6} /.exec(zeile);
    if (treffer) anker.add(slug(zeile.slice(treffer[0].length).replaceAll("`", "")));
  }
  return anker;
}

/** Die Links, deren Anker es auf ihrer Seite nicht gibt, als lesbare Meldung. */
function toteAnker(configText, seiteLesen) {
  const tot = [];
  for (const { text, seite, anker } of ankerLinks(configText)) {
    const markdown = seiteLesen(seite);
    if (markdown === null) {
      tot.push(`${seite}#${anker} ("${text}"): Seite docs/${seite}.md fehlt`);
    } else if (!ankerDerSeite(markdown).has(anker)) {
      tot.push(`${seite}#${anker} ("${text}"): kein solcher Anker auf docs/${seite}.md`);
    }
  }
  return tot;
}

function echteSeite(seite) {
  const pfad = join(DOCS, `${seite}.md`);
  return existsSync(pfad) ? readFileSync(pfad, "utf-8") : null;
}

test("slug bildet die Ueberschrift der Skills wie VitePress ab", () => {
  assert.equal(
    slug("Die sechzehn Skills und der 9-Schritt-Kernprozess"),
    "die-sechzehn-skills-und-der-9-schritt-kernprozess",
  );
});

test("slug setzt vor eine fuehrende Ziffer einen Unterstrich wie VitePress", () => {
  assert.equal(slug("5. Kit installieren"), "_5-kit-installieren");
});

test("slug entfernt Umlaut-Punkte statt sie umzuschreiben", () => {
  assert.equal(slug("Die zwölf Skills"), "die-zwolf-skills");
});

test("die Sidebar traegt Links mit Anker — sonst prueft dieser Test nichts", () => {
  assert.ok(ankerLinks(readFileSync(CONFIG, "utf-8")).length > 0);
});

test("beide Seitenleisten tragen Links mit Anker — die englische gegen docs/en/ (Issue #1370)", () => {
  // Die englische Seitenleiste verlinkt `/en/dokumentation#…`; ihr Anker wird gegen
  // `docs/en/dokumentation.md` geprueft. Fehlte eine der beiden Seitenleisten, prueften
  // die Faelle hier nur noch die halbe Doku.
  const seiten = new Set(ankerLinks(readFileSync(CONFIG, "utf-8")).map((l) => l.seite));
  assert.ok(seiten.has("dokumentation"), "keine Anker-Links der deutschen Seitenleiste gefunden");
  assert.ok(seiten.has("en/dokumentation"), "keine Anker-Links der englischen Seitenleiste gefunden");
});

test("Gegenprobe: ein deutscher Anker in der englischen Seitenleiste wird als tot erkannt", () => {
  const config = `{ text: "Three lanes", link: "/en/dokumentation#drei-bahnen" },`;
  assert.deepEqual(toteAnker(config, echteSeite), [
    'en/dokumentation#drei-bahnen ("Three lanes"): kein solcher Anker auf docs/en/dokumentation.md',
  ]);
});

test("jeder Sidebar-Anker in docs-site/.vitepress/config.ts zeigt auf eine Ueberschrift", () => {
  assert.deepEqual(toteAnker(readFileSync(CONFIG, "utf-8"), echteSeite), []);
});

test("Gegenprobe: ein erfundener Anker wird als tot erkannt", () => {
  const config = `{ text: "Erfunden", link: "/dokumentation#gibt-es-nicht" },`;
  assert.deepEqual(toteAnker(config, echteSeite), [
    'dokumentation#gibt-es-nicht ("Erfunden"): kein solcher Anker auf docs/dokumentation.md',
  ]);
});

test("Gegenprobe: der alte Anker der Skills waere tot", () => {
  const config = `{ text: "Die zwölf Skills", link: "/dokumentation#die-zwolf-skills-und-der-9-schritt-kernprozess" },`;
  assert.equal(toteAnker(config, echteSeite).length, 1);
});

// Die Verweise im Text der aktuellen Seiten zeigen ebenso nur auf Anker, die es gibt
// (Plan #1652, A10): Mit der neuen Einstiegsseite sind Anker entfallen, und fuer sie gibt es
// keine Weiterleitung (E8).

/** Die aktuellen Seiten in beiden Sprachen, ohne die der Liste `historisch`. */
function aktuelleSeiten() {
  const { historisch } = JSON.parse(readFileSync(join(repoRoot, "docs-site", "sprachen.json"), "utf-8"));
  const namen = readdirSync(DOCS).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)).filter((n) => !historisch.includes(n));
  return namen.flatMap((n) => [n, `en/${n}`]).filter((s) => existsSync(join(DOCS, `${s}.md`)));
}

/** Die Seite, auf die ein Link-Ziel von `seite` aus zeigt: absolut, relativ oder dieselbe. */
function zielSeite(seite, ziel) {
  const name = ziel.replace(/^\.\//, "").replace(/\.md$/, "");
  if (name.startsWith("/")) return name.slice(1);
  if (name === "") return seite;
  return (seite.startsWith("en/") ? "en/" : "") + name;
}

/** Die Ziele `seite#anker` der Markdown-Links einer Seite, Codebloecke ausgenommen. */
function textLinks(seite, markdown) {
  const ziele = [];
  let imCode = false;
  for (const zeile of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(zeile)) imCode = !imCode;
    if (imCode) continue;
    for (const [, ziel, anker] of zeile.matchAll(/\]\(([^)#\s]*)#([^)\s]+)\)/g)) {
      if (!/^[a-z]+:/.test(ziel)) ziele.push({ seite: zielSeite(seite, ziel), anker });
    }
  }
  return ziele;
}

function toteTextAnker(seiten, seiteLesen) {
  const tot = [];
  for (const seite of seiten) {
    for (const { seite: ziel, anker } of textLinks(seite, seiteLesen(seite))) {
      const markdown = seiteLesen(ziel);
      if (markdown === null) tot.push(`docs/${seite}.md → ${ziel}#${anker}: Seite fehlt`);
      else if (!ankerDerSeite(markdown).has(anker)) tot.push(`docs/${seite}.md → ${ziel}#${anker}: kein solcher Anker`);
    }
  }
  return tot;
}

test("jeder Anker-Verweis im Text der aktuellen Seiten zeigt auf eine Ueberschrift", () => {
  assert.ok(aktuelleSeiten().includes("en/dokumentation"));
  assert.deepEqual(toteTextAnker(aktuelleSeiten(), echteSeite), []);
});

test("Gegenprobe: ein relativer Verweis auf einen entfallenen Anker wird als tot erkannt", () => {
  const seiten = { quickstart: "[Bahnen](./dokumentation.md#leitplanken-gibt-es-nicht)", "en/quickstart": "[lanes](./dokumentation.md#three-lanes)" };
  const lesen = (s) => seiten[s] ?? echteSeite(s);
  assert.deepEqual(toteTextAnker(Object.keys(seiten), lesen), [
    "docs/quickstart.md → dokumentation#leitplanken-gibt-es-nicht: kein solcher Anker",
  ]);
});
