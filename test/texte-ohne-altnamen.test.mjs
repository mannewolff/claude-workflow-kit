// Regeltext, Vorlagen, Pruefrollen und Agenten nennen nur englische Namen (Issue #1571, Plan
// #1548, Block F, E15, E17, E19).
//
// Die Texte unter `templates/`, `kit/rollen/` und `agents/` gehoeren dem Projekt und bleiben
// zweisprachig (Kriterium 7 der fachlichen Quelle #1527); beide Fassungen nennen aber nur noch
// die englischen Skill-, Kommando-, Praefix- und Labelnamen (Kriterium 8). Ein frueherer Name
// darf nur in einer Tabellenzeile alt → neu stehen, die auch den neuen Namen traegt.
//
// Die festen Anfaenge der Vorgeschichte (`Suchbegriffe:`, `- Widerspruch:` …) bleiben, wie sie
// sind (E17). Die englischen Pruefrollen schreiben die Fundblock-Zeilen englisch, die Werte
// hinter `Art:` bleiben deutsch (E19, E5).
//
// Geprueft wird die Quelle, nicht die installierte Kopie unter `.claude/`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALTNAMEN, LABELS, MARKER, PRAEFIXE } from "../kit/board/namen.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORDNER = ["templates", "en/templates", "kit/rollen", "en/kit/rollen", "agents", "en/agents"];
const DATEIEN = ORDNER.flatMap((o) => readdirSync(join(repoRoot, o))
  .filter((n) => n.endsWith(".md")).sort().map((n) => `${o}/${n}`));
const text = (pfad) => readFileSync(join(repoRoot, pfad), "utf-8");

const esc = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
// Ein Name als ganzer Name: kein Wortzeichen und kein Bindestrich davor oder dahinter.
const ganz = (s) => `(?<![\\w-])${s}(?![\\w-])`;

// Die deutschen Flags von night.mjs, die seit Issue #1565 abgewiesen werden
// (DEUTSCHE_FLAGS in kit/night/grundlagen.mjs).
const NACHT_FLAGS = { "--kette": "--chain", "--pruefen": "--check", "--waechter": "--watcher" };
const KOMMANDO_DATEIEN = { "befunde.mjs": "findings.mjs", "aufwand.mjs": "effort.mjs",
  "wirksamkeit.mjs": "effectiveness.mjs", "einstellungen.mjs": "settings.mjs" };
const SKILLS = { fachplan: "requirement", kontext: "session-start", context: "session-start",
  review: "kit-review", plan: "techplan" };

// Je frueherer Name: Beschreibung, Muster und die neuen Namen, die eine Tabellenzeile alt → neu
// tragen muss.
const ALTE = [
  ...Object.entries(SKILLS).map(([alt, neu]) =>
    // Pfade wie `docs/plan.md` zaehlen nicht.
    [`Skill /${alt}`, new RegExp(`(?<![\\w/.-])\\/${alt}(?![\\w-]|\\.\\w)`), `/${neu}`]),
  ...Object.entries(KOMMANDO_DATEIEN).map(([alt, neu]) => [`Datei ${alt}`, new RegExp(ganz(esc(alt))), neu]),
  ...Object.entries(NACHT_FLAGS).map(([alt, neu]) => [`night.mjs ${alt}`, new RegExp(ganz(esc(alt))), neu]),
  ...Object.entries(ALTNAMEN.achsen).map(([a, neu]) => [`Achse ${a}`, new RegExp(`board\\.mjs\\s+${ganz(esc(a))}`), neu]),
  ...Object.entries(ALTNAMEN.befehle).flatMap(([achse, befehle]) => Object.entries(befehle).map(([b, neu]) =>
    [`Befehl ${achse} ${b}`, new RegExp(`${ganz(esc(achse))}\\s+${esc(b)}(?![\\w-])`), neu])),
  ...Object.entries(ALTNAMEN.schutz).map(([a, neu]) =>
    [`Aktion ${a}`, new RegExp(`(?:protection|schutz)\\s+${esc(a)}(?![\\w-])`), neu]),
  ["Befehl code schutz", /\bcode\s+schutz(?![\w-])/, "protection"],
  ...Object.entries(ALTNAMEN.optionen).map(([o, neu]) =>
    [`Option --${o}`, new RegExp(`(?<![\\w-])--${esc(o)}(?![\\w-])`), `--${neu}`]),
  ...Object.entries(ALTNAMEN.werte).flatMap(([option, werte]) => Object.entries(werte).map(([w, neu]) =>
    [`Wert --${option} ${w}`, new RegExp(`--${esc(option)}[\\s=]+${esc(w)}(?![\\w-])`), neu])),
  ...[...Object.values(PRAEFIXE), ...Object.values(LABELS)].filter(({ de, en }) => de !== en)
    .map(({ de, en }) => [de, new RegExp(ganz(esc(de))), en]),
];

