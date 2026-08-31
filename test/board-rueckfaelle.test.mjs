// Die Rueckfaelle der reinen Funktionen in kit/board.mjs (Issue #405).
//
// Jede dieser Funktionen hat einen Weg fuer den Normalfall und einen fuer das, was
// fehlen kann — ein leeres Feld, eine leere Liste, ein nicht gesetzter Wert. Der
// zweite Weg war bisher nirgends festgehalten.
//
// Das ist kein Selbstzweck: Die Rueckfaelle entscheiden, ob eine Luecke zu einer
// leeren Angabe wird (richtig) oder zu `undefined` im Text (falsch, und am Board
// erst Tage spaeter sichtbar).

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  normalizeRepoName,
  normalizeComments,
  resolveKontextPaths,
  pickNoteFile,
  pickLatestLog,
  pickReviewers,
  pruefvorgabeDurchsetzen,
  leseTextQuelle,
} from "../kit/board.mjs";

// ============================================================
// normalizeRepoName: was kein Repository-Name ist
// ============================================================

test("normalizeRepoName liefert null, wo kein Name uebrig bleibt", () => {
  // Jeder dieser Werte kommt real vor: `git remote get-url` in einem Repo ohne
  // origin liefert nichts, und eine URL ohne Pfad ist ein halb konfiguriertes Remote.
  for (const roh of [null, undefined, "", "   ", ".git", "  .git  "]) {
    assert.equal(normalizeRepoName(roh), null, `'${roh}' haette null ergeben muessen`);
  }
});

test("normalizeRepoName liefert null, wenn nach dem Host kein Segment folgt", () => {
  // Ein Remote, das nur auf den Host zeigt: Es gibt keinen Namen zu bilden, und
  // einen zu erfinden waere schlimmer als die Auskunft "keiner".
  assert.equal(normalizeRepoName("https://github.com/"), null);
});

test("normalizeRepoName behaelt ein einzelnes Segment, ohne Owner zu erfinden", () => {
  assert.equal(normalizeRepoName("https://example.org/nur-repo"), "nur-repo");
  assert.equal(normalizeRepoName("git@host:nur-repo.git"), "nur-repo");
});

// ============================================================
// normalizeComments: Kommentare mit fehlenden Feldern
// ============================================================

test("normalizeComments faengt jede Form ab, in der ein Feld fehlt", () => {
  const roh = [
    { author: { login: "mit-login" }, body: "a", createdAt: "2026-01-01" },
    { author: { username: "mit-username" }, body: "b", created_at: "2026-01-02" },
    { author: "flacher-string", body: "c" },
    { author: {}, body: "d" },              // Objekt ohne beide Namensfelder
    { body: "e" },                           // gar kein Autor
    { author: "x", body: "" },               // leerer Body faellt heraus
    { author: "x" },                         // fehlender Body ebenso
    { author: "x", body: "f", system: true }, // System-Notiz faellt heraus
    null,
    "kein Objekt",
  ];

  const k = normalizeComments(roh);

  assert.deepEqual(k.map((c) => c.body), ["a", "b", "c", "d", "e"],
    "es wurden andere Kommentare behalten als erwartet");
  assert.deepEqual(k.map((c) => c.author),
    ["mit-login", "mit-username", "flacher-string", "", ""],
    "ein fehlender Autor muss ein leerer Text werden, nie 'undefined'");
  assert.equal(k[0].createdAt, "2026-01-01");
  assert.equal(k[1].createdAt, "2026-01-02", "die snake_case-Form wurde nicht gelesen");
  assert.equal(k[2].createdAt, "", "ein fehlendes Datum muss ein leerer Text werden");
});

test("normalizeComments liefert eine leere Liste, wo gar keine Liste kam", () => {
  for (const roh of [null, undefined, {}, "text", 7]) {
    assert.deepEqual(normalizeComments(roh), []);
  }
});

// ============================================================
// resolveKontextPaths: die Rueckfaelle der Vault-Pfade
// ============================================================

test("ohne uebergebenes Projekt gilt das aus der Config", () => {
  const p = resolveKontextPaths({ cfg: { vault: "/v", project: "aus-config" }, date: "2026-01-01" });
  assert.equal(p.project, "aus-config");
  assert.equal(p.projectNote, join("/v", "Projekte", "aus-config", "aus-config.md"));
});

test("ohne Projekt an beiden Stellen bleibt der Name leer, statt 'undefined' zu werden", () => {
  const p = resolveKontextPaths({ cfg: { vault: "/v" }, date: "2026-01-01" });
  assert.equal(p.project, "", "ein fehlender Name muss leer bleiben");
  assert.doesNotMatch(p.projectNote, /undefined/, "aus dem fehlenden Namen wurde ein Pfad gebaut");
});

