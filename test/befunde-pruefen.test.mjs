// Die Formpruefung der Funde (Issue #799, Plan #797, Fachliche Quelle #768).
//
// `pruefen` liest einen Befunde-Text und meldet je Fund, welche der drei Pflichtangaben
// aus „Befunde der Modell-Pruefungen" (templates/CLAUDE-workflow.md) fehlt: die
// `Gegenprobe:`-Zeile, ihr Stand oder die `Art:`-Zeile mit einem Namen aus der festen
// Liste.
//
// ZWEI ZUSAGEN STEHEN GEGENEINANDER UND GELTEN BEIDE:
//
// 1. Aus der Form wird kein Gate. Ein Fund ohne Angabe haelt nichts auf, also endet
//    `pruefen` auch mit lauter unvollstaendigen Funden mit Exit 0. Ungleich 0 wird es
//    nur, wenn der Aufruf selbst nicht geht — fehlendes `--datei`, fehlende oder
//    unlesbare Datei.
// 2. Die Ausgabe ist immer JSON, auch in diesen Fehlerfaellen.
//
// GRAMMATIK DES FUNDBLOCKS: Ein Marken-Abschnitt beginnt bei einer der vier
// Schweregrad-Marken und endet vor der naechsten Marke oder vor der naechsten
// Ueberschrift ohne Marke. Innerhalb eines Abschnitts beginnt jede fette Kopfzeile
// einen eigenen Fund — die Altbestaende des Kits fuehren die Marke als
// Gruppenueberschrift ueber mehreren Funden (siehe den Plan-Review von Issue #797),
// und ohne diese Unterteilung zaehlte ein Abschnitt mit sechs Funden als einer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEFUNDE = join(repoRoot, "kit", "befunde.mjs");

/** Ein vollstaendiger Fund in der Form aus dem Regeltext. */
const VOLLSTAENDIG = [
  "#### WICHTIG",
  "",
  "**W1 — Der Plan nennt zwei Orte fuer dieselbe Liste.**",
  "Fundstelle: Abschnitt „Geplante Aenderungen\".",
  "Gegenprobe: Ein zweiter Ort in skills/ — kein Treffer. — geprueft, bestaetigt",
  "Art: doppelung",
  "Vorschlag: Die Liste nur im Kommando fuehren.",
].join("\n");

