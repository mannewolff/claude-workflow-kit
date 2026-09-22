// Der Rueckweg der Befunde aus dem Worktree der Nacht-Kette (Plan #797; Issue #803).
//
// Die Kette fuehrt /issue-review in einem Worktree ausserhalb des Repos (night-17);
// der Spiegel nach `.claude/` geht nur in eine Richtung und traegt `befunde.tsv` gar
// nicht erst hinein. `befundeZurueck` haengt die dort gebuchten Zeilen an die
// Hauptkopie an — nie ueberschreibend — und prueft je beruehrter Art den Gesamtstand
// der Hauptkopie gegen die Schwelle: Der Worktree zaehlt ab null, und ohne die
// Pruefung am Gesamtstand entstuende in einem Projekt, das nur nachts pruefen laesst,
// nie ein Schwellentreffer (E20, Fund B1 der Plan-Pruefung).
//
// Gerufen wird an beiden Abbaustellen der Kette: vor der Umsetzungsstufe und im
// finally am Kettenende. Das Nullen von `kette.wt` nach dem ersten Abbau verhindert
// das doppelte Anhaengen. Die Abbaustellen prueft der Test am ECHTEN kit/night.mjs
// ueber das Ketten-Fixture; die Funktion selbst an einfachen Temp-Verzeichnissen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { befundeZurueck } from "../kit/night.mjs";
import {
  NUR_POSIX, run, board, mitProjekt, fachplan, umgebung,
  PLAN_ANLEGEN, REVIEW_MARKER, PAKETE_ANLEGEN, UMSETZUNG_ERFOLG,
} from "./helpers/kette-fixture.mjs";

/** Eine Protokollzeile, wie `befunde.mjs buchen` sie schreibt — sieben Spalten, Art in Spalte 5. */
function zeile(art) {
  return `2026-09-22T00:00:00.000Z\tplan\t2\treviewer\t${art}\tWICHTIG\t-`;
}

/**
 * Eine Hauptkopie und ein "Worktree" als Temp-Verzeichnisse. `befundeZurueck` liest
 * und schreibt nur unter `.claude/` — ein echter git-Worktree ist fuer die Funktion
 * selbst nicht noetig, die Abbaustellen pruefen die Ketten-Tests unten.
 */
