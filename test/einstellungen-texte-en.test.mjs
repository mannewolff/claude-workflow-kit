// Die Einstellungsoberflaeche spricht die Sprache des Projekts (Issue #1456, Plan #1420 E13, E14).
//
// Jede Ausgabe an den Menschen steht in der Texttabelle TEXTE { de, en } von kit/settings.mjs
// und geht ueber den Texthelfer aus kit/board/namen.mjs, den tools/sync-blobs.mjs einbettet. Die
// Befunde, Saetze und Hinweise des Servers stehen in der Sprache des jeweiligen Projekts, die
// Seite stellt Texte und lang-Attribut mit dem geoeffneten Projekt um, und die Kommandozeile
// folgt der Config im Arbeitsverzeichnis. Vertragswerte (E14) bleiben: die Feldnamen der
// Antworten, die Befundarten und die Pfade unter den deutschen Namen.
// Ablauf-Pruefung: Dass die Datei allein, ohne Repo-Kontext, laeuft, zeigt nur ihr Start als eigener Prozess aus einem Wegwerf-Verzeichnis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { LAUFARTEN, TEILE, TEXTE, THEMEN, aenderungsliste, projektZustand, pruefeSchema, speichere, vorschau } from "../kit/settings.mjs";
import { pruefeParitaet } from "../kit/board/namen.mjs";
import { mitServer, projekt } from "./helpers/einstellungen-fixture.mjs";
import { oberflaecheStarten } from "./helpers/oberflaeche-vm.mjs";

const QUELLE = fileURLToPath(new URL("../kit/settings.mjs", import.meta.url));

/** Ein Projekt mit Befunden: ein unbekannter Bereich, ein Reviewer ohne Modell, keine Kit-Datei. */
const ENGLISCH = {
  language: "en",
  codeHost: "local",
  issueTracker: "local",
  buildChecks: [{ cmd: "node --test", areas: ["gone"] }],
  checkAreas: { empty: [] },
  issueReview: { requiredBeforeReady: true, reviewers: [{ name: "opus", kind: "claude" }, { name: "gpt", kind: "command", command: "codex" }], pairs: { opus: ["gpt"] } },
  mainBranch: "main",
};
const DEUTSCH = { ...ENGLISCH, language: undefined };

const UMLAUTE = /[äöüÄÖÜß„]/;
const UMLAUT_STELLE = new RegExp(`.{0,40}${UMLAUTE.source}.{0,40}`);

/** Die Texte, die es nur deutsch gibt — sie duerfen in einem englischen Projekt nirgends stehen. */
const NUR_DEUTSCH = Object.entries(TEXTE.de)
  .filter(([k, v]) => v !== TEXTE.en[k] && !/\{/.test(v) && v.trim().length > 4)
  .map(([, v]) => v.trim());

function mitProjekt(team, fn, { stand } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), "einstellungen-texte-"));
  const home = mkdtempSync(join(tmpdir(), "einstellungen-texte-home-"));
  try {
    const pfad = projekt(wurzel, "p", { team, stand });
    return fn({ projekt: { name: "p", pfad }, optionen: { home, eigenerStand: "5.0.0" } });
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

const befundeVon = (zustand) => Object.values(zustand.themen).flat().flatMap((t) => t.eintraege).flatMap((e) => e.befunde);

test("[1456-1] TEXTE traegt je Sprache dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(TEXTE), []);
});

test("[1456-2] Titel der Teile, Themen und Laufarten stehen deutsch in der Tabelle wie in ihren Konstanten", () => {
  for (const teil of TEILE.filter((t) => t.titel !== null)) assert.equal(TEXTE.de[`teil.${teil.kennung}`], teil.titel, teil.kennung);
  for (const thema of new Set([...Object.values(THEMEN), "Unbekannt"])) assert.equal(TEXTE.de[`thema.${thema}`], thema, thema);
  for (const [kennung, aufschrift] of LAUFARTEN) assert.equal(TEXTE.de[`laufart.${kennung}`], aufschrift, kennung);
});

