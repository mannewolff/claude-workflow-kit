// Das Modell einer Karte (Issue #665, Plan #663).
//
// Der Nacht-Runner startete jede Session mit demselben Modell — `args.model`, einmal fuer
// den ganzen Lauf. Eine Empfehlung am Arbeitspaket hatte keine Wirkung. Jetzt laeuft die
// Session einer Karte mit dem Modell dieser Karte.
//
// Die Liste erlaubter Namen aus `night.modelle` ist die EINZIGE Pruefung (Plan #663, E3).
// Sie ist kein Komfort, sondern der Sicherheitskern: Ohne sie wanderte ein Wert aus einem
// Issue-Body unbesehen in `argv`, und ein Paket mit
// `Empfohlenes Modell: --dangerously-skip-permissions` waere ein Angriff ueber eine Karte.
// Ein Name ausserhalb der Liste faellt auf das Modell des Laufs zurueck, mit Grund in der
// Einheit. Ein Modell, das trotz gueltigen Namens nicht startet, bleibt ein Fehlschlag wie
// heute — `werteRunde` behandelt jeden Nicht-Timeout-Exit ungleich 0 so, und "nicht
// gestartet" waere von "abgestuerzt" nur durch Deutung von stderr zu unterscheiden.
//
// Hier stehen die reinen Funktionen im selben Prozess. Wie der Runner das Modell einer Karte
// in die Session bringt, pruefen seit Issue #1229 die Ablauf-Pruefungen in
// test/ablauf-night-session-modell.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";

import { empfohlenesModell, aufgabenStufe, stufenEinstellung, stufeStartbar, modellFuerStufe, paketWahl, frischeStufenFelder, runSession } from "../kit/night/session.mjs";
import { sessionAbh, ARGS } from "./helpers/session-attrappe.mjs";

const ERLAUBT = ["claude-opus-5", "claude-sonnet-5"];

// --- Die reine Funktion ---

test("[night-26] ein Name von der Liste wird uebernommen", () => {
  const { modell, grund } = empfohlenesModell("## Kontext\n\nEmpfohlenes Modell: claude-sonnet-5\n", ERLAUBT);
  assert.equal(modell, "claude-sonnet-5");
  assert.equal(grund, null, "ein uebernommener Name braucht keinen Grund");
});

test("[night-26] ein Name ausserhalb der Liste liefert null mit Grund", () => {
  const { modell, grund } = empfohlenesModell("Empfohlenes Modell: gpt-6-astra\n", ERLAUBT);
  assert.equal(modell, null);
  assert.ok(grund && grund.length > 0, "der Rueckfall braucht einen Grund");
  assert.match(grund, /gpt-6-astra/, "der Grund nennt den abgewiesenen Namen");
});

test("[night-26] ein Wert mit fuehrendem Bindestrich gilt gar nicht erst als Treffer", () => {
  // Der Sicherheitskern. Der Wert darf nicht einmal als Kandidat entstehen — er stuende
  // sonst eine Vergleichsoperation davon entfernt, in argv zu landen.
  const { modell } = empfohlenesModell("Empfohlenes Modell: --dangerously-skip-permissions\n", ERLAUBT);
  assert.equal(modell, null, "ein Flag ist kein Modellname");
});

test("[night-26] ein Wert mit Leerzeichen gilt nicht als Treffer", () => {
  // Sonst waere `claude-opus-5 --dangerously-skip-permissions` ein Treffer, sobald der
  // Vergleich nur den Anfang prueft.
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5 --yolo\n", ERLAUBT).modell, null);
});

test("[night-26] eine fehlende Zeile liefert null ohne Grund", () => {
  const { modell, grund } = empfohlenesModell("## Kontext\n\nKein Hinweis hier.\n", ERLAUBT);
  assert.equal(modell, null);
  assert.equal(grund, null, "eine fehlende Empfehlung ist kein abgewiesener Name");
});

