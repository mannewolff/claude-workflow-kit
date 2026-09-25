// Der Zaehler der Prueflaeufe am Session-Strom (Issue #924, Plan #917, E1/E2/E3/E7/E9).
//
// Anders als der Werkzeugzeit-Beobachter DEUTET dieser hier: Er liest das Kommando eines
// Bash-Aufrufs und haelt es gegen die konfigurierten `buildChecks`. Darum sitzt er neben
// jenem und nicht in ihm (E1) — die Uhr bleibt eine Uhr.
//
// Drei Ebenen werden geprueft: `prueflaufBeobachter()` an aufgezeichneten Stromzeilen,
// `prueflaeufeAddieren()` als reine Summe zweier Sessions, und der Weg in den
// Ergebnisstand E2E ueber einen Nachtlauf mit Fake-Session — dieselbe Linie wie
// night-zeiten.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  prueflaufBeobachter, prueflaeufeAddieren, prueflaufZeilen, berichtBauen, runSession,
  UEBERNAHME_MARKE,
} from "../kit/night.mjs";
import { UEBERNAHME_MARKE as CHECKS_UEBERNAHME_MARKE } from "../kit/checks.mjs";

// Die buildChecks dieses Repos in Kurzform: zwei Gruppen als String, eine als Objekt mit
// `cmd` — beide Formen muss der Beobachter lesen (E2).
const GRUPPE_A = 'node --test "test/night-*.test.mjs" "test/board-*.test.mjs"';
const GRUPPE_B = 'node --test "test/skills-*.test.mjs" "test/docs-*.test.mjs"';
const CHECKS = [GRUPPE_A, { cmd: GRUPPE_B, areas: ["skills-doku"] }, "npx eslint kit tools test"];

/** Ein `assistant`-Ereignis mit einem Bash-`tool_use` je Kommando. */
function bashAufrufe(...paare) {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: paare.map(([id, command]) => ({ type: "tool_use", id, name: "Bash", input: { command } })),
    },
  });
}

/** Ein `user`-Ereignis mit einem `tool_result` zur gegebenen Id. */
function toolResult(id, inhalt = "ok") {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: inhalt }] },
  });
}

/** Fuettert den Beobachter mit Paaren [zeile, zeitstempel] und liefert sein Ergebnis. */
function beobachte(paare, checks = CHECKS) {
  const b = prueflaufBeobachter(checks);
  for (const [zeile, ts] of paare) b.zeile(zeile, ts);
  return b.ergebnis();
}

/** Ein einzelner Bash-Aufruf mit Ergebnis, 100 ms Spanne. */
function einAufruf(command, checks = CHECKS) {
  return beobachte([
    [bashAufrufe(["t1", command]), 1000],
    [toolResult("t1"), 1100],
  ], checks);
}

// ============================================================
// prueflaufBeobachter — was zaehlt und was nicht
// ============================================================

test("[night-924] drei gezielte Laeufe sind drei Prueflaeufe und keine vollstaendige Gruppe", () => {
  const erg = beobachte([
    [bashAufrufe(["t1", "node --test test/night-prueflaeufe.test.mjs"]), 1000],
    [toolResult("t1"), 1500],
    [bashAufrufe(["t2", "node --test test/night-zeiten.test.mjs"]), 2000],
    [toolResult("t2"), 2300],
    [bashAufrufe(["t3", "node --test test/checks-run.test.mjs"]), 3000],
    [toolResult("t3"), 3200],
  ]);
  assert.equal(erg.anzahl, 3);
  assert.equal(erg.volle, 0);
  assert.equal(erg.volleNoetig, 0);
  assert.equal(erg.dauerMs, 500 + 300 + 200, "dauerMs ist die Summe der zugeordneten Spannen");
});

test("[night-924] ein Aufruf, der woertlich einem buildChecks-Kommando entspricht, ist eine vollstaendige Gruppe", () => {
  const erg = einAufruf(GRUPPE_A);
  assert.equal(erg.volle, 1);
  assert.equal(erg.anzahl, 1, "die vollstaendige Gruppe ist ein Prueflauf wie jeder andere — volle zaehlt zusaetzlich");
  assert.equal(erg.volleNoetig, 0);
});

