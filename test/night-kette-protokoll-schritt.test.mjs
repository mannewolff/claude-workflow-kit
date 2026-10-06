// Protokoll je Schritt, Vorab-Stand und Halt-Stand (Issue #1090, Plan #1079 E1, E16, E17).
//
// Belegfall 5 aus Fachplan #1075: Laufen Kette und Prueflauf gleichzeitig, standen ihre
// Zeilen verschraenkt im selben Tagesprotokoll. Jeder Schritt schreibt deshalb zusaetzlich
// eine eigene Datei `.claude/protokolle/<lauf>/<karte>-<stufe>.log`, und jede Zeile des
// Tagesprotokolls traegt die Lauf-Kennung in der Klammer des Zeitstempels.
//
// Belegfall 1: Ein Lauf, der in der Vorabpruefung stirbt, blieb spurlos. Die Kette setzt
// darum vor dem Vorflug jede Kandidatenkarte auf `laeuft`.
//
// Seit Issue #1233 laufen die Ketten unten im selben Prozess (`ketteImProzess`, Plan #1199,
// E6). Belegfall 5 — zwei Laeufe nebeneinander — und der Prueflauf `--pruefen` brauchen den
// Einstieg und stehen in `ablauf-night-kette-protokoll-schritt.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KETTE_HALT_ANKER } from "../kit/night/kette.mjs";
import { KLAEREN_LABEL } from "../kit/night/wartend.mjs";
import {
  ketteImProzess, fachplanKarte, jeStufe, planAnlegen, reviewHalt, GLATT,
} from "./helpers/kette-fixture.mjs";

const VORAB = /^Lauf angenommen um \d{4}-\d{2}-\d{2}T\S+Z, Vorabprüfung läuft$/;

/** Die Kommentare einer Karte nach dem Lauf, als ein Text. */
const kartenText = (r, id) => r.karte(id).comments.map((c) => c.body).join("\n");

/** Die Journalzeilen `stand` einer Karte. */
const staendeVon = (journal, id) => journal.filter((z) => z.art === "stand" && z.karte === id);

test("[protokoll-schritt] Vorab-Stand: vor dem Vorflug steht jede Kandidatenkarte auf laeuft", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: GLATT });
  assert.equal(r.code, 0, r.ausgabe);
  const staende = staendeVon(r.journal, "1");
  assert.equal(staende[0].zustand, "laeuft");
  assert.match(staende[0].text, VORAB);
  assert.ok(staende[1].text.includes("plan begonnen"), "danach folgt der Stand der ersten Stufe");
  assert.deepEqual(staendeVon(r.vorflug.journal, "1").map((z) => z.zustand), ["laeuft"], "der Vorab-Stand steht schon beim Vorflug");
});

test("[protokoll-schritt] scheitert der Vorflug, steht jede Karte auf abgebrochen mit Befund, kit:night bleibt", async () => {
  const r = await ketteImProzess({
    karten: [fachplanKarte("1"), fachplanKarte("2", { titel: "[Fachlich] Ein zweites Anliegen" })],
    sitzung: jeStufe({ plan: planAnlegen() }),
    vorflug: "Die Vorflug-Session lieferte kein Ergebnis",
  });
  assert.equal(r.code, 1, "der Lauf endet mit hartem Stopp");
  for (const F of ["1", "2"]) {
    const karte = r.karte(F);
    assert.ok(karte.labels.includes("kit:night"), `kit:night an #${F} bleibt`);
    assert.ok(karte.labels.includes("lauf:abgebrochen"), `Labels: ${karte.labels}`);
    const text = kartenText(r, F);
    assert.equal(text.split("## Laufstand").length - 1, 1, "genau ein Laufstand-Kommentar");
    assert.match(text, /Kette nicht gestartet um \S+: Die Vorflug-Session lieferte kein Ergebnis/);
    assert.equal(text.split("Kette nicht gestartet").length - 1, 1, "der Befund steht nur im Laufstand, kein eigener Kommentar");
    assert.deepEqual(staendeVon(r.journal, F).map((s) => s.zustand), ["laeuft", "abgebrochen"]);
  }
  assert.deepEqual(r.sitzungen, [], "keine Ketten-Session gestartet");
});

test("[protokoll-schritt] mit --dry-run entsteht kein Vorab-Stand", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], argv: ["--dry-run"] });
  assert.equal(r.code, 0, r.ausgabe);
  assert.ok(!r.karte("1").labels.some((l) => l.startsWith("lauf:")));
  assert.ok(!kartenText(r, "1").includes("## Laufstand"));
  assert.deepEqual(r.journal.filter((z) => z.art === "stand"), []);
});

test("[protokoll-schritt] eine angehaltene Kette setzt wartet mit dem Wortlaut aus E1, kit:klaeren wie heute", async () => {
  const r = await ketteImProzess({ karten: [fachplanKarte("1")], sitzung: jeStufe({ plan: planAnlegen(), review: reviewHalt }) });
  assert.equal(r.code, 0, r.ausgabe);
  assert.equal(r.lauf.einheiten.find((e) => e.id === "1").ausgang, "angehalten");
  const karte = r.karte("1");
  assert.ok(karte.labels.includes("lauf:wartet"), `Labels: ${karte.labels}`);
  assert.ok(karte.labels.includes(KLAEREN_LABEL));
  const text = kartenText(r, "1");
  assert.ok(text.includes(`Halt: Frage wartet auf den Menschen — siehe \`${KETTE_HALT_ANKER}\``), text);
  assert.match(text, new RegExp(KETTE_HALT_ANKER));
  const letzter = r.journal.findLast((z) => z.art === "stand" && z.karte === "1");
  assert.equal(letzter.zustand, "wartet");
});