test("[1456-3] ein englisches Projekt bekommt Befunde, Titel und Hinweise auf Englisch", () => {
  mitProjekt(ENGLISCH, ({ projekt: p, optionen }) => {
    const zustand = projektZustand(p, optionen);
    assert.equal(zustand.sprache, "en");
    assert.deepEqual(zustand.hinweise, ["Kit version unknown — no board.mjs in the project and none under ~/.claude/kit; read-only."]);
    const gruende = befundeVon(zustand).map((b) => b.grund);
    assert.ok(gruende.includes("names 'gone', which is not in checkAreas"), gruende.join(" | "));
    assert.ok(gruende.includes("'model' is missing — a reviewer of kind 'claude' does not run without a model identifier"), gruende.join(" | "));
    assert.ok(gruende.includes("lists no pattern and so covers nothing — checks that point to this area never run"), gruende.join(" | "));
    for (const g of gruende) assert.doesNotMatch(g, UMLAUTE, g);
    assert.deepEqual(Object.keys(zustand.themen).sort(), ["Board", "Nachtbetrieb", "Prüfungen", "Release", "Review"].sort(), "die Themen bleiben Schluessel unter den deutschen Namen (E14)");
    const titel = Object.values(zustand.themen).flat().map((t) => t.titel).filter(Boolean);
    assert.ok(titel.includes("Check commands and areas") && titel.includes("Pairings"), titel.join(" | "));
    assert.deepEqual(befundeVon(zustand).map((b) => b.art).sort(), befundeVon(zustand).map((b) => b.art).sort().filter((a) => ["fehler", "warnung", "unbekannt"].includes(a)), "die Befundart bleibt Vertragswert");
  });
});

test("[1456-4] Vorschau und Speichern sprechen im englischen Projekt Englisch", () => {
  mitProjekt({ ...ENGLISCH, buildChecks: ["node --test"], checkAreas: { web: ["src/**"] } }, ({ projekt: p, optionen }) => {
    const hashes = projektZustand(p, optionen).hashes;
    const v = vorschau(p, { ebene: "team", teil: "m4", aenderungen: [{ pfad: "checkAreas", wert: { web: ["src/**"], neu: [] } }], hashes }, optionen);
    assert.equal(v.status, 200);
    assert.deepEqual(v.body.aenderungen.map((a) => a.satz), ["checkAreas.neu is added: []"]);
    assert.ok(v.body.befunde.some((b) => b.grund.startsWith("lists no pattern")), JSON.stringify(v.body.befunde));
    const aus = speichere(p, { ebene: "team", aenderungen: [{ pfad: "buildChecks", wert: [] }], hashes }, optionen);
    assert.equal(aus.status, 409);
    assert.deepEqual(aus.body.abgeschaltet.map((a) => a.text), ["The mandatory checks are being emptied — the commit gate and the night runner check nothing afterwards."]);
    const alt = speichere(p, { ebene: "team", aenderungen: [], hashes: { team: "x", lokal: null } }, optionen);
    assert.deepEqual(alt.body, { art: "geaendert", grund: "The file has changed since it was loaded." }, "art bleibt Vertragswert, grund ist Freitext");
  }, { stand: "5.0.0" });
});

test("[1456-5] ein deutsches Projekt bleibt deutsch, und die Sprache eines Projekts sickert nicht in den Prozess", () => {
  mitProjekt(ENGLISCH, ({ projekt: p, optionen }) => projektZustand(p, optionen));
  assert.deepEqual(pruefeSchema("x", { type: "integer" }).map((b) => b.grund), ["muss vom Typ integer sein, ist string"]);
  assert.deepEqual(aenderungsliste({ a: 1 }, { a: 2 }).map((a) => a.satz), ["a wird 2 statt 1"]);
  mitProjekt(DEUTSCH, ({ projekt: p, optionen }) => {
    const zustand = projektZustand(p, optionen);
    assert.equal(zustand.sprache, "de");
    assert.ok(befundeVon(zustand).some((b) => b.grund === "nennt 'gone', das nicht in checkAreas steht"));
  });
});

/** Ein Text als ganzes Wort: "Reviewer" steckt in "Reviewers", ist dort aber nicht der deutsche Titel. */
const maskiert = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const alsWort = (text) => new RegExp(String.raw`(?<![\p{L}\p{N}])` + maskiert(text) + String.raw`(?![\p{L}\p{N}])`, "u");

/** Alles, was die Seite zeigt: Text, Platzhalter und Titel ueber den ganzen Baum. */
function sichtbar(seite, wurzel) {
  const teile = [wurzel.textContent];
  for (const e of seite.alle(wurzel, () => true)) teile.push(e.placeholder, e.title);
  return teile.filter(Boolean).join("\n");
}

test("[1456-6] die Seite zeigt in einem englischen Projekt in keinem Thema einen deutschen Text", async () => {
  await mitServer((w) => projekt(w, "alpha", { team: { ...ENGLISCH, night: { modelle: ["opus"], stufen: { schwer: { modell: "opus" } } } }, stand: "5.0.0" }), async (s) => {
    const seite = await oberflaecheStarten({ basis: s.basis, token: s.token });
    assert.equal(seite.ids.stand.textContent, "Interface 5.0.0", "die Startsprache folgt dem einzigen Projekt");
    seite.klick(seite.projektKnopf("alpha"));
    await seite.ruhe();
    const themen = seite.alle(seite.ids.themen, (e) => e.tagName === "BUTTON");
    assert.deepEqual(themen.map((b) => b.textContent), ["Checks", "Board", "Review", "Night operation", "Release"]);
    for (const knopf of themen) {
      seite.klick(knopf);
      await seite.ruhe();
      seite.feuere();
      await seite.ruhe();
      const text = sichtbar(seite, seite.dokument.body);
      for (const deutsch of NUR_DEUTSCH) assert.ok(!alsWort(deutsch).test(text), `${knopf.textContent}: "${deutsch}" erscheint`);
      assert.doesNotMatch(text, UMLAUTE, `${knopf.textContent}: ${text.match(UMLAUT_STELLE)?.[0]}`);
    }
  });
});

