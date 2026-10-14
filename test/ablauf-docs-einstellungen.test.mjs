// Ablauf-Pruefung: tools/config-referenz.mjs --check ist der Pruefweg der Doku; sein Exitcode und seine Meldung gegen eine Kopie mit KIT_ROOT zeigt nur der Start als Programm.
//
// Die Einstellungs-Referenz der Dokumentation entsteht aus dem Schema (Issue #675,
// Plan #674 E3). Seit Plan #1652 (E3, E4) steht sie auf einer eigenen Seite mit einer Zeile
// je Einstellung: englischer Pfad, erster Satz der Beschreibung, gueltige Werte, Vorgabe.
// Dieser Test haelt `docs/einstellungen.md` gegen `templates/workflow.config.schema.json`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { TEILE } from "../kit/settings.mjs";
import { SCHLUESSEL } from "../kit/board/config-namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(repoRoot, "tools", "config-referenz.mjs");
const VORGABEN = join(repoRoot, "tools", "config-referenz.vorgaben.json");
const SEITE = "einstellungen.md";

function lauf(args, root) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf-8", env: { ...process.env, ...(root ? { KIT_ROOT: root } : {}) } });
}

function mitKopie(fn) {
  const dir = mkdtempSync(join(tmpdir(), "config-referenz-"));
  try {
    mkdirSync(join(dir, "templates"));
    mkdirSync(join(dir, "docs"));
    mkdirSync(join(dir, "tools"));
    copyFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), join(dir, "templates", "workflow.config.schema.json"));
    copyFileSync(join(repoRoot, "docs", "einstellungen.md"), join(dir, "docs", "einstellungen.md"));
    copyFileSync(VORGABEN, join(dir, "tools", "config-referenz.vorgaben.json"));
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
    const doku = join(dir, "docs", SEITE);
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
    const doku = readFileSync(join(dir, "docs", SEITE), "utf-8");
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
    const doku = readFileSync(join(dir, "docs", SEITE), "utf-8");
    // Der schon gesetzte Backtick wird nicht verdoppelt, der nackte bekommt seinen.
    assert.match(doku, /Ausdruck mit `<ID>` und dazu `<Bereich>`\./);
  });
});

test("fehlen die Marker, endet das Werkzeug mit Exit 1 und benennt sie", () => {
  mitKopie((dir) => {
    const doku = join(dir, "docs", SEITE);
    writeFileSync(doku, readFileSync(doku, "utf-8").replace("<!-- einstellungen:start -->", ""));
    const res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /einstellungen:start/);
  });
});

/** Der erzeugte Teil einer Seite zwischen den Markern. */
function erzeugt(text) {
  return text.slice(text.indexOf("<!-- einstellungen:start -->"), text.indexOf("<!-- einstellungen:ende -->"));
}

/** Die Zeile einer Einstellung im erzeugten Teil, `undefined` ohne sie. */
function zeileVon(text, pfad) {
  return erzeugt(text).split("\n").find((z) => z.startsWith(`- \`${pfad}\` — `));
}

test("der Abschnitt fuehrt je Wurzelfeld ausser version eine Zeile, keine Ueberschrift", () => {
  const schema = JSON.parse(readFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), "utf-8"));
  const doku = readFileSync(join(repoRoot, "docs", SEITE), "utf-8");
  for (const feld of Object.keys(schema.properties).filter((f) => f !== "version")) {
    const englisch = SCHLUESSEL[feld] ?? feld;
    assert.ok(zeileVon(doku, englisch), `Zeile fuer ${englisch} fehlt`);
  }
  assert.equal(zeileVon(doku, "version"), undefined);
  assert.doesNotMatch(doku, /^### `/m);
});

test("jede Zeile traegt Vorgabe oder 'Keine Vorgabe' und nur den ersten Satz", () => {
  const doku = readFileSync(join(repoRoot, "docs", SEITE), "utf-8");
  const zeilen = erzeugt(doku).split("\n").filter((z) => z.startsWith("- `"));
  assert.ok(zeilen.length >= 154, `nur ${zeilen.length} Zeilen`);
  for (const zeile of zeilen) assert.match(zeile, /(Vorgabe: \S.*|Keine Vorgabe)\.$/, zeile);
  assert.equal(zeileVon(doku, "mainBranch"), "- `mainBranch` — Branch für lokale Commits und Push (Schritt 8). Vorgabe: `main`.");
  assert.equal(zeileVon(doku, "codeHost"), "- `codeHost` — Wo der Code liegt (Push, Pull Requests). Gültig: `github`, `gitlab`, `local`. Vorgabe: `github`.");
});

test("Vorgabetabelle: provider, tierRule, scenariosFrom und reviewCommand tragen ihren Satz und ihre Vorgabe", () => {
  const doku = readFileSync(join(repoRoot, "docs", SEITE), "utf-8");
  const provider = zeileVon(doku, "provider");
  assert.ok(provider.includes("Wird beim Laden auf `codeHost` und `issueTracker` übertragen; neu nicht setzen."), provider);
  assert.doesNotMatch(provider, /Veraltet/);
  for (const pfad of ["night.tierRule", "scenariosFrom", "reviewCommand"]) {
    const zeile = zeileVon(doku, pfad);
    assert.ok(zeile, `${pfad} fehlt`);
    assert.doesNotMatch(zeile, /keine Vorgabe/i, zeile);
    assert.match(zeile, /Vorgabe: \S/, zeile);
  }
});