/** Fuehrt `pruefen` gegen einen Text aus und gibt das geparste JSON zurueck. */
function pruefe(text, nachher) {
  const dir = mkdtempSync(join(tmpdir(), "befunde-pruefen-"));
  try {
    const datei = join(dir, "befunde.md");
    writeFileSync(datei, text, "utf-8");
    const res = spawnSync(process.execPath, [BEFUNDE, "pruefen", "--datei", datei], { cwd: dir, encoding: "utf-8" });
    nachher(res, JSON.parse(res.stdout), datei);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("pruefen erkennt alle vier Schweregrad-Marken als je einen Fundblock", () => {
  const text = [
    "#### KRITISCH",
    "Fundstelle: a",
    "",
    "#### BLOCKER",
    "Fundstelle: b",
    "",
    "#### WICHTIG",
    "Fundstelle: c",
    "",
    "#### HINWEIS",
    "Fundstelle: d",
  ].join("\n");

  pruefe(text, (res, json) => {
    assert.equal(res.status, 0, `die Formpruefung ist kein Gate: ${res.stderr}`);
    assert.equal(json.ok, true);
    assert.deepEqual(json.funde.map((f) => f.marke), ["KRITISCH", "BLOCKER", "WICHTIG", "HINWEIS"]);
  });
});

test("pruefen meldet je fehlender Angabe genau einen Eintrag und endet mit Exit 0", () => {
  const text = ["#### BLOCKER", "**B1 — Ohne jede Angabe.**", "Fundstelle: irgendwo"].join("\n");

  pruefe(text, (res, json) => {
    assert.equal(res.status, 0);
    assert.equal(json.funde.length, 1);
    assert.deepEqual(json.funde[0].fehlt, ["gegenprobe", "stand", "art"]);
    assert.equal(json.eintraege.length, 3, "drei fehlende Angaben, drei Eintraege");
    assert.deepEqual(json.eintraege.map((e) => e.angabe), ["gegenprobe", "stand", "art"]);
    for (const eintrag of json.eintraege) {
      assert.equal(eintrag.fund, 1);
      assert.equal(eintrag.marke, "BLOCKER");
      assert.ok(eintrag.meldung.length > 0, "jeder Eintrag traegt eine Meldung");
    }
    assert.equal(json.unvollstaendig, 1);
    assert.equal(json.vollstaendig, 0);
  });
});

test("ein vollstaendiger Fund erzeugt keinen Eintrag", () => {
  pruefe(VOLLSTAENDIG, (res, json) => {
    assert.equal(res.status, 0);
    assert.equal(json.funde.length, 1);
    assert.deepEqual(json.funde[0].fehlt, []);
    assert.equal(json.eintraege.length, 0);
    assert.equal(json.vollstaendig, 1);
    assert.equal(json.unvollstaendig, 0);
  });
});

test("'nicht geprueft' ist ein gueltiger Stand der Gegenprobe", () => {
  // Beide Staende zaehlen als Angabe: Die Form verlangt Auskunft darueber, ob jemand
  // nachgesehen hat — nicht, dass jemand nachgesehen hat.
  const text = VOLLSTAENDIG.replace("— geprueft, bestaetigt", "— nicht geprueft");

  pruefe(text, (res, json) => {
    assert.deepEqual(json.funde[0].fehlt, []);
  });
});

test("ein Fund mit 'Art: erfunden' wird als fehlende Art gemeldet", () => {
  const text = VOLLSTAENDIG.replace("Art: doppelung", "Art: erfunden");

  pruefe(text, (res, json) => {
    assert.deepEqual(json.funde[0].fehlt, ["art"]);
    assert.equal(json.eintraege.length, 1);
    assert.match(json.eintraege[0].meldung, /erfunden/,
      "die Meldung nennt den vorgefundenen Namen nicht");
  });
});

test("ein Fund mit 'Gegenprobe: X — vielleicht' wird als fehlender Stand gemeldet", () => {
  const text = VOLLSTAENDIG.replace(
    "Gegenprobe: Ein zweiter Ort in skills/ — kein Treffer. — geprueft, bestaetigt",
    "Gegenprobe: Ein zweiter Ort in skills/ — vielleicht");

  pruefe(text, (res, json) => {
    assert.deepEqual(json.funde[0].fehlt, ["stand"],
      "die Gegenprobe steht da, nur ihr Stand fehlt");
    assert.equal(json.eintraege.length, 1);
  });
});

test("mehrere Funde unter einer Marke zaehlen einzeln", () => {
  // Die Form der Altbestaende: eine Marke als Gruppenueberschrift, darunter mehrere
  // fette Fund-Kopfzeilen.
  const text = [
    "#### WICHTIG",
    "",
    "**W1 — Erster Fund.**",
    "Fundstelle: a",
    "Gegenprobe: Nachgesehen in kit/board.mjs. — geprueft, bestaetigt",
    "Art: luecke",
    "",
    "**W2 — Zweiter Fund.**",
    "Fundstelle: b",
    "",
    "**W3 — Dritter Fund.**",
    "Fundstelle: c",
    "Art: korrektheit",
  ].join("\n");

  pruefe(text, (res, json) => {
    assert.equal(json.funde.length, 3);
    assert.deepEqual(json.funde.map((f) => f.fehlt), [[], ["gegenprobe", "stand", "art"], ["gegenprobe", "stand"]]);
    assert.equal(json.eintraege.length, 5);
    assert.match(json.funde[1].titel, /W2/, "der Titel des Funds fehlt");
    assert.ok(json.funde[1].zeile > json.funde[0].zeile, "die Zeilennummer fehlt oder steht falsch");
  });
});

test("eine Marke mitten im Fliesstext eroeffnet keinen Fund", () => {
  // Aus dem echten Plan-Review von Issue #797: Der Abschnitt „Geprueft ohne Befund"
  // zaehlt die gelesenen Stellen auf und nennt dabei die Marken. Zaehlte das als Fund,
  // meldete die Pruefung einen Mangel an einem Absatz, der gar kein Fund ist.
  const text = [
    "#### HINWEIS",
    "**H1 — Ein Fund.**",
    "Fundstelle: a",
    "",
    "#### Geprueft ohne Befund",
    "Nachgesehen: die Rollen-Prompts mit „Schweregrad BLOCKER / WICHTIG / HINWEIS\" und /review mit KRITISCH.",
  ].join("\n");

  pruefe(text, (res, json) => {
    assert.equal(json.funde.length, 1, "der Fliesstext wurde als Fund gelesen");
    assert.equal(json.funde[0].marke, "HINWEIS");
  });
});

test("ein Text ohne jede Marke ergibt keine Funde und bleibt gruen", () => {
  pruefe("## Review\n\nAlles in Ordnung, nichts gefunden.\n", (res, json) => {
    assert.equal(res.status, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(json.funde, []);
    assert.deepEqual(json.eintraege, []);
  });
});

test("pruefen ohne --datei gibt JSON aus und endet ungleich 0", () => {
  const res = spawnSync(process.execPath, [BEFUNDE, "pruefen"], { cwd: repoRoot, encoding: "utf-8" });

  assert.notEqual(res.status, 0);
  const json = JSON.parse(res.stdout);
  assert.equal(json.ok, false);
  assert.match(json.fehler, /--datei/);
});

test("eine fehlende Datei endet ungleich 0 und gibt trotzdem JSON aus", () => {
  const dir = mkdtempSync(join(tmpdir(), "befunde-fehlt-"));
  try {
    const res = spawnSync(process.execPath, [BEFUNDE, "pruefen", "--datei", join(dir, "gibtsnicht.md")],
      { cwd: dir, encoding: "utf-8" });

    assert.notEqual(res.status, 0, "eine fehlende Datei ist ein Aufruffehler, kein leerer Befund");
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    assert.match(json.fehler, /gibtsnicht\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("eine unlesbare Datei — ein Verzeichnis — endet ungleich 0 und gibt JSON aus", () => {
  const dir = mkdtempSync(join(tmpdir(), "befunde-unlesbar-"));
  try {
    const res = spawnSync(process.execPath, [BEFUNDE, "pruefen", "--datei", dir], { cwd: dir, encoding: "utf-8" });

    assert.notEqual(res.status, 0);
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, false);
    assert.ok(json.fehler.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Portabilitaet: aus einem leeren Verzeichnis heraus laufen beide Kommandos", () => {
  // Das Kit liefert seine Werkzeuge als eigenstaendig portable Einzeldateien aus: kein
  // Repo-Kontext, keine Nachbardatei, keine Config. Ein Import auf eine Datei des
  // Kit-Repos faellt hier sofort auf.
  const dir = mkdtempSync(join(tmpdir(), "befunde-portabel-"));
  try {
    const kopie = join(dir, "befunde.mjs");
    copyFileSync(BEFUNDE, kopie);
    const datei = join(dir, "befunde.md");
    writeFileSync(datei, VOLLSTAENDIG, "utf-8");

    const arten = spawnSync(process.execPath, [kopie, "arten"], { cwd: dir, encoding: "utf-8" });
    assert.equal(arten.status, 0, `arten lief nicht ohne Repo-Kontext: ${arten.stderr}`);
    assert.equal(JSON.parse(arten.stdout).anzahl, 12);

    const pruefen = spawnSync(process.execPath, [kopie, "pruefen", "--datei", datei], { cwd: dir, encoding: "utf-8" });
    assert.equal(pruefen.status, 0, `pruefen lief nicht ohne Repo-Kontext: ${pruefen.stderr}`);
    assert.equal(JSON.parse(pruefen.stdout).funde.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
