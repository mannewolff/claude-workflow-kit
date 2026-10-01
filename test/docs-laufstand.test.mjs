// Der Laufstand im Regeltext und in der Dokumentation (Issue #1082, Plan #1079, fachliche
// Quelle #1075).
//
// Nach E20 des Plans kommt die bindende Quelle zuerst: Die Prozessvorlage beschreibt den
// Laufstand, bevor das Werkzeug ihn baut. Geprueft werden `templates/CLAUDE-workflow.md`
// und `docs/dokumentation.md` — die Vorlage und nicht die Kopie unter `.claude/`: Die ist
// Installer-Ausgabe und in CI nicht vorhanden (siehe docs-wartende-sitzung.test.mjs).
//
// Der dritte Test prueft den Test selbst: Fehlt in einer Kopie genau eine Angabe, muss die
// Pruefung sie als fehlend melden. Sonst koennte ein zu weites Muster eine Angabe
// bestaetigen, die gar nicht dasteht.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const DOKU = lies("docs", "dokumentation.md");
const VORLAGE = lies("templates", "CLAUDE-workflow.md");

/** Der Text eines Abschnitts bis zur naechsten Ueberschrift derselben Ebene. */
function abschnitt(text, ueberschrift) {
  const ebene = ueberschrift.match(/^#+/)[0];
  const start = text.indexOf(`${ueberschrift}\n`);
  if (start === -1) return "";
  const rest = text.slice(start + ueberschrift.length);
  const naechste = rest.search(new RegExp(`^${ebene} `, "m"));
  return naechste === -1 ? rest : rest.slice(0, naechste);
}

// Die Angaben aus Punkt 2 des Pakets, je mit der Plan-Entscheidung, aus der sie stammt.
// Die beiden `wartet`-Formen stehen woertlich: Das Werkzeug schreibt sie spaeter genau so
// an die Karte, und der Regeltext ist ihre Quelle.
const ANGABEN = [
  ["das Label lauf:laeuft (E1)", /`lauf:laeuft`/],
  ["das Label lauf:abgebrochen (E1)", /`lauf:abgebrochen`/],
  ["das Label lauf:wartet (E1)", /`lauf:wartet`/],
  ["genau einen Kommentar `## Laufstand`, der ersetzt wird (E1)", /genau ein(?:en)? Kommentar `## Laufstand`[^.]*ersetzt/],
  ["Tafel, nicht Verlauf (E1)", /Tafel, nicht Verlauf/],
  ["dass der Nachtbericht Verlauf bleibt (E1)", /Nachtbericht bleibt Verlauf/],
  [
    "die wartet-Form des gesperrten Uebergangs woertlich (E1, E12)",
    /wartet: Übergang <x> im Projekt nicht freigegeben — weiter mit kit:night/,
  ],
  [
    "die wartet-Form des inhaltlichen Halts woertlich (E1)",
    /Halt: Frage wartet auf den Menschen — siehe `## Kette angehalten`/,
  ],
  ["die wartet-Form ohne kit:durchziehen (E12)", /wartet: Karte ohne Freigabe zur Umsetzung/],
  ["den Start bei der ersten Stufe ohne Ergebnis (E11)", /`kit:night`[^.]*ersten Stufe ohne Ergebnis/],
  ["den frischen Plan erst nach Done des alten (E9)", /frische[nr]? Plan[^.]*erst[^.]*Done/],
  ["die Uebergaenge im Projekt (E12)", /`night\.kette\.uebergaenge`/],
  ["abdeckungUmsetzung nur mit kit:durchziehen (E12)", /`abdeckungUmsetzung`[^.]*nur[^.]*`kit:durchziehen`/],
  [
    "den einen Versuch nur bei Umgebungsfehlern des lebenden Laufs (E13)",
    /(?:einen|ein) automatische[nr]? Versuch[^.]*nur bei Umgebungsfehlern[^.]*solange der Lauf lebt/i,
  ],
  ["den Vermerk 2. Versuch (E13)", /„2\. Versuch“/],
  ["dass ein gestorbener Lauf nicht wiederholt wird (E7, E13)", /gestorbene[rn]? Lauf wird nicht wiederholt/],
];

// Das Geruest des Doku-Unterabschnitts: die Ueberschriften, unter die die folgenden Pakete
// des Plans ihren Inhalt schreiben.
const GERUEST = [
  ["die Ueberschrift des Waechters", /^#### Der Wächter$/m],
  ["die Ueberschrift des Journals", /^#### Das Journal$/m],
  ["die Ueberschrift der Belegfaelle", /^#### Die Belegfälle$/m],
];

/** Die Namen der Angaben, die im Text fehlen. */
function fehlend(text, angaben) {
  return angaben.filter(([, muster]) => !muster.test(text)).map(([name]) => name);
}

const NACHT_VORLAGE = abschnitt(VORLAGE, "## Nachtbetrieb (optional)");
const LAUFSTAND_DOKU = abschnitt(abschnitt(DOKU, "## Nachtbetrieb"), "### Der Laufstand");

test("[docs-laufstand-1] der Nachtbetrieb-Abschnitt der Vorlage beschreibt den Laufstand", () => {
  assert.ok(NACHT_VORLAGE, "der Abschnitt '## Nachtbetrieb (optional)' fehlt in der Vorlage");
  assert.deepEqual(fehlend(NACHT_VORLAGE, ANGABEN), [], "der Nachtbetrieb-Abschnitt der Vorlage nennt nicht alles");
});

test("[docs-laufstand-2] das Nachtbetrieb-Kapitel der Doku hat den Unterabschnitt 'Der Laufstand' samt Geruest", () => {
  assert.ok(LAUFSTAND_DOKU, "der Unterabschnitt '### Der Laufstand' fehlt im Kapitel '## Nachtbetrieb'");
  assert.deepEqual(
    fehlend(LAUFSTAND_DOKU, [...ANGABEN, ...GERUEST]),
    [],
    "der Unterabschnitt 'Der Laufstand' nennt nicht alles"
  );
});

test("[docs-laufstand-3] eine Kopie ohne eine Angabe wird als unvollstaendig erkannt", () => {
  for (const [ort, text, angaben] of [
    ["Vorlage", NACHT_VORLAGE, ANGABEN],
    ["Doku", LAUFSTAND_DOKU, [...ANGABEN, ...GERUEST]],
  ]) {
    for (const [name, muster] of angaben) {
      const ohne = text.replace(new RegExp(muster.source, `${muster.flags}g`), "");
      assert.ok(
        fehlend(ohne, angaben).includes(name),
        `${ort}: eine Kopie ohne ${name} gilt weiterhin als vollstaendig`
      );
    }
  }
});

// Die Belegfaelle der fachlichen Anforderung (Issue #1091, Kriterium 11 aus #1075): Je Fall
// eine Tabellenzeile mit dem Kartenstand danach und dem Weg nach vorn. Ein Muster greift nur
// innerhalb einer Zeile (`[^\n]`), damit Fall, Stand und Geste in derselben Zeile stehen.
const BELEGFAELLE = [
  ["Fall 1 spurloser Lauf: nicht beendet, weiter mit kit:night", /^\| Spurlos[^\n]*`lauf:abgebrochen`[^\n]*nicht beendet[^\n]*`kit:night`[^\n]*\|$/m],
  ["Fall 2 Abbruch obwohl fertig: vorgefunden, weiter mit kit:night", /^\| Abgebrochen, obwohl fertig[^\n]*`lauf:abgebrochen`[^\n]*`kit:night`[^\n]*vorgefunden[^\n]*\|$/m],
  ["Fall 3 Ausgang unbekannt: 2. Versuch, sonst nicht begonnen", /^\| Ausgang unbekannt[^\n]*„2\. Versuch“[^\n]*nicht begonnen[^\n]*`kit:night`[^\n]*\|$/m],
  ["Fall 4 ein Paket haelt die Nacht an: nur das Paket, Stash", /^\| Ein Paket hält die Nacht an[^\n]*`lauf:abgebrochen`[^\n]*hängt an #N[^\n]*`nachtrest #<id> <lauf>`[^\n]*\|$/m],
  ["Fall 5 verschraenkte Protokolle: Zeile Protokoll", /^\| Verschränkte Protokolle[^\n]*`Protokoll:`[^\n]*`\.claude\/protokolle\/<lauf>\/<karte>-<stufe>\.log`[^\n]*\|$/m],
];

// Punkt 3 des Pakets: Waechter und Frist, Journal und Nachtrag, Teilschnitt, Stash.
const ZUSAETZE = [
  ["die Frist des Waechters", /`night\.stand\.fristMin`/],
  ["dass ein lebender Lauf nie als verstummt gilt", /lebt[^.]*nie als verstummt/],
  ["das Journal", /`\.claude\/lauf\/<lauf>\.jsonl`/],
  ["den Nachtrag", /nachgetragen/],
  ["den Teilschnitt und sein Aufraeumen", /Teilschnitt am Board aufräumen, dann erneut kit:night/],
  ["das Zurueckholen des Stashs", /`git stash apply stash@\{<n>\}`/],
];

const BELEGE_DOKU = abschnitt(LAUFSTAND_DOKU, "#### Die Belegfälle");
const WACHE_JOURNAL_DOKU = LAUFSTAND_DOKU.slice(LAUFSTAND_DOKU.indexOf("#### Der Wächter"));

test("[docs-laufstand-4] die Belegfaelle zeigen je Fall Kartenstand und Weg nach vorn", () => {
  assert.ok(BELEGE_DOKU, "der Unterabschnitt '#### Die Belegfälle' fehlt");
  assert.deepEqual(fehlend(BELEGE_DOKU, BELEGFAELLE), [], "nicht jeder Belegfall steht in der Tabelle");
});

test("[docs-laufstand-5] Waechter, Journal, Teilschnitt und Stash sind beschrieben", () => {
  assert.deepEqual(fehlend(WACHE_JOURNAL_DOKU, ZUSAETZE), [], "es fehlt eine Angabe");
});

test("[docs-laufstand-6] eine Kopie ohne einen Belegfall oder Zusatz wird als unvollstaendig erkannt", () => {
  for (const [text, angaben] of [
    [BELEGE_DOKU, BELEGFAELLE],
    [WACHE_JOURNAL_DOKU, ZUSAETZE],
  ]) {
    for (const [name, muster] of angaben) {
      const ohne = text.replace(new RegExp(muster.source, `${muster.flags}g`), "");
      assert.ok(fehlend(ohne, angaben).includes(name), `eine Kopie ohne ${name} gilt weiterhin als vollstaendig`);
    }
  }
});
