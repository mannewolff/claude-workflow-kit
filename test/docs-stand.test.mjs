// Die Doku beschreibt das Kit, wie es ist (Plan #1652, A7).
//
// Die Pruefungen gelten fuer die Seiten der Liste SEITEN: Jedes Paket des Plans nimmt
// seine neu geschriebene Seite auf (E10), das letzte ersetzt die Liste durch alle
// aktuellen Seiten und schaltet die Wortsumme scharf. Bis dahin steht das Budget der
// eigenen Seite nur als Hinweis in der Ausgabe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHLUESSEL } from "../kit/board/config-namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(repoRoot, "docs");

/** Die neu geschriebenen Seiten, je mit ihrem Wortbudget (A2). */
const SEITEN = { einstellungen: 3600, quickstart: 500, lokal: 400, wsl2: 650, pruefbereiche: 600, glossar: 400, index: 100, prozess: 5000 };

/** Eingebaute Claude-Code-Kommandos, die die Doku nennt (E7). */
const EINGEBAUT = new Set(["help"]);

/** Ueberschriften der Update-Hinweise; ihr Abschnitt ist von (b) ausgenommen (E5). */
const AUSNAHMEN = new Set(["Umzug von nativem Windows"]);

/** Wendungen, die von einer frueheren Fassung erzaehlen. */
const WENDUNGEN = ["früher galt", "früher hieß", "seit Issue", "wurde entfernt", "ehemals", "Altname"];

const START = "<!-- einstellungen:start -->";
const ENDE = "<!-- einstellungen:ende -->";

function seiten() {
  const liste = [];
  for (const name of Object.keys(SEITEN)) {
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
    if (feld === "version") continue;
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

test("Szenario: Jeder genannte Name funktioniert", () => {
  const skills = new Set(readdirSync(join(repoRoot, "skills")).filter((n) => existsSync(join(repoRoot, "skills", n, "SKILL.md"))));
  for (const { name, text } of seiten()) {
    for (const [, aufruf] of text.matchAll(/`\/([a-z][a-z0-9-]*)(?:\s[^`]*)?`/g)) {
      assert.ok(skills.has(aufruf) || EINGEBAUT.has(aufruf), `${name}: /${aufruf} gibt es weder unter skills/ noch als eingebautes Kommando`);
    }
  }
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

test("Kriterium 7: jede Einstellung steht mit englischem Pfad und Vorgabe in docs/einstellungen.md", (t) => {
  const text = readFileSync(join(DOCS, "einstellungen.md"), "utf-8");
  const pfade = einstellungen();
  assert.ok(pfade.length >= 154, `nur ${pfade.length} Einstellungen gefunden`);
  for (const pfad of [...pfade.map(englisch), "vault", "always", "projectDocs", "project", "logPath", "parentProject"]) {
    const zeile = new RegExp(String.raw`^- \`${maskiert(pfad)}\` — .*(Vorgabe: \S|Keine Vorgabe\.)`, "m");
    assert.match(text, zeile, `${pfad} fehlt mit Vorgabe oder „Keine Vorgabe“`);
  }
  for (const [seite, budget] of Object.entries(SEITEN)) {
    const woerter = readFileSync(join(DOCS, `${seite}.md`), "utf-8").split(/\s+/).filter(Boolean).length;
    t.diagnostic(`${seite}: ${woerter} Wörter, Budget ${budget}`);
  }
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
  assert.equal(skills.length, 18);
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
