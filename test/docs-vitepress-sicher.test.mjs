// Die Nutzerdoku muss durch den VitePress-Build gehen (Issue #792).
//
// VitePress uebersetzt jede Markdown-Datei unter `docs/` in eine Vue-Komponente. Der
// Vue-Compiler liest darin jedes `<Wort>` als Element: Ist der Name kein HTML-Element,
// gilt er als Komponente, und ohne End-Tag bricht der Build mit "Element is missing end
// tag" ab. Genau das ist passiert — die erzeugte Einstellungs-Referenz trug die Zeile
// `Regulaerer Ausdruck mit dem Platzhalter <ID>, …`, und docs.mwolff.org stand danach
// vier Tage still, weil gebaut nur beim Push auf `production` wird.
//
// Geprueft wird deshalb hier, ohne Abhaengigkeit von `docs-site/`: Die bekannte
// Fehlerklasse faellt in der normalen Suite auf, nicht erst im Release. Der Build selbst
// bleibt der harte Nachweis, dieser Test ist der fruehe.
//
// Nicht geprueft wird das fehlende End-Tag eines echten HTML-Elements (`<div>` allein):
// Das ist eine andere Fehlerklasse, sie ist hier nie aufgetreten, und ein Test darauf
// brauchte einen Parser statt einer Liste.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(repoRoot, "docs");

// Was VitePress baut: jede `.md` unter `srcDir` (`../docs`, siehe
// docs-site/.vitepress/config.ts). `node_modules` und `public` gehoeren nicht dazu.
const NICHT_GEBAUT = new Set(["node_modules", "public"]);

/** Alle Markdown-Dateien, die VitePress uebersetzt — rekursiv, repo-relativ. */
function markdownDateien(verzeichnis) {
  const gefunden = [];
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    if (eintrag.isDirectory()) {
      if (NICHT_GEBAUT.has(eintrag.name)) continue;
      gefunden.push(...markdownDateien(join(verzeichnis, eintrag.name)));
    } else if (eintrag.name.endsWith(".md")) {
      gefunden.push(join(verzeichnis, eintrag.name));
    }
  }
  return gefunden;
}

// Die HTML-Elemente, die der Vue-Compiler als solche kennt und nicht als Komponente
// behandelt. Bewusst eine Liste und kein Muster: Ein Muster liesse sich erweitern, bis es
// alles durchlaesst — und genau das soll hier nicht passieren.
const HTML_ELEMENTE = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio",
  "b", "base", "bdi", "bdo", "blockquote", "body", "br", "button",
  "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt",
  "em", "embed", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html",
  "i", "iframe", "img", "input", "ins", "kbd", "label", "legend", "li", "link",
  "main", "map", "mark", "menu", "meta", "meter", "nav", "noscript",
  "object", "ol", "optgroup", "option", "output",
  "p", "param", "picture", "pre", "progress",
  "q", "rp", "rt", "ruby", "s", "samp", "script", "section", "select", "slot", "small",
  "source", "span", "strong", "style", "sub", "summary", "sup",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time",
  "title", "tr", "track", "u", "ul", "var", "video", "wbr",
  // SVG und MathML, soweit sie in Fliesstext vorkommen koennten.
  "svg", "path", "circle", "rect", "line", "polygon", "polyline", "g", "text", "math",
]);

/**
 * Der Text einer Datei ohne alles, was der Vue-Compiler nicht als Template liest:
 * Code-Bloecke, Inline-Code, HTML-Kommentare und Autolinks.
 *
 * Zeilenweise, damit Inline-Code nicht ueber Absatzgrenzen hinweg zusammenfaellt: Ein
 * `\`` am Anfang einer Datei und eines am Ende verschluckten sonst alles dazwischen —
 * und ein Test, der nichts mehr sieht, ist immer gruen.
 */
function nurTemplate(text) {
  const ohneKommentare = text.replaceAll(/<!--[\s\S]*?-->/g, "");
  const zeilen = ohneKommentare.split("\n");
  const raus = [];
  let zaun = null;
  for (const zeile of zeilen) {
    const treffer = zeile.match(/^\s*(`{3,}|~{3,})/);
    if (zaun) {
      if (treffer && treffer[1][0] === zaun[0] && treffer[1].length >= zaun.length) zaun = null;
      raus.push("");
      continue;
    }
    if (treffer) {
      zaun = treffer[1];
      raus.push("");
      continue;
    }
    raus.push(
      zeile
        .replaceAll(/(`+)(.*?)\1/g, "")
        .replaceAll(/<(?:https?:\/\/|mailto:)[^>\s]*>/g, "")
        .replaceAll(/<[^>\s@]+@[^>\s]+>/g, "")
    );
  }
  return raus;
}

/** Jeder Tag-Name, der kein HTML-Element ist, mit Zeilennummer. */
function fremdeTags(text) {
  const funde = [];
  nurTemplate(text).forEach((zeile, i) => {
    for (const m of zeile.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9-]*)/g)) {
      if (!HTML_ELEMENTE.has(m[2].toLowerCase())) funde.push({ zeile: i + 1, tag: `<${m[1]}${m[2]}>` });
    }
  });
  return funde;
}

test("keine gebaute Markdown-Datei traegt ein nacktes Tag ausserhalb von Code", () => {
  const mangel = [];
  for (const datei of markdownDateien(DOCS)) {
    for (const fund of fremdeTags(readFileSync(datei, "utf-8"))) {
      mangel.push(`${relative(repoRoot, datei)}:${fund.zeile} — ${fund.tag}`);
    }
  }
  assert.deepEqual(
    mangel,
    [],
    `Diese Stellen brechen den VitePress-Build ("Element is missing end tag").\n`
      + `In Backticks setzen oder ausschreiben:\n${mangel.join("\n")}`
  );
});

test("der Pruefer erkennt ein nacktes Tag und laesst Code und Autolinks in Ruhe", () => {
  // Ohne diesen Test waere ein Pruefer, der nichts mehr findet, nicht von einer sauberen
  // Doku zu unterscheiden.
  assert.deepEqual(fremdeTags("Der Platzhalter <ID> steht hier.").map((f) => f.tag), ["<ID>"]);
  assert.deepEqual(fremdeTags("Der Platzhalter `<ID>` steht hier."), []);
  assert.deepEqual(fremdeTags("Doppelt: `` `<ID>` `` steht hier."), []);
  assert.deepEqual(fremdeTags("```\n<ID>\n```\n"), []);
  assert.deepEqual(fremdeTags("~~~js\n<ID>\n~~~\n"), []);
  assert.deepEqual(fremdeTags("<https://docs.mwolff.org/install.mjs>"), []);
  assert.deepEqual(fremdeTags("<!-- <ID> -->"), []);
  assert.deepEqual(fremdeTags("Ein <br> und ein <details> sind erlaubt."), []);
  assert.deepEqual(fremdeTags("Ein Zaun im Zaun:\n````\n```\n<ID>\n```\n````\n"), []);
});
