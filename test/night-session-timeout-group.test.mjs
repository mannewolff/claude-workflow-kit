// Das Zeitlimit einer Session und das Warten auf ihre Prozessgruppe (Issue #182, #668).
//
// Der Runner killte beim Zeitlimit nur den direkten Kindprozess. Node loest das
// close-Event aber erst auf, wenn alle stdio-Streams geschlossen sind — ein
// Enkelprozess, der die geerbte Pipe offen haelt, verhindert das. Darum geht das Signal an
// die ganze Prozessgruppe, und das Zeitlimit hat drei Stufen: SIGTERM, nach der Nachfrist
// SIGKILL, nach einer weiteren Nachfrist loest der Runner selbst auf.
//
// Im selben Prozess (Issue #1229, Plan #1199, E6): `runProcess` bekommt eine Attrappe als
// `spawn`, eine Uhr fuer `jetzt` und `wecker`, ein `killen`, das die Signale mitschreibt,
// und ein `ps` als `spawnSync`. Jede Stufe ist damit auf die Millisekunde bestimmt, und
// kein Test wartet. Dass das Signal an die Gruppe den Enkel eines echten Prozessbaums
// wirklich trifft, belegt test/ablauf-night-session-timeout-group.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { baumBeendenAufruf, warteAufProzessgruppe, runProcess } from "../kit/night/session.mjs";
import { sessionAbh, uhrAttrappe, mitLauf, stdoutFangen } from "./helpers/session-attrappe.mjs";

const NACHFRIST = 5000;

/** Startet `runProcess` mit der Attrappe; das Ergebnis bleibt ein Promise. */
function starte(drehbuch, { timeoutMs = 400, ...optionen } = {}) {
  const teile = sessionAbh(drehbuch, optionen);
  const ergebnis = runProcess("claude", ["-p", "x"], { issueId: "7", timeoutMs }, teile.abh);
  return { ...teile, ergebnis };
}

/** Laesst die Mikrotasks laufen, die das Drehbuch und die Zuhoerer anstossen. */
const weiter = () => new Promise((r) => setImmediate(r));

test("Baum beenden: unter Windows taskkill auf den Baum, auf POSIX ein Signal an die Gruppe", () => {
  assert.deepEqual(baumBeendenAufruf(4711, "SIGTERM", "win32"), { taskkill: ["/pid", "4711", "/T", "/F"] });
  assert.deepEqual(baumBeendenAufruf(4711, "SIGKILL", "win32"), { taskkill: ["/pid", "4711", "/T", "/F"] });
  assert.deepEqual(baumBeendenAufruf(4711, "SIGTERM", "linux"), { pid: -4711, signal: "SIGTERM" });
  assert.deepEqual(baumBeendenAufruf(4711, "SIGKILL", "darwin"), { pid: -4711, signal: "SIGKILL" });
});

// --- Warten auf die Prozessgruppe (Issue #668) ---------------------------------

test("Warten auf die Prozessgruppe: unter Windows ohne Suche nach der Marke sofort zurueck", async () => {
  // Unter Windows fragt die Funktion allein die Suche nach der Marke der Session
  // (Issue #1144, night-25); ohne sie gibt es dort nichts, worauf zu warten waere.
  const abfragen = [];
  const schlaf = async () => assert.fail("unter Windows darf nicht gewartet werden");
  const leer = await warteAufProzessgruppe(4711, 60_000, {
    plattform: "win32", schlaf, spawnSync: (...a) => abfragen.push(a),
  });
  assert.equal(leer, true);
  assert.deepEqual(abfragen, [], "ps wird unter Windows nicht gefragt");
});

test("Warten auf die Prozessgruppe: fragt ps im Takt, bis die Gruppe leer ist", async () => {
  const uhr = uhrAttrappe();
  const antworten = ["123\n456\n", "456\n", ""];
  const abfragen = [];
  const ps = (befehl, args) => {
    abfragen.push([befehl, ...args].join(" "));
    return { status: 0, stdout: antworten.shift() };
  };
  const leer = await warteAufProzessgruppe(4711, 10_000, { pollMs: 200, jetzt: uhr.jetzt, schlaf: uhr.schlaf, spawnSync: ps });
  assert.equal(leer, true);
  assert.deepEqual(abfragen, ["ps -o pid= -g 4711", "ps -o pid= -g 4711", "ps -o pid= -g 4711"]);
  assert.equal(uhr.jetzt() - 1_000_000, 400, "zweimal der Takt von 200 ms");
});

test("Warten auf die Prozessgruppe: bei Ablauf der Frist false, ohne darueber hinaus zu warten", async () => {
  const uhr = uhrAttrappe();
  const leer = await warteAufProzessgruppe(4711, 1000, {
    pollMs: 300, jetzt: uhr.jetzt, schlaf: uhr.schlaf, spawnSync: () => ({ status: 0, stdout: "123\n" }),
  });
  assert.equal(leer, false);
  assert.equal(uhr.jetzt() - 1_000_000, 1200, "die erste Abfrage nach Ablauf der Frist endet das Warten");
});

test("Warten auf die Prozessgruppe: ein gescheitertes ps gilt als leere Gruppe", async () => {
  const leer = await warteAufProzessgruppe(4711, 1000, {
    schlaf: async () => assert.fail("kein Warten"), spawnSync: () => ({ status: 1, stdout: "", stderr: "ps: kaputt" }),
  });
  assert.equal(leer, true);
});

