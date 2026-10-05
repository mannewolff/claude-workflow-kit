// Die Entscheidungen hinter der Wiederholung gegen Ueberlast (Issue #834, #842, #998,
// #1067), als reine Funktionen des Teils kit/board/wiederholung.mjs (Issue #1215, Plan
// #1199, E6, E18): Budget und Grenze je Versuch, was wiederholt werden darf, welche
// Rueckmeldung ein Versuch traegt, wie lange gewartet wird, das Wiederholkommando, der
// Neustart hinter einem Proxy und die begrenzte Gleichzeitigkeit der Verlaufsabrufe.
//
// Alles im selben Prozess, ohne Server und ohne Kindprozess. Die Schleife selbst, die
// diese Entscheidungen der Reihe nach trifft, gehoert zum Toolbox-Adapter und steht in
// test/board-toolbox-wiederholung.test.mjs; was nur ueber die CLI sichtbar ist, in
// test/ablauf-board-wiederholung-cli.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RUECKMELDUNG } from "../kit/board/grundlagen.mjs";
import {
  TOOLBOX_UEBERLAST_TYPE,
  TOOLBOX_BUDGET_NACHT_MS,
  toolboxBudgetMs,
  toolboxVersuchMs,
  darfWiederholen,
  rueckmeldungFuer,
  wartezeitMs,
  wiederholKommando,
  netzfehlerArt,
  proxyNeustartNoetig,
  proxyGesetzt,
  PROXY_HINWEIS,
  hoechstensGleichzeitig,
} from "../kit/board/wiederholung.mjs";

const PROXY = "http://127.0.0.1:9";

// ============================================================
// Budget und Grenze je Versuch
// ============================================================

test("toolboxBudgetMs: 30 Sekunden interaktiv, 120 mit KIT_AGENT_MODEL", () => {
  assert.equal(toolboxBudgetMs({}), 30_000);
  assert.equal(toolboxBudgetMs({ KIT_AGENT_MODEL: "" }), 30_000);
  assert.equal(toolboxBudgetMs({ KIT_AGENT_MODEL: "claude-opus-5" }), 120_000);
});

test("KIT_TOOLBOX_BUDGET_MS schlaegt beide Regelwerte", () => {
  assert.equal(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: "200" }), 200);
  assert.equal(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: " 200 " }), 200);
  assert.equal(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: "200", KIT_AGENT_MODEL: "claude-opus-5" }), 200);
});

test("Ein unbrauchbarer Wert faellt auf die Regel zurueck", () => {
  for (const wert of ["", "   ", "0", "-5", "abc", "1.5"]) {
    assert.equal(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: wert }), 30_000, wert);
    assert.equal(
      toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: wert, KIT_AGENT_MODEL: "claude-opus-5" }),
      120_000,
      wert
    );
  }
});

test("Ohne die Variable gilt die Regel unveraendert", () => {
  assert.equal(toolboxBudgetMs({}), 30_000);
  assert.equal(toolboxBudgetMs({ KIT_AGENT_MODEL: "claude-opus-5" }), 120_000);
});

// Die Grenze je Versuch folgt dem Budget (Issue #1067): Nachts reisst die Uebertragung
// einer grossen Antwort bei langsamer Leitung die 10 s, und jeder Wiederholversuch
// scheiterte genauso. Drei Versuche passen in beiden Faellen ins Budget.
test("Die Grenze je Versuch ist interaktiv 10 s und nachts 30 s", () => {
  assert.equal(toolboxVersuchMs(toolboxBudgetMs({})), 10_000);
  assert.equal(toolboxVersuchMs(30_000), 10_000);
  assert.equal(toolboxVersuchMs(toolboxBudgetMs({ KIT_AGENT_MODEL: "claude-opus-5" })), 30_000);
  assert.equal(toolboxVersuchMs(120_000), 30_000);
});

test("Ein ausdruecklich gesetztes Budget unter dem Nacht-Budget behaelt 10 s je Versuch", () => {
  assert.equal(toolboxVersuchMs(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: "200" })), 10_000);
  assert.equal(toolboxVersuchMs(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: "119999" })), 10_000);
  assert.equal(toolboxVersuchMs(toolboxBudgetMs({ KIT_TOOLBOX_BUDGET_MS: "120000" })), 30_000);
});

test("TOOLBOX_BUDGET_NACHT_MS ist das Nachtbudget, das der Nacht-Runner mitgibt", () => {
  assert.equal(TOOLBOX_BUDGET_NACHT_MS, 120_000);
  assert.equal(toolboxBudgetMs({ KIT_AGENT_MODEL: "claude-opus-5" }), TOOLBOX_BUDGET_NACHT_MS);
});

// ============================================================
// Was wiederholt wird und welche Rueckmeldung ein Versuch traegt
// ============================================================