test("[1456-7] dieselbe Seite bleibt in einem deutschen Projekt deutsch", async () => {
  await mitServer((w) => projekt(w, "alpha", { team: DEUTSCH, stand: "5.0.0" }), async (s) => {
    const seite = await oberflaecheStarten({ basis: s.basis, token: s.token });
    assert.equal(seite.ids.stand.textContent, "Oberfläche 5.0.0");
    seite.klick(seite.projektKnopf("alpha"));
    await seite.ruhe();
    assert.deepEqual(seite.alle(seite.ids.themen, (e) => e.tagName === "BUTTON").map((b) => b.textContent), ["Prüfungen", "Board", "Review", "Nachtbetrieb", "Release"]);
    assert.ok(seite.ids.einstellungen.textContent.includes("Prüfkommandos und Bereiche"));
  });
});

/** Ein Wegwerf-Verzeichnis mit nur dieser Datei und einer Config; `fn` bekommt seinen Pfad. */
async function wegwerf(team, fn) {
  const dir = mkdtempSync(join(tmpdir(), "einstellungen-allein-"));
  try {
    mkdirSync(join(dir, ".claude"));
    copyFileSync(QUELLE, join(dir, "settings.mjs"));
    writeFileSync(join(dir, ".claude", "workflow.config.json"), `${JSON.stringify(team, null, 2)}\n`);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[1456-8] allein gestartet spricht die Datei in einem englischen Projekt nur Englisch", async () => {
  await wegwerf(ENGLISCH, async (dir) => {
    const hilfe = spawnSync(process.execPath, ["settings.mjs", "--help"], { cwd: dir, encoding: "utf-8", env: { ...process.env, HOME: dir } });
    assert.equal(hilfe.status, 0, hilfe.stderr);
    assert.match(hilfe.stdout, /^settings\.mjs — maintain the settings of the claude-workflow-kit/);
    assert.doesNotMatch(hilfe.stdout, UMLAUTE);
    const fehler = spawnSync(process.execPath, ["settings.mjs", "--port", "x"], { cwd: dir, encoding: "utf-8", env: { ...process.env, HOME: dir } });
    assert.equal(fehler.stderr, "Error: --port needs a number between 0 and 65535\n");

    const kind = spawn(process.execPath, ["settings.mjs", "--port", "0"], { cwd: dir, env: { ...process.env, HOME: dir } });
    try {
      const ausgabe = await new Promise((fertig, abbruch) => {
        let text = "";
        kind.stdout.on("data", (c) => {
          text += c;
          if (/Stop with Ctrl\+C\.\n$/.test(text)) fertig(text);
        });
        kind.on("exit", (code) => abbruch(new Error(`Oberflaeche endete mit ${code}: ${text}`)));
      });
      assert.doesNotMatch(ausgabe, UMLAUTE, ausgabe);
      const url = new URL(ausgabe.match(/Open: (\S+)/)[1]);
      const kopf = { "X-Einstellungen-Token": url.hash.replace("#token=", "") };
      const projekte = await (await fetch(`${url.origin}/api/projekte`, { headers: kopf })).json();
      assert.equal(projekte.sprache, "en");
      const name = projekte.projekte[0].name;
      const zustand = await (await fetch(`${url.origin}/api/projekt/${encodeURIComponent(name)}`, { headers: kopf })).json();
      for (const h of zustand.hinweise) assert.doesNotMatch(h, UMLAUTE, h);
      for (const b of befundeVon(zustand)) assert.doesNotMatch(b.grund, UMLAUTE, b.grund);
      const unbekannt = await (await fetch(`${url.origin}/api/projekt/gibt-es-nicht`, { headers: kopf })).json();
      assert.deepEqual(unbekannt, { grund: "Unknown project" });
      const html = await (await fetch(`${url.origin}/`)).text();
      assert.match(html, /<html lang="en">/);
      assert.match(html, /<title>Settings — claude-workflow-kit<\/title>/);
      assert.match(html, /id="projektname">Choose a project</);
    } finally {
      kind.kill();
    }
  });
});
