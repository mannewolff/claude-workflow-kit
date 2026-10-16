// Die Doku beschreibt das Kit, wie es ist (Plan #1652, A7).
//
// Die Pruefungen gelten fuer alle aktuellen Seiten, also `docs/*.md` ohne die Liste
// `historisch` in `docs-site/sprachen.json` (E10), und ihre Wortsumme ist hoechstens 20.700
// (Kriterium 5). Das Budget je Seite (A2) steht nur als Hinweis in der Ausgabe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHLUESSEL } from "../kit/board/config-namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(repoRoot, "docs");

/** Das Wortbudget je Seite (A2), nur als Hinweis. */
const BUDGET = { dokumentation: 1800, einstellungen: 3600, quickstart: 500, lokal: 400, wsl2: 650, pruefbereiche: 600, glossar: 400, index: 100, prozess: 5000, einrichtung: 3800, runner: 3300 };

/** Hoechstens ein Drittel von 62.029 Woertern (Kriterium 5). */
const WORTSUMME = 20700;

/** Die aktuellen Seiten: `docs/*.md` ohne die der Liste `historisch`. */
function aktuelleSeiten() {
  const { historisch } = JSON.parse(readFileSync(join(repoRoot, "docs-site", "sprachen.json"), "utf-8"));
  return readdirSync(DOCS).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)).filter((n) => !historisch.includes(n)).sort();
}

/** Woerter wie `wc -w`: jede Folge ohne Leerraum. */
const woerter = (text) => text.split(/\s+/).filter(Boolean).length;

/** Eingebaute Claude-Code-Kommandos, die die Doku nennt (E7). */
const EINGEBAUT = new Set(["help"]);

/** Ueberschriften der Update-Hinweise; ihr Abschnitt ist von (b) ausgenommen (E5). */
const AUSNAHMEN = new Set([
  "Umzug von nativem Windows",
  "Moving from native Windows",
  "Namen für Umsteiger von Version 4",
  "Names for those moving up from version 4",
]);

/** Wendungen, die von einer frueheren Fassung erzaehlen. */
const WENDUNGEN = ["früher galt", "früher hieß", "seit Issue", "wurde entfernt", "ehemals", "Altname"];

const START = "<!-- einstellungen:start -->";
const ENDE = "<!-- einstellungen:ende -->";

function seiten() {
  const liste = [];
  for (const name of aktuelleSeiten()) {
    for (const pfad of [join(DOCS, `${name}.md`), join(DOCS, "en", `${name}.md`)]) {
      liste.push({ name: pfad.slice(repoRoot.length + 1), text: readFileSync(pfad, "utf-8") });
    }
  }
  return liste;
}

/** Der Text ohne die Abschnitte der Ausnahme-Ueberschriften. */
function ohneAusnahmen(text) {
  const aus = [];
  let ausnahme = 0;
  for (const zeile of text.split("\n")) {
    const ebene = /^#{1,6} /.test(zeile) ? zeile.indexOf(" ") : 0;
    if (ebene && ausnahme && ebene <= ausnahme) ausnahme = 0;
    if (ebene && !ausnahme && AUSNAHMEN.has(zeile.slice(ebene + 1).trim())) ausnahme = ebene;
    if (!ausnahme) aus.push(zeile);
  }
  return aus.join("\n");
}

