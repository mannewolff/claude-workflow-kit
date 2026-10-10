// Die wartende Sitzung und die Auswertung einer Runde (Issue #668, #775, #776, #977, #572) —
// im selben Prozess gegen den Teil kit/night/wartend.mjs (Plan #1199, E6, E18).
//
// Die reinen Bausteine bekommen nur Text: woran der Runner am Schlusstext eine Sitzung
// erkennt, die auf eine SELBST angestossene Arbeit gewartet hat (night-52), wo dieser Grund
// in der Rangfolge der Gruende steht (night-53) und was der Vermerk am Paket nennt (night-54).
//
// Die Auswertung einer Runde (`werteRunde`) bekommt Board und git eingesetzt: Ergebnis der
// Session, Karte vor und nach der Session und der Zustand des Arbeitsbaums gehen hinein, die
// Board-Aufrufe und die Merker der Runde kommen heraus. Die Ablaeufe mit echtem Runner, Session
// und Salvage stehen in ablauf-night-wartend-runde.test.mjs.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  wartendeSession, wartendVermerk, rundenGrund, WARTEND_ANKER, ZEITLIMIT_ANKER, HALT_FOLGESATZ, KLAEREN_LABEL,
  werteRunde, rundenMerker, rundenMerkerZuruecksetzen, wartendAbhaengigkeiten,
} from "../kit/night/wartend.mjs";

// --- night-52, night-53, night-54: die Bausteine der wartenden Sitzung (Issue #775) ---
//
// Der Wortlaut steht hier ein zweites Mal — absichtlich, wie bei den vier Gruenden
// darueber: Der Test ist die Gegenprobe zur Konstanten. Wer sie umformuliert, aendert
// einen Text, der zugleich in Protokoll, Board-Kommentar und Ergebnisstand steht, und
// soll das an einem roten Test merken.
const WARTEND_WORTLAUT =
  "Grund: Sitzung hat auf eine selbst angestossene Arbeit gewartet und ist ohne Ergebnis beendet worden";

// Wie `resultZeile`, nur mit eigenem Schlusstext — an dem haengt die ganze Erkennung.
const resultZeileMitText = (stopReason, text, isError = false) =>
  `{"type":"result","is_error":${isError},"stop_reason":${JSON.stringify(stopReason)},` +
  `"total_cost_usd":0.5,"duration_api_ms":1000,"num_turns":7,"result":${JSON.stringify(text)}}`;

test("[night-52] wartendeSession erkennt die Wendungen der Musterliste", () => {
  for (const text of [
    "Ich warte auf den Abschluss von mvn verify.",
    "Der Pflichtcheck laeuft noch.",
    "Der Testlauf laeuft im Hintergrund weiter.",
    "Ich melde mich, sobald der Lauf fertig ist.",
    "Das Ergebnis steht noch aus.",
    // Gross-/Kleinschreibung spielt keine Rolle: dieselbe Wendung, anderer Satzanfang.
    "WARTE AUF das Ende des Mutationstests.",
    // "im Hintergrund" mit einem Warteverb im Praesens: genau der Fall, um den es geht.
    "Die Tests laufen im Hintergrund, ich melde mich.",
  ]) {
    assert.equal(wartendeSession(text), true, `nicht als wartend erkannt: ${text}`);
  }
});

test("[night-52] wartendeSession wertet im Hintergrund abgeschlossene Arbeit nicht als Warten", () => {
  // "im Hintergrund" allein sagt nichts ueber den Zeitpunkt: Dieselbe Wendung steht im
  // Rueckblick einer fertigen Sitzung. Ohne Warteverb im Praesens galt eine erledigte
  // Runde als abgebrochen, und ihr Paket bekam den Vermerk der wartenden Sitzung.
  for (const text of [
    "Die Tests liefen im Hintergrund und sind inzwischen erfolgreich abgeschlossen.",
    "Fertig. Die Checks liefen im Hintergrund durch, alles gruen, committet.",
    "alles im Hintergrund erledigt",
  ]) {
    assert.equal(wartendeSession(text), false, `abgeschlossene Arbeit als Warten gewertet: ${text}`);
  }
});