test("darfWiederholen: 429 nur mit Ueberlast-type, dann aber bei jeder Methode", () => {
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    assert.equal(darfWiederholen({ method, status: 429, typ: TOOLBOX_UEBERLAST_TYPE }), true, method);
    assert.equal(darfWiederholen({ method, status: 429, typ: null }), false, method);
    assert.equal(darfWiederholen({ method, status: 429, typ: "urn:fremd:limit" }), false, method);
  }
});

test("darfWiederholen: 5xx bei GET/PUT/DELETE und bei POST nur mit Schluessel", () => {
  assert.equal(darfWiederholen({ method: "GET", status: 503 }), true);
  assert.equal(darfWiederholen({ method: "PUT", status: 502 }), true);
  assert.equal(darfWiederholen({ method: "DELETE", status: 500 }), true);
  assert.equal(darfWiederholen({ method: "POST", status: 502, hatSchluessel: true }), true);
  assert.equal(darfWiederholen({ method: "POST", status: 502, hatSchluessel: false }), false);
});

test("darfWiederholen: 401 und die uebrigen 4xx nie", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(darfWiederholen({ method: "GET", status }), false, String(status));
  }
});

test("darfWiederholen: Zeitablauf und Abbruch ja, aktive Ablehnung nein", () => {
  assert.equal(darfWiederholen({ method: "GET", netz: "zeitablauf" }), true);
  assert.equal(darfWiederholen({ method: "POST", netz: "abbruch" }), true);
  assert.equal(darfWiederholen({ method: "GET", netz: "endgueltig" }), false);
});

test("rueckmeldungFuer: die drei Faelle", () => {
  assert.equal(rueckmeldungFuer({ ok: true, status: 200, method: "POST" }), RUECKMELDUNG.AUSGEFUEHRT);
  assert.equal(rueckmeldungFuer({ status: 403, method: "POST" }), RUECKMELDUNG.NICHT_AUSGEFUEHRT);
  assert.equal(rueckmeldungFuer({ netz: "endgueltig", method: "POST" }), RUECKMELDUNG.NICHT_AUSGEFUEHRT);
  assert.equal(rueckmeldungFuer({ netz: "zeitablauf", method: "POST" }), RUECKMELDUNG.AUSGANG_UNKLAR);
  assert.equal(rueckmeldungFuer({ status: 502, method: "POST" }), RUECKMELDUNG.AUSGANG_UNKLAR);
  // Lesend veraendert nichts — auch ein abgebrochener GET ist "nicht ausgefuehrt".
  assert.equal(rueckmeldungFuer({ netz: "zeitablauf", method: "GET" }), RUECKMELDUNG.NICHT_AUSGEFUEHRT);
  assert.equal(rueckmeldungFuer({ status: 503, method: "GET" }), RUECKMELDUNG.NICHT_AUSGEFUEHRT);
});

test("wartezeitMs: waechst, deckelt, streut und folgt Retry-After", () => {
  assert.equal(wartezeitMs(1, null, () => 0), 500);
  assert.equal(wartezeitMs(2, null, () => 0), 1000);
  assert.equal(wartezeitMs(5, null, () => 0), 8000);
  assert.equal(wartezeitMs(9, null, () => 0), 8000);
  // Streuung: voller Zufallswert schlaegt oben auf, nie nach unten.
  assert.ok(wartezeitMs(1, null, () => 1) > 500);
  // Retry-After gewinnt gegen die eigene Staffel, 0 faellt auf die Untergrenze.
  assert.equal(wartezeitMs(1, 3, () => 0), 3000);
  assert.equal(wartezeitMs(4, 0, () => 0), 100);
});

test("wiederholKommando: setzt den Schalter, ohne ihn zu doppeln", () => {
  const argv = ["/usr/bin/node", "board.mjs", "issue", "comment", "7", "--text", "hallo welt"];
  const kommando = wiederholKommando("abc-123", argv);
  assert.match(kommando, /^node board\.mjs issue comment 7/);
  assert.match(kommando, /--text 'hallo welt'/);
  assert.match(kommando, /--idempotency-key abc-123$/);
  // Ein vorhandener Schalter wird ersetzt, nicht ergaenzt.
  const nochmal = wiederholKommando("neu", [...argv, "--idempotency-key", "alt"]);
  assert.equal(nochmal.match(/--idempotency-key/g).length, 1);
  assert.match(nochmal, /--idempotency-key neu$/);
});

// ============================================================
// Netzfehler einordnen
// ============================================================

function netzfehler(code, name = "Error") {
  const e = new Error(`fetch failed (${code})`);
  e.name = name;
  e.cause = { code };
  return e;
}

test("netzfehlerArt: die eigene Zeitgrenze ist ein Zeitablauf", () => {
  assert.equal(netzfehlerArt(netzfehler("UND_ERR_HEADERS_TIMEOUT", "TimeoutError")), "zeitablauf");
  assert.equal(netzfehlerArt(netzfehler("", "AbortError")), "zeitablauf");
});

