// Der Pruefstand am Plan: schreiben, lesen und erkennen, ob die Antwort den Plan geaendert hat
// (Issue #1699, Plan #1697 E6, E7, E9, E12).
//
// Haelt die Kette nach der Pruefung an einer offenen Frage im Plan an, schreibt sie an den Plan
// einen Kommentar `## Pruefstand der Kette` mit Marker, Pruefer, dem Hash ueber den Rest des
// Bodys und je einem Hash pro Entscheidungszeile. Beim Neustart vergleicht sie: Eine Antwort,
// die nur `## Offene Fragen` leert und Entscheidungszeilen ergaenzt, aendert den Plan nicht;
// jede andere Aenderung schon. Ohne gueltigen Pruefstand gilt der Plan als unveraendert (E7).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  PRUEFSTAND_ANKER, ketteAbhaengigkeiten, pruefstandLesen, pruefstandUnveraendert, pruefstandVeraltet,
  pruefstandVermerken, pruefstandVon,
} from "../kit/night/kette.mjs";

afterEach(() => ketteAbhaengigkeiten());

/** Ein Plan mit Marker, offener Frage, Entscheidungen samt Vertrag und den uebrigen Pflichtabschnitten. */
const PLAN = [
  "# [Plan] Ein Vorhaben",
  "",
  "Fachliche Quelle: Issue #1",
  "Plan-Review: fable, gpt-astra (2026-10-14, Nachtlauf)",
  "",
  "## Ziel",
  "Die Kette haelt spaeter an.",
  "",
  "## Geplante Änderungen",
  "- `kit/night/kette.mjs`: ein Pruefstand.",
  "",
  "## Architektonische Entscheidungen",
  "- E1: Wo steht der Pruefstand?",
  "  Gewählt: als Kommentar am Plan.",
  "",
  "### Verträge",
  "- V1: Das Label `kit:x` im Partnerrepo.",
  "  Gegenstand: ein Label.",
  "",
  "## Offene Fragen",
  "- Wer legt das Label `kit:x` an?",
  "",
  "## Verifizierung",
  "- `node --test` ist gruen.",
].join("\n");

const unveraendert = (alt, neu) => pruefstandUnveraendert(pruefstandVon(alt), pruefstandVon(neu));

test("[1699] nur die offene Frage beantwortet (durch '- Keine.' ersetzt): unveraendert", () => {
  const neu = PLAN.replace("- Wer legt das Label `kit:x` an?", "- Keine.");
  assert.notEqual(neu, PLAN);
  assert.equal(unveraendert(PLAN, neu), true);
});

test("[1699] ein neuer E-Eintrag am Ende der Entscheidungen: unveraendert", () => {
  const neu = PLAN.replace("  Gegenstand: ein Label.\n", "  Gegenstand: ein Label.\n- E2: Wer legt das Label an?\n  Gewählt: der Mensch, vor dem Schnitt.\n");
  assert.notEqual(neu, PLAN);
  assert.equal(unveraendert(PLAN, neu), true);
});

test("[1699] eine neue Zeile 'Entschieden:' im V-Eintrag unter '### Verträge': unveraendert", () => {
  const neu = PLAN.replace("  Gegenstand: ein Label.", "  Gegenstand: ein Label.\n  Entschieden: Der Mensch legt es an.");
  assert.notEqual(neu, PLAN);
  assert.equal(unveraendert(PLAN, neu), true);
});

test("[1699] derselbe Body mit CRLF, mit CR, mit Leerraum am Zeilenende oder Leerzeilen am Ende: unveraendert", () => {
  const varianten = {
    crlf: PLAN.replaceAll("\n", "\r\n"),
    cr: PLAN.replaceAll("\n", "\r"),
    leerraum: PLAN.split("\n").map((z) => `${z}  \t`).join("\n"),
    leerzeilen: `${PLAN}\n\n\n`,
  };
  const stand = pruefstandVon(PLAN);
  for (const [name, body] of Object.entries(varianten)) {
    assert.deepEqual(pruefstandVon(body), stand, name);
    assert.equal(unveraendert(PLAN, body), true, name);
  }
});

test("[1699] eine vorhandene Entscheidungszeile geaendert, geloescht oder zwei vertauscht: geaendert", () => {
  const geaendert = PLAN.replace("  Gewählt: als Kommentar am Plan.", "  Gewählt: als Label am Plan.");
  const geloescht = PLAN.replace("  Gewählt: als Kommentar am Plan.\n", "");
  const vertauscht = PLAN.replace("- E1: Wo steht der Pruefstand?\n  Gewählt: als Kommentar am Plan.", "  Gewählt: als Kommentar am Plan.\n- E1: Wo steht der Pruefstand?");
  for (const [name, neu] of Object.entries({ geaendert, geloescht, vertauscht })) {
    assert.notEqual(neu, PLAN, name);
    assert.equal(unveraendert(PLAN, neu), false, name);
  }
});