test("[night-52] wartendeSession wertet das Warten auf einen Menschen nicht als eigenen Fall", () => {
  for (const text of [
    "Ich warte auf deine Antwort zur offenen Frage.",
    "Ich warte auf Rueckmeldung aus dem Team.",
    "Ich warte auf die Freigabe des Vorgehens.",
    "Ich warte auf dein GO.",
    "Ich warte auf Klaerung der offenen Frage.",
    "Ich warte auf das Review durch einen Menschen.",
  ]) {
    assert.equal(wartendeSession(text), false, `Warten auf einen Menschen faelschlich gewertet: ${text}`);
  }
  // Kein Schlusstext, kein Fall — `leseErgebnisText` liefert bei leerem Text `null`.
  assert.equal(wartendeSession(null), false);
  assert.equal(wartendeSession(""), false);
  // Eine Sitzung, die schlicht fertig ist, wartet auf nichts.
  assert.equal(wartendeSession("Issue #775 ist umgesetzt, committet und in In review."), false);
});

test("[night-52] wartendeSession trifft das Verb warten, nicht das Substantiv Warten (Issue #1207)", () => {
  // Der Schlusstext der Review-Session aus Lauf 2026-10-05-121520: Er beschrieb eine
  // Planaenderung, und das Substantiv hielt die Kette an.
  assert.equal(wartendeSession("begrenztes Warten auf eine Bedingung ist nur in gekennzeichneten Ablauf-Prüfungen erlaubt"), false);
  for (const text of ["Ich warte auf den Prüflauf", "Der Lauf wartet auf die Gruppe", "Wartet auf das Ergebnis.", "Warte auf den Lauf."]) {
    assert.equal(wartendeSession(text), true, `nicht als wartend erkannt: ${text}`);
  }
});

test("[night-52] die GO-Ausnahme trifft nur das grossgeschriebene Wort fuer sich", () => {
  // Ohne Wortgrenze verschluckte das „GO\" in ALGOL den ganzen Fall: Die Ausnahmeliste hat
  // Vorrang, und der wartende Schlusstext saehe aus wie Warten auf einen Menschen.
  assert.equal(wartendeSession("Der ALGOL-Uebersetzer laeuft noch."), true);
  // Dasselbe eine Ebene feiner: Gross-/Kleinschreibung und der Bindestrich unterscheiden
  // das kurze GO des Menschen von einem Wortbestandteil.
  assert.equal(wartendeSession("Der Go-Test laeuft noch."), true);
  assert.equal(wartendeSession("Der GO-Baustein laeuft noch."), true);
  // Und das kurze GO selbst bleibt die Ausnahme, die es war.
  assert.equal(wartendeSession("Ich warte auf dein GO."), false);
});

test("[night-53] rundenGrund liefert den neuen Grund beim regulaeren Ende einer wartenden Sitzung", () => {
  const res = { stdout: resultZeileMitText("end_turn", "Der Pflichtcheck laeuft noch im Hintergrund.") };
  assert.equal(rundenGrund(res, { zustand: "gruen" }), WARTEND_WORTLAUT);
});

test("[night-53] eine regulaer beendete Sitzung ohne Warten behaelt ihren bisherigen Grund", () => {
  const res = { stdout: resultZeileMitText("end_turn", "Alles erledigt, nichts steht offen.") };
  assert.equal(rundenGrund(res, { zustand: "gruen" }), "Grund: Session regulaer beendet ohne Commit (end_turn)");
});

test("[night-53] Zeitlimit, is_error und roter Pflichtcheck stehen vor dem neuen Grund", () => {
  const wartend = "Der Pflichtcheck laeuft noch im Hintergrund.";
  const stdout = resultZeileMitText("end_turn", wartend);

  assert.equal(
    rundenGrund({ stdout, error: { code: "ETIMEDOUT" } }, { zustand: "gruen" }),
    "Grund: Session am Zeitlimit beendet",
  );
  assert.equal(
    rundenGrund({ stdout: resultZeileMitText("end_turn", wartend, true) }, { zustand: "gruen" }),
    "Grund: Session mit is_error beendet",
  );
  assert.match(
    rundenGrund({ stdout }, { zustand: "rot", rotesKommando: "npm test" }),
    /^Grund: Pflichtcheck rot — npm test \(Session\)$/,
  );
});