test("[night-924] ein buildChecks-Eintrag in Objektform wird wie die String-Form gelesen", () => {
  const erg = einAufruf(GRUPPE_B);
  assert.equal(erg.volle, 1, "die cmd-Form eines Eintrags ist dasselbe Kommando");
  assert.equal(erg.anzahl, 1);
});

test("[night-924] ein checks.mjs run --bereich ist der sanktionierte Gruppenlauf: volleNoetig, nicht volle", () => {
  const erg = einAufruf("node .claude/kit/checks.mjs run --bereich board");
  assert.equal(erg.volleNoetig, 1);
  assert.equal(erg.volle, 0, "der Bereichslauf darf nicht unter die Verstoesse geraten (Plan #917, E3)");
  assert.equal(erg.anzahl, 1);
});

test("[night-924] ein node --test auf eine einzelne Datei ist keine vollstaendige Gruppe", () => {
  const erg = einAufruf("node --test test/night-zeiten.test.mjs");
  assert.equal(erg.volle, 0);
  assert.equal(erg.volleNoetig, 0);
  assert.equal(erg.anzahl, 1, "gezaehlt wird er trotzdem — er ist ein Prueflauf der Arbeit");
});

test("[night-924] ein checks.mjs run ohne --bereich ist der Abschlussversuch und erhoeht arbeit.anzahl nicht", () => {
  const erg = einAufruf("node .claude/kit/checks.mjs run");
  assert.equal(erg.anzahl, 0, "sonst stuende der Abschlussversuch in zwei Zahlen (Plan #917, E9)");
  assert.equal(erg.volle, 0);
  assert.equal(erg.volleNoetig, 0);
  assert.equal(erg.dauerMs, 0);
});

// ============================================================
// Abschlussversuche — der eigene Block neben der Arbeit (Issue #926, E9)
// ============================================================

test("[night-926] der Abschlussversuch zaehlt in seinem eigenen Block, mit seiner Spanne", () => {
  const erg = einAufruf("node .claude/kit/checks.mjs run");
  assert.deepEqual(erg.abschluss, { anzahl: 1, dauerMs: 100 });
  assert.equal(erg.anzahl, 0, "er bleibt aus der Arbeit heraus — dort zaehlte er doppelt");
});

test("[night-926] auch --frisch ist ein Abschlussversuch, ein --bereich-Lauf keiner", () => {
  assert.deepEqual(einAufruf("node .claude/kit/checks.mjs run --frisch").abschluss, { anzahl: 1, dauerMs: 100 });
  assert.deepEqual(einAufruf("node .claude/kit/checks.mjs run --bereich board").abschluss, { anzahl: 0, dauerMs: 0 });
});

test("[night-926] zwei Abschlussversuche einer Session addieren Zahl und Spannen", () => {
  const erg = beobachte([
    [bashAufrufe(["t1", "node .claude/kit/checks.mjs run"]), 1000],
    [toolResult("t1"), 1400],
    [bashAufrufe(["t2", "node .claude/kit/checks.mjs run"]), 2000],
    [toolResult("t2"), 2100],
  ]);
  assert.deepEqual(erg.abschluss, { anzahl: 2, dauerMs: 500 });
});

test("[night-926] ein uebernommener Abschlusslauf zaehlt als Versuch ohne Dauer", () => {
  const erg = einAufruf("node .claude/kit/checks.mjs run");
  assert.equal(erg.abschluss.dauerMs, 100, "der frische Lauf traegt seine Spanne — Gegenprobe");
  const uebernommen = beobachte([
    [bashAufrufe(["t1", "node .claude/kit/checks.mjs run"]), 1000],
    [toolResult("t1", `Stand unveraendert seit 2026-09-24T22:00:00.000Z: ${UEBERNAHME_MARKE} (gruen). Neu pruefen mit --frisch.`), 1100],
  ]);
  assert.deepEqual(uebernommen.abschluss, { anzahl: 1, dauerMs: 0 },
    "uebernehmen() reicht die Werte des frueheren Laufs weiter — die Spanne waere nicht gemessen, sondern geerbt");
});