test("[night-26] eine fehlende oder leere Liste schaltet die Wirkung ab", () => {
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5\n", []).modell, null);
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5\n", undefined).modell, null);
  assert.equal(empfohlenesModell("Empfohlenes Modell: claude-opus-5\n", null).modell, null);
});

test("[night-26] die Zeile ist am Zeilenanfang verankert", () => {
  // Sonst traefe eine Erwaehnung im Fliesstext ("... siehe Empfohlenes Modell: X ...").
  assert.equal(empfohlenesModell("siehe Empfohlenes Modell: claude-opus-5\n", ERLAUBT).modell, null);
});

// Unter Windows findet das Kit ein Programm nur ueber eine Endung aus PATHEXT. Wie npm es
// installiert, liegt daneben eine `.cmd`, und gestartet wird die sh-Datei ohne Endung ueber
// die Git Bash (Issue #1131, E8). Die `.cmd` selbst laeuft nie; auf POSIX bleibt sie unbeachtet.
function huelleFuerWindows(binDir, name) {
  writeFileSync(join(binDir, `${name}.cmd`), "@rem Huelle: das Kit startet die sh-Datei daneben.\r\n");
}

// --- Die Stufenwahl (Issue #709, Plan #707) ---
//
// Vier Funktionen ohne Aufrufer: Die Stufe eines Pakets, die normalisierte Einstellung,
// die Startpruefung einer Stufe und das Ausweichen nach oben. Sie stehen hier unter Test,
// bevor `laufeRunde` sie im Folgepaket benutzt — das Ausweichen ueber zwei Stufen, der
// abgewiesene Stufenwert und die Kommandozeile mit vorangestellter Umgebung sind genau die
// Stellen, an denen ein Fehler still das falsche Modell startet.

test("[night-37] die Zeile Aufgabenstufe wird am Zeilenanfang gelesen", () => {
  for (const wert of ["schwer", "mittel", "leicht"]) {
    const { stufe, grund } = aufgabenStufe(`## Kontext\n\nAufgabenstufe: ${wert}\n`);
    assert.equal(stufe, wert);
    assert.equal(grund, null, "eine gelesene Stufe braucht keinen Grund");
  }
});

test("[night-37] eine eingerueckte Zeile und eine Erwaehnung im Fliesstext treffen nicht", () => {
  // Derselbe enge Anker wie bei EMPFOHLENES_MODELL_ZEILE.
  assert.equal(aufgabenStufe("  Aufgabenstufe: leicht\n").stufe, null, "eingerueckt ist kein Treffer");
  assert.equal(aufgabenStufe("siehe Aufgabenstufe: leicht\n").stufe, null, "Fliesstext ist kein Treffer");
  assert.equal(aufgabenStufe("Aufgabenstufe: leicht und schwer\n").stufe, null, "zwei Woerter sind kein Treffer");
});

test("[night-37] ein unbekannter Stufenwert liefert null mit Grund", () => {
  const { stufe, grund } = aufgabenStufe("Aufgabenstufe: mittelschwer\n");
  assert.equal(stufe, null);
  assert.ok(grund && grund.length > 0, "ein abgewiesener Wert braucht einen Grund");
  assert.match(grund, /mittelschwer/, "der Grund nennt den abgewiesenen Wert");
});

test("[night-37] eine fehlende Zeile liefert null ohne Grund", () => {
  const { stufe, grund } = aufgabenStufe("## Kontext\n\nKein Hinweis hier.\n");
  assert.equal(stufe, null);
  assert.equal(grund, null, "eine fehlende Stufe ist kein abgewiesener Wert");
});

test("[night-37] fehlender Block, leerer Block und leere Stufen ergeben aktiv false", () => {
  for (const config of [
    undefined,
    {},
    { night: {} },
    { night: { stufen: {} } },
    { night: { stufen: { schwer: {}, mittel: {}, leicht: {} } } },
    { night: { stufen: { schwer: { modell: "" }, leicht: { kommando: "  " } } } },
  ]) {
    const { aktiv, stufen } = stufenEinstellung(config);
    assert.equal(aktiv, false, `aktiv bei ${JSON.stringify(config)}`);
    assert.deepEqual(stufen, {}, "eine leere Stufe wird weggeworfen");
  }
});

