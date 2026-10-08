// Ablauf-Pruefung: tools/config-referenz.mjs --check ist der Pruefweg der Doku; sein Exitcode und seine Meldung gegen eine Kopie mit KIT_ROOT zeigt nur der Start als Programm.
//
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

// Die englische Einstellungs-Referenz (Issue #1356, Plan #1348 E8): Die Uebersetzung
// liegt in tools/config-referenz.en.json, je Einstellung mit dem Hash der deutschen
// Beschreibung. Sie gilt erst, wenn docs/en/dokumentation.md beide Marker traegt.

const UEBERSETZUNG = join(repoRoot, "tools", "config-referenz.en.json");
const EN_KOPF = "# Documentation\n\n## All settings\n\n<!-- einstellungen:start -->\n<!-- einstellungen:ende -->\n\nTail.\n";

function mitEnglisch(fn) {
  return mitKopie((dir) => {
    mkdirSync(join(dir, "tools"));
    mkdirSync(join(dir, "docs", "en"));
    copyFileSync(UEBERSETZUNG, join(dir, "tools", "config-referenz.en.json"));
    writeFileSync(join(dir, "docs", "en", "dokumentation.md"), EN_KOPF);
    return fn(dir);
  });
}

function englischerAbschnitt(dir) {
  const text = readFileSync(join(dir, "docs", "en", "dokumentation.md"), "utf-8");
  return text.slice(text.indexOf("<!-- einstellungen:start -->"), text.indexOf("<!-- einstellungen:ende -->"));
}

test("[1356] die Uebersetzung deckt jede Einstellung des Schemas mit Text und 12-stelligem Hash", () => {
  // Vollstaendig gegen das Schema: Traegt die englische Datei die Marker, nennt --check
  // jede Einstellung ohne Eintrag. Ein gruener Lauf auf der Repo-Kopie heisst darum,
  // dass jeder Pfad, den referenz() ausgibt, uebersetzt und aktuell ist.
  const eintraege = JSON.parse(readFileSync(UEBERSETZUNG, "utf-8"));
  for (const [pfad, e] of Object.entries(eintraege)) {
    assert.equal(typeof e.text, "string", `${pfad}: text fehlt`);
    assert.ok(e.text.trim().length > 0, `${pfad}: text leer`);
    assert.match(e.de, /^[0-9a-f]{12}$/, `${pfad}: Hash nicht 12-stellig`);
  }
  mitEnglisch((dir) => {
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1, "ohne geschriebenen Abschnitt muss --check rot sein");
    assert.doesNotMatch(res.stderr, /englischer Eintrag fehlt|Hash veraltet/);
    assert.equal(lauf([], dir).status, 0);
    const res2 = lauf(["--check"], dir);
    assert.equal(res2.status, 0, `${res2.stdout}\n${res2.stderr}`);
  });
});

test("[1356] ein fehlender englischer Eintrag macht --check rot und nennt die Einstellung", () => {
  mitEnglisch((dir) => {
    const pfad = join(dir, "tools", "config-referenz.en.json");
    const eintraege = JSON.parse(readFileSync(pfad, "utf-8"));
    delete eintraege["night.kette.planMin"];
    writeFileSync(pfad, JSON.stringify(eintraege, null, 2));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /night\.kette\.planMin: englischer Eintrag fehlt/);
  });
});

test("[1356] eine geaenderte deutsche Beschreibung macht den Hash veraltet, --check nennt die Einstellung", () => {
  mitEnglisch((dir) => {
    assert.equal(lauf([], dir).status, 0);
    const pfad = join(dir, "templates", "workflow.config.schema.json");
    const schema = JSON.parse(readFileSync(pfad, "utf-8"));
    schema.properties.mainBranch.description = "Eine neue Beschreibung.";
    writeFileSync(pfad, JSON.stringify(schema, null, 2));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /mainBranch: Hash veraltet/);
    assert.doesNotMatch(res.stderr, /codeHost/);
  });
});

test("[1356] die englische Ausgabe traegt englischen Rahmentext, kein 'gültig' und keinen deutschen Hinweissatz", () => {
  mitEnglisch((dir) => {
    assert.equal(lauf([], dir).status, 0);
    const abschnitt = englischerAbschnitt(dir);
    assert.match(abschnitt, /_This section is generated from `templates\/workflow\.config\.schema\.json`/);
    assert.match(abschnitt, /\(valid: `github`, `gitlab`, `local`\)/);
    assert.doesNotMatch(abschnitt, /gültig/);
    assert.doesNotMatch(abschnitt, /Dieser Abschnitt entsteht/);
    // Die Einstellungsnamen bleiben unuebersetzt.
    assert.match(abschnitt, /^### `mainBranch`$/m);
    assert.match(abschnitt, /^- `night\.kette\.planMin` — /m);
  });
});

test("[1356] geschrieben wird nur zwischen den Markern der englischen Datei, die deutsche bleibt unberuehrt", () => {
  mitEnglisch((dir) => {
    const de = readFileSync(join(dir, "docs", "dokumentation.md"), "utf-8");
    assert.equal(lauf([], dir).status, 0);
    const text = readFileSync(join(dir, "docs", "en", "dokumentation.md"), "utf-8");
    assert.ok(text.startsWith("# Documentation\n\n## All settings\n\n<!-- einstellungen:start -->\n"));
    assert.ok(text.endsWith("<!-- einstellungen:ende -->\n\nTail.\n"));
    assert.match(englischerAbschnitt(dir), /Branch for local commits and push \(step 8\)\./);
    assert.equal(readFileSync(join(dir, "docs", "dokumentation.md"), "utf-8"), de);
    const erst = text;
    assert.equal(lauf([], dir).status, 0);
    assert.equal(readFileSync(join(dir, "docs", "en", "dokumentation.md"), "utf-8"), erst);
  });
});

test("[1356] ohne Marker in der englischen Datei bleibt sie unberuehrt und --check prueft keine Uebersetzung", () => {
  mitEnglisch((dir) => {
    const en = join(dir, "docs", "en", "dokumentation.md");
    writeFileSync(en, "# Documentation\n\nNo markers yet.\n");
    writeFileSync(join(dir, "tools", "config-referenz.en.json"), "{}");
    assert.equal(lauf(["--check"], dir).status, 0);
    assert.equal(lauf([], dir).status, 0);
    assert.equal(readFileSync(en, "utf-8"), "# Documentation\n\nNo markers yet.\n");
  });
});