test("[night-926] die Uebernahme-Marke des Beobachters ist die des Kommandos", () => {
  assert.equal(UEBERNAHME_MARKE, CHECKS_UEBERNAHME_MARKE,
    "zwei Fassungen desselben Satzes, und der Beobachter erkennt die Uebernahme nicht mehr");
});

test("[night-926] die Marke in einer Blockform des tool_result wird ebenso gelesen", () => {
  const erg = beobachte([
    [bashAufrufe(["t1", "node .claude/kit/checks.mjs run"]), 1000],
    [JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "t1",
          content: [{ type: "text", text: `Stand unveraendert seit gestern: ${UEBERNAHME_MARKE} (gruen).` }],
        }],
      },
    }), 1100],
  ]);
  assert.deepEqual(erg.abschluss, { anzahl: 1, dauerMs: 0 });
});

test("[night-926] ein Arbeitslauf mit der Marke im Ergebnis behaelt seine Spanne", () => {
  const erg = beobachte([
    [bashAufrufe(["t1", "node --test test/a.test.mjs"]), 1000],
    [toolResult("t1", `... ${UEBERNAHME_MARKE} ...`), 1300],
  ]);
  assert.equal(erg.dauerMs, 300, "die Regel gilt fuer den Abschlussversuch, nicht fuer jeden Lauf");
});

test("[night-924] auch checks.mjs run --frisch bleibt Abschlussversuch, mit --bereich bleibt es der Gruppenlauf", () => {
  assert.equal(einAufruf("node .claude/kit/checks.mjs run --frisch").anzahl, 0);
  const mitBereich = einAufruf("node .claude/kit/checks.mjs run --bereich=board --frisch");
  assert.equal(mitBereich.volleNoetig, 1, "--bereich=<name> ist dieselbe Wahl wie --bereich <name>");
  assert.equal(mitBereich.anzahl, 1);
});

test("[night-924] ein Aufruf mit fremdem Programm zaehlt nicht", () => {
  const erg = beobachte([
    [bashAufrufe(["t1", "git status --porcelain"], ["t2", "ls -la"]), 1000],
    [toolResult("t1"), 1100],
    [toolResult("t2"), 1200],
  ]);
  assert.equal(erg.anzahl, 0);
  assert.equal(erg.dauerMs, 0);
});

test("[night-924] eine Umgebungszuweisung vor dem Programm verdeckt es nicht", () => {
  assert.equal(einAufruf("NODE_OPTIONS=--no-warnings node --test test/board-cli.test.mjs").anzahl, 1);
});

test("[night-924] nur Bash-Aufrufe zaehlen — ein Read oder ein Agent mit demselben Text nicht", () => {
  const erg = beobachte([
    [JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: { command: GRUPPE_A } }] },
    }), 1000],
    [toolResult("t1"), 1100],
  ]);
  assert.equal(erg.anzahl, 0);
  assert.equal(erg.volle, 0);
});

test("[night-924] parallele Prueflaeufe eines Schubs zaehlen einzeln, jeder mit seiner eigenen Spanne", () => {
  const erg = beobachte([
    [bashAufrufe(["a", "node --test test/a.test.mjs"], ["b", "node --test test/b.test.mjs"]), 1000],
    [toolResult("a"), 1200],
    [toolResult("b"), 1500],
  ]);
  assert.equal(erg.anzahl, 2, "zwei gestartete Laeufe sind zwei Laeufe, auch wenn sie nebeneinander liefen");
  assert.equal(erg.dauerMs, 200 + 500);
});

test("[night-924] ein Prueflauf ohne Ergebnis zaehlt als gestartet, seine Dauer geht nicht ein", () => {
  const erg = beobachte([
    [bashAufrufe(["t1", "node --test test/a.test.mjs"]), 1000],
    [toolResult("t1"), 1100],
    [bashAufrufe(["t2", "node --test test/b.test.mjs"]), 2000],
    // kein tool_result: Strom am Zeitlimit abgeschnitten
  ]);
  assert.equal(erg.anzahl, 2, "gestartet hat die Session beide");
  assert.equal(erg.dauerMs, 100, "die offene Spanne waere eine Schaetzung");
});

