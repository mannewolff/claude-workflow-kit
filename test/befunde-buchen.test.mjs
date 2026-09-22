// Das Protokoll der Modell-Funde (Issue #802, Plan #797, Fachliche Quelle #768).
//
// `buchen` schreibt je uebernommenem Fund mit bestaetigter Gegenprobe eine Zeile nach
// `.claude/befunde.tsv` — anhaengend, nie leerend — und meldet je beruehrter Art den
// neuen Zaehlerstand und ob die Schwelle erreicht ist. Gebucht wird NUR, was
// uebernommen UND gegengeprueft ist (AK 7): nicht gepruefte, unvollstaendige und
// abgelehnte Funde sind keine Vorkommen.
//
// Diese Datei prueft die Stufen ohne Vergleichsstand (`fachlich`, `plan`, `issue`)
// und die Rolle aus dem Reviewer-Kopf; der Vergleichsstand der Stufe `code` steht in
// test/befunde-vergleichsstand.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BEFUNDE = join(repoRoot, "kit", "befunde.mjs");

/** Ein Fundblock in der Form aus dem Regeltext, Bausteine je Test austauschbar. */
function fund({ titel = "W — Ein Fund.", stand = "geprueft, bestaetigt", uebernahme = "uebernommen", art = "doppelung", marke = "WICHTIG", zusatz = [] } = {}) {
  const zeilen = [
    `#### ${marke}`,
    "",
    `**${titel}**`,
    "Fundstelle: irgendwo",
    `Gegenprobe: Eine Beobachtung. — ${stand}`,
  ];
  if (art !== null) zeilen.push(`Art: ${art}`);
  if (uebernahme !== null) zeilen.push(`Uebernahme: ${uebernahme}`);
  zeilen.push(...zusatz);
  return zeilen.join("\n");
}

/**
 * Fuehrt `buchen` gegen einen Text aus. Die Eingangsdatei liegt unter `.claude/`,
 * damit sie im Vergleichsstand-Zwilling dieses Helpers nie als Tree-Aenderung
 * zaehlt — hier ist das nur Gleichklang.
 */
function buchen(dir, text, args = ["--stufe", "plan", "--karte", "797"]) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const datei = join(dir, ".claude", "befunde-eingang.md");
  writeFileSync(datei, text, "utf-8");
  return spawnSync(process.execPath, [BEFUNDE, "buchen", "--datei", datei, ...args], { cwd: dir, encoding: "utf-8" });
}

function protokoll(dir) {
  const pfad = join(dir, ".claude", "befunde.tsv");
  if (!existsSync(pfad)) return null;
  return readFileSync(pfad, "utf-8").split("\n").filter(Boolean);
}

/** n vorhandene Protokollzeilen einer Art, wie ein frueherer Lauf sie hinterlaesst. */
function vorbefuellen(dir, n, art = "doppelung") {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const zeile = `2026-09-21T00:00:00.000Z\tplan\t1\tunbekannt\t${art}\tWICHTIG\t-\n`;
  writeFileSync(join(dir, ".claude", "befunde.tsv"), zeile.repeat(n), "utf-8");
}

function mitDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "befunde-buchen-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("buchen schreibt nur Funde mit bestaetigter Gegenprobe und Uebernahmevermerk", () => {
  mitDir((dir) => {
    const text = [
      fund({ titel: "F1 — nicht geprueft.", stand: "nicht geprueft" }),
      fund({ titel: "F2 — abgelehnt.", uebernahme: "abgelehnt" }),
      fund({ titel: "F3 — unvollstaendig.", art: null, zusatz: ["Angaben: unvollstaendig"] }),
      fund({ titel: "F4 — zaehlt.", art: "luecke" }),
    ].join("\n\n");
    const res = buchen(dir, text);
    assert.equal(res.status, 0, res.stderr);
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.geschrieben, 1);
    const zeilen = protokoll(dir);
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].split("\t")[4], "luecke");
  });
});

test("ein zweiter Aufruf haengt an und leert die Datei nie", () => {
  mitDir((dir) => {
    vorbefuellen(dir, 2);
    const res = buchen(dir, fund());
    assert.equal(res.status, 0, res.stderr);
    assert.equal(protokoll(dir).length, 3, "zwei Zeilen plus ein Fund ergeben drei Zeilen");
  });
});

test("die Zeile traegt sieben tabulatorgetrennte Spalten ohne Modellnamen", () => {
  mitDir((dir) => {
    const text = ["### Reviewer 1: architektur-bestand, fable (claude-fable-5.1)", "", fund()].join("\n");
    const res = buchen(dir, text, ["--stufe", "plan", "--karte", "797"]);
    assert.equal(res.status, 0, res.stderr);
    const spalten = protokoll(dir)[0].split("\t");
    assert.equal(spalten.length, 7);
    const [zeit, stufe, karte, rolle, art, marke, vergleich] = spalten;
    assert.match(zeit, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "ISO-8601 in UTC");
    assert.equal(stufe, "plan");
    assert.equal(karte, "797");
    assert.equal(rolle, "architektur-bestand");
    assert.equal(art, "doppelung");
    assert.equal(marke, "WICHTIG");
    assert.equal(vergleich, "-", "unter der Code-Stufe bleibt der Vergleichsstand leer");
    for (const s of spalten) {
      assert.ok(!s.includes("fable") && !s.includes("claude-"), `Spalte '${s}' traegt einen Modellnamen`);
    }
  });
});

