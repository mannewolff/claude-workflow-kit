// Wartezeile im Fachplan (Issue #1661, Plan #1624 E1): `ereignisGrund` liest die Zeile
// `Wartet auf Ereignis: <Grund>` allein im Abschnitt Ziel, `mitEreignis` setzt sie dort,
// `ohneEreignis` nimmt sie heraus und laesst jedes andere Zeichen des Bodys stehen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ereignisGrund, mitEreignis, ohneEreignis } from "../kit/board/ereignis.mjs";

const fachplan = ({ ziel = "Ein Ziel.", kopf = "Autor-Modell: claude-opus-5-5\nFachplan-Review: fable (2026-10-13)", fragen = "1. Eine Frage?", danach = "" } = {}) =>
  `## Ziel\n${ziel}\n\n${kopf}\n\n## Fachliche Akzeptanzkriterien\n- Eins.\n\n## Nicht-Ziele\n- Keins.\n\n## Offene Fragen an den PO\n${fragen}\n${danach}`;

test("ereignisGrund liest die Zeile im Ziel, deutsch und englisch", () => {
  assert.equal(ereignisGrund(fachplan({ kopf: "Autor-Modell: x\nWartet auf Ereignis: Tarif X waehlbar" })), "Tarif X waehlbar");
  const en = "## Goal\nA goal.\n\nAuthor-Model: x\nWaiting for event: plan X available\n\n## Non-goals\n- None.\n";
  assert.equal(ereignisGrund(en), "plan X available");
});

test("ereignisGrund: ohne Zeile null, die erste nicht leere Zeile gilt", () => {
  assert.equal(ereignisGrund(fachplan()), null);
  assert.equal(ereignisGrund(""), null);
  assert.equal(ereignisGrund(undefined), null);
  assert.equal(ereignisGrund(fachplan({ kopf: "Wartet auf Ereignis:   \nWartet auf Ereignis: B\nWartet auf Ereignis: C" })), "B");
});

test("ereignisGrund: ausserhalb des Ziels, im Zitat oder im Codeblock zaehlt die Zeile nicht", () => {
  const zeile = "Wartet auf Ereignis: Tarif X";
  assert.equal(ereignisGrund(fachplan({ fragen: `1. Frage?\n${zeile}` })), null);
  assert.equal(ereignisGrund(fachplan({ ziel: `Ein Ziel.\n> ${zeile}` })), null);
  assert.equal(ereignisGrund(fachplan({ ziel: `Ein Ziel.\n\`\`\`\n${zeile}\n\`\`\`` })), null);
  assert.equal(ereignisGrund(fachplan({ danach: `\n## Vorgeschichte\n${zeile}\n` })), null);
});

test("mitEreignis setzt die Zeile hinter Autor-Modell und Fachplan-Review", () => {
  const neu = mitEreignis(fachplan(), "Tarif X waehlbar");
  assert.equal(neu, fachplan({ kopf: "Autor-Modell: claude-opus-5-5\nFachplan-Review: fable (2026-10-13)\nWartet auf Ereignis: Tarif X waehlbar" }));
  assert.equal(ereignisGrund(neu), "Tarif X waehlbar");
});

test("mitEreignis ohne Kennzeichnungszeilen: am Ende des Ziels", () => {
  const body = "## Ziel\nEin Ziel.\n\n## Nicht-Ziele\n- Keins.\n";
  assert.equal(mitEreignis(body, "Grund"), "## Ziel\nEin Ziel.\nWartet auf Ereignis: Grund\n\n## Nicht-Ziele\n- Keins.\n");
  assert.equal(mitEreignis("## Ziel\nEin Ziel.", "Grund"), "## Ziel\nEin Ziel.\nWartet auf Ereignis: Grund");
});

test("mitEreignis ersetzt eine vorhandene Wartezeile, statt sie zu verdoppeln", () => {
  const alt = fachplan({ kopf: "Autor-Modell: x\nWartet auf Ereignis: alt\nFachplan-Review: y" });
  const neu = mitEreignis(alt, "neu");
  assert.equal(neu, fachplan({ kopf: "Autor-Modell: x\nWartet auf Ereignis: neu\nFachplan-Review: y" }));
  assert.equal(neu.match(/Wartet auf Ereignis:/g).length, 1);
});

test("mitEreignis laesst eine gleichlautende Zeile ausserhalb des Ziels stehen", () => {
  const body = fachplan({ fragen: "1. Frage?\nWartet auf Ereignis: fremd" });
  const neu = mitEreignis(body, "Grund");
  assert.equal(ereignisGrund(neu), "Grund");
  assert.match(neu, /1\. Frage\?\nWartet auf Ereignis: fremd/);
});

test("mitEreignis ohne Abschnitt Ziel: null", () => {
  assert.equal(mitEreignis("## Nicht-Ziele\n- Keins.\n", "Grund"), null);
});

test("ohneEreignis entfernt jede Wartezeile im Ziel und sonst kein Zeichen", () => {
  const ohne = fachplan({ ziel: "Ein Ziel.\r\nZweite Zeile.  " });
  const mit = fachplan({ ziel: "Ein Ziel.\r\nWartet auf Ereignis: A\r\nZweite Zeile.  ", kopf: "Autor-Modell: claude-opus-5-5\nFachplan-Review: fable (2026-10-13)\nWaiting for event: B" });
  assert.equal(Buffer.compare(Buffer.from(ohneEreignis(mit)), Buffer.from(ohne)), 0);
  assert.equal(ohneEreignis(ohne), ohne);
});

test("ohneEreignis laesst die Wartezeile ausserhalb des Ziels und im Codeblock stehen", () => {
  const body = fachplan({ ziel: "Ein Ziel.\n```\nWartet auf Ereignis: Beispiel\n```", fragen: "1. Frage?\nWartet auf Ereignis: fremd" });
  assert.equal(ohneEreignis(body), body);
});