/** Schreibt das Schema der Kopie mit einer Aenderung zurueck. */
function schemaAendern(dir, aendern) {
  const pfad = join(dir, "templates", "workflow.config.schema.json");
  const schema = JSON.parse(readFileSync(pfad, "utf-8"));
  aendern(schema);
  writeFileSync(pfad, JSON.stringify(schema, null, 2));
}

test("Satzschnitt: Abkuerzungen und Punkte in Klammern beenden den ersten Satz nicht", () => {
  mitKopie((dir) => {
    schemaAendern(dir, (s) => {
      s.properties.mainBranch.description = "Zweig für Commits (etwa main. Oder trunk. Auch dev) mit z.B. Tags bzw. Notizen, ggf. leer. Zweiter Satz. Dritter.";
    });
    assert.equal(lauf([], dir).status, 0);
    const zeile = zeileVon(readFileSync(join(dir, "docs", SEITE), "utf-8"), "mainBranch");
    assert.equal(zeile, "- `mainBranch` — Zweig für Commits (etwa main. Oder trunk. Auch dev) mit z.B. Tags bzw. Notizen, ggf. leer. Vorgabe: `main`.");
  });
});

test("Satzschnitt: ein Punkt ohne folgenden Leerraum beendet den Satz nicht, ohne Punkt gilt der ganze Text", () => {
  mitKopie((dir) => {
    schemaAendern(dir, (s) => {
      s.properties.mainBranch.description = "Datei config.json im Projekt. Rest.";
      s.properties.productionBranch.description = "Ziel ohne Punkt";
    });
    assert.equal(lauf([], dir).status, 0);
    const doku = readFileSync(join(dir, "docs", SEITE), "utf-8");
    assert.match(zeileVon(doku, "mainBranch"), /— Datei config\.json im Projekt\. Vorgabe/);
    assert.match(zeileVon(doku, "productionBranch"), /— Ziel ohne Punkt Vorgabe: `production`\.$/);
  });
});

test("Vorgabetabelle: default vor Tabelle, Tabelle vor 'Keine Vorgabe', Ersatzsatz statt erstem Satz", () => {
  mitKopie((dir) => {
    writeFileSync(join(dir, "tools", "config-referenz.vorgaben.json"), JSON.stringify({
      "night.stufenRegel": { vorgabe: { de: "die Regel des Kits", en: "the kit's rule" } },
      provider: { satz: { de: "Ersatz für den ersten Satz.", en: "Replacement." } },
    }));
    assert.equal(lauf([], dir).status, 0);
    const doku = readFileSync(join(dir, "docs", SEITE), "utf-8");
    assert.match(zeileVon(doku, "night.tierRule"), /Vorgabe: die Regel des Kits\.$/);
    assert.match(zeileVon(doku, "provider"), /^- `provider` — Ersatz für den ersten Satz\. Gültig: `github`, `gitlab`, `local`\. Keine Vorgabe\.$/);
    assert.match(zeileVon(doku, "language"), /Vorgabe: `de`\.$/);
    assert.match(zeileVon(doku, "scenariosFrom"), /Keine Vorgabe\.$/);
    // Ein Objekt als Vorgabe steht nicht als JSON da, sondern verweist auf die Felder darunter.
    assert.match(zeileVon(doku, "triggers"), /Vorgabe: die Werte der Felder darunter\.$/);
    assert.match(zeileVon(doku, "mutationCommand"), /Vorgabe: leer\.$/);
  });
});

test("Vorgabetabelle: ein unbekannter Pfad oder eine Vorgabe neben default macht --check rot", () => {
  mitKopie((dir) => {
    const tabelle = join(dir, "tools", "config-referenz.vorgaben.json");
    writeFileSync(tabelle, JSON.stringify({ "gibt.esNicht": { vorgabe: { de: "x", en: "x" } } }));
    let res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /gibt\.esNicht/);
    writeFileSync(tabelle, JSON.stringify({ mainBranch: { vorgabe: { de: "x", en: "x" } } }));
    res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /mainBranch.*default/);
    writeFileSync(tabelle, JSON.stringify({ provider: { satz: { de: "Nur deutsch." } } }));
    res = lauf(["--check"], dir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /provider/);
  });
});

/** Die Einleitung der Seite vor `## Alle Einstellungen`. */
function einleitung() {
  const doku = readFileSync(join(repoRoot, "docs", SEITE), "utf-8");
  const ende = doku.indexOf("## Alle Einstellungen");
  assert.ok(ende > 0, "Abschnitt 'Alle Einstellungen' nicht gefunden");
  return doku.slice(0, ende);
}