test("die Rolle stammt aus dem jeweils letzten Reviewer-Kopf vor dem Fund", () => {
  mitDir((dir) => {
    const text = [
      "### Reviewer 1: architektur-bestand, fable (claude-fable-5.1)",
      "",
      fund({ titel: "F1 — erster Reviewer.", art: "doppelung" }),
      "",
      "### Reviewer 2: schnitt-abhaengigkeiten, codex (gpt-6-astra)",
      "",
      fund({ titel: "F2 — zweiter Reviewer.", art: "luecke" }),
    ].join("\n");
    const res = buchen(dir, text);
    assert.equal(res.status, 0, res.stderr);
    const rollen = protokoll(dir).map((z) => z.split("\t")[3]);
    assert.deepEqual(rollen, ["architektur-bestand", "schnitt-abhaengigkeiten"]);
  });
});

test("ohne Reviewer-Kopf steht 'unbekannt', bei --stufe code 'code-review'", () => {
  mitDir((dir) => {
    const res = buchen(dir, fund());
    assert.equal(res.status, 0, res.stderr);
    assert.equal(protokoll(dir)[0].split("\t")[3], "unbekannt");
  });
  mitDir((dir) => {
    // Ohne Pruef-Zusammenfassung ist der Vergleichsstand nicht-vergleichbar —
    // gebucht wird trotzdem, mit dem Fallback der Code-Stufe als Rolle.
    const res = buchen(dir, fund(), ["--stufe", "code", "--karte", "5"]);
    assert.equal(res.status, 0, res.stderr);
    const spalten = protokoll(dir)[0].split("\t");
    assert.equal(spalten[3], "code-review");
    assert.equal(spalten[6], "nicht-vergleichbar");
  });
});

test("die Umlautform der Modelle zaehlt wie das Kit-uebliche ASCII", () => {
  mitDir((dir) => {
    const text = [
      "#### WICHTIG",
      "",
      "**U — Umlautfassung.**",
      "Gegenprobe: Eine Beobachtung. — geprüft, bestätigt",
      "Art: doppelung",
      "Übernahme: übernommen",
    ].join("\n");
    const res = buchen(dir, text);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(protokoll(dir).length, 1);
  });
});

test("bei Schwelle drei meldet der dritte Fund einer Art 'erreicht', der zweite nicht", () => {
  mitDir((dir) => {
    vorbefuellen(dir, 1);
    const res = buchen(dir, fund());
    const json = JSON.parse(res.stdout);
    assert.deepEqual(json.arten, [{ art: "doppelung", stand: 2, nullpunkt: 0, erreicht: false }]);
  });
  mitDir((dir) => {
    vorbefuellen(dir, 2);
    const res = buchen(dir, fund());
    const json = JSON.parse(res.stdout);
    assert.deepEqual(json.arten, [{ art: "doppelung", stand: 3, nullpunkt: 0, erreicht: true }]);
  });
});

test("ein Sprung ueber die Schwelle (zwei Funde in einem Aufruf) meldet ebenfalls 'erreicht'", () => {
  mitDir((dir) => {
    vorbefuellen(dir, 2);
    const text = [fund({ titel: "F1 — drei." }), fund({ titel: "F2 — vier." })].join("\n\n");
    const res = buchen(dir, text);
    const json = JSON.parse(res.stdout);
    assert.deepEqual(json.arten, [{ art: "doppelung", stand: 4, nullpunkt: 0, erreicht: true }]);
  });
});

test("der Nullpunkt aus befunde-vorschlaege.json verschiebt die Schwelle", () => {
  mitDir((dir) => {
    vorbefuellen(dir, 2);
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "befunde-vorschlaege.json"),
      JSON.stringify({ doppelung: { nullpunkt: 2 } }) + "\n", "utf-8");
    const res = buchen(dir, fund());
    const json = JSON.parse(res.stdout);
    assert.deepEqual(json.arten, [{ art: "doppelung", stand: 3, nullpunkt: 2, erreicht: false }]);
  });
});

test("die Schwelle kommt aus dem Config-Block befunde.schwelle", () => {
  mitDir((dir) => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "workflow.config.json"),
      JSON.stringify({ befunde: { schwelle: 1 } }) + "\n", "utf-8");
    const res = buchen(dir, fund());
    const json = JSON.parse(res.stdout);
    assert.equal(json.schwelle, 1);
    assert.deepEqual(json.arten, [{ art: "doppelung", stand: 1, nullpunkt: 0, erreicht: true }]);
  });
});

test("im Leerfall bleibt die Ausgabe JSON und es entsteht keine Protokolldatei", () => {
  mitDir((dir) => {
    const res = buchen(dir, "## Geprueft ohne Befund\n\nKein Fund, die Marken KRITISCH und WICHTIG kommen nur im Fliesstext vor.\n");
    assert.equal(res.status, 0, res.stderr);
    const json = JSON.parse(res.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.geschrieben, 0);
    assert.deepEqual(json.arten, []);
    assert.equal(protokoll(dir), null, "anhaengend, nie leerend — und im Leerfall gar nicht erst angelegt");
  });
});

test("ein Aufruf ohne Pflichtargument oder mit unbekannter Stufe wird mit JSON abgewiesen", () => {
  mitDir((dir) => {
    for (const args of [
      ["buchen", "--stufe", "plan", "--karte", "1"],
      ["buchen", "--datei", "x.md", "--karte", "1"],
      ["buchen", "--datei", "x.md", "--stufe", "plan"],
      ["buchen", "--datei", "x.md", "--stufe", "commit", "--karte", "1"],
    ]) {
      const res = spawnSync(process.execPath, [BEFUNDE, ...args], { cwd: dir, encoding: "utf-8" });
      assert.equal(res.status, 1, `Aufruf ${args.join(" ")} muss abgewiesen werden`);
      assert.equal(JSON.parse(res.stdout).ok, false);
    }
  });
});