/** Ob ein Codeblock einen Befehl mit Platzhalter zeigt: `#N` oder `<Wort>`. */
const zeigtPlatzhalter = (block) => block.some((z) => /#N\b|<[\w-]+>/.test(z));

/** Der Text ohne Codebloecke, die einen Befehl mit Platzhalter zeigen (E6). */
function ohnePlatzhalterBloecke(text) {
  const aus = [];
  let block = null;
  for (const zeile of text.split("\n")) {
    const zaun = zeile.startsWith("```") || zeile.startsWith("~~~");
    if (block === null && !zaun) aus.push(zeile);
    else if (block === null) block = [zeile];
    else block.push(zeile);
    if (block !== null && zaun && block.length > 1) {
      if (!zeigtPlatzhalter(block)) aus.push(...block);
      block = null;
    }
  }
  return aus.concat(block ?? []).join("\n");
}

function ohneErzeugtenBlock(text) {
  const a = text.indexOf(START);
  const b = text.indexOf(ENDE);
  return a < 0 || b < a ? text : text.slice(0, a) + text.slice(b + ENDE.length);
}

/** Jede Einstellung des Schemas als deutscher Pfad, wie tools/config-referenz.mjs sie ausgibt. */
function einstellungen() {
  const schema = JSON.parse(readFileSync(join(repoRoot, "templates", "workflow.config.schema.json"), "utf-8"));
  const liste = [];
  function unterfelder(knoten, pfad) {
    if (!knoten || typeof knoten !== "object") return;
    if (knoten.items && typeof knoten.items === "object") {
      if (typeof knoten.items.description === "string") liste.push(`${pfad}[]`);
      unterfelder(knoten.items, `${pfad}[]`);
    }
    for (const variante of knoten.oneOf ?? []) unterfelder(variante, pfad);
    for (const [name, kind] of Object.entries(knoten.properties ?? {})) {
      if (typeof kind.description === "string") liste.push(`${pfad}.${name}`);
      unterfelder(kind, `${pfad}.${name}`);
    }
    if (knoten.additionalProperties && typeof knoten.additionalProperties === "object") unterfelder(knoten.additionalProperties, `${pfad}.*`);
  }
  for (const [feld, knoten] of Object.entries(schema.properties)) {
    liste.push(feld);
    unterfelder(knoten, feld);
  }
  return liste;
}

function englisch(pfad) {
  const glieder = pfad.split(".");
  return glieder
    .map((g, i) => {
      const name = g.replace(/\[\]$/, "");
      const en = SCHLUESSEL[[...glieder.slice(0, i), name].join(".")] ?? name;
      return g.endsWith("[]") ? `${en}[]` : en;
    })
    .join(".");
}

const maskiert = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * Die Slash-Kommandos, die ein Text nennt: in Backticks wie bisher und im Fließtext ohne
 * Backticks (Issue #1669). Im Fließtext zählt `/name` nur mit Leerraum, Zeilenanfang oder
 * Satzzeichen davor und ohne `/`, `#`, Wortzeichen oder Dateiendung dahinter — so bleiben Pfade,
 * URLs und Linkziele wie `](/einstellungen)` draußen. Frontmatter, Codeblöcke und
 * Code-Spannen prüft nur die Backtick-Form.
 */
function genannteNamen(text) {
  const namen = [...text.matchAll(/`\/([a-z][a-z0-9-]*)(?:\s[^`]*)?`/g)].map((m) => m[1]);
  const fliesstext = text.replace(/^---\n[\s\S]*?\n---\n/, "").replaceAll(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replaceAll(/`[^`\n]*`/g, "");
  for (const [, name] of fliesstext.matchAll(/(?<=^|[\s„“"'«(*_])(?<!\]\()\/([a-z][a-z0-9-]*)(?![\w/#-]|\.[\w/])/gm)) namen.push(name);
  return namen;
}

test("Szenario: Jeder genannte Name funktioniert", () => {
  const skills = new Set(readdirSync(join(repoRoot, "skills")).filter((n) => existsSync(join(repoRoot, "skills", n, "SKILL.md"))));
  for (const { name, text } of seiten()) {
    for (const aufruf of genannteNamen(ohneAusnahmen(text))) {
      assert.ok(skills.has(aufruf) || EINGEBAUT.has(aufruf), `${name}: /${aufruf} gibt es weder unter skills/ noch als eingebautes Kommando`);
    }
  }
});

test("Gegenprobe: ein erfundener Name ohne Backticks fällt auf, Pfade und Links nicht", () => {
  const text = "---\nlink: /quickstart\n---\nDanach /does-not-exist aufrufen, dann `/local-check`.\n\nSiehe [Seite](/einstellungen#x), /en/glossar, https://docs.mwolff.org/prozess und /local-check.\n\n```bash\ncd /tmp\n```\n";
  assert.deepEqual(genannteNamen(text).sort(), ["does-not-exist", "local-check", "local-check"]);
});

test("Szenario: Die Doku beschreibt den Stand, nicht die Geschichte", () => {
  for (const { name, text } of seiten()) {
    const geprueft = ohnePlatzhalterBloecke(ohneAusnahmen(text));
    const nummer = /#\d+/.exec(geprueft);
    assert.equal(nummer, null, `${name}: Issue-Nummer ${nummer?.[0]}`);
    assert.doesNotMatch(geprueft, /Spec-Driven/i, `${name}: Spec-Driven`);
    const ohneBlock = ohneErzeugtenBlock(geprueft);
    for (const wendung of WENDUNGEN) {
      assert.doesNotMatch(ohneBlock, new RegExp(String.raw`(?<!\p{L})${maskiert(wendung)}(?!\p{L})`, "iu"), `${name}: „${wendung}“`);
    }
  }
});

test("Gegenprobe: die Pruefung auf Geschichte erkennt Nummer, Wendung und Ausnahme", () => {
  const text = "# Seite\n\nRegel seit Issue 12.\n\n## Umzug von nativem Windows\n\nAus #77.\n\n## Weiter\n\n```bash\n/techplan #N\n```\n";
  const geprueft = ohnePlatzhalterBloecke(ohneAusnahmen(text));
  assert.doesNotMatch(geprueft, /#\d+/);
  assert.match(ohneErzeugtenBlock(geprueft), /seit Issue/);
  assert.match(ohnePlatzhalterBloecke("```\ngit log #12\n```\n"), /#12/);
});

test("Kriterium 7: jede Einstellung steht mit englischem Pfad und Vorgabe in docs/einstellungen.md", () => {
  const text = readFileSync(join(DOCS, "einstellungen.md"), "utf-8");
  const pfade = einstellungen();
  assert.ok(pfade.length >= 155, `nur ${pfade.length} Einstellungen gefunden`);
  assert.ok(pfade.includes("version"), "version fehlt unter den Einstellungen");
  const genannt = genanntePfade(text);
  for (const pfad of [...pfade.map(englisch), "vault", "always", "projectDocs", "project", "logPath", "parentProject"]) {
    assert.ok(genannt.has(pfad), `${pfad} fehlt mit Vorgabe oder „Keine Vorgabe“`);
  }
  // Je Pfad des Schemas genau eine Zeile im erzeugten Block (Issue #1734).
  const block = text.slice(text.indexOf(START), text.indexOf(ENDE));
  const zaehlung = zeilenJePfad(block);
  for (const pfad of pfade.map(englisch)) assert.equal(zaehlung.get(pfad), 1, `${pfad}: ${zaehlung.get(pfad) ?? 0} Zeilen`);
});

/** Wie oft jeder Pfad im Text eine Zeile hat; eine Zeile mit `{a,b,c}` zählt für jeden genannten Pfad. */
function zeilenJePfad(text) {
  const zaehlung = new Map();
  for (const z of text.split("\n")) {
    const ende = z.indexOf("` — ");
    if (!z.startsWith("- `") || ende < 0) continue;
    for (const p of ausgeklappt(z.slice(3, ende))) zaehlung.set(p, (zaehlung.get(p) ?? 0) + 1);
  }
  return zaehlung;
}

/** Die Pfade, für die ein Pfad mit `{a,b,c}` steht. */
function ausgeklappt(pfad) {
  const a = pfad.indexOf("{");
  const b = pfad.indexOf("}", a);
  return a < 0 || b < 0 ? [pfad] : pfad.slice(a + 1, b).split(",").flatMap((g) => ausgeklappt(pfad.slice(0, a) + g + pfad.slice(b + 1)));
}

test("Gegenprobe: eine doppelte Zeile fällt auf, eine zusammengezogene zählt je Pfad einmal", () => {
  const zaehlung = zeilenJePfad("- `a` — x. Keine Vorgabe.\n- `a` — y. Keine Vorgabe.\n- `b.{c,d}.e` — z. Keine Vorgabe.\n");
  assert.deepEqual([...zaehlung].sort(), [["a", 2], ["b.c.e", 1], ["b.d.e", 1]]);
});

/**
 * Die Pfade, die eine Seite mit Vorgabe oder „Keine Vorgabe“ nennt. Eine zusammengezogene Zeile
 * mit `{a,b,c}` im Pfad zählt als Zeile jedes genannten Pfads (Issue #1732).
 */
function genanntePfade(text) {
  const genannt = new Set();
  for (const zeile of text.split("\n")) {
    const ende = zeile.indexOf("` — ");
    if (!zeile.startsWith("- `") || ende < 0) continue;
    const rest = zeile.slice(ende);
    if (!/Vorgabe: \S/.test(rest) && !rest.includes("Keine Vorgabe.")) continue;
    for (const p of ausgeklappt(zeile.slice(3, ende))) genannt.add(p);
  }
  return genannt;
}

test("eine zusammengezogene Zeile zählt als Zeile jedes genannten Pfads", () => {
  const genannt = genanntePfade("- `night.tiers.{hard,medium}.model` — Modell. Keine Vorgabe.\n- `ohne` — Text ohne Vorgabe\n");
  assert.deepEqual([...genannt].sort(), ["night.tiers.hard.model", "night.tiers.medium.model"]);
});

test("Kriterium 5: die aktuellen deutschen Seiten haben zusammen höchstens 20.700 Wörter", (t) => {
  let summe = 0;
  for (const seite of aktuelleSeiten()) {
    const anzahl = woerter(readFileSync(join(DOCS, `${seite}.md`), "utf-8"));
    summe += anzahl;
    t.diagnostic(`${seite}: ${anzahl} Wörter, Budget ${BUDGET[seite] ?? "keines"}`);
  }
  t.diagnostic(`Summe: ${summe} Wörter`);
  assert.ok(aktuelleSeiten().includes("dokumentation"), "die Einstiegsseite fehlt in der Zählung");
  assert.ok(!aktuelleSeiten().includes("regeln-im-werkzeug"), "eine historische Seite zählt mit");
  assert.ok(summe <= WORTSUMME, `${summe} Wörter, erlaubt sind ${WORTSUMME}`);
});

test("Gegenprobe: die Wortzählung zählt wie wc -w", () => {
  assert.equal(woerter("  ## Drei Bahnen\n\n| `a` | b |\n"), 8);
});

/** Ob vor jeder Tabelle eines Abschnitts hoechstens ein Satz Einleitung steht. */
function einleitungenZuLang(text) {
  const zulang = [];
  let einleitung = [];
  for (const zeile of text.split("\n")) {
    if (/^#{1,6} /.test(zeile)) einleitung = [];
    else if (zeile.startsWith("|")) {
      const saetze = einleitung.join(" ").replaceAll(/`[^`]*`/g, "x").match(/[.!?:](\s|$)/g) ?? [];
      if (einleitung.length && saetze.length > 1) zulang.push(einleitung.join(" "));
      einleitung = [];
    } else if (zeile.trim() && !zeile.startsWith("<!--")) einleitung.push(zeile.trim());
  }
  return zulang;
}

const UPDATE_HINWEISE = [
  ["docs/dokumentation.md", "## Namen für Umsteiger von Version 4", "docs/wsl2.md", "## Umzug von nativem Windows"],
  ["docs/en/dokumentation.md", "## Names for those moving up from version 4", "docs/en/wsl2.md", "## Moving from native Windows"],
];

test("Kriterium 8: genau die zwei Update-Hinweise, Verweis aus CHANGELOG.md, Tabellen mit höchstens einem Satz Einleitung", () => {
  assert.match(readFileSync(join(repoRoot, "CHANGELOG.md"), "utf-8"), /docs\.mwolff\.org\/wsl2#umzug-von-nativem-windows/);
  for (const [namenSeite, namen, windowsSeite, windows] of UPDATE_HINWEISE) {
    assert.ok(abschnitt(readFileSync(join(repoRoot, windowsSeite), "utf-8"), windows), `${windowsSeite}: ${windows} fehlt`);
    const tabelle = abschnitt(readFileSync(join(repoRoot, namenSeite), "utf-8"), namen);
    assert.ok(tabelle, `${namenSeite}: ${namen} fehlt`);
    assert.ok((tabelle.match(/^\|---/gm) ?? []).length >= 6, `${namenSeite}: die Tabellen fehlen`);
    assert.deepEqual(einleitungenZuLang(tabelle), [], `${namenSeite}: mehr als ein Satz Einleitung vor einer Tabelle`);
  }
});

test("Gegenprobe: zwei Sätze vor einer Tabelle sind zu viel, ein Satz und eine Überschrift nicht", () => {
  assert.deepEqual(einleitungenZuLang("### Skills\n<!-- de: 0123456789ab -->\n\nEin Satz mit `a.b`.\n\n| a |\n"), []);
  assert.equal(einleitungenZuLang("Ein Satz. Noch einer.\n\n| a |\n").length, 1);
});

/** Ein Abschnitt ab seiner Ueberschrift bis zur naechsten Ueberschrift derselben oder hoeheren Ebene, Codebloecke ausgenommen. */
function abschnitt(text, ueberschrift) {
  const ebene = ueberschrift.match(/^#+/)[0].length;
  const zeilen = text.split("\n");
  const start = zeilen.indexOf(ueberschrift);
  if (start === -1) return null;
  let imCode = false;
  for (let i = start + 1; i < zeilen.length; i++) {
    if (/^\s*(```|~~~)/.test(zeilen[i])) imCode = !imCode;
    const kopf = /^(#{1,6}) /.exec(zeilen[i]);
    if (!imCode && kopf && kopf[1].length <= ebene) return zeilen.slice(start + 1, i).join("\n");
  }
  return zeilen.slice(start + 1).join("\n");
}

const PROZESS = [
  ["docs/prozess.md", /offenen Fragen/, /nach `\/issue-review`[^.]*vor `\/techplan`/],
  ["docs/en/prozess.md", /open questions/, /after `\/issue-review`[^.]*before `\/techplan`/],
];

test("Szenario: Ein neuer Leser findet den Skill für offene Fragen", () => {
  for (const [pfad, zweck, stelle] of PROZESS) {
    const groom = abschnitt(readFileSync(join(repoRoot, pfad), "utf-8"), "### /groom");
    assert.ok(groom, `${pfad}: die Überschrift /groom fehlt`);
    assert.match(groom, zweck, `${pfad}: der Zweck von /groom fehlt`);
    assert.match(groom, stelle, `${pfad}: die Stelle zwischen /issue-review und /techplan fehlt`);
  }
});

test("Kriterium 1: jeder Skill hat in beiden Fassungen von prozess.md eine eigene Überschrift", () => {
  const skills = readdirSync(join(repoRoot, "skills")).filter((n) => existsSync(join(repoRoot, "skills", n, "SKILL.md")));
  assert.equal(skills.length, 17);
  for (const [pfad] of PROZESS) {
    const text = readFileSync(join(repoRoot, pfad), "utf-8");
    for (const name of skills) {
      assert.match(text, new RegExp(String.raw`^#{2,4} \/${maskiert(name)}$`, "m"), `${pfad}: keine Überschrift für /${name}`);
    }
  }
});

test("Kriterium 3: prozess.md beschreibt Szenarien mit Beispiel und den Vermerk „Keine“ unter /groom", () => {
  const text = readFileSync(join(DOCS, "prozess.md"), "utf-8");
  const szenarien = abschnitt(text, "### Szenarien im Fachplan");
  assert.ok(szenarien, "der Abschnitt zu Szenarien fehlt");
  for (const wort of ["Angenommen", "Wenn", "Dann", "Und"]) {
    assert.match(szenarien, new RegExp(`\`${wort}\``), `das Schlüsselwort ${wort} fehlt`);
  }
  assert.match(szenarien, /```markdown\n## Szenarien\n\n### Szenario: [^\n]+\n- Angenommen [^\n]+\n(- [^\n]+\n)*- Wenn [^\n]+\n(- [^\n]+\n)*- Dann /, "das Beispiel fehlt");
  assert.match(abschnitt(text, "### /groom"), /Vermerk „Keine“/, "der Vermerk „Keine“ fehlt unter /groom");
});