test("[1699] eine Aenderung unter Ziel, Geplante Aenderungen oder Verifizierung: geaendert", () => {
  const varianten = {
    ziel: PLAN.replace("Die Kette haelt spaeter an.", "Die Kette haelt frueher an."),
    geplant: PLAN.replace("- `kit/night/kette.mjs`: ein Pruefstand.", "- `kit/night/kette.mjs`: ein Pruefstand.\n- `kit/night/night.mjs`: ein Aufrufer."),
    verifizierung: PLAN.replace("- `node --test` ist gruen.", "- `node --test` ist rot."),
  };
  for (const [name, neu] of Object.entries(varianten)) {
    assert.notEqual(neu, PLAN, name);
    assert.equal(unveraendert(PLAN, neu), false, name);
  }
});

test("[1699] die Markerzeile 'Plan-Review:' zaehlt nicht in Rest", () => {
  const neu = PLAN.replace("Plan-Review: fable, gpt-astra (2026-10-14, Nachtlauf)", "Plan-Review: opus (2026-10-16, Nachtlauf)");
  assert.equal(pruefstandVon(neu).rest, pruefstandVon(PLAN).rest);
});

test("[1699] Rest ist 12 Hex, je Entscheidungszeile ein Hash aus 8 Hex", () => {
  const stand = pruefstandVon(PLAN);
  assert.match(stand.rest, /^[0-9a-f]{12}$/);
  // E1, Gewählt, ### Verträge, V1, Gegenstand: fuenf nichtleere Zeilen.
  assert.equal(stand.entscheidungen.length, 5);
  for (const h of stand.entscheidungen) assert.match(h, /^[0-9a-f]{8}$/);
});

/** Ein Plan als Karte, wie das Board ihn liefert. */
const karte = (body, kommentare = []) => ({ id: "7", title: "[Plan] Ein Vorhaben", body, comments: kommentare.map((k) => ({ body: k })) });

/** Ein Pruefstand-Kommentar zu `body` mit Pruefer `pruefer`. */
function pruefstandKommentar(body, { marker = "fable, gpt-astra (2026-10-14, Nachtlauf)", pruefer = "" } = {}) {
  const s = pruefstandVon(body);
  return [PRUEFSTAND_ANKER, "", `Plan-Review: ${marker}`, `Prüfer: ${pruefer}`, `Rest: ${s.rest}`, `Entscheidungen: ${s.entscheidungen.join(" ")}`, ""].join("\n");
}

test("[1699] pruefstandLesen nimmt den juengsten Kommentar mit dem Anker und liest seine vier Zeilen", () => {
  const alt = pruefstandKommentar(PLAN.replace("Die Kette", "Eine Kette"), { marker: "alt (2026-10-01)", pruefer: "opus" });
  const jung = pruefstandKommentar(PLAN, { pruefer: "fable" });
  const stand = pruefstandLesen(karte(PLAN, [alt, "## Laufstand\n\nirgendwas", jung, "ein Kommentar ohne Anker"]));
  const erwartet = pruefstandVon(PLAN);
  assert.deepEqual(stand, {
    planReview: "fable, gpt-astra (2026-10-14, Nachtlauf)", pruefer: "fable", rest: erwartet.rest, entscheidungen: erwartet.entscheidungen,
  });
});

test("[1699] pruefstandLesen: leerer Pruefer, ohne Kommentar mit Anker null", () => {
  assert.equal(pruefstandLesen(karte(PLAN, ["## Laufstand\n\nx"])), null);
  assert.equal(pruefstandLesen(karte(PLAN, [pruefstandKommentar(PLAN)])).pruefer, "");
});

test("[1699] pruefstandVeraltet: anderer Markerwert als der Body ist nicht veraltet", () => {
  const neu = PLAN.replace("Die Kette haelt spaeter an.", "Ganz anders.");
  assert.equal(pruefstandVeraltet(karte(neu, [pruefstandKommentar(PLAN, { marker: "opus (2026-10-01)" })])), false);
});

test("[1699] pruefstandVeraltet: ohne Pruefstand nicht veraltet", () => {
  assert.equal(pruefstandVeraltet(karte(PLAN.replace("Die Kette", "Eine Kette"))), false);
});