test("ohne uebergebenen Dateinamen wird der Notizname konstruiert", () => {
  // Der Fall der Erstanlage: Die Notiz gibt es noch nicht, der Pfad muss trotzdem
  // stimmen — sonst legt /document sie woanders an, als /kontext sie sucht.
  const p = resolveKontextPaths({ cfg: { vault: "/v" }, project: "kit", date: "2026-01-01" });
  assert.equal(p.projectNote, join("/v", "Projekte", "kit", "kit.md"));
});

test("mit parentProject sammeln sich die Notizen im Ordner des Dach-Projekts", () => {
  const p = resolveKontextPaths({
    cfg: { vault: "/v", parentProject: "system" }, project: "service", date: "2026-01-01",
  });
  assert.equal(p.projectNote, join("/v", "Projekte", "system", "service.md"));
  assert.equal(p.parentNote, join("/v", "Projekte", "system", "system.md"));
});

test("ohne always-Liste in der Config bleibt sie leer", () => {
  const p = resolveKontextPaths({ cfg: { vault: "/v" }, project: "kit", date: "2026-01-01" });
  assert.deepEqual(p.always, []);
});

// ============================================================
// pickNoteFile: keine, eine, mehrere
// ============================================================

test("pickNoteFile: ohne Markdown-Datei gibt es nichts zu waehlen", () => {
  assert.deepEqual(pickNoteFile(["bild.png", "notiz.txt"], "kit.md"), { name: null, kollision: null });
  assert.deepEqual(pickNoteFile([], "kit.md"), { name: null, kollision: null });
  assert.deepEqual(pickNoteFile(null, "kit.md"), { name: null, kollision: null },
    "ein nicht lesbarer Ordner darf nicht werfen");
});

test("pickNoteFile: eine einzelne Notiz gilt auch unter anderem Namen", () => {
  // Alleinstehend heisst: Im Ordner liegt genau eine Notiz, also ist sie gemeint —
  // auch wenn der Vault sie anders benannt hat als das Repo heisst.
  assert.equal(pickNoteFile(["Anders Benannt.md"], "kit.md").name, "Anders Benannt.md");
  // Mit parentProject gilt das NICHT: Dort liegen mehrere Service-Notizen im selben
  // Ordner, und die einzige darf nicht blind als die gesuchte gelten.
  assert.equal(pickNoteFile(["Anders Benannt.md"], "kit.md", { alleinstehend: false }).name, null);
});

test("pickNoteFile: mehrere Notizen ohne Namenstreffer ergeben nichts", () => {
  assert.deepEqual(pickNoteFile(["a.md", "b.md"], "kit.md"), { name: null, kollision: null });
});

test("pickNoteFile: der Name entscheidet unabhaengig von der Schreibweise", () => {
  assert.equal(pickNoteFile(["a.md", "Kit.MD"], "kit.md").name, "Kit.MD");
});

test("pickNoteFile: zwei gleich benannte Notizen sind eine Kollision", () => {
  const r = pickNoteFile(["Kit.md", "kit.md", "anderes.md"], "kit.md");
  assert.equal(r.name, null, "bei einer Kollision darf keine Datei gewaehlt werden");
  assert.deepEqual(r.kollision, ["Kit.md", "kit.md"]);
});

// ============================================================
// pickLatestLog: das Template und seine Rueckfaelle
// ============================================================

test("pickLatestLog nimmt ohne Template das Standardmuster", () => {
  const t = pickLatestLog(["2026-01-01.md", "2026-01-03.md", "notiz.md"], {});
  assert.equal(t.name, "2026-01-03.md", "ohne Template greift Log/{date}.md nicht");
});

test("pickLatestLog trennt die Projekte im gemeinsamen Ordner", () => {
  const dateien = ["2026-01-05-fremd.md", "2026-01-03-kit.md", "2026-01-01-kit.md"];
  const t = pickLatestLog(dateien, { template: "Log/{date}-{project}.md", project: "kit" });
  assert.equal(t.name, "2026-01-03-kit.md",
    "der juengste FREMDE Eintrag waere die falsche Anknuepfung");
});

test("pickLatestLog verwirft erfundene Datumsangaben", () => {
  const t = pickLatestLog(["2026-13-99.md", "2026-01-01.md"], { template: "Log/{date}.md" });
  assert.equal(t.name, "2026-01-01.md", "den 99. des 13. Monats gibt es nicht");
});

test("pickLatestLog liefert null, wo nichts passt", () => {
  assert.equal(pickLatestLog(["notiz.md"], { template: "Log/{date}.md" }), null);
});

