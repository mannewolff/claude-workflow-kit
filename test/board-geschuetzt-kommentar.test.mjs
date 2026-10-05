// `issue check-geschuetzt` — Treffer, Freigabe und Halt-Kommentar eines Pakets (Issue #1045,
// Plan #987, E5, E6, E11, E17).
//
// Der Halt-Kommentar ist Schreib- und Leseformat zugleich: Das Gate liest beim naechsten
// Anlauf aus genau diesem Text zurueck, welche Pfade der Mensch freigegeben hat. Darum
// prueft der Rundlauf-Test, dass der erzeugte Text wieder eingelesen freigibt.
//
// Geschuetzte Pfade kommen aus `GESCHUETZTE_PFADE`, nie als Literal (E18): Sonst hielte das
// eigene Gate die Pakete dieses Plans an.


import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GESCHUETZTE_PFADE,
  GESCHUETZT_ANKER,
  GESCHUETZT_LABEL,
  GESCHUETZT_LABEL_GESETZT,
  GESCHUETZT_LABEL_NICHT_GESETZT,
  geschuetztKommentar,
  geschuetztFreigabe,
} from "../kit/board/geschuetzt.mjs";

const EINSTELLUNGEN = GESCHUETZTE_PFADE[0];
const LOKAL_EINSTELLUNGEN = GESCHUETZTE_PFADE[1];
const AUFGABE_ZEILE = `In \`${EINSTELLUNGEN}\` einen Eintrag ergaenzen.`;
const KRITERIUM_ZEILE = `- \`${LOKAL_EINSTELLUNGEN}\` traegt den Eintrag.`;

function halt(pfade, labelZeile) {
  const liste = pfade.map((p) => "- `" + p + "`").join("\n");
  return `${GESCHUETZT_ANKER}\n\n${liste}\n\n${labelZeile}`;
}

// --- Konstanten und reine Funktionen -------------------------------------------------

test("Anker, Label und Label-Zeilen sind exportierte Konstanten", () => {
  assert.equal(GESCHUETZT_ANKER, "## Geschuetzte Datei");
  assert.equal(GESCHUETZT_LABEL, "kit:geschuetzt");
  assert.equal(GESCHUETZT_LABEL_GESETZT, "Label kit:geschuetzt gesetzt");
  assert.equal(GESCHUETZT_LABEL_NICHT_GESETZT, "Label kit:geschuetzt nicht gesetzt");
});

test("der Kommentar nennt je Pfad eine Backtick-Zeile und zitiert die Zeilen woertlich, ohne Label-Zeile", () => {
  const treffer = [
    { pfad: EINSTELLUNGEN, zeile: AUFGABE_ZEILE },
    { pfad: EINSTELLUNGEN, zeile: `- \`${EINSTELLUNGEN}\` ist gueltiges JSON.` },
    { pfad: LOKAL_EINSTELLUNGEN, zeile: KRITERIUM_ZEILE },
  ];
  const text = geschuetztKommentar(treffer);
  const zeilen = text.split("\n");
  assert.equal(zeilen[0], GESCHUETZT_ANKER);
  assert.deepEqual(zeilen.filter((z) => z.startsWith("- ")), [`- \`${EINSTELLUNGEN}\``, `- \`${LOKAL_EINSTELLUNGEN}\``]);
  for (const t of treffer) assert.ok(zeilen.some((z) => z.endsWith(t.zeile) && z.trimStart().startsWith(">")), t.zeile);
  assert.ok(!text.includes(GESCHUETZT_LABEL_GESETZT));
  assert.ok(!text.includes(GESCHUETZT_LABEL_NICHT_GESETZT));
});