test("[night-53] ohne regulaeres Ende bleibt es beim unbekannten Ergebnis", () => {
  // Der Zweig verfeinert `end_turn` und loest ihn nicht ab: Ein anderer stop_reason sagt
  // ueber den Ausgang zu wenig, um den Fall zu behaupten.
  const res = { stdout: resultZeileMitText("max_tokens", "Der Pflichtcheck laeuft noch im Hintergrund.") };
  assert.equal(rundenGrund(res, { zustand: "gruen" }), "Grund: Session ohne auswertbares Ergebnis-Ereignis beendet");
});

test("[night-54] der Vermerk nennt Anker, Fall, gekuerzten Stand und die Reste", () => {
  assert.equal(WARTEND_ANKER, "## Nachtlauf: wartende Sitzung");

  const lang = `Stand: ${"A".repeat(2500)}`;
  const vermerk = wartendVermerk(lang, ["kit/night/wartend.mjs", "test/night-wartend-sitzung.test.mjs"]);

  assert.ok(vermerk.startsWith(WARTEND_ANKER), `der Anker fehlt am Anfang:\n${vermerk}`);
  assert.ok(vermerk.includes(WARTEND_WORTLAUT), `der Fall steht nicht im Wortlaut der Konstanten:\n${vermerk}`);
  assert.ok(vermerk.includes(lang.slice(0, 2000)), "der Schlusstext fehlt bis zur Grenze");
  assert.ok(!vermerk.includes(lang.slice(0, 2001)), "der Schlusstext wird nicht auf 2.000 Zeichen gekuerzt");
  assert.match(vermerk, /kit\/night\/wartend\.mjs/, "die Reste im Arbeitsverzeichnis fehlen");
  assert.match(vermerk, /test\/night-wartend-sitzung\.test\.mjs/, "die Reste im Arbeitsverzeichnis fehlen");
});

test("[night-54] bei leerer Pfadliste entfaellt die Zeile zu den Resten ersatzlos", () => {
  const vermerk = wartendVermerk("Der Pflichtcheck laeuft noch im Hintergrund.");

  assert.ok(vermerk.includes(WARTEND_WORTLAUT));
  assert.ok(vermerk.includes("Der Pflichtcheck laeuft noch im Hintergrund."));
  // „keine Reste\" waere eine Meldung ueber etwas, das es nicht gibt — im
  // Rueckstellungsfall ist der Baum ohnehin sauber.
  assert.doesNotMatch(vermerk, /Rest/i, `der Vermerk meldet die leere Liste:\n${vermerk}`);
  assert.doesNotMatch(vermerk, /Arbeitsverzeichnis/i, `der Vermerk meldet die leere Liste:\n${vermerk}`);
});

// --- Die Auswertung einer Runde mit eingesetztem Board und git (Plan #1199, E6) ---

const DEFERRED_WORTLAUT =
  "Session ohne In-review-Ergebnis beendet — Issue zurueckgestellt, Lauf ging mit dem naechsten Issue weiter.";
const WARTE_SCHLUSSTEXT = "Der Pflichtcheck laeuft noch im Hintergrund, ich melde mich, sobald er durch ist.";
const TOP = { id: "7", title: "Ein Paket der Runde" };
const VORHER = { id: "7", status: "in_progress", labels: [], comments: [] };

/**
 * Board und git als Attrappe: `status` ist die Spalte, die der Einzelabruf nach der Session
 * liefert, `nachher` die Karte, die `issue get` dann zeigt, `sauber` der Zustand des Baums.
 * Jeder Board-Aufruf landet in `aufrufe`.
 */
function attrappe({ status = "ready", nachher = { ...VORHER, status }, sauber = true, reste = [] } = {}) {
  const aufrufe = [];
  wartendAbhaengigkeiten({
    board: (...args) => {
      aufrufe.push(args);
      return args[1] === "get" ? nachher : { ok: true };
    },
    boardRoh: (...args) => {
      aufrufe.push(args);
      return { status: 0, json: null, text: "" };
    },
    leseKarte: () => ({ ...nachher, status }),
    gitClean: () => sauber,
    gitReste: () => reste,
    lesePruefung: () => ({ zustand: "ungeprueft" }),
  });
  return aufrufe;
}

