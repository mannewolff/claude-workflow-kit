// Die Einstellungs-Referenz der Dokumentation entsteht aus dem Schema (Issue #675,
// Plan #674 E3). Wortgleich bleibt nur, was aus einer Quelle erzeugt wird — dieser Test
// haelt `docs/dokumentation.md` gegen `templates/workflow.config.schema.json`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { TEILE } from "../kit/einstellungen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(repoRoot, "tools", "config-referenz.mjs");

function lauf(args, root) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf-8", env: { ...process.env, ...(root ? { KIT_ROOT: root } : {}) } });
}

function mitKopie(fn) {
  const dir = mkdtempSync(join(tmpdir(), "config-referenz-"));
  try {
    mkdirSync(join(dir, "templates"));
    mkdirSync(join(dir, "docs"));
    copyFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), join(dir, "templates", "workflow.config.schema.json"));
    copyFileSync(join(repoRoot, "docs", "dokumentation.md"), join(dir, "docs", "dokumentation.md"));
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("config-referenz --check ist im Repo gruen", () => {
  const res = lauf(["--check"]);
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
});

test("eine geaenderte description macht --check rot und nennt den Abschnitt", () => {
  mitKopie((dir) => {
    const pfad = join(dir, "templates", "workflow.config.schema.json");
    const schema = JSON.parse(readFileSync(pfad, "utf-8"));
    schema.properties.mainBranch.description = "Eine neue Beschreibung.";
    writeFileSync(pfad, JSON.stringify(schema, null, 2));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Alle Einstellungen/);
  });
});

test("ohne --check schreibt das Werkzeug den Abschnitt, ein zweiter Lauf aendert nichts", () => {
  mitKopie((dir) => {
    const pfad = join(dir, "templates", "workflow.config.schema.json");
    const schema = JSON.parse(readFileSync(pfad, "utf-8"));
    schema.properties.mainBranch.description = "Eine neue Beschreibung.";
    writeFileSync(pfad, JSON.stringify(schema, null, 2));
    assert.equal(lauf([], dir).status, 0);
    const doku = join(dir, "docs", "dokumentation.md");
    const erst = readFileSync(doku, "utf-8");
    assert.match(erst, /Eine neue Beschreibung\./);
    assert.equal(lauf([], dir).status, 0);
    assert.equal(readFileSync(doku, "utf-8"), erst);
    assert.equal(lauf(["--check"], dir).status, 0);
  });
});

test("ein Platzhalter der Form <X> erscheint in der Ausgabe als Inline-Code", () => {
  // Issue #792: Ein nacktes `<X>` in einer Beschreibung wandert sonst unveraendert in die
  // Doku, und der Vue-Compiler von VitePress liest es als Element ohne End-Tag — der
  // Build bricht ab. Entschaerft wird beim Erzeugen und nicht im Schema: Sonst bricht die
  // naechste Beschreibung mit Platzhalter denselben Build.
  mitKopie((dir) => {
    const pfad = join(dir, "templates", "workflow.config.schema.json");
    const schema = JSON.parse(readFileSync(pfad, "utf-8"));
    schema.properties.mainBranch.description = "Muster mit dem Platzhalter <X>, gefolgt von Text.";
    writeFileSync(pfad, JSON.stringify(schema, null, 2));
    assert.equal(lauf([], dir).status, 0);
    const doku = readFileSync(join(dir, "docs", "dokumentation.md"), "utf-8");
    assert.match(doku, /Muster mit dem Platzhalter `<X>`, gefolgt von Text\./);
    assert.doesNotMatch(doku, /Platzhalter <X>/);
  });
});

test("ein Platzhalter in einem Unterfeld und ein schon gesetzter Backtick bleiben richtig", () => {
  mitKopie((dir) => {
    const pfad = join(dir, "templates", "workflow.config.schema.json");
    const schema = JSON.parse(readFileSync(pfad, "utf-8"));
    schema.properties.aufwand.properties.laeufe.description = "Ausdruck mit `<ID>` und dazu <Bereich>.";
    writeFileSync(pfad, JSON.stringify(schema, null, 2));
    assert.equal(lauf([], dir).status, 0);
    const doku = readFileSync(join(dir, "docs", "dokumentation.md"), "utf-8");
    // Der schon gesetzte Backtick wird nicht verdoppelt, der nackte bekommt seinen.
    assert.match(doku, /Ausdruck mit `<ID>` und dazu `<Bereich>`\./);
  });
});