test("pickLatestLog nimmt Sonderzeichen im Projektnamen woertlich", () => {
  // Ein Punkt im Namen ist ein Punkt, kein Platzhalter — sonst passte "docs.mwolff"
  // auch auf "docsXmwolff".
  const dateien = ["2026-01-02-docs.mwolff.md", "2026-01-03-docsXmwolff.md"];
  const t = pickLatestLog(dateien, { template: "Log/{date}-{project}.md", project: "docs.mwolff" });
  assert.equal(t.name, "2026-01-02-docs.mwolff.md");
});

// ============================================================
// pickReviewers: leere Listen auf beiden Wegen
// ============================================================

const R = (name) => ({ name, kind: "claude", model: `claude-${name}` });

test("pickReviewers ohne Reviewer-Liste meldet Unterbesetzung statt zu werfen", () => {
  for (const alle of [null, undefined, []]) {
    const r = pickReviewers(alle, "opus", 2, {});
    assert.deepEqual(r.gewaehlt, []);
    assert.equal(r.unterbesetzt, true, "eine leere Liste ist immer unterbesetzt");
    assert.equal(r.quelle, "regel");
  }
});

test("pickReviewers: die Paar-Tabelle greift auch ohne Reviewer-Liste ins Leere", () => {
  // Ein Name in `pairs`, den `reviewers` gar nicht fuehrt: Er wird uebergangen, statt
  // als halb aufgeloester Eintrag durchzurutschen.
  const r = pickReviewers(null, "opus", 2, { opus: ["fable", "sonnet"] });
  assert.deepEqual(r.gewaehlt, []);
  assert.equal(r.unterbesetzt, true);
  assert.equal(r.quelle, "pairs", "die Quelle bleibt die Tabelle, auch wenn sie leer ausgeht");
});

test("pickReviewers: unbekannte Namen in der Paar-Tabelle fallen heraus", () => {
  const r = pickReviewers([R("fable"), R("sonnet")], "opus", 2, { opus: ["fable", "gibt-es-nicht"] });
  assert.deepEqual(r.gewaehlt.map((x) => x.name), ["fable"]);
  assert.equal(r.unterbesetzt, true, "ein fehlender Reviewer muss die Unterbesetzung melden");
});

test("pickReviewers: die Regel nimmt nie den Autor selbst", () => {
  const r = pickReviewers([R("opus"), R("fable"), R("sonnet")], "opus", 2, {});
  assert.deepEqual(r.gewaehlt.map((x) => x.name), ["fable", "sonnet"]);
  assert.equal(r.unterbesetzt, false);
});

// ============================================================
// pruefvorgabeDurchsetzen: Bodies ohne Kontext-Abschnitt
// ============================================================

test("pruefvorgabeDurchsetzen laesst einen Body ohne Kontext-Abschnitt unveraendert", () => {
  // Ohne `## Kontext` gibt es keinen Ort, an dem die Zeile stehen duerfte — dann wird
  // auch keiner erfunden.
  const neu = "Nur Fliesstext, keine Ueberschrift.\n";
  assert.equal(pruefvorgabeDurchsetzen("## Kontext\n\nPruefung: 2\n", neu), neu);
});

test("pruefvorgabeDurchsetzen ruehrt Zeilen in einem Code-Fence nicht an", () => {
  // Ein Issue, das das Format an einem Beispiel zeigt, traegt `Pruefung:` im Fence.
  // Wird die Zeile dort angefasst, veraendert sich der Beispieltext des Dokuments.
  const alt = "## Kontext\n\nPruefung: 2\n\n## Aufgabe\n";
  const neu = "## Kontext\n\n```\nPruefung: 3\n```\n\n## Aufgabe\n";
  const ergebnis = pruefvorgabeDurchsetzen(alt, neu);
  assert.match(ergebnis, /```\nPruefung: 3\n```/, "die Zeile im Fence wurde veraendert");
});

// ============================================================
// leseTextQuelle: die Vorrangregeln
// ============================================================

test("leseTextQuelle nimmt den direkten Wert, wenn keine Datei angegeben ist", () => {
  // Nur der Gluecksfall in-process: Alle Fehlerwege enden in `fail()` und damit in
  // process.exit — sie sind ueber die CLI geprueft (board-text-quelle, board-luecken).
  assert.equal(leseTextQuelle("Direkter Text", undefined, "text"), "Direkter Text");
  assert.equal(leseTextQuelle("Direkter Text", "", "text"), "Direkter Text",
    "ein leerer Dateipfad zaehlt nicht als angegebene Datei");
});
