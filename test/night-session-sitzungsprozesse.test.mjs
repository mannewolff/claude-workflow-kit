// Die Prozesse einer Session und die Reserve ihres Bash-Limits (Issue #668, #902, #1144,
// #1174) — die reinen Bausteine, im selben Prozess gegen den Teil kit/night/session.mjs.
//
// Seit Issue #1231 eine eigene Datei: Sie standen in der Ablauf-Pruefung der wartenden
// Sitzung, die heute ablauf-night-wartend-runde.test.mjs heisst. Die Suche und die Abfrage
// der Prozessliste sind injiziert, damit das Warten auf jedem Rechner pruefbar ist.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bashZeitlimit, BASH_RESERVE_MS, sessionUmgebung, SITZUNG_MARKE, sitzungsSuche, sitzungsPids, sitzungsProzesse,
  warteAufProzessgruppe, baumBeendenAufruf,
} from "../kit/night/session.mjs";

// --- night-91: die Reserve zwischen Bash-Limit und Rundenzeitlimit (Issue #902) ---

test("[night-91] das Bash-Limit laesst der Session eine Reserve zum Melden", () => {
  // Eine Stunde Runde: die feste Reserve von zehn Minuten greift, weil sie unter den
  // 20 Prozent (12 Minuten) liegt.
  assert.equal(bashZeitlimit(60 * 60 * 1000), 50 * 60 * 1000);
  // Eine Minute Runde: jetzt greift der Anteil, sonst bliebe nichts uebrig.
  assert.equal(bashZeitlimit(60 * 1000), 48 * 1000);
  assert.equal(BASH_RESERVE_MS, 10 * 60 * 1000);
});

test("[night-91] das Bash-Limit bleibt positiv und stets unter dem Rundenzeitlimit", () => {
  for (const timeoutMs of [2, 5, 100, 1000, 60 * 1000, 40 * 60 * 1000, 60 * 60 * 1000]) {
    const grenze = bashZeitlimit(timeoutMs);
    assert.ok(grenze >= 1, `nicht positiv bei ${timeoutMs}: ${grenze}`);
    assert.ok(grenze < timeoutMs, `nicht unter dem Rundenzeitlimit bei ${timeoutMs}: ${grenze}`);
  }
});

// Unter Windows gibt es keine Prozessgruppe (Issue #1144). Die Prozesse einer Session
// erkennt der Runner dort an ihrer Marke in der Umgebung; die Suche ist injiziert, damit
// das Warten auf jedem Rechner pruefbar ist.

test("[night-25] jede Session traegt eine eigene Marke in der Umgebung", () => {
  const erste = sessionUmgebung(42, {}, {});
  const zweite = sessionUmgebung(42, {}, {});
  assert.match(erste[SITZUNG_MARKE], /^[\w-]+$/, "die Marke fehlt oder enthaelt Zeichen, die die Git Bash umdeuten koennte");
  assert.notEqual(erste[SITZUNG_MARKE], zweite[SITZUNG_MARKE], "zwei Sessions duerfen nicht dieselbe Marke tragen");
  assert.equal(sessionUmgebung(42, {}, {}, "fest")[SITZUNG_MARKE], "fest");
});

test("[night-25] die Suche liest die Marke aus der Umgebung der MSYS-Prozesse und nennt ihre Windows-PID", () => {
  const suche = sitzungsSuche("marke-1");
  assert.equal(suche.umgebung.KIT_SITZUNG_SUCHE, "marke-1");
  assert.match(suche.skript, /\/proc\/\[0-9\]\*/);
  assert.match(suche.skript, new RegExp(`grep -qzx "${SITZUNG_MARKE}=\\$KIT_SITZUNG_SUCHE"`));
  assert.match(suche.skript, /winpid/);
  // Die Suche selbst traegt die Marke nur unter anderem Namen — sonst faende sie sich.
  assert.ok(!(SITZUNG_MARKE in suche.umgebung));
  assert.deepEqual(sitzungsPids("4711\n\n 815 \nkeine-pid\n0\n"), [4711, 815]);
  assert.deepEqual(sitzungsPids(""), []);
});

test("[night-25] unter Windows wartet der Runner, bis kein Prozess mit der Marke der Session mehr laeuft", async () => {
  const antworten = [[11, 12], [12], []];
  let gefragt = 0;
  const prozesse = () => antworten[Math.min(gefragt++, antworten.length - 1)];
  assert.equal(await warteAufProzessgruppe(4711, 60_000, { plattform: "win32", pollMs: 1, prozesse }), true);
  assert.equal(gefragt, 3, "gewartet wird, bis die Suche nichts mehr findet");
});