test("[1699] pruefstandVeraltet: gueltiger Pruefstand und geaenderter Body ist veraltet, beantwortete Frage nicht", () => {
  const kommentar = pruefstandKommentar(PLAN);
  assert.equal(pruefstandVeraltet(karte(PLAN.replace("Die Kette haelt spaeter an.", "Ganz anders."), [kommentar])), true);
  assert.equal(pruefstandVeraltet(karte(PLAN.replace("- Wer legt das Label `kit:x` an?", "- Keine."), [kommentar])), false);
});

test("[1699] pruefstandVeraltet beim lokalen Tracker: Kommentare im Body zaehlen nicht in Rest", () => {
  const kopf = "\n\n---\n**Kommentar** (2026-10-15)\n\n";
  const body = `${PLAN.replace("- Wer legt das Label `kit:x` an?", "- Keine.")}${kopf}${pruefstandKommentar(PLAN)}${kopf}## Laufstand\n\nweiter`;
  assert.equal(pruefstandVeraltet({ id: "7", title: "[Plan] x", body }), false);
});

/** Faengt die Protokollzeilen von `log` ab, solange `fn` laeuft. */
function mitProtokoll(fn) {
  const zeilen = [];
  const schreiben = process.stdout.write;
  process.stdout.write = (chunk) => {
    zeilen.push(String(chunk));
    return true;
  };
  let ergebnis;
  try {
    ergebnis = fn();
  } finally {
    process.stdout.write = schreiben;
  }
  return { ergebnis, text: zeilen.join("") };
}

const reste = () => readdirSync(tmpdir()).filter((n) => n.startsWith(`night-pruefstand-${process.pid}-`));

test("[1699] pruefstandVermerken schreibt genau die vier Zeilen unter dem Anker ueber eine Datei", () => {
  const aufrufe = [];
  ketteAbhaengigkeiten({
    boardRoh: (...args) => {
      aufrufe.push({ args, text: readFileSync(args[4], "utf-8") });
      return { status: 0, text: "" };
    },
  });
  const { ergebnis, text } = mitProtokoll(() => pruefstandVermerken({ planReviewer: "fable" }, "7", PLAN));
  assert.equal(ergebnis, true);
  assert.equal(aufrufe.length, 1);
  assert.deepEqual(aufrufe[0].args.slice(0, 4), ["issue", "comment", "7", "--text-file"]);
  const s = pruefstandVon(PLAN);
  const zeilen = aufrufe[0].text.split("\n").filter((z) => z.trim() !== "");
  assert.deepEqual(zeilen, [
    PRUEFSTAND_ANKER,
    "Plan-Review: fable, gpt-astra (2026-10-14, Nachtlauf)",
    "Prüfer: fable",
    `Rest: ${s.rest}`,
    `Entscheidungen: ${s.entscheidungen.join(" ")}`,
  ]);
  assert.deepEqual(pruefstandLesen(karte(PLAN, [aufrufe[0].text])), { planReview: "fable, gpt-astra (2026-10-14, Nachtlauf)", pruefer: "fable", ...s });
  assert.match(text, new RegExp(`Vermerk '${PRUEFSTAND_ANKER}' an Plan #7 geschrieben`));
  assert.deepEqual(reste(), [], "die Datei unter tmpdir() ist weg");
});

test("[1699] pruefstandVermerken ohne planReviewer laesst den Pruefer leer", () => {
  let text = "";
  ketteAbhaengigkeiten({ boardRoh: (...args) => { text = readFileSync(args[4], "utf-8"); return { status: 0, text: "" }; } });
  mitProtokoll(() => pruefstandVermerken({}, "7", PLAN));
  assert.match(text, /^Prüfer:$/m);
  assert.equal(pruefstandLesen(karte(PLAN, [text])).pruefer, "");
});

test("[1699] scheitert das Board, wirft pruefstandVermerken nicht, und das Protokoll traegt pruefstandNicht", () => {
  ketteAbhaengigkeiten({ boardRoh: () => ({ status: 1, text: "Board weg" }) });
  const { ergebnis, text } = mitProtokoll(() => pruefstandVermerken({ planReviewer: "" }, "7", PLAN));
  assert.equal(ergebnis, false);
  assert.match(text, new RegExp(`Vermerk '${PRUEFSTAND_ANKER}' an Plan #7 nicht geschrieben \\(Board weg\\)`));
  assert.deepEqual(reste(), []);

  ketteAbhaengigkeiten({ boardRoh: () => { throw new Error("kaputt"); } });
  const zweiter = mitProtokoll(() => pruefstandVermerken({}, "7", PLAN));
  assert.equal(zweiter.ergebnis, false);
  assert.match(zweiter.text, /nicht geschrieben \(kaputt\)/);
});