test("Warten auf die Prozessgruppe: eine scheiternde Suche nach der Marke geht ins Protokoll und haelt nicht auf", async () => {
  const vermerke = [];
  const leer = await warteAufProzessgruppe(4711, 1000, {
    plattform: "win32", prozesse: () => { throw new Error("Abfrage der Prozessliste gescheitert (Exitcode 1)"); },
    vermerk: (t) => vermerke.push(t),
  });
  assert.equal(leer, true);
  assert.equal(vermerke.length, 1);
  assert.match(vermerke[0], /Abfrage der Prozessliste gescheitert .* der Runner wartet nicht auf die Prozesse der Session/);
});

// --- Die Stufen des Zeitlimits (Issue #182) ------------------------------------

test("Zeitlimit: SIGTERM an die Gruppe; endet die Session darauf, kommt ETIMEDOUT zurueck", async () => {
  const { ergebnis, signale, uhr } = starte([{ offen: true }], {
    beimSignal: (kind, signal) => kind.emit("close", null, signal),
    spawnSync: () => assert.fail("nach einem Zeitlimit wird nicht auf die Gruppe gewartet"),
  });
  await weiter();
  uhr.vor(399);
  assert.deepEqual(signale, [], "vor dem Zeitlimit kein Signal");
  uhr.vor(1);
  const res = await ergebnis;
  assert.deepEqual(signale, [{ pid: -4242, signal: "SIGTERM" }], "das Signal geht an die Gruppe, nicht an die PID");
  assert.equal(res.error.code, "ETIMEDOUT");
  assert.equal(res.signal, "SIGTERM");
  assert.equal(uhr.offen(), 0, "kein Wecker bleibt stehen");
});

test("Zeitlimit: ein SIGTERM-taubes Kommando wird hart nachgekillt", async () => {
  const { ergebnis, signale, uhr } = starte([{ offen: true }], {
    beimSignal: (kind, signal) => { if (signal === "SIGKILL") kind.emit("close", null, "SIGKILL"); },
  });
  await weiter();
  uhr.vor(400);
  uhr.vor(NACHFRIST - 1);
  assert.deepEqual(signale.map((s) => s.signal), ["SIGTERM"], "die Nachfrist laeuft noch");
  uhr.vor(1);
  const res = await ergebnis;
  assert.deepEqual(signale.map((s) => s.signal), ["SIGTERM", "SIGKILL"]);
  assert.equal(res.error.code, "ETIMEDOUT");
  assert.equal(uhr.offen(), 0);
});

test("Zeitlimit: bleibt auch nach SIGKILL das close-Ereignis aus, loest der Runner selbst auf", async () => {
  // Ein Enkel, der die geerbte Pipe offen haelt, verhindert das close-Ereignis — der Runner
  // darf darauf unter keinen Umstaenden unbegrenzt warten.
  const { ergebnis, signale, uhr } = starte([{ offen: true }, "erste Zeile"]);
  await weiter();
  uhr.vor(400 + 2 * NACHFRIST);
  const res = await ergebnis;
  assert.deepEqual(signale.map((s) => s.signal), ["SIGTERM", "SIGKILL"]);
  assert.equal(res.status, null);
  assert.equal(res.signal, "SIGKILL");
  assert.equal(res.error.code, "ETIMEDOUT");
  assert.equal(res.stdout, "erste Zeile\n", "was bis dahin kam, bleibt erhalten");
});

test("Zeitlimit: die Nachfrist kommt aus NIGHT_KILL_GRACE_MS", async () => {
  process.env.NIGHT_KILL_GRACE_MS = "600";
  try {
    const { ergebnis, signale, uhr } = starte([{ offen: true }]);
    await weiter();
    uhr.vor(400 + 600);
    assert.deepEqual(signale.map((s) => s.signal), ["SIGTERM", "SIGKILL"]);
    uhr.vor(600);
    assert.equal((await ergebnis).signal, "SIGKILL");
  } finally {
    delete process.env.NIGHT_KILL_GRACE_MS;
  }
});

test("unter dem Zeitlimit: kein Signal, und der Wecker des Zeitlimits wird abgestellt", async () => {
  const { ergebnis, signale, uhr } = starte(["fertig", { ms: 100 }, { ende: 0 }]);
  const res = await ergebnis;
  assert.equal(res.status, 0);
  assert.equal(res.error, null);
  assert.deepEqual(signale, []);
  assert.equal(uhr.offen(), 0, "der Wecker des Zeitlimits ist abgestellt");
});

// --- Nach dem regulaeren Ende: Warten auf die Gruppe (Issue #668) --------------

test("nach dem regulaeren Ende wartet der Runner auf die Gruppe, hoechstens fuer den Rest des Zeitlimits", async () => {
  const ps = [];
  const { ergebnis, uhr } = starte([{ ms: 100 }, { ende: 0 }], {
    timeoutMs: 1000,
    spawnSync: (befehl, args) => {
      ps.push(args.join(" "));
      return { status: 0, stdout: "999\n" };
    },
  });
  await mitLauf([], async ({ protokoll }) => {
    const { ergebnis: res } = await stdoutFangen(() => ergebnis);
    assert.equal(res.status, 0);
    // 100 ms Session, dann im Takt von 200 ms bis zur ersten Abfrage nach dem Ende des
    // Zeitlimits: 100 + 5 × 200.
    assert.equal(uhr.jetzt() - 1_000_000, 1100, "gewartet wird bis zum Ende des Zeitlimits, nicht laenger");
    assert.ok(ps.every((a) => a === "-o pid= -g 4242"), "gefragt wird nach der Gruppe der Session");
    assert.match(protokoll(), /Nach dem Ende der Session liefen noch Prozesse ihrer Gruppe, als die Frist ablief/);
  });
});