test("die Einleitung nennt jeden benannten Teil der Oberflaeche", () => {
  // Die Titel kommen aus TEILE und stehen nicht zweimal: Kam ein Teil hinzu (Aufwand,
  // Wirksamkeit), zaehlte der Absatz ihn sonst weiter nicht mit und behauptete eine
  // Gliederung, die es nicht mehr gibt.
  const text = einleitung();
  for (const teil of TEILE.filter((t) => t.titel !== null)) {
    assert.ok(text.includes(teil.titel), `Teil '${teil.titel}' fehlt in der Einleitung`);
  }
});

test("die Einleitung nennt Ort der Dateien, persoenliche Abweichung und den Start der Oberflaeche", () => {
  const text = einleitung();
  assert.match(text, /`\.claude\/workflow\.config\.json`/);
  assert.match(text, /`\.claude\/workflow\.config\.local\.json`/);
  assert.match(text, /persönlich/);
  assert.match(text, /node settings\.mjs/);
  assert.match(text, /https:\/\/docs\.mwolff\.org\/settings\.mjs/);
});

test("kontext.config.json steht unter den Einstellungen mit beiden Orten, ohne session-start.config.json", () => {
  const doku = readFileSync(join(repoRoot, "docs", SEITE), "utf-8");
  const teil = doku.slice(doku.indexOf("<!-- einstellungen:ende -->"));
  assert.match(teil, /`~\/\.claude\/kontext\.config\.json`/);
  assert.match(teil, /`\.claude\/kontext\.config\.json`/);
  assert.match(teil, /feldweise/);
  assert.doesNotMatch(doku, /session-start\.config\.json/);
});

// Die englische Einstellungs-Referenz (Issue #1356, Plan #1348 E8): Die Uebersetzung
// liegt in tools/config-referenz.en.json, je Einstellung mit dem Hash der deutschen
// Beschreibung. Sie gilt erst, wenn docs/en/einstellungen.md beide Marker traegt. Die
// englische Zeile schneidet ihren ersten Satz aus dieser Uebersetzung.

const UEBERSETZUNG = join(repoRoot, "tools", "config-referenz.en.json");
const EN_KOPF = "# Settings\n\n## All settings\n\n<!-- einstellungen:start -->\n<!-- einstellungen:ende -->\n\nTail.\n";

function mitEnglisch(fn) {
  return mitKopie((dir) => {
    mkdirSync(join(dir, "docs", "en"));
    copyFileSync(UEBERSETZUNG, join(dir, "tools", "config-referenz.en.json"));
    writeFileSync(join(dir, "docs", "en", SEITE), EN_KOPF);
    return fn(dir);
  });
}

function englischerAbschnitt(dir) {
  const text = readFileSync(join(dir, "docs", "en", SEITE), "utf-8");
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
    assert.match(abschnitt, /Valid: `github`, `gitlab`, `local`\. Default: `github`\./);
    assert.match(abschnitt, /No default\./);
    assert.doesNotMatch(abschnitt, /Vorgabe/);
    assert.doesNotMatch(abschnitt, /gültig/);
    assert.doesNotMatch(abschnitt, /Dieser Abschnitt entsteht/);
    // Nur der englische Pfad, in beiden Fassungen (Plan #1652, E13).
    assert.match(abschnitt, /^- `mainBranch` — Branch for local commits and push \(step 8\)\. Default: `main`\.$/m);
    assert.match(abschnitt, /^- `night\.chain\.planMin` — /m);
    assert.doesNotMatch(abschnitt, /German:/);
  });
});

test("[1356] geschrieben wird nur zwischen den Markern der englischen Datei, die deutsche bleibt unberuehrt", () => {
  mitEnglisch((dir) => {
    const de = readFileSync(join(dir, "docs", SEITE), "utf-8");
    assert.equal(lauf([], dir).status, 0);
    const text = readFileSync(join(dir, "docs", "en", SEITE), "utf-8");
    assert.ok(text.startsWith("# Settings\n\n## All settings\n\n<!-- einstellungen:start -->\n"));
    assert.ok(text.endsWith("<!-- einstellungen:ende -->\n\nTail.\n"));
    assert.match(englischerAbschnitt(dir), /Branch for local commits and push \(step 8\)\./);
    assert.equal(readFileSync(join(dir, "docs", SEITE), "utf-8"), de);
    const erst = text;
    assert.equal(lauf([], dir).status, 0);
    assert.equal(readFileSync(join(dir, "docs", "en", SEITE), "utf-8"), erst);
  });
});

test("[1356] ohne Marker in der englischen Datei bleibt sie unberuehrt und --check prueft keine Uebersetzung", () => {
  mitEnglisch((dir) => {
    const en = join(dir, "docs", "en", SEITE);
    writeFileSync(en, "# Documentation\n\nNo markers yet.\n");
    writeFileSync(join(dir, "tools", "config-referenz.en.json"), "{}");
    assert.equal(lauf(["--check"], dir).status, 0);
    assert.equal(lauf([], dir).status, 0);
    assert.equal(readFileSync(en, "utf-8"), "# Documentation\n\nNo markers yet.\n");
  });
});
