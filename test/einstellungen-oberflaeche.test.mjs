// Die Seite der Einstellungs-Oberflaeche (Issue #678, Plan #674 E12, E13).
//
// Sie laedt nichts von fremden Servern: Schriften liegen eingebettet vor, und die
// Antwort traegt eine Content-Security-Policy ohne fremde Hosts. Das Token kommt aus dem
// URL-Fragment und geht nur als Kopfzeile an die API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SCHRIFTEN } from "../kit/einstellungen.mjs";
import { mitServer, projekt } from "./helpers/einstellungen-fixture.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function seite() {
  return mitServer((w) => projekt(w, "alpha", { stand: "1.0.0" }), async ({ basis }) => {
    const res = await fetch(`${basis}/`);
    return { status: res.status, csp: res.headers.get("content-security-policy"), html: await res.text() };
  });
}

test("[einstellungen-7] die Seite laedt nichts von fremden Servern", async () => {
  const { status, html } = await seite();
  assert.equal(status, 200);
  const ohneKommentare = html.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(ohneKommentare, /https?:\/\//, "eine URL ausserhalb eines Lizenzkommentars");
  assert.doesNotMatch(html, /rel="preconnect"/);
  assert.doesNotMatch(html, /@import/);
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
});

test("[einstellungen-7] drei Schriftfamilien liegen als eingebettete woff2 vor", async () => {
  const { html } = await seite();
  for (const familie of ["IBM Plex Sans", "IBM Plex Mono", "Archivo"]) {
    assert.match(html, new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${familie}"[^}]*src:\\s*url\\(data:font/woff2;base64,`), `${familie} fehlt`);
  }
});

test("[einstellungen-7] die eingebetteten Schriften gleichen den Dateien unter assets/fonts", () => {
  for (const [datei, b64] of Object.entries(SCHRIFTEN)) {
    const quelle = readFileSync(join(repoRoot, "assets", "fonts", datei));
    assert.equal(b64, quelle.toString("base64"), `${datei} weicht ab`);
  }
  assert.equal(Object.keys(SCHRIFTEN).length, 5);
});

test("[einstellungen-7] die hellen Farben der Kupferwarte, kein dunkles Schema", async () => {
  const { html } = await seite();
  for (const [name, wert] of [["--grund", "#E7E9ED"], ["--platte", "#FDFDFE"], ["--text", "#14181E"], ["--kupfer", "#A85F2C"]]) {
    assert.match(html, new RegExp(`${name}:\\s*${wert};`), `${name} fehlt`);
  }
  assert.doesNotMatch(html, /prefers-color-scheme:\s*dark/);
});

test("[einstellungen-7] die Seite liest das Token aus dem Fragment und sendet es als Kopfzeile", async () => {
  const { html } = await seite();
  assert.match(html, /location\.hash/);
  assert.match(html, /X-Einstellungen-Token/);
});

test("[einstellungen-7] die Antwort traegt eine Content-Security-Policy ohne fremde Hosts", async () => {
  const { csp } = await seite();
  assert.ok(csp, "keine Content-Security-Policy");
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /https?:|\*/);
});

test("[einstellungen-7] kit/einstellungen.mjs bleibt unter 1.500.000 Byte", () => {
  assert.ok(statSync(join(repoRoot, "kit", "einstellungen.mjs")).size < 1_500_000);
});
