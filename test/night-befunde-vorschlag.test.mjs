// Der Vorschlag am Ende des Rueckwegs (Issue #804, night-70).
//
// Nach `befundeZurueck` ruft die Nacht-Kette fuer JEDE zurueckgegebene Mangel-Art
// `befunde.mjs vorschlag --art <a>` und protokolliert das Ergebnis. Der Aufruf steht am
// Anlass und nicht erst beim naechsten `push main` (Plan #797, E9): Ein zweiter Ort
// waere ein zweiter Zeitpunkt, zu dem dieselbe Zahl anders herauskommen kann.
//
// KEIN GATE: Ein Fehlschlag des Vorschlags haelt den Abbau des Worktrees nicht auf.
//
// Gemessen am ECHTEN kit/night.mjs ueber das Ketten-Fixture — mit dem lokalen Tracker,
// dessen `issue create` eine Kartendatei unter `issues/` hinterlaesst.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN,
} from "./helpers/kette-fixture.mjs";

/** Eine Protokollzeile, wie `befunde.mjs buchen` sie schreibt — sieben Spalten, Art in Spalte 5. */
function zeile(art) {
  return `2026-09-22T00:00:00.000Z\tplan\t2\treviewer\t${art}\tWICHTIG\t-`;
}

/** Die Fake-Zeile, die im Worktree eine Buchung hinterlaesst — wie `befunde buchen` es taete. */
const BUCHUNG_IM_WORKTREE = String.raw`printf "2026-09-22T00:00:00.000Z\tplan\t2\treviewer\tluecke\tWICHTIG\t-\n" >> .claude/befunde.tsv`;

/** Zwei Vorkommen liegen schon in der Hauptkopie; das dritte bucht die Kette im Worktree. */
function zweiInDerHauptkopie(dir) {
  writeFileSync(join(dir, ".claude", "befunde.tsv"),
    [zeile("luecke"), zeile("luecke")].map((z) => `${z}\n`).join(""), "utf-8");
}

/** Die Titel aller Karten des lokalen Trackers. */
function kartenTitel(dir) {
  const issues = join(dir, "issues");
  if (!existsSync(issues)) return [];
  return readdirSync(issues)
    .filter((n) => n.endsWith(".md"))
    .map((n) => readFileSync(join(issues, n), "utf-8"))
    .map((t) => (t.match(/^title:\s*(.*)$/m) || [null, ""])[1].trim());
}

function vorschlaege(dir) {
  const pfad = join(dir, ".claude", "befunde-vorschlaege.json");
  return existsSync(pfad) ? JSON.parse(readFileSync(pfad, "utf-8")) : null;
}

/** Die Kette bis zur Paket-Stufe; die Buchung faellt in der Review-Stufe an. */
function kettenUmgebung(dir) {
  return umgebung(dir, { stufen: {
    plan: PLAN_ANLEGEN,
    review: `${REVIEW_MARKER}; ${BUCHUNG_IM_WORKTREE}`,
    pakete: PAKETE_ANLEGEN,
  } });
}

test("[night-70] das dritte Vorkommen im Worktree laesst die Idee am Board entstehen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    zweiInDerHauptkopie(dir);
    const F = fachplan(dir);
    const res = run(dir, ["--kette"], kettenUmgebung(dir));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const titel = kartenTitel(dir);
    assert.ok(titel.includes("[Idee] Maschinelle Pruefung fuer Mangel-Art luecke?"),
      `die Idee fehlt am Board:\n${titel.join("\n")}`);
    assert.match(res.stdout, /Vorschlag fuer 'luecke' angelegt/,
      "der Runner protokolliert den Vorschlag");

    const vermerk = vorschlaege(dir);
    assert.equal(vermerk.luecke.stand, "offen");
    assert.equal(vermerk.luecke.zaehlerstand, 3);
    assert.ok(String(F), "Fachplan angelegt");
  });
});

test("[night-70] ohne Schwellentreffer entsteht keine Idee", NUR_POSIX, () => {
  mitProjekt((dir) => {
    // Nur die eine Buchung der Kette — eins von drei noetigen Vorkommen.
    const F = fachplan(dir);
    const res = run(dir, ["--kette"], kettenUmgebung(dir));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.equal(kartenTitel(dir).filter((t) => t.startsWith("[Idee]")).length, 0);
    assert.equal(vorschlaege(dir), null, "ohne Vorschlag keine Zustandsdatei");
    assert.ok(String(F));
  });
});