test("[night-37] eine belegte Stufe genuegt fuer aktiv true", () => {
  // Teilbelegung ist der Normalfall (Plan #707, E4).
  const { aktiv, stufen } = stufenEinstellung({ night: { stufen: { schwer: { modell: "claude-opus-5" }, mittel: {} } } });
  assert.equal(aktiv, true);
  assert.deepEqual(Object.keys(stufen), ["schwer"], "nur die belegte Stufe bleibt stehen");
  assert.equal(stufen.schwer.modell, "claude-opus-5");
  assert.equal(stufen.schwer.kommando, null);
  assert.equal(stufen.schwer.name, null);
});

test("[night-37] eine Kommando-Stufe behaelt ihren Namen", () => {
  const { aktiv, stufen } = stufenEinstellung({ night: { stufen: { leicht: { kommando: "mein-runner --auftrag", name: "lokal" } } } });
  assert.equal(aktiv, true);
  // `effort: null` seit Issue #846: Der normalisierte Eintrag traegt das Feld immer,
  // eine Kommando-Stufe hat dort nie einen Wert.
  assert.deepEqual(stufen.leicht, { modell: null, kommando: "mein-runner --auftrag", name: "lokal", effort: null });
});

test("[night-37] das Ausweichen geht ueber zwei Stufen nach oben", () => {
  const einstellung = stufenEinstellung({ night: { stufen: { schwer: { modell: "claude-opus-5" } } } });
  const { stufeVerwendet, eintrag, grund } = modellFuerStufe(einstellung, "leicht", ERLAUBT);
  assert.equal(stufeVerwendet, "schwer");
  assert.equal(eintrag.modell, "claude-opus-5");
  assert.match(grund, /leicht/, "der Grund nennt die uebersprungene Stufe leicht");
  assert.match(grund, /mittel/, "der Grund nennt die uebersprungene Stufe mittel");
});

test("[night-37] eine belegte und startbare Stufe wird ohne Grund geliefert", () => {
  const einstellung = stufenEinstellung({ night: { stufen: { leicht: { modell: "claude-sonnet-5" } } } });
  const { stufeVerwendet, eintrag, grund } = modellFuerStufe(einstellung, "leicht", ERLAUBT);
  assert.equal(stufeVerwendet, "leicht");
  assert.equal(eintrag.modell, "claude-sonnet-5");
  assert.equal(grund, null, "ohne uebersprungene Stufe gibt es nichts zu begruenden");
});

test("[night-37] keine hoehere Stufe belegt liefert stufeVerwendet null mit Grund", () => {
  const einstellung = stufenEinstellung({ night: { stufen: { leicht: { modell: "claude-sonnet-5" } } } });
  const { stufeVerwendet, eintrag, grund } = modellFuerStufe(einstellung, "mittel", ERLAUBT);
  assert.equal(stufeVerwendet, null);
  assert.equal(eintrag, null);
  assert.match(grund, /mittel/, "der Grund nennt die unbelegte Stufe");
  assert.match(grund, /schwer/, "der Grund nennt auch die hoehere unbelegte Stufe");
});

test("[night-37] eine belegte, aber nicht startbare Stufe wird uebersprungen", () => {
  // `claude-fremd-5` steht nicht in night.modelle (E18) — die Stufe gilt als nicht startbar
  // und der Lauf weicht nach oben aus, mit dem Grund im Satz.
  const einstellung = stufenEinstellung({ night: { stufen: { mittel: { modell: "claude-fremd-5" }, schwer: { modell: "claude-opus-5" } } } });
  const { stufeVerwendet, grund } = modellFuerStufe(einstellung, "mittel", ERLAUBT);
  assert.equal(stufeVerwendet, "schwer");
  assert.match(grund, /mittel/, "der Grund nennt die uebersprungene Stufe");
  assert.match(grund, /nicht startbar/, "der Grund unterscheidet nicht startbar von nicht belegt");
  assert.match(grund, /claude-fremd-5/, "der Grund nennt den abgewiesenen Namen");
});