test("[night-924] unlesbare Zeilen, fehlendes Kommando und fehlende Id werden tolerant uebersprungen", () => {
  const erg = beobachte([
    ["kein JSON", 900],
    ["", 905],
    ["{abgeschnitten", 910],
    [undefined, 915],
    [JSON.stringify({ type: "assistant", message: {} }), 920],
    [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: GRUPPE_A } }] } }), 930],
    [JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "Bash" }] } }), 940],
    [JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "unbekannt" }] } }), 950],
    [bashAufrufe(["t1", GRUPPE_A]), 1000],
    [toolResult("t1"), 1300],
  ]);
  assert.equal(erg.anzahl, 1, "der eine lesbare Aufruf muss trotz Muell davor gezaehlt werden");
  assert.equal(erg.volle, 1);
  assert.equal(erg.dauerMs, 300);
});

test("[night-924] ohne buildChecks zaehlt der Beobachter keine Arbeit, aber weiter den Bereichslauf", () => {
  assert.deepEqual(beobachte([[bashAufrufe(["t1", "mvn verify"]), 1000], [toolResult("t1"), 1100]], []),
    { anzahl: 0, volle: 0, volleNoetig: 0, dauerMs: 0, abschluss: { anzahl: 0, dauerMs: 0 } });
  const bereich = einAufruf("node .claude/kit/checks.mjs run --bereich board", []);
  assert.equal(bereich.volleNoetig, 1, "der Bereichslauf ist per Aufrufweg erkennbar, nicht ueber die Programme");
});

test("[night-924] der Beobachter nimmt eine bereits geparste Zeile entgegen und ergebnis() ist mehrfach abrufbar", () => {
  const b = prueflaufBeobachter(CHECKS);
  b.zeile(JSON.parse(bashAufrufe(["t1", GRUPPE_A])), 1000);
  b.zeile(JSON.parse(toolResult("t1")), 1100);
  assert.deepEqual(b.ergebnis(), b.ergebnis());
  assert.deepEqual(b.ergebnis(), { anzahl: 1, volle: 1, volleNoetig: 0, dauerMs: 100, abschluss: { anzahl: 0, dauerMs: 0 } });
});

// ============================================================
// prueflaufZeilen — die Zahlen im Bericht (Issue #926, Plan #917, E6/E8)
// ============================================================

/** Eine Paket-Einheit des Ergebnisstands, so weit der Bericht sie braucht. */
function paketEinheit(id, minuten, prueflaeufe = { arbeit: { anzahl: 3, volle: 0, volleNoetig: 1, dauerMs: 60_000 }, abschluss: { anzahl: 1, dauerMs: 120_000 } }, pruefungZusatz = {}) {
  return {
    id: String(id),
    dauerMs: minuten * 60_000,
    pruefung: { id: String(id), zustand: "geprueft", laufen: [], ausgelassen: [], ...pruefungZusatz },
    prueflaeufe,
  };
}

const DREI_PAKETE = [paketEinheit(101, 8), paketEinheit(102, 12), paketEinheit(103, 43)];

test("[night-926] gemischte Dauern ergeben die Summenzeile gegen die Zielmarke", () => {
  const zeilen = prueflaufZeilen(DREI_PAKETE, 10);
  assert.ok(zeilen.some((z) => z === "- 1 von 3 Paketen unter 10 Minuten."), `Summenzeile fehlt: ${zeilen.join(" | ")}`);
});

test("[night-926] je Paket eine Zeile mit Dauer, Prueflaeufen, volle und volleNoetig", () => {
  const zeilen = prueflaufZeilen([paketEinheit(101, 8)], 10);
  const zeile = zeilen.find((z) => z.includes("#101"));
  assert.ok(zeile, `keine Zeile fuer das Paket: ${zeilen.join(" | ")}`);
  assert.match(zeile, /Dauer 8\.0 min/);
  assert.match(zeile, /Prueflaeufe 3/);
  assert.match(zeile, /volle 0/);
  assert.match(zeile, /Gruppenlaeufe 1/);
  assert.match(zeile, /Abschlussversuche 1/);
});