const kommentare = (aufrufe) => aufrufe.filter((a) => a[1] === "comment").map((a) => a[a.indexOf("--text") + 1]);
const moves = (aufrufe) => aufrufe.filter((a) => a[1] === "move").map((a) => a[3]);

function runde(res, { pruefung = { zustand: "ungeprueft" }, vorher = VORHER } = {}) {
  return werteRunde({
    top: TOP, res, minutes: "0.1", args: {}, salvageAttempted: new Set(), pruefung, vorher, sessionWahl: {},
  });
}

beforeEach(() => rundenMerkerZuruecksetzen());
after(() => wartendAbhaengigkeiten());

test("[night-55] eine wartende Sitzung bei sauberem Baum wird zurueckgestellt, mit eigenem Grund und Vermerk", async () => {
  const aufrufe = attrappe();
  const ausgang = await runde({ status: 0, stdout: resultZeileMitText("end_turn", WARTE_SCHLUSSTEXT) });

  assert.equal(ausgang, "deferred", "der Weg bleibt die Rueckstellung — der Baum ist sauber");
  const [kommentar] = kommentare(aufrufe);
  assert.ok(kommentar.startsWith(WARTEND_ANKER), `der Vermerk ist der Kommentar:\n${kommentar}`);
  assert.ok(kommentar.includes(WARTEND_WORTLAUT));
  assert.ok(kommentar.includes(WARTE_SCHLUSSTEXT), "der Schlusstext steht als letzter bekannter Stand da");
  assert.doesNotMatch(kommentar, /Arbeitsverzeichnis/, "bei sauberem Baum gibt es keine Reste zu melden");
  assert.deepEqual(moves(aufrufe), ["backlog"]);
  assert.equal(rundenMerker().wartend, true, "die Einheit bekommt das Feld wartendBeendet");
});

test("[night-55] dieselbe Runde ohne wartenden Schlusstext behaelt den bisherigen Grund, ohne Vermerk und Merker", async () => {
  const aufrufe = attrappe();
  const ausgang = await runde({ status: 0, stdout: resultZeileMitText("end_turn", "Ich komme nicht weiter.") });

  assert.equal(ausgang, "deferred");
  assert.deepEqual(kommentare(aufrufe), [`Nachtlauf: ${DEFERRED_WORTLAUT}`]);
  assert.deepEqual(moves(aufrufe), ["backlog"]);
  assert.deepEqual(rundenMerker(), { wartend: false, zeitlimit: false, haltArt: null });
});

test("[night-977] ein Zeitabbruch bei sauberem Baum traegt den Zeitlimit-Vermerk mit der wirksamen Grenze", async () => {
  const aufrufe = attrappe();
  const ausgang = await runde({
    status: null, signal: "SIGTERM", stdout: "", timeoutMs: 120_000,
    fortschritt: { zeilen: ["FORTSCHRITT: AK1 — Test liegt rot"], gesehen: 1 },
  });

  assert.equal(ausgang, "deferred");
  const [kommentar] = kommentare(aufrufe);
  assert.ok(kommentar.startsWith(ZEITLIMIT_ANKER), `der Zeitlimit-Vermerk ist der Kommentar:\n${kommentar}`);
  assert.match(kommentar, /2 Minuten/);
  assert.match(kommentar, /FORTSCHRITT: AK1 — Test liegt rot/);
  assert.deepEqual(rundenMerker(), { wartend: false, zeitlimit: true, haltArt: null });
});

test("[night-572] ein vollstaendig nachgewiesener Halt wird gezaehlt, ohne Kommentar und ohne Move des Runners", async () => {
  const nachher = {
    ...VORHER, status: "backlog", labels: [KLAEREN_LABEL],
    comments: [{ body: `Frage an den Menschen.\n\n${HALT_FOLGESATZ}` }],
  };
  const aufrufe = attrappe({ status: "backlog", nachher });
  const ausgang = await runde({ status: 0, stdout: resultZeileMitText("end_turn", "Die Frage steht am Board.") });

  assert.equal(ausgang, "angehalten");
  assert.deepEqual(kommentare(aufrufe), [], "den Kommentar hat die Session geschrieben");
  assert.deepEqual(moves(aufrufe), [], "den Move hat die Session gemacht");
  assert.equal(rundenMerker().haltArt, "klaeren");
});