test("[night-25] unter Windows endet das Warten an der Frist, wenn ein Prozess der Session weiterlaeuft", async () => {
  let uhr = 0;
  const res = await warteAufProzessgruppe(4711, 1000, {
    plattform: "win32", pollMs: 1, prozesse: () => [11], jetzt: () => (uhr += 300),
  });
  assert.equal(res, false);
});

// Die Erkennung selbst unter `plattform: "win32"` (Issue #1174): Die Abfrage ist
// eingespielt und liefert aus einer festen Prozessliste die Windows-PIDs der Prozesse, die
// die gesuchte Marke tragen — so, wie es die Suche in der Git Bash tut.
const prozessListe = [
  { winpid: 11, umgebung: { [SITZUNG_MARKE]: "marke-a" } },
  { winpid: 12, umgebung: { [SITZUNG_MARKE]: "marke-b" } },
  { winpid: 13, umgebung: {} },
];
const eingespielt = (liste) => (marke) => ({
  status: 0,
  stdout: liste.filter((p) => p.umgebung[SITZUNG_MARKE] === marke).map((p) => `${p.winpid}\n`).join(""),
});

test("[night-25] unter Windows erkennt der Runner die Prozesse mit der Marke der Session", () => {
  assert.deepEqual(sitzungsProzesse("marke-a", { abfrage: eingespielt(prozessListe) }), [11]);
  assert.deepEqual(sitzungsProzesse("marke-c", { abfrage: eingespielt(prozessListe) }), []);
});

test("[night-25] unter Windows wartet der Runner, solange ein Prozess mit der Marke laeuft", async () => {
  const liste = [...prozessListe];
  let gefragt = 0;
  const abfrage = (marke) => {
    gefragt += 1;
    // Zweimal laeuft der Hintergrundlauf der Session noch, vor der dritten Abfrage endet er.
    if (gefragt === 3) liste.splice(0, 1);
    return eingespielt(liste)(marke);
  };
  const vermerke = [];
  const leer = await warteAufProzessgruppe(4711, 60_000, {
    plattform: "win32", pollMs: 1, prozesse: () => sitzungsProzesse("marke-a", { abfrage }), vermerk: (t) => vermerke.push(t),
  });
  assert.equal(leer, true);
  assert.equal(gefragt, 3, "gewartet wird, bis kein Prozess mit der Marke mehr laeuft");
  assert.deepEqual(vermerke, []);
});

test("[night-25] unter Windows geht der Runner sofort weiter, wenn kein Prozess die Marke traegt", async () => {
  let gefragt = 0;
  const abfrage = (marke) => (gefragt++, eingespielt(prozessListe)(marke));
  const leer = await warteAufProzessgruppe(4711, 60_000, {
    plattform: "win32", pollMs: 1, prozesse: () => sitzungsProzesse("marke-c", { abfrage }), vermerk: () => assert.fail("kein Vermerk"),
  });
  assert.equal(leer, true);
  assert.equal(gefragt, 1);
});

test("[night-25] scheitert unter Windows die Abfrage der Prozessliste, steht das im Protokoll und der Runner geht weiter", async () => {
  for (const [fall, abfrage] of [
    ["Exitcode", () => ({ status: 2, stdout: "", stderr: "grep: kaputt" })],
    ["Startfehler", () => ({ status: null, error: new Error("spawn ENOENT") })],
    ["keine Git Bash", () => ({ fehler: "Git Bash nicht gefunden" })],
  ]) {
    assert.throws(() => sitzungsProzesse("marke-a", { abfrage }), /Prozessliste/, fall);
    const vermerke = [];
    const leer = await warteAufProzessgruppe(4711, 60_000, {
      plattform: "win32", pollMs: 1, prozesse: () => sitzungsProzesse("marke-a", { abfrage }), vermerk: (t) => vermerke.push(t),
    });
    assert.equal(leer, true, `${fall}: der Runner macht weiter wie bisher`);
    assert.equal(vermerke.length, 1, `${fall}: genau ein Vermerk`);
    assert.match(vermerke[0], /Prozessliste/, fall);
  }
});

test("[night-25] unter Windows beendet taskkill die Wurzel und die Prozesse mit der Marke der Session", () => {
  assert.deepEqual(baumBeendenAufruf(4711, "SIGTERM", "win32", [11, 12]),
    { taskkill: ["/pid", "4711", "/pid", "11", "/pid", "12", "/T", "/F"] });
  // Die Wurzel steht nur einmal da, auch wenn die Suche sie mitfindet.
  assert.deepEqual(baumBeendenAufruf(4711, "SIGKILL", "win32", [4711]), { taskkill: ["/pid", "4711", "/T", "/F"] });
  // Auf POSIX trifft das Signal an die Gruppe dieselben Prozesse; weitere PIDs gibt es dort nicht.
  assert.deepEqual(baumBeendenAufruf(4711, "SIGTERM", "linux", [11]), { pid: -4711, signal: "SIGTERM" });
});