test("Freigabe nach E5: Kommentar mit 'gesetzt', Label weg, jeder Treffer genannt", () => {
  const treffer = [{ pfad: EINSTELLUNGEN, zeile: AUFGABE_ZEILE }];
  const frei = [{ body: halt([EINSTELLUNGEN], GESCHUETZT_LABEL_GESETZT) }];
  assert.equal(geschuetztFreigabe(treffer, frei, []), true);
  assert.equal(geschuetztFreigabe(treffer, frei, [GESCHUETZT_LABEL]), false, "Label noch gesetzt");
  assert.equal(geschuetztFreigabe(treffer, [{ body: halt([EINSTELLUNGEN], GESCHUETZT_LABEL_NICHT_GESETZT) }], []), false);
  assert.equal(geschuetztFreigabe(treffer, [{ body: halt([LOKAL_EINSTELLUNGEN], GESCHUETZT_LABEL_GESETZT) }], []), false, "anderer Pfad");
  assert.equal(geschuetztFreigabe(treffer, [{ body: `Ohne Anker\n- \`${EINSTELLUNGEN}\`\n${GESCHUETZT_LABEL_GESETZT}` }], []), false);
  assert.equal(geschuetztFreigabe(treffer, [], []), false);
  assert.equal(geschuetztFreigabe([], frei, []), false, "ohne Treffer gibt es nichts freizugeben");
});

test("Freigabe: ein dort nicht genannter Pfad haelt erneut an", () => {
  const treffer = [{ pfad: EINSTELLUNGEN, zeile: AUFGABE_ZEILE }, { pfad: LOKAL_EINSTELLUNGEN, zeile: KRITERIUM_ZEILE }];
  assert.equal(geschuetztFreigabe(treffer, [{ body: halt([EINSTELLUNGEN], GESCHUETZT_LABEL_GESETZT) }], []), false);
  assert.equal(geschuetztFreigabe(treffer, [{ body: halt([EINSTELLUNGEN, LOKAL_EINSTELLUNGEN], GESCHUETZT_LABEL_GESETZT) }], []), true);
});

test("Freigabe: ein zitierter Pfad in einer Zitatzeile zaehlt nicht als genannt", () => {
  const treffer = [{ pfad: LOKAL_EINSTELLUNGEN, zeile: KRITERIUM_ZEILE }];
  const body = `${GESCHUETZT_ANKER}\n\n- \`${EINSTELLUNGEN}\`\n  > ${KRITERIUM_ZEILE}\n\n${GESCHUETZT_LABEL_GESETZT}`;
  assert.equal(geschuetztFreigabe(treffer, [{ body }], []), false);
});

test("Freigabe: Zeilenenden mit CR stoeren die Ruecklesung nicht", () => {
  const treffer = [{ pfad: EINSTELLUNGEN, zeile: AUFGABE_ZEILE }];
  const body = halt([EINSTELLUNGEN], GESCHUETZT_LABEL_GESETZT).replaceAll("\n", "\r\n");
  assert.equal(geschuetztFreigabe(treffer, [{ body }], []), true);
});

test("Rundlauf: der erzeugte Kommentar samt 'gesetzt' gibt ohne Label frei", () => {
  const treffer = [
    { pfad: EINSTELLUNGEN, zeile: AUFGABE_ZEILE },
    { pfad: LOKAL_EINSTELLUNGEN, zeile: KRITERIUM_ZEILE },
  ];
  const body = `${geschuetztKommentar(treffer)}\n\n${GESCHUETZT_LABEL_GESETZT}`;
  assert.equal(geschuetztFreigabe(treffer, [{ body }], []), true);
  assert.equal(geschuetztFreigabe(treffer, [{ body: `${geschuetztKommentar(treffer)}\n\n${GESCHUETZT_LABEL_NICHT_GESETZT}` }], []), false);
});

test("Rundlauf: ein Pfad mit Backtick steht in einem laengeren Lauf und wird wieder gelesen", () => {
  const pfad = `${GESCHUETZTE_PFADE.at(-1)}a\`b.sh`;
  const treffer = [{ pfad, zeile: "In ``" + pfad + "`` etwas aendern." }];
  const text = geschuetztKommentar(treffer);
  assert.ok(text.split("\n").includes("- ``" + pfad + "``"), text);
  assert.equal(geschuetztFreigabe(treffer, [{ body: `${text}\n\n${GESCHUETZT_LABEL_GESETZT}` }], []), true);
});