test("[night-37] ein Stufen-Modellname ausserhalb night.modelle gilt als nicht startbar", () => {
  assert.equal(stufeStartbar({ modell: "claude-opus-5" }, ERLAUBT).ok, true);
  const { ok, grund } = stufeStartbar({ modell: "claude-fremd-5" }, ERLAUBT);
  assert.equal(ok, false);
  assert.match(grund, /night\.modelle/, "der Grund nennt die Liste, gegen die geprueft wird");
});

/** Ein ausfuehrbares Programm in einem eigenen Temp-Verzeichnis, erreichbar ueber PATH. */
function programmImPfad(name) {
  const binDir = mkdtempSync(join(tmpdir(), "night-stufe-bin-"));
  writeFileSync(join(binDir, name), "#!/bin/sh\nexit 0\n");
  chmodSync(join(binDir, name), 0o755);
  huelleFuerWindows(binDir, name);
  return binDir;
}

function mitPfad(binDir, fn) {
  const alt = process.env.PATH;
  process.env.PATH = `${binDir}${delimiter}${alt}`;
  try {
    return fn();
  } finally {
    process.env.PATH = alt;
  }
}

test("[night-37] ein auffindbares Programm im PATH gilt als startbar", () => {
  const binDir = programmImPfad("mein-runner-xyz");
  try {
    mitPfad(binDir, () => {
      const { ok, grund } = stufeStartbar({ kommando: "mein-runner-xyz --auftrag" }, []);
      assert.equal(ok, true, `als nicht startbar gemeldet: ${grund}`);
      assert.equal(grund, null);
    });
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("[night-37] eine fuehrende NAME=WERT-Zuweisung gilt nicht als Programmname", () => {
  // Sonst suchte die Startpruefung nach einem Programm namens `KEIN_ECHTER_HOST=1` und
  // wiche still nach oben aus, obwohl das Programm da ist (Plan #707, E8).
  const binDir = programmImPfad("mein-runner-xyz");
  try {
    mitPfad(binDir, () => {
      const { ok } = stufeStartbar({ kommando: "KEIN_ECHTER_HOST=1 PORT=9 mein-runner-xyz --flag" }, []);
      assert.equal(ok, true, "die vorangestellte Umgebung verdeckt das Programm");
    });
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("[night-37] ein nicht auffindbares Programm gilt als nicht startbar", () => {
  const { ok, grund } = stufeStartbar({ kommando: "KEIN_ECHTER_HOST=1 gibt-es-nicht-xyz --flag" }, []);
  assert.equal(ok, false);
  assert.match(grund, /gibt-es-nicht-xyz/, "der Grund nennt das gesuchte Programm");
});

test("[night-37] ein Shell-Builtin gilt als startbar", () => {
  // `command -v` findet Builtins; eine eigene PATH-Suche faende sie nicht (E8).
  assert.equal(stufeStartbar({ kommando: "cd /tmp" }, []).ok, true);
});

// --- Die Wahl je Paket (Issue #711, Plan #707, E5/E6) ---
//
// `paketWahl` ist die eine Stelle, an der Modellname und Stufe aufeinandertreffen. Die
// Reihenfolge ist der Gegenstand: erst der Name der Karte, dann — nur bei aktiver
// Einstellung — die Stufe, sonst das Modell des Laufs. Ein ABGEWIESENER Name faellt auf
// das Modell des Laufs und nicht auf die Stufe (E6): Ein Vertipper darf nicht still ein
// anderes Modell in Gang setzen.

const wahl = (body, stufen, laufModell = "claude-opus-5", erlaubte = ERLAUBT) =>
  paketWahl({ body, einstellung: stufenEinstellung({ night: { stufen } }), erlaubteModelle: erlaubte, laufModell });

test("[night-26] der Modellname der Karte gewinnt gegen die Stufe, mit Vermerk der doppelten Angabe", () => {
  const w = wahl("Empfohlenes Modell: claude-sonnet-5\nAufgabenstufe: leicht\n",
    { leicht: { modell: "claude-opus-5" } });
  assert.equal(w.modell, "claude-sonnet-5");
  assert.equal(w.herkunft, "karte");
  assert.equal(w.stufe, "leicht", "die Stufe der Karte steht trotzdem in der Einheit");
  assert.equal(w.stufeVerwendet, null, "die Stufe hat das Modell nicht gestellt");
  assert.ok(w.grund && w.grund.length > 0, "die doppelte Angabe braucht einen Vermerk");
  assert.match(w.grund, /leicht/, "der Vermerk nennt die uebergangene Stufe");
});

test("[night-26] ein abgewiesener Modellname faellt auf das Modell des Laufs und nicht auf die Stufe", () => {
  // E6: Der Rueckfall der Karte endet beim Lauf. Ginge er weiter zur Stufe, startete ein
  // Vertipper im Modellnamen still ein anderes Modell als das des Laufs.
  const w = wahl("Empfohlenes Modell: claude-gibt-es-nicht\nAufgabenstufe: leicht\n",
    { leicht: { modell: "claude-sonnet-5" } });
  assert.equal(w.modell, "claude-opus-5");
  assert.equal(w.herkunft, "lauf");
  assert.equal(w.stufeVerwendet, null, "die Stufe darf den abgewiesenen Namen nicht auffangen");
  assert.match(w.grund, /claude-gibt-es-nicht/, "der Grund nennt den abgewiesenen Namen");
});

test("[night-26] eine fehlende Stufe bei aktiver Einstellung ergibt das Modell des Laufs", () => {
  const w = wahl("## Kontext\n\nKein Hinweis hier.\n", { leicht: { modell: "claude-sonnet-5" } });
  assert.equal(w.modell, "claude-opus-5");
  assert.equal(w.herkunft, "lauf");
  assert.equal(w.stufe, null);
  assert.equal(w.stufeVerwendet, null);
  assert.equal(w.grund, null, "eine fehlende Zeile ist kein Befund");
});

test("[night-26] eine Stufe ohne aktive Einstellung ergibt das Modell des Laufs", () => {
  const w = wahl("Aufgabenstufe: leicht\n", {});
  assert.equal(w.modell, "claude-opus-5");
  assert.equal(w.herkunft, "lauf");
  assert.equal(w.stufe, "leicht", "die Stufe der Karte bleibt sichtbar");
  assert.equal(w.stufeVerwendet, null);
});

test("[night-26] die Stufe stellt das Modell und weicht nach oben aus", () => {
  const w = wahl("Aufgabenstufe: leicht\n", { schwer: { modell: "claude-sonnet-5" } });
  assert.equal(w.modell, "claude-sonnet-5");
  assert.equal(w.herkunft, "stufe");
  assert.equal(w.stufe, "leicht");
  assert.equal(w.stufeVerwendet, "schwer");
  assert.match(w.grund, /leicht/, "der Grund nennt die uebersprungene Stufe leicht");
  assert.match(w.grund, /mittel/, "der Grund nennt die uebersprungene Stufe mittel");
  assert.equal(w.startbar, true);
});

test("[night-26] eine Kommando-Stufe liefert Kommandozeile und Namen statt eines Modellnamens", () => {
  const w = wahl("Aufgabenstufe: leicht\n", { leicht: { kommando: "cd /tmp", name: "lokal" } });
  assert.equal(w.kommando, "cd /tmp");
  assert.equal(w.stufenName, "lokal");
  assert.equal(w.herkunft, "stufe");
  assert.equal(w.modell, "lokal", "die Selbstauskunft der Stufe steht dort, wo sonst der Modellname steht");
  assert.equal(w.startbar, true);
});

test("[night-26] scheitert die Startpruefung auf allen Stufen, ist das Paket nicht startbar", () => {
  const w = wahl("Aufgabenstufe: mittel\n", { mittel: { modell: "claude-fremd-5" } });
  assert.equal(w.startbar, false, "ohne startbare Stufe darf keine Session beginnen");
  assert.equal(w.stufeVerwendet, null);
  assert.match(w.grund, /mittel/, "der Grund nennt die gescheiterte Stufe");
  assert.match(w.grund, /schwer/, "der Grund nennt auch die unbelegte hoehere Stufe");
});

test("[night-26] ein abgewiesener Stufenwert ergibt das Modell des Laufs, mit Grund", () => {
  const w = wahl("Aufgabenstufe: mittelschwer\n", { leicht: { modell: "claude-sonnet-5" } });
  assert.equal(w.modell, "claude-opus-5");
  assert.equal(w.herkunft, "lauf");
  assert.equal(w.startbar, true, "ein unbrauchbarer Stufenwert haelt das Paket nicht auf");
  assert.match(w.grund, /mittelschwer/, "der Grund nennt den abgewiesenen Wert");
});

// --- Die frisch gelesene Einstellung (Issue #711, Plan #707, E19) ---

test("[night-26] frischeStufenFelder liest stufen und stufenRegel von Platte", () => {
  const dir = mkdtempSync(join(tmpdir(), "night-frisch-"));
  try {
    const pfad = join(dir, "workflow.config.json");
    writeFileSync(pfad, JSON.stringify({ night: { stufen: { leicht: { modell: "claude-sonnet-5" } }, stufenRegel: "eigene Regel" } }));
    const felder = frischeStufenFelder(pfad, { night: { stufen: { schwer: { modell: "claude-opus-5" } } } });
    assert.deepEqual(felder.stufen, { leicht: { modell: "claude-sonnet-5" } }, "der Stand des Laufbeginns wird ueberschrieben");
    assert.equal(felder.stufenRegel, "eigene Regel");
    assert.equal(felder.grund, null, "ein gelungener Lesevorgang braucht keinen Grund");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[night-26] ein unlesbarer Stand liefert den Stand des Laufbeginns mit Grund", () => {
  // E19: Der Lauf darf daran nicht enden — er arbeitet mit dem weiter, was er beim Start
  // gelesen hat, und sagt im Protokoll, dass er es tut.
  const stand = { night: { stufen: { schwer: { modell: "claude-opus-5" } }, stufenRegel: "Regel vom Start" } };
  const felder = frischeStufenFelder(join(tmpdir(), "gibt-es-nicht-711", "workflow.config.json"), stand);
  assert.deepEqual(felder.stufen, { schwer: { modell: "claude-opus-5" } });
  assert.equal(felder.stufenRegel, "Regel vom Start");
  assert.ok(felder.grund && felder.grund.length > 0, "der Rueckfall auf den Startstand braucht einen Grund");
});

// --- Das gewaehlte Modell in der Session (Issue #665) ------------------------------

test("[night-26] runSession startet mit dem uebergebenen Modell, in --model und KIT_AGENT_MODEL", async () => {
  const { abh, aufrufe } = sessionAbh([]);
  await runSession("7", { ...ARGS, model: "claude-opus-5" }, { model: "claude-sonnet-5" }, abh);
  const { args, env } = aufrufe[0];
  assert.equal(args[args.indexOf("--model") + 1], "claude-sonnet-5");
  assert.equal(env.KIT_AGENT_MODEL, "claude-sonnet-5", "der Aktivitaetsverlauf zeigt das Modell der Karte, nicht das des Laufs");
});

test("[night-26] ohne eigenes Modell behaelt die Session das Modell des Laufs", async () => {
  const { abh, aufrufe } = sessionAbh([]);
  await runSession("7", { ...ARGS, model: "claude-opus-5" }, {}, abh);
  const { args, env } = aufrufe[0];
  assert.equal(args[args.indexOf("--model") + 1], "claude-opus-5");
  assert.equal(env.KIT_AGENT_MODEL, "claude-opus-5");
});
