// Ziel, Prueferzahl und Vorbereitung der Veroeffentlichung im Regeltext und in der
// Dokumentation (Issue #1255, Plan #1243, fachliche Quelle #1192).
//
// Das Verhalten bauen #1249, #1251, #1253 und #1254; dieses Paket beschreibt es. Geprueft
// werden `templates/CLAUDE-workflow.md` und `docs/dokumentation.md` — die Vorlage und nicht
// die Kopie unter `.claude/`, die Installer-Ausgabe ist (siehe docs-laufstand.test.mjs).
//
// Die Werte, die das Werkzeug an die Karte schreibt (Ziel-Labels, Prueferzahl, die Saetze
// `Als Nächstes`, der Build-Dienst-Punkt), kommen aus dem Code: Eine Doku, die Werte nennt,
// die das Programm nicht kennt, ist schlimmer als keine (docs-pruefstufen.test.mjs).
//
// Der letzte Test prueft den Test selbst: Fehlt in einer Kopie genau eine Angabe, muss die
// Pruefung sie als fehlend melden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KETTE_ZIELE, PLANREVIEW_LABELS, ZIEL_LABEL_PRAEFIX } from "../kit/night/session.mjs";
import { KETTE_ZIEL_ANKER } from "../kit/night/kette.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = (...p) => readFileSync(join(repoRoot, ...p), "utf-8");

const DOKU = lies("docs", "dokumentation.md");
const VORLAGE = lies("templates", "CLAUDE-workflow.md");