test("[night-926] eine Einheit ohne pruefung zaehlt nicht mit — sie hat keine Runde durchlaufen", () => {
  const ohneSession = { id: "104", dauerMs: 60_000, ausgang: "uebersprungen" };
  const zeilen = prueflaufZeilen([...DREI_PAKETE, ohneSession], 10);
  assert.ok(zeilen.some((z) => z === "- 1 von 3 Paketen unter 10 Minuten."), zeilen.join(" | "));
  assert.ok(!zeilen.some((z) => z.includes("#104")), "die Einheit ohne Session gehoert nicht in die Liste");
});

test("[night-926] eine Einheit mit pruefung: null (ohne Session gescheitert) zaehlt nicht mit", () => {
  const zeilen = prueflaufZeilen([paketEinheit(101, 8), { id: "105", dauerMs: 1000, pruefung: null }], 10);
  assert.ok(zeilen.some((z) => z === "- 1 von 1 Paketen unter 10 Minuten."), zeilen.join(" | "));
});

test("[night-926] ohne Zielmarke wird mit 10 Minuten gerechnet", () => {
  assert.ok(prueflaufZeilen(DREI_PAKETE).some((z) => z === "- 1 von 3 Paketen unter 10 Minuten."),
    "fehlt night.zielUmsetzungMin, gilt die Vorgabe des Schemas");
  assert.ok(prueflaufZeilen(DREI_PAKETE, 45).some((z) => z === "- 3 von 3 Paketen unter 45 Minuten."),
    "eine gesetzte Marke gilt");
});

test("[night-926] genau auf der Marke gilt als erreicht", () => {
  assert.ok(prueflaufZeilen([paketEinheit(101, 10)], 10).some((z) => z === "- 1 von 1 Paketen unter 10 Minuten."));
});

test("[night-926] prueflaeufe null sagt 'nicht gemessen' und nennt keine Null", () => {
  const zeile = prueflaufZeilen([paketEinheit(101, 8, null)], 10).find((z) => z.includes("#101"));
  assert.match(zeile, /nicht gemessen/);
  assert.ok(!/Prueflaeufe 0/.test(zeile), `eine Null behauptete eine Messung: ${zeile}`);
  assert.ok(!/Abschlussversuche 0/.test(zeile), `dasselbe fuer die Abschlussversuche: ${zeile}`);
  assert.match(zeile, /Dauer 8\.0 min/, "die Dauer ist gemessen und bleibt stehen");
});

test("[night-926] jede Datei ohne Zuordnung steht mit Namen im Bericht", () => {
  const einheit = paketEinheit(101, 8, undefined, { ohneZuordnung: ["kit/neu.mjs", "docs/neu.md"] });
  const zeilen = prueflaufZeilen([einheit], 10);
  const text = zeilen.join("\n");
  assert.match(text, /kit\/neu\.mjs/);
  assert.match(text, /docs\/neu\.md/);
  assert.ok(zeilen.some((z) => z === "- 1 von 1 Paketen unter 10 Minuten."),
    "die Luecke in der Zuordnung faerbt nichts rot — der Abschluss bleibt unberuehrt");
});

test("[night-926] ohne gemessenes Paket sagt der Block das und rechnet nichts", () => {
  const zeilen = prueflaufZeilen([], 10);
  assert.ok(!zeilen.some((z) => /von 0 Paketen/.test(z)), `keine Rechnung ohne Paket: ${zeilen.join(" | ")}`);
  assert.match(zeilen.join("\n"), /keine Umsetzung gemessen/);
});

