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
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(repoRoot, "docs-site", ".vitepress", "config.ts");
const DOCS = join(repoRoot, "docs");

/**
 * Der Anker einer Ueberschrift, nachgebildet nach VitePress: Unicode NFKD, Akzente weg,
 * klein, jede Folge anderer Zeichen als Buchstabe und Ziffer wird `-`, `-` am Rand weg.
 */
function slug(ueberschrift) {
  return ueberschrift
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
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

test("slug entfernt Umlaut-Punkte statt sie umzuschreiben", () => {
  assert.equal(slug("Die zwölf Skills"), "die-zwolf-skills");
});

test("die Sidebar traegt Links mit Anker — sonst prueft dieser Test nichts", () => {
  assert.ok(ankerLinks(readFileSync(CONFIG, "utf-8")).length > 0);
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