test("fehlen die Marker, endet das Werkzeug mit Exit 1 und benennt sie", () => {
  mitKopie((dir) => {
    const doku = join(dir, "docs", "dokumentation.md");
    writeFileSync(doku, readFileSync(doku, "utf-8").replace("<!-- einstellungen:start -->", ""));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /einstellungen:start/);
  });
});

test("der Abschnitt fuehrt je Wurzelfeld ausser version eine Ueberschrift", () => {
  const schema = JSON.parse(readFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), "utf-8"));
  const doku = readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8");
  const abschnitt = doku.slice(doku.indexOf("<!-- einstellungen:start -->"), doku.indexOf("<!-- einstellungen:ende -->"));
  for (const feld of Object.keys(schema.properties).filter((f) => f !== "version")) {
    assert.match(abschnitt, new RegExp(`^### \`${feld}\`$`, "m"), `Ueberschrift fuer ${feld} fehlt`);
  }
  assert.doesNotMatch(abschnitt, /^### `version`$/m);
});

function oberflaechenAbschnitt() {
  const doku = readFileSync(join(repoRoot, "docs", "dokumentation.md"), "utf-8");
  const start = doku.indexOf("## Einstellungen über die Oberfläche");
  const ende = doku.indexOf("## Alle Einstellungen");
  assert.ok(start !== -1 && ende !== -1 && start < ende, "Abschnitt 'Einstellungen über die Oberfläche' nicht gefunden");
  return doku.slice(start, ende);
}

test("der Oberflaechen-Abschnitt nennt jeden benannten Teil der Oberflaeche", () => {
  // Die Titel kommen aus TEILE und stehen nicht zweimal: Kam ein Teil hinzu (Aufwand,
  // Wirksamkeit), zaehlte der Absatz ihn sonst weiter nicht mit und behauptete eine
  // Gliederung, die es nicht mehr gibt.
  const abschnitt = oberflaechenAbschnitt();
  for (const teil of TEILE.filter((t) => t.titel !== null)) {
    assert.ok(abschnitt.includes(teil.titel), `Teil '${teil.titel}' fehlt im Abschnitt`);
  }
  assert.ok(abschnitt.includes("einfache Gruppen"), "der generische Gruppen-Teil fehlt im Abschnitt");
});

test("[einstellungen-8] der Textblock-Absatz nennt jeden Pfad des Text-Teils in Dateischreibweise", () => {
  // `night.stufen` und `night.stufenRegel` stehen seit Issue #708 neben `night.modelle`
  // im Text-Teil (kit/einstellungen.mjs, TEILE). Nannte die Doku nur die Modellliste,
  // suchte wer die beiden pflegen will vergeblich nach einer eigenen Eingabe.
  const abschnitt = oberflaechenAbschnitt();
  const start = abschnitt.indexOf("**Textblock in Dateischreibweise.**");
  assert.ok(start !== -1, "Absatz 'Textblock in Dateischreibweise' fehlt");
  const ende = abschnitt.indexOf("**", start + 40);
  const absatz = abschnitt.slice(start, ende === -1 ? undefined : ende);
  const textTeil = TEILE.find((t) => t.kennung === "text");
  for (const pfad of textTeil.pfade) {
    const maskiert = pfad.replaceAll(".", String.raw`\.`);
    assert.match(absatz, new RegExp(`\`${maskiert}\``), `der Pfad '${pfad}' fehlt im Textblock-Absatz`);
  }
});

test("der Absatz 'Team und persoenlich' gilt nicht mehr fuer jede Einstellung", () => {
  const abschnitt = oberflaechenAbschnitt();
  const start = abschnitt.indexOf("**Team und persönlich.**");
  const ende = abschnitt.indexOf("**", start + 25);
  assert.ok(start !== -1, "Absatz 'Team und persoenlich' fehlt");
  const absatz = abschnitt.slice(start, ende === -1 ? undefined : ende);
  assert.doesNotMatch(absatz, /zu jeder Einstellung/i);
  assert.match(absatz, /persönliche Abweichung erlaubt ist/);
});

test("die Beschreibung des Textblocks in Dateischreibweise nennt Modellliste und unbekannte Felder", () => {
  const abschnitt = oberflaechenAbschnitt();
  const start = abschnitt.indexOf("**Textblock in Dateischreibweise.**");
  assert.ok(start !== -1, "Absatz 'Textblock in Dateischreibweise' fehlt");
  const ende = abschnitt.indexOf("**", start + 40);
  const absatz = abschnitt.slice(start, ende === -1 ? undefined : ende);
  assert.match(absatz, /night\.modelle/);
  assert.match(absatz, /nicht kennt/);
});