test("[night-926] der Umsetzungs-Abschnitt des Nachtberichts nennt dieselben Zeilen", () => {
  const einheit = {
    id: "900", ausgang: "fertig", variante: "B",
    stufen: { plan: { id: "917" }, pakete: { ids: ["101"] }, umsetzung: { umgesetzt: [{ id: "101" }], angehalten: [], zurueckgestellt: [], nichtBegonnen: [] } },
  };
  const text = berichtBauen(einheit, { einheiten: DREI_PAKETE, zielUmsetzungMin: 10, stempel: "s", start: 0, jetzt: 0 });
  const umsetzung = text.split("### Umsetzung")[1].split("###")[0];
  assert.match(umsetzung, /- 1 von 3 Paketen unter 10 Minuten\./, `Summenzeile fehlt unter ### Umsetzung: ${umsetzung}`);
  assert.match(umsetzung, /#101:.*Dauer 8\.0 min/);
  assert.match(umsetzung, /#103:.*Dauer 43\.0 min/);
});

test("[night-926] ohne uebergebene Einheiten bleibt der Umsetzungs-Abschnitt bei seiner Auskunft", () => {
  const einheit = { id: "900", ausgang: "fertig", variante: "B", stufen: { umsetzung: { umgesetzt: [], angehalten: [], zurueckgestellt: [], nichtBegonnen: [] } } };
  const text = berichtBauen(einheit, { stempel: "s", start: 0, jetzt: 0 });
  const umsetzung = text.split("### Umsetzung")[1].split("###")[0];
  assert.match(umsetzung, /keine Umsetzung gemessen/);
});

// ============================================================
// prueflaeufeAddieren — die Sessions einer Einheit
// ============================================================

test("[night-924] zwei Sessions derselben Einheit addieren ihre Prueflaeufe feldweise", () => {
  const runde = { arbeit: { anzahl: 12, volle: 4, volleNoetig: 1, dauerMs: 1_980_000 }, abschluss: { anzahl: 2, dauerMs: 900_000 } };
  const salvage = { arbeit: { anzahl: 2, volle: 1, volleNoetig: 0, dauerMs: 60_000 }, abschluss: { anzahl: 1, dauerMs: 0 } };
  assert.deepEqual(prueflaeufeAddieren(runde, salvage), {
    arbeit: { anzahl: 14, volle: 5, volleNoetig: 1, dauerMs: 2_040_000 },
    abschluss: { anzahl: 3, dauerMs: 900_000 },
  });
});

test("[night-926] eine Session ohne Abschlussblock addiert sich zu einer mit ihm", () => {
  assert.deepEqual(prueflaeufeAddieren(
    { arbeit: { anzahl: 1, volle: 0, volleNoetig: 0, dauerMs: 10 } },
    { arbeit: { anzahl: 0, volle: 0, volleNoetig: 0, dauerMs: 0 }, abschluss: { anzahl: 1, dauerMs: 50 } },
  ), {
    arbeit: { anzahl: 1, volle: 0, volleNoetig: 0, dauerMs: 10 },
    abschluss: { anzahl: 1, dauerMs: 50 },
  });
});

test("[night-924] die Summe traegt nur die Messung, keine Rechnung daraus (Plan #917, E7)", () => {
  const summe = prueflaeufeAddieren(
    { arbeit: { anzahl: 1, volle: 0, volleNoetig: 0, dauerMs: 10 }, abschluss: { anzahl: 1, dauerMs: 5 } },
    { arbeit: { anzahl: 1, volle: 0, volleNoetig: 0, dauerMs: 10 }, abschluss: { anzahl: 1, dauerMs: 5 } },
  );
  assert.deepEqual(Object.keys(summe), ["arbeit", "abschluss"], "keine Zielmarke, kein Anteil, keine Laeufe je Abschluss");
  assert.deepEqual(Object.keys(summe.arbeit).sort(), ["anzahl", "dauerMs", "volle", "volleNoetig"]);
  assert.deepEqual(Object.keys(summe.abschluss).sort(), ["anzahl", "dauerMs"]);
});

// ============================================================
// E2E — der Weg in den Ergebnisstand und die Stufe ohne Strom
// ============================================================

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NIGHT = join(repoRoot, "kit", "night.mjs");

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, { cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, ...env } });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function setupProjekt(praefix, buildChecks = ["true"]) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks,
    local: { issuesDir: "issues" },
  }, null, 2));
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\nbin/\n");
  for (const [c, a] of [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.email", "test@example.invalid"]],
    ["git", ["config", "user.name", "Night Test"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "-q", "-m", "setup"]],
  ]) {
    const res = run(dir, c, a);
    assert.equal(res.status, 0, `${c} ${a.join(" ")} schlug fehl: ${res.stderr}`);
  }
  return dir;
}