// Eine Tabellenzeile alt → neu, die den neuen Namen traegt, darf den alten nennen.
const tabelleAltNeu = (zeile, neu) => /^\s*\|/.test(zeile) && zeile.includes(neu);

function funde(inhalt) {
  return inhalt.split("\n").flatMap((zeile, i) => ALTE
    .filter(([, muster, neu]) => muster.test(zeile) && !tabelleAltNeu(zeile, neu))
    .map(([was]) => `${i + 1}: ${was} — ${zeile.trim().slice(0, 140)}`));
}

test("die Liste der Texte ist vollstaendig", () => {
  for (const d of ["templates/CLAUDE-workflow.md", "templates/CLAUDE-Fachplan.md", "templates/CLAUDE-Plan.md",
    "en/templates/CLAUDE-workflow.md", "kit/rollen/code-review.md", "en/kit/rollen/code-review.md",
    "agents/kit-pruefer.md", "en/agents/kit-pruefer.md"]) {
    assert.ok(DATEIEN.includes(d), `${d} fehlt`);
  }
});

for (const pfad of DATEIEN) {
  test(`${pfad}: nennt keinen frueheren Namen als gueltigen Namen`, () => {
    const liste = funde(text(pfad));
    assert.deepEqual(liste, [], `${pfad}:\n${liste.join("\n")}`);
  });
}

test("Pruefung: ein alter Name ausserhalb einer Tabelle faellt auf, in der Tabelle alt → neu nicht", () => {
  assert.equal(funde("Rufe `/fachplan #12` auf.").length, 1);
  assert.equal(funde("Starte `node .claude/kit/night.mjs --kette`.").length, 1);
  assert.equal(funde("`board.mjs issue melden 12`").length, 1);
  assert.equal(funde("Titel mit [Fachlich] anlegen").length, 1);
  assert.equal(funde("| `/fachplan` | `/requirement` |").length, 0);
  assert.equal(funde("| `/fachplan` | `/techplan` |").length, 1, "die Tabellenzeile muss den neuen Namen tragen");
  assert.equal(funde("siehe `docs/plan.md`").length, 0);
});

test("Abschnitt Titel-Praefixe: schreibt englisch, erkennt beide", () => {
  const de = text("templates/CLAUDE-workflow.md").replaceAll(/\s+/g, " ");
  assert.match(de, /schreibt englisch, erkennt beide/);
  const en = text("en/templates/CLAUDE-workflow.md").replaceAll(/\s+/g, " ");
  assert.match(en, /writes English, recognises both/);
});

const ROLLEN = readdirSync(join(repoRoot, "en/kit/rollen")).filter((n) => n.endsWith(".md")).sort();

for (const rolle of ROLLEN) {
  test(`en/kit/rollen/${rolle}: Fundblock-Zeilen englisch aus dem Register`, () => {
    const inhalt = text(`en/kit/rollen/${rolle}`);
    for (const sache of ["gegenprobe", "art", "geprueftBestaetigt"]) {
      assert.doesNotMatch(inhalt, new RegExp(esc(MARKER[sache].de)), `${rolle}: ${MARKER[sache].de} steht noch deutsch`);
    }
  });

  test(`kit/rollen/${rolle}: Fundblock-Zeilen deutsch`, () => {
    const inhalt = text(`kit/rollen/${rolle}`);
    for (const sache of ["gegenprobe", "art", "geprueftBestaetigt"]) {
      assert.doesNotMatch(inhalt, new RegExp(esc(MARKER[sache].en)), `${rolle}: ${MARKER[sache].en} in der deutschen Fassung`);
    }
  });
}