test("[night-572] ein Halt mit unsauberem Baum ist ein harter Stopp mit Kommentar", async () => {
  const nachher = {
    ...VORHER, status: "backlog", labels: [KLAEREN_LABEL],
    comments: [{ body: `Frage.\n\n${HALT_FOLGESATZ}` }],
  };
  const aufrufe = attrappe({ status: "backlog", nachher, sauber: false, reste: ["halb.txt"] });
  const ausgang = await runde({ status: 0, stdout: resultZeileMitText("end_turn", "Frage gestellt.") });

  assert.equal(ausgang, "hardStop");
  const [kommentar] = kommentare(aufrufe);
  assert.match(kommentar, /Halt mit unsauberem Working Tree/);
  assert.deepEqual(moves(aufrufe), []);
});

test("[night-471] in In review mit Nachweis ist die Runde ein Erfolg, ohne Board-Aufruf", async () => {
  const aufrufe = attrappe({ status: "in_review" });
  const ausgang = await runde({ status: 0, stdout: resultZeileMitText("end_turn", "Fertig.") }, {
    pruefung: { zustand: "geprueft" },
  });

  assert.equal(ausgang, "erfolg");
  assert.deepEqual(aufrufe, []);
});

test("[night-471] in In review mit rotem Nachweis bleibt die Karte, und ein Kommentar nennt den Mangel", async () => {
  const aufrufe = attrappe({ status: "in_review" });
  const ausgang = await runde({ status: 0, stdout: resultZeileMitText("end_turn", "Fertig.") }, {
    pruefung: { zustand: "rot", rotesKommando: "npm test", rotesErgebnis: "rot" },
  });

  assert.equal(ausgang, "fehlschlag");
  assert.match(kommentare(aufrufe)[0], /Nachweis rot — npm test endete rot/);
  assert.deepEqual(moves(aufrufe), [], "Karte und Commit bleiben unangetastet");
});

test("[night-152] eine erfolgreiche Runde mit Resten im Baum stoppt hart", async () => {
  attrappe({ status: "in_review", reste: ["vergessen.tmp"] });
  const ausgang = await runde({ status: 0, stdout: resultZeileMitText("end_turn", "Fertig.") }, {
    pruefung: { zustand: "geprueft" },
  });
  assert.equal(ausgang, "hardStop");
});

test("[night-927] ein unlesbarer Zustand der Karte ist ein Fehlschlag ohne Board-Aenderung", async () => {
  const aufrufe = attrappe();
  wartendAbhaengigkeiten({ leseKarte: () => null });
  const ausgang = await runde({ status: 0, stdout: resultZeileMitText("end_turn", WARTE_SCHLUSSTEXT) });

  assert.equal(ausgang, "fehlschlag");
  assert.deepEqual(aufrufe, []);
  assert.equal(rundenMerker().wartend, false, "ohne gelesenen Zustand wird nichts gewertet");
});

test("[night-1418] die Bremse aus der Zusammenfassung kommt ueber die eingesetzte Abhaengigkeit", async () => {
  const aufrufe = attrappe();
  const gelesen = [];
  wartendAbhaengigkeiten({
    lesePruefung: (id) => {
      gelesen.push(id);
      return {
        zustand: "rot",
        roh: { festgefahren: { ausgeloest: { pruefung: "npm test", fehler: "AssertionError", versuche: 3 } } },
      };
    },
  });
  const ausgang = await runde({ status: 0, stdout: resultZeileMitText("end_turn", "Ich komme nicht weiter.") });

  assert.equal(ausgang, "festgefahren");
  assert.deepEqual(gelesen, [TOP.id], "gelesen wird die Zusammenfassung der Karte der Runde");
  assert.deepEqual(moves(aufrufe), ["backlog"]);
});

test("wartendAbhaengigkeiten weist eine unbekannte Abhaengigkeit ab", () => {
  assert.throws(() => wartendAbhaengigkeiten({ spawn: () => {} }), /kennt keine Abhaengigkeit 'spawn'/);
});
