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

/** Eine Zeile ohne Inline-Code, Autolinks und Mail-Adressen — alles, was kein Template ist. */
function ohneCode(zeile) {
  return zeile
    .replaceAll(/(`+)(.*?)\1/g, "")
    .replaceAll(/<(?:https?:\/\/|mailto:)[^>\s]*>/g, "")
    .replaceAll(/<[^>\s@]+@[^>\s]+>/g, "");
}

/**
 * Eine Zeile ohne ihre HTML-Kommentare, samt dem Zustand am Zeilenende.
 *
 * Getilgt wird erst, NACHDEM der Inline-Code der Zeile weg ist (Issue #824, Fund 4.4):
 * Ein `<!--` in Backticks ist Text und kein Kommentaranfang. Innerhalb eines Kommentars
 * bleibt der Code stehen, wie er ist — dort gibt es keine Code-Spans, und ein Backtick
 * im Kommentar paarte sonst mit einem hinter dem `-->`.
 */
function ohneKommentar(zeile, imKommentar) {
  let rest = zeile;
  let drin = imKommentar;
  let raus = "";
  for (;;) {
    if (drin) {
      const ende = rest.indexOf("-->");
      if (ende === -1) return { text: raus, imKommentar: true };
      rest = rest.slice(ende + 3);
      drin = false;
    }
    const sichtbar = ohneCode(rest);
    const start = sichtbar.indexOf("<!--");
    if (start === -1) return { text: raus + sichtbar, imKommentar: false };
    raus += sichtbar.slice(0, start);
    rest = sichtbar.slice(start + 4);
    drin = true;
  }
}

/**
 * Der Text einer Datei ohne alles, was der Vue-Compiler nicht als Template liest:
 * Code-Bloecke, Inline-Code, HTML-Kommentare und Autolinks.
 *
 * Zeilenweise, damit Inline-Code nicht ueber Absatzgrenzen hinweg zusammenfaellt: Ein
 * `\`` am Anfang einer Datei und eines am Ende verschluckten sonst alles dazwischen —
 * und ein Test, der nichts mehr sieht, ist immer gruen. Zeilenweise auch, damit jede
 * Zeile ihre Nummer behaelt: Ein mehrzeiliger Kommentar vorweg zu tilgen schob jeden
 * Fund dahinter nach oben.
 */
function nurTemplate(text) {
  const raus = [];
  let zaun = null;
  let imKommentar = false;
  for (const zeile of text.split("\n")) {
    // Im Kommentar eroeffnet keine Zeile einen Zaun: Was dort steht, ist verdeckt.
    const treffer = imKommentar ? null : zeile.match(/^\s*(`{3,}|~{3,})/);
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
    const { text: ohne, imKommentar: danach } = ohneKommentar(zeile, imKommentar);
    imKommentar = danach;
    raus.push(ohne);
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

test("ein Kommentar-Zeichen in Inline-Code eroeffnet keinen Kommentar", () => {
  // Issue #824, Fund 4.4: Wurden HTML-Kommentare VOR Zaeunen und Inline-Code entfernt,
  // sah der Pruefer das in Backticks gesetzte `<!--` als Kommentaranfang, verschluckte
  // alles bis zum ebenso gesetzten `-->` — und fand das nackte `<ID>` dazwischen nicht.
  const text = "Kommentar `<!--`\n<ID>\nund `-->` hier.";
  assert.deepEqual(fremdeTags(text).map((f) => f.tag), ["<ID>"]);
  assert.equal(fremdeTags(text)[0].zeile, 2, "die Zeilennummer des Fundes stimmt nicht");
});

test("ein mehrzeiliger Kommentar verschiebt die Zeilennummern nicht", () => {
  // Vorher wurden Kommentare samt ihrer Zeilenumbrueche getilgt: Nach einem
  // mehrzeiligen Kommentar zeigte jeder Fund auf eine zu kleine Zeile.
  const text = "<!--\nverdeckt\n-->\n<ID> steht hier.";
  assert.deepEqual(fremdeTags(text).map((f) => f.tag), ["<ID>"]);
  assert.equal(fremdeTags(text)[0].zeile, 4, "die Zeilennummer des Fundes stimmt nicht");
});

test("ein mehrzeiliger Kommentar verdeckt weiterhin, was in ihm steht", () => {
  assert.deepEqual(fremdeTags("<!--\n<ID>\n-->"), []);
  assert.deepEqual(fremdeTags("Davor <!-- <ID>\nnoch drin\n--> und <Danach> dahinter."), [{ zeile: 3, tag: "<Danach>" }]);
  assert.deepEqual(fremdeTags("```\n<!--\n```\n<ID> steht ausserhalb.").map((f) => f.tag), ["<ID>"],
    "ein Kommentaranfang im Code-Zaun darf nichts dahinter verdecken");
});