/** Der Text eines Abschnitts bis zur naechsten Ueberschrift derselben oder hoeheren Ebene. */
function abschnitt(text, ueberschrift) {
  const ebene = ueberschrift.match(/^#+/)[0].length;
  const start = text.indexOf(`${ueberschrift}\n`);
  if (start === -1) return "";
  const rest = text.slice(start + ueberschrift.length);
  const naechste = rest.search(new RegExp(`^#{1,${ebene}} `, "m"));
  return naechste === -1 ? rest : rest.slice(0, naechste);
}

/** Die Namen der Angaben, die im Text fehlen. */
function fehlend(text, angaben) {
  return angaben.filter(([, muster]) => !muster.test(text)).map(([name]) => name);
}

const esc = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const ZIEL_LABELS = KETTE_ZIELE.map(({ ziel }) => `${ZIEL_LABEL_PRAEFIX}${ziel}`);

// Der Wortlaut nach E14/E17, woertlich: An ihm misst jeder Review, ob W3 die Uebernahme am
// Morgen deckt und ob der Weg ueber den Build-Dienst den Push-Lauf je auslaesst.
const W3_WORTLAUT =
  "beim `push main` oder in der Vorbereitung der Nacht für genau den Commit, den `push main` unverändert übernimmt; fährt das Projekt sie im Build-Dienst, läuft sie immer beim `push main` auf dem Prüfzweig";

const GO_ZIEL = ["das GO ueber kit:durchziehen oder ein Ziel ab umsetzung", /`kit:durchziehen` oder ein Ziel ab `umsetzung`/];

const W3_ANGABEN = [
  ["den W3-Wortlaut samt Build-Dienst-Satz (E14, E17)", new RegExp(esc(W3_WORTLAUT))],
  ["kein Commit ohne gruenen Nachweis", /[Kk]ein Commit ohne gr(?:ü|ue)nen Nachweis/],
  ["keine Uebernahme eines roten oder geaenderten Stands", /keine (?:Ü|Ue)bernahme eines roten oder ge(?:ä|ae)nderten Stands/],
];

const NACHT_ANGABEN = [
  ...ZIEL_LABELS.map((l) => [`das Ziel-Label ${l}`, new RegExp(`\`${esc(l)}\``)]),
  ...PLANREVIEW_LABELS.map((l) => [`das Label ${l}`, new RegExp(`\`${esc(l)}\``)]),
  ["den Verbrauch von Ziel und planreview beim Start (E1)", /verbrauch[^.]*(?:Ziel[^.]*`planreview:\*`|`planreview:\*`[^.]*Ziel)/],
  ["das Ende am Ziel mit fertig bis (E5)", /`fertig bis <Ziel>`/],
  ["die Projektgrenze (E6)", /Projektgrenze/],
  ["den Uebergang umsetzungVorbereitung (E7)", /`umsetzungVorbereitung`/],
  ["die Stufe vorbereitung", /Stufe `vorbereitung`/],
  ["das Warten, bis nichts mehr baut (E8)", /wartet[^.]*bis nichts mehr baut/],
  ["den eigenen Worktree der Vorbereitung", /`vorbereitung`[^.]*eigenen Worktree/],
  ["kein Push in der Vorbereitung", /`vorbereitung`[^.]*(?:pusht nicht|ohne Push)/],
  ["den Nachweislauf der Paketstufe bei pushPruefung im Build-Dienst (E17)", /`pushPruefung`[^.]*Build-Dienst[^.]*Nachweislauf der Paketstufe/],
  ["den vollen Lauf im Build-Dienst als offenen Punkt (E17)", /voller Lauf im Build-Dienst \(Prüfzweig <zweig>\)/],
  ["die feste Stelle .claude/push-vorbereitung.json", /`\.claude\/push-vorbereitung\.json`/],
];

const PFLICHT_VORLAGE = abschnitt(VORLAGE, "## Pflichtchecks vor Push (Schritt 6)");
const W3_VORLAGE = abschnitt(VORLAGE, "### W3 — Rote Pflichtchecks blockieren den Push mechanisch `[Urteil]`");
const W1_VORLAGE = abschnitt(VORLAGE, "### W1 — Die drei Stop-Punkte bleiben menschlich `[Urteil]`");
const STOP_VORLAGE = abschnitt(VORLAGE, "## Die drei Stop-Punkte (nie automatisiert)");
const NACHT_VORLAGE = abschnitt(VORLAGE, "## Nachtbetrieb (optional)");

test("[ziel-1] Stop-Punkte und W1 nennen das GO ueber kit:durchziehen oder ein Ziel ab umsetzung", () => {
  for (const [ort, text] of [["Stop-Punkte", STOP_VORLAGE], ["W1", W1_VORLAGE]]) {
    assert.ok(text, `der Abschnitt ${ort} fehlt in der Vorlage`);
    assert.deepEqual(fehlend(text, [GO_ZIEL]), [], `${ort} nennt das GO am Ziel nicht`);
  }
});

test("[ziel-2] Pflichtchecks und W3 tragen den Wortlaut nach E14 und E17", () => {
  for (const [ort, text] of [["Pflichtchecks vor Push", PFLICHT_VORLAGE], ["W3", W3_VORLAGE]]) {
    assert.ok(text, `der Abschnitt ${ort} fehlt in der Vorlage`);
    assert.deepEqual(fehlend(text, W3_ANGABEN), [], `${ort} nennt nicht alles`);
  }
  assert.match(PFLICHT_VORLAGE, /mit `pushPruefung` in seinen Build-Dienst/, "der vorhandene Satz zu pushPruefung fehlt");
});

test("[ziel-3] der Nachtbetrieb-Abschnitt der Vorlage beschreibt Ziel, Grenze und Vorbereitung", () => {
  assert.ok(NACHT_VORLAGE, "der Abschnitt '## Nachtbetrieb (optional)' fehlt");
  assert.deepEqual(fehlend(NACHT_VORLAGE, NACHT_ANGABEN), [], "der Nachtbetrieb-Abschnitt nennt nicht alles");
});

const KETTE_DOKU = abschnitt(DOKU, "### Zweiter Modus: die Nacht-Kette");
const ZIEL_DOKU = abschnitt(KETTE_DOKU, "#### Wie weit eine Kette läuft: das Ziel");
const LAUFSTAND_DOKU = abschnitt(DOKU, "### Der Laufstand");
const PUSH_DOKU = abschnitt(DOKU, "### /push-main");

// Die Saetze `Als Nächstes` stehen im Werkzeug (E5); die Tabelle nennt je Ziel einen davon.
const ALS_NAECHSTES = {
  plan: "Plan lesen, dann `kit:night` an den Plan.",
  pakete: "Pakete nach Ready ziehen.",
  umsetzung: "Pakete in In review testen, dann `push main`.",
  "push-vorbereitet": "Meldung der Vorbereitung lesen, dann `push main`.",
};

const ZIEL_TABELLE = KETTE_ZIELE.map(({ ziel, endstufe }) => [
  `die Tabellenzeile ${ziel} mit letzter Stufe ${endstufe}`,
  new RegExp(`^\\| \`${esc(ZIEL_LABEL_PRAEFIX + ziel)}\` \\| \`${endstufe}\` \\|[^\\n]*${esc(ALS_NAECHSTES[ziel])}[^\\n]*\\|$`, "m"),
]);

const ZIEL_ANGABEN = [
  ...ZIEL_TABELLE,
  ["planreview:2", /`planreview:2`/],
  ["die Labels je Board einmal anlegen", /je Board einmal angelegt/],
  ["den Anker der Ablehnung (E3)", new RegExp(esc(`\`${KETTE_ZIEL_ANKER}\``))],
  ["mehr als ein Ziel als Ablehnung (E3)", /mehr als ein `ziel:\*`/],
  ["ziel:plan am Plandokument als Ablehnung (E3)", /`ziel:plan` an einem Plandokument/],
  ["planreview am Plandokument als Ablehnung (E3)", /`planreview:\*` an einem Plandokument/],
  ["planreview bei schon geprueftem Plan als Ablehnung (E3)", /`planreview:\*`[^.]*`Plan-Review:`/],
];

const LAUFSTAND_ANGABEN = [
  ["die Zeile Ziel:", /`Ziel: <[^>]+>`/],
  ["die Zeile Grenze:", /`Grenze: <[^>]+>`/],
  ["den Kopf fertig bis", /`fertig bis <Ziel>`/],
];

const PUSH_ANGABEN = [
  ["den Modus vorbereiten", /`\/push-main vorbereiten`/],
  ["die Uebernahme am Morgen", /Übernimmt den Stand der Nacht vom <zeitpunkt> \(<commit>\)/],
  ["die feste Stelle", /`\.claude\/push-vorbereitung\.json`/],
  ["die Uebernahme auch ueber den Build-Dienst (E17)", /Build-Dienst[^.]*Prüfzweig[^.]*/],
  ["den Build-Dienst-Punkt als offene Pruefung (E17)", /voller Lauf im Build-Dienst \(Prüfzweig <zweig>\)/],
];

test("[ziel-4] die Nacht-Kette hat den Unterabschnitt zum Ziel mit Tabelle, Prueferzahl und Ablehnungen", () => {
  assert.ok(ZIEL_DOKU, "der Unterabschnitt '#### Wie weit eine Kette läuft: das Ziel' fehlt");
  assert.deepEqual(fehlend(ZIEL_DOKU, ZIEL_ANGABEN), [], "der Unterabschnitt nennt nicht alles");
});

test("[ziel-5] der Laufstand nennt Ziel, Grenze und fertig bis", () => {
  assert.deepEqual(fehlend(LAUFSTAND_DOKU, LAUFSTAND_ANGABEN), [], "der Laufstand nennt nicht alles");
});

test("[ziel-6] /push-main beschreibt Vorbereitung und Uebernahme, auch ueber den Build-Dienst", () => {
  assert.deepEqual(fehlend(PUSH_DOKU, PUSH_ANGABEN), [], "/push-main nennt nicht alles");
});

test("[ziel-7] eine Kopie ohne eine Angabe wird als unvollstaendig erkannt", () => {
  for (const [ort, text, angaben] of [
    ["Stop-Punkte", STOP_VORLAGE, [GO_ZIEL]],
    ["W1", W1_VORLAGE, [GO_ZIEL]],
    ["W3", W3_VORLAGE, W3_ANGABEN],
    ["Pflichtchecks", PFLICHT_VORLAGE, W3_ANGABEN],
    ["Nachtbetrieb", NACHT_VORLAGE, NACHT_ANGABEN],
    ["Ziel", ZIEL_DOKU, ZIEL_ANGABEN],
    ["Laufstand", LAUFSTAND_DOKU, LAUFSTAND_ANGABEN],
    ["/push-main", PUSH_DOKU, PUSH_ANGABEN],
  ]) {
    for (const [name, muster] of angaben) {
      const ohne = text.replace(new RegExp(muster.source, `${muster.flags.replace("g", "")}g`), "");
      assert.ok(fehlend(ohne, angaben).includes(name), `${ort}: eine Kopie ohne ${name} gilt weiterhin als vollstaendig`);
    }
  }
});
