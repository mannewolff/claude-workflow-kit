// Texte nennen Praefixe, Labels und Skill-Namen englisch (Issue #1553, Plan #1548 E15).
//
// Jeder Text unter kit/texte/ und jeder Text des Nachtlaufs nennt in beiden Sprachen die
// englischen Namen: `[Requirement]` statt `[Fachlich]`, `kit:clarify` statt `kit:klaeren`,
// `/requirement` statt `/fachplan`, `/kit-review` im Morgenritual. Erkannt werden die alten
// Namen weiter — auch der alte Wortlaut des Halt-Folgesatzes, damit offene Karten
// weiterlaufen (Kriterium 10).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { markerName } from "../kit/board/namen.mjs";
import { HALT_FOLGESATZ, KLAEREN_LABEL, istHalt } from "../kit/night/wartend.mjs";

const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "kit");
const TEXTE_DIR = join(KIT_DIR, "texte");
// Die Texte des Einstiegs stehen in kit/night.mjs selbst. Ein leichter Test laedt den Einstieg
// nicht (test/checks-leichtigkeit.test.mjs), darum als Quelltext, ohne Kommentarzeilen.
const NACHT_QUELLE = readFileSync(join(KIT_DIR, "night.mjs"), "utf-8").split("\n")
  .filter((z) => !/^\s*(\*|\/\/|\/\*\*)/.test(z));

// Die deutschen Namen, die kein Text mehr nennt.
const DEUTSCH = /\/fachplan|\/kontext|\/review\b|\[Fachlich\]|\[Idee\]|\[Mensch\]|kit:klaeren|kit:geschuetzt|kit:pruefen|kit:durchziehen|review:fertig|lauf:(laeuft|abgebrochen|wartet)|ziel:(plan|pakete|umsetzung|push)/;

/** Jeder Text einer Tabelle `{ de, en }` als `[sprache, schluessel, text]`. */
function texteVon(tabelle) {
  return Object.entries(tabelle).flatMap(([sprache, eintraege]) => Object.entries(eintraege)
    .map(([schluessel, wert]) => [sprache, schluessel, typeof wert === "string" ? wert : JSON.stringify(wert)]));
}

test("kein Text unter kit/texte/ nennt einen deutschen Namen", async () => {
  const funde = [];
  for (const datei of readdirSync(TEXTE_DIR).filter((d) => d.endsWith(".mjs"))) {
    const { TEXTE } = await import(pathToFileURL(join(TEXTE_DIR, datei)).href);
    if (!TEXTE) continue;
    for (const [sprache, schluessel, text] of texteVon(TEXTE)) {
      const treffer = text.match(DEUTSCH);
      if (treffer) funde.push(`${datei} ${sprache}.${schluessel}: ${treffer[0]}`);
    }
  }
  assert.deepEqual(funde, []);
});

test("kein Text des Nachtlaufs nennt einen deutschen Namen", () => {
  assert.deepEqual(NACHT_QUELLE.filter((z) => DEUTSCH.test(z)), []);
});

test("das Morgenritual nennt /kit-review in beiden Sprachen", () => {
  const zeilen = NACHT_QUELLE.filter((z) => /^\s*morgenRitual:/.test(z));
  assert.equal(zeilen.length, 2, zeilen.join("\n"));
  assert.match(zeilen[0], /Morgen-Ritual: \/kit-review -> Test -> push main/);
  assert.match(zeilen[1], /Morning ritual: \/kit-review -> test -> push main/);
});

test("die Idee verweist in beiden Sprachen auf /requirement", async () => {
  const { TEXTE } = await import(pathToFileURL(join(TEXTE_DIR, "night-wartend.mjs")).href);
  assert.match(TEXTE.de.gateIdee, /\/requirement #\{id\}/);
  assert.match(TEXTE.en.gateIdee, /\/requirement #\{id\}/);
});

// --- Halt-Folgesatz: der neue Wortlaut, der alte wird erkannt (E15) ---

const ALT = "Daraus soll per /fachplan eine fachliche Anforderung entstehen.";
const haltKarte = (text) => ({ status: "backlog", labels: [KLAEREN_LABEL], comments: [{ body: `Frage.\n\n${text}` }] });

test("HALT_FOLGESATZ nennt /requirement und gleicht dem Register", () => {
  assert.equal(HALT_FOLGESATZ, "Daraus soll per /requirement eine fachliche Anforderung entstehen.");
  assert.equal(HALT_FOLGESATZ, markerName("haltFolgesatz", "de"));
});

test("ein Halt mit dem alten, dem deutschen oder dem englischen Folgesatz wird erkannt", () => {
  for (const satz of [ALT, HALT_FOLGESATZ, markerName("haltFolgesatz", "en")]) {
    assert.equal(istHalt({ comments: [] }, haltKarte(satz)), "klaeren", satz);
  }
  assert.equal(istHalt({ comments: [] }, haltKarte("Nur eine Frage.")), null);
});