test("netzfehlerArt: kein Aufruf ging hinaus, wenn der Server ablehnt oder der Name fehlt", () => {
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "ERR_INVALID_URL", "EPROTO", "CERT_HAS_EXPIRED"]) {
    assert.equal(netzfehlerArt(netzfehler(code)), "endgueltig", code);
  }
  // Der Code darf auch am Fehler selbst haengen statt an seiner Ursache.
  assert.equal(netzfehlerArt({ code: "ECONNREFUSED" }), "endgueltig");
});

test("netzfehlerArt: eine unterwegs abgebrochene Verbindung ist ein Abbruch", () => {
  assert.equal(netzfehlerArt(netzfehler("ECONNRESET")), "abbruch");
  assert.equal(netzfehlerArt(new Error("fetch failed")), "abbruch");
  assert.equal(netzfehlerArt(undefined), "abbruch");
});

// ============================================================
// Neustart hinter einem Proxy (Issue #998)
// ============================================================

test("proxyNeustartNoetig: Proxy gesetzt, Schalter fehlt -> true", () => {
  assert.equal(proxyNeustartNoetig({ HTTPS_PROXY: PROXY }), true);
});

test("proxyNeustartNoetig: Schalter gesetzt -> false", () => {
  assert.equal(proxyNeustartNoetig({ HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: "1" }), false);
});

test("proxyNeustartNoetig: keine Proxy-Variable -> false", () => {
  assert.equal(proxyNeustartNoetig({}), false);
});

test("proxyNeustartNoetig: nur https_proxy (klein) -> true", () => {
  assert.equal(proxyNeustartNoetig({ https_proxy: PROXY }), true);
});

test("proxyNeustartNoetig: leere Proxy-Variable -> false", () => {
  assert.equal(proxyNeustartNoetig({ HTTPS_PROXY: "", https_proxy: "  " }), false);
});

test("proxyGesetzt: nur eine nicht leere Proxy-Variable zaehlt", () => {
  assert.equal(proxyGesetzt({ HTTPS_PROXY: PROXY }), true);
  assert.equal(proxyGesetzt({ https_proxy: PROXY, NODE_USE_ENV_PROXY: "1" }), true);
  assert.equal(proxyGesetzt({ HTTPS_PROXY: " " }), false);
  assert.equal(proxyGesetzt({}), false);
});

test("PROXY_HINWEIS nennt die Abhilfe und warnt vor dem Verlassen der Sandbox", () => {
  assert.match(PROXY_HINWEIS, /NODE_USE_ENV_PROXY=1/);
  assert.match(PROXY_HINWEIS, /nicht das Verlassen der Sandbox/);
});

// ============================================================
// Begrenzte Gleichzeitigkeit der Verlaufsabrufe (Issue #1095)
// ============================================================

/** Ein von aussen geloestes Versprechen: Der Test bestimmt, wann ein Abruf endet. */
function offen() {
  let loesen;
  let werfen;
  const versprechen = new Promise((ja, nein) => { loesen = ja; werfen = nein; });
  return { versprechen, loesen, werfen };
}

test("hoechstensGleichzeitig: nie mehr als die Grenze zugleich, Ergebnisse in Eingabereihenfolge", async () => {
  const abrufe = Array.from({ length: 5 }, () => offen());
  let laufend = 0;
  let hoechstens = 0;
  const gestartet = [];
  const ergebnis = hoechstensGleichzeitig(2, [0, 1, 2, 3, 4], async (n) => {
    gestartet.push(n);
    laufend += 1;
    hoechstens = Math.max(hoechstens, laufend);
    const wert = await abrufe[n].versprechen;
    laufend -= 1;
    return wert;
  });
  // Rueckwaerts geloest: Die Reihenfolge der Ergebnisse haengt nicht an der des Endes.
  for (const n of [4, 3, 2, 1, 0]) abrufe[n].loesen(`karte-${n}`);
  assert.deepEqual(await ergebnis, ["karte-0", "karte-1", "karte-2", "karte-3", "karte-4"]);
  assert.equal(hoechstens, 2);
  assert.deepEqual(gestartet, [0, 1, 2, 3, 4]);
});

test("hoechstensGleichzeitig: der erste Fehler laesst das Ganze scheitern, kein neuer Eintrag beginnt", async () => {
  const gestartet = [];
  await assert.rejects(
    hoechstensGleichzeitig(1, [0, 1, 2], async (n) => {
      gestartet.push(n);
      if (n === 0) throw new Error("Verlauf 0 kaputt");
      return n;
    }),
    /Verlauf 0 kaputt/,
  );
  assert.deepEqual(gestartet, [0]);
});

test("hoechstensGleichzeitig: eine leere Liste liefert eine leere Liste", async () => {
  assert.deepEqual(await hoechstensGleichzeitig(4, [], async () => 1), []);
});