test("[night-70] ein Fehlschlag des Vorschlags haelt den Abbau nicht auf", NUR_POSIX, () => {
  mitProjekt((dir) => {
    zweiInDerHauptkopie(dir);
    // Eine unlesbare Zustandsdatei weist `vorschlag` ab — sie ist ignoriert und macht
    // den Arbeitsbaum darum nicht unsauber, anders als ein geloeschtes Kit-Werkzeug.
    writeFileSync(join(dir, ".claude", "befunde-vorschlaege.json"), "{kein json", "utf-8");
    const F = fachplan(dir);
    const res = run(dir, ["--kette"], kettenUmgebung(dir));

    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /Vorschlag fuer 'luecke' fehlgeschlagen/,
      "der Fehlschlag steht als eine Zeile im Protokoll");
    assert.match(res.stdout, /der Abbau geht weiter/);
    assert.equal(readFileSync(join(dir, ".claude", "befunde-vorschlaege.json"), "utf-8"), "{kein json",
      "kein halb vermerkter Vorschlag");
    assert.equal(kartenTitel(dir).filter((t) => t.startsWith("[Idee]")).length, 0);
    // Der Rueckweg selbst ist unberuehrt: die dritte Zeile steht in der Hauptkopie.
    const zeilen = readFileSync(join(dir, ".claude", "befunde.tsv"), "utf-8").split("\n").filter(Boolean);
    assert.equal(zeilen.length, 3);
    assert.ok(String(F));
  });
});

test("[night-70] jede zurueckgegebene Art bekommt ihren eigenen Aufruf", NUR_POSIX, () => {
  mitProjekt((dir) => {
    writeFileSync(join(dir, ".claude", "befunde.tsv"),
      [zeile("luecke"), zeile("luecke"), zeile("doppelung"), zeile("doppelung")]
        .map((z) => `${z}\n`).join(""), "utf-8");
    const F = fachplan(dir);
    const buchungen = [
      BUCHUNG_IM_WORKTREE,
      String.raw`printf "2026-09-22T00:00:00.000Z\tplan\t2\treviewer\tdoppelung\tWICHTIG\t-\n" >> .claude/befunde.tsv`,
    ].join("; ");
    const env = umgebung(dir, { stufen: {
      plan: PLAN_ANLEGEN,
      review: `${REVIEW_MARKER}; ${buchungen}`,
      pakete: PAKETE_ANLEGEN,
    } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const titel = kartenTitel(dir);
    for (const art of ["luecke", "doppelung"]) {
      assert.ok(titel.includes(`[Idee] Maschinelle Pruefung fuer Mangel-Art ${art}?`),
        `die Idee zu '${art}' fehlt:\n${titel.join("\n")}`);
    }
    assert.deepEqual(Object.keys(vorschlaege(dir)).sort(), ["doppelung", "luecke"]);
    assert.ok(String(F));
  });
});

test("[night-70] board.mjs ist nicht der einzige Kit-Nachbar, den die Kette braucht", () => {
  // Gegenprobe zur Fixture-Aenderung: Liegt befunde.mjs nicht neben board.mjs, findet
  // der Runner das Kommando nicht — der Test oben waere dann gruen aus dem falschen
  // Grund (Fehlschlag haelt nichts auf) und der Vorschlag nie geprueft.
  const quelle = readFileSync(new URL("../kit/night.mjs", import.meta.url), "utf-8");
  assert.match(quelle, /befunde\.mjs vorschlag/,
    "der Aufruf muss in kit/night.mjs stehen");
  assert.match(quelle, /BEFUNDE_PATH = process\.env\.KIT_ROOT/,
    "der Pfad folgt demselben KIT_ROOT-Weg wie Board, Aufwand und Wirksamkeit");
});

test("[night-70] board bleibt unberuehrt: die Fixture-Karten sind weiter lesbar", NUR_POSIX, () => {
  // Der Vorschlag legt eine Karte im selben Tracker an; die Nummernvergabe des lokalen
  // Trackers darf dabei nicht mit den Karten der Kette kollidieren.
  mitProjekt((dir) => {
    zweiInDerHauptkopie(dir);
    const F = fachplan(dir);
    const res = run(dir, ["--kette"], kettenUmgebung(dir));
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const geholt = board(dir, "issue", "get", F);
    assert.equal(geholt.title, "[Fachlich] Ein Anliegen");
  });
});