function einheit(dir, id) {
  const dateien = readdirSync(join(dir, ".claude")).filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n)).sort();
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  const s = JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

const NACH_IN_REVIEW = 'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review > /dev/null';
const ARBEIT_UND_COMMIT = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt"'
  + ' && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
// `ohneZuordnung` steht mit drin (Issue #926, E8): Die Datei ohne Bereichsmuster ist der
// einzige Weg, den Durchgriff von der Zusammenfassung bis in den Bericht E2E zu belegen.
const SUMMARY_GRUEN = `printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[],"ohneZuordnung":["fremd.txt"]}'`
  + " > .claude/checks-summary.json";

/** Ein Bash-Aufruf im Strom der Fake-Session: tool_use, kurze Pause, tool_result. */
function schub(id, command) {
  return [
    `echo '${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } })}'`,
    "sleep 0.05",
    `echo '${JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } })}'`,
  ].join("\n");
}

test("[night-924] nach einer Session mit Prueflaeufen traegt die Einheit prueflaeufe.arbeit neben zeiten", NUR_POSIX, () => {
  const dir = setupProjekt("night-prueflaeufe-stand-");
  try {
    const issue = board(dir, "issue", "create", "--title", "Mit Prueflaeufen", "--body", "## Abhaengigkeiten\nKeine.");
    const id = String(issue.id);
    board(dir, "issue", "move", id, "ready");
    const fake = [
      schub("p1", "true"),                    // woertlich das buildChecks-Kommando: volle Gruppe
      schub("p2", "true --nur-ein-teil"),     // dasselbe Programm, gezielt: nur anzahl
      schub("p3", "git status --porcelain"),  // fremdes Programm: zaehlt nicht
      SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW,
    ].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none", "--verbose"], { NIGHT_CLAUDE_CMD: fake });
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`);

    const e = einheit(dir, id);
    assert.ok(e.prueflaeufe, "die Einheit traegt kein prueflaeufe-Feld");
    assert.ok(e.zeiten, "prueflaeufe steht NEBEN zeiten, nicht an seiner Stelle");
    assert.equal(e.prueflaeufe.arbeit.anzahl, 2, "der git-Aufruf ist kein Prueflauf");
    assert.equal(e.prueflaeufe.arbeit.volle, 1);
    assert.equal(e.prueflaeufe.arbeit.volleNoetig, 0);
    assert.ok(e.prueflaeufe.arbeit.dauerMs > 0, `die Spannen haetten gemessen sein muessen: ${e.prueflaeufe.arbeit.dauerMs}`);
    assert.equal(e.zeiten.prueflaeufe, undefined, "die Zeiten bleiben unveraendert (zeitenBauen)");

    // Der zweite Berichtsort (Issue #926, E6): Die Umsetzungsnacht berichtet ueber
    // `pruefBericht` auf Konsole und ins Protokoll — genau dort lief der Anlassfall.
    assert.match(res.stdout, /Prueflaeufe und Zielmarke:/, res.stdout);
    assert.match(res.stdout, new RegExp(`#${id}:.*Prueflaeufe 2`), res.stdout);
    assert.match(res.stdout, /- 1 von 1 Paketen unter 10 Minuten\./, res.stdout);
    assert.match(res.stdout, /ohne Zuordnung: fremd\.txt/, res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-924] eine Stufe ohne Strom liefert prueflaeufe: null — nicht gemessen ist nicht null Laeufe", NUR_POSIX, async () => {
  const dir = mkdtempSync(join(tmpdir(), "night-prueflaeufe-ohne-strom-"));
  try {
    const prog = join(dir, "stufen-programm");
    writeFileSync(prog, "#!/bin/sh\necho fertig\n", { mode: 0o755 });
    const res = await runSession("1", { model: "fixture-modell", timeoutMin: 1, yolo: false, verbose: false }, {
      kommando: prog,
      aufgabenstufe: "leicht",
      stufenName: "lokal",
      prompt: "/implement-next #1",
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.prueflaeufe, null, "ohne Strom gibt es nichts zu zaehlen — 0 hiesse gemessen, keiner");
    assert.equal(res.werkzeugzeit, null, "dieselbe Regel wie bei der Werkzeugzeit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