function setupPaar({ haupt = null, wt = null, config = null, vorschlaege = null } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "befunde-haupt-"));
  const pfad = mkdtempSync(join(tmpdir(), "befunde-wt-"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
  if (haupt) writeFileSync(join(repo, ".claude", "befunde.tsv"), haupt.map((z) => `${z}\n`).join(""));
  if (config) writeFileSync(join(repo, ".claude", "workflow.config.json"), JSON.stringify(config));
  if (vorschlaege) writeFileSync(join(repo, ".claude", "befunde-vorschlaege.json"), JSON.stringify(vorschlaege));
  if (wt) {
    mkdirSync(join(pfad, ".claude"), { recursive: true });
    writeFileSync(join(pfad, ".claude", "befunde.tsv"), wt.map((z) => `${z}\n`).join(""));
  }
  return { repo, pfad };
}

function mitPaar(einstellungen, fn) {
  const { repo, pfad } = setupPaar(einstellungen);
  try {
    fn(repo, pfad);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(pfad, { recursive: true, force: true });
  }
}

function hauptZeilen(repo) {
  return readFileSync(join(repo, ".claude", "befunde.tsv"), "utf-8").split("\n").filter((z) => z !== "");
}

test("[night-69] befundeZurueck haengt an, statt zu ueberschreiben", () => {
  const alt = [zeile("doppelung"), zeile("luecke")];
  mitPaar({ haupt: alt, wt: [zeile("luecke")] }, (repo, pfad) => {
    befundeZurueck(pfad, repo);
    const zeilen = hauptZeilen(repo);
    assert.equal(zeilen.length, 3, "zwei alte plus eine neue Zeile");
    assert.deepEqual(zeilen.slice(0, 2), alt, "die alten Zeilen stehen unveraendert voran");
    assert.equal(zeilen[2], zeile("luecke"), "die Worktree-Zeile steht dahinter");
  });
});

test("[night-69] der Schwellentreffer misst den Gesamtstand der Hauptkopie, nicht den des Worktrees", () => {
  // Der Worktree sah beim Buchen den Stand 1 — erst der Gesamtstand nach dem
  // Anhaengen erreicht die Schwelle drei.
  mitPaar({ haupt: [zeile("luecke"), zeile("luecke")], wt: [zeile("luecke")] }, (repo, pfad) => {
    assert.deepEqual(befundeZurueck(pfad, repo), ["luecke"]);
  });
});

test("[night-69] nur beruehrte Arten stehen in der Rueckgabe", () => {
  // `doppelung` ueberschreitet die Schwelle allein in der Hauptkopie, kommt im
  // Worktree aber nicht vor — sie zu melden hiesse, jeden Abbau zum Vorschlag zu machen.
  mitPaar({ haupt: [zeile("doppelung"), zeile("doppelung"), zeile("doppelung")], wt: [zeile("luecke")] }, (repo, pfad) => {
    assert.deepEqual(befundeZurueck(pfad, repo), []);
  });
});

test("[night-69] ohne befunde.tsv im Worktree bleibt die Hauptkopie unveraendert", () => {
  mitPaar({ haupt: [zeile("luecke")] }, (repo, pfad) => {
    assert.deepEqual(befundeZurueck(pfad, repo), []);
    assert.deepEqual(hauptZeilen(repo), [zeile("luecke")]);
  });
});

test("[night-69] ohne Datei auf beiden Seiten wird die Hauptkopie nicht angelegt", () => {
  mitPaar({}, (repo, pfad) => {
    assert.deepEqual(befundeZurueck(pfad, repo), []);
    assert.ok(!existsSync(join(repo, ".claude", "befunde.tsv")), "kein leeres Protokoll anlegen");
  });
});

test("[night-69] die Schwelle kommt aus dem Config-Block befunde der Hauptkopie", () => {
  mitPaar({
    haupt: [zeile("luecke")], wt: [zeile("luecke")],
    config: { befunde: { schwelle: 2 } },
  }, (repo, pfad) => {
    assert.deepEqual(befundeZurueck(pfad, repo), ["luecke"]);
  });
});

test("[night-69] der Nullpunkt aus befunde-vorschlaege.json zaehlt wie bei buchen", () => {
  // Drei Vorkommen, aber der Nullpunkt einer frueheren Ablehnung liegt bei zwei:
  // erst oberhalb davon zaehlt die Schwelle wieder — dieselbe Regel wie in
  // kit/befunde.mjs (E11, E20).
  mitPaar({
    haupt: [zeile("luecke"), zeile("luecke")], wt: [zeile("luecke")],
    vorschlaege: { luecke: { nullpunkt: 2 } },
  }, (repo, pfad) => {
    assert.deepEqual(befundeZurueck(pfad, repo), []);
  });
});

test("[night-69] ein gescheitertes Anhaengen wirft nicht und wird als Hinweis protokolliert", () => {
  mitPaar({ wt: [zeile("luecke")] }, (repo, pfad) => {
    // Ein Verzeichnis unter dem Zielpfad laesst appendFileSync scheitern — auf jeder
    // Plattform, ohne an Dateirechten zu drehen.
    mkdirSync(join(repo, ".claude", "befunde.tsv"), { recursive: true });
    const geschrieben = [];
    const orig = process.stdout.write;
    process.stdout.write = (text) => { geschrieben.push(String(text)); return true; };
    let arten;
    try {
      arten = befundeZurueck(pfad, repo);
    } finally {
      process.stdout.write = orig;
    }
    assert.deepEqual(arten, [], "ohne Anhaengen gibt es keinen Schwellentreffer");
    assert.match(geschrieben.join(""), /Befunde aus dem Worktree nicht zurueckgeholt/,
      "der Fehlschlag muss im Protokoll stehen");
  });
});

// --- Die beiden Abbaustellen der Kette ----------------------------------------

/** Die Fake-Zeile, die im Worktree eine Buchung hinterlaesst — wie `befunde buchen` es taete. */
const BUCHUNG_IM_WORKTREE = String.raw`printf "2026-09-22T00:00:00.000Z\tplan\t2\treviewer\tluecke\tWICHTIG\t-\n" >> .claude/befunde.tsv`;

test("[night-69] der Abbau im finally am Kettenende holt die Buchungen der Review-Stufe zurueck", NUR_POSIX, () => {
  mitProjekt((dir) => {
    // Zwei Vorkommen liegen schon in der Hauptkopie — der Spiegel traegt sie nicht in
    // den Worktree, und die Kette darf sie beim Rueckholen nicht ueberschreiben.
    const alt = [zeile("luecke"), zeile("luecke")];
    writeFileSync(join(dir, ".claude", "befunde.tsv"), alt.map((z) => `${z}\n`).join(""));

    const F = fachplan(dir);
    const env = umgebung(dir, { stufen: {
      plan: PLAN_ANLEGEN,
      review: `${REVIEW_MARKER}; ${BUCHUNG_IM_WORKTREE}`,
      pakete: PAKETE_ANLEGEN,
    } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const zeilen = hauptZeilen(dir);
    assert.equal(zeilen.length, 3, `die Buchung der Kette fehlt oder wurde gedoppelt:\n${zeilen.join("\n")}`);
    assert.deepEqual(zeilen.slice(0, 2), alt, "die alten Zeilen stehen unveraendert voran");
    assert.match(res.stdout, /Schwelle erreicht: luecke/,
      "der Runner protokolliert die Arten, deren Gesamtstand die Schwelle erreicht");
    assert.ok(String(F), "Fachplan angelegt"); // benutzt, damit die Nummer im Fehlerfall greifbar ist
  });
});

test("[night-69] der Abbau vor der Umsetzungsstufe holt die Buchungen zurueck — und das finally haengt nicht noch einmal an", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplan(dir);
    board(dir, "issue", "label", "add", F, "kit:durchziehen");
    const env = umgebung(dir, { stufen: {
      plan: PLAN_ANLEGEN,
      review: REVIEW_MARKER,
      pakete: `${PAKETE_ANLEGEN}; ${BUCHUNG_IM_WORKTREE}`,
      umsetzung: UMSETZUNG_ERFOLG,
    } });
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    // Genau eine Zeile: Der Abbau vor der Umsetzungsstufe hat sie geholt, und das
    // finally am Kettenende darf nach `kette.wt = null` nicht noch einmal anhaengen.
    assert.deepEqual(hauptZeilen(dir), [zeile("luecke")],
      "die Buchung muss genau einmal in der Hauptkopie stehen");
  });
});
