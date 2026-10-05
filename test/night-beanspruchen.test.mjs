// Die Kette beansprucht ihre fachliche Wurzel am Board mit Bestaetigung (Plan #1113,
// Baustein D, E3, E4, E7; Issue #1188).
//
// Das Board kennt kein bedingtes Schreiben. Der Schutz laeuft ueber den Laufstand: lesen,
// schreiben, die Bestaetigungsfrist warten, wiederlesen. `issue stand` ersetzt immer den
// juengsten Laufstand, darum gewinnt der letzte Schreiber. Geprueft mit eingespeistem
// Board — zwei Runner teilen sich darin eine Karte —, die gescheiterte Vorbereitung ueber
// das echte CLI am lokalen Tracker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";

import {
  beanspruchen, beanspruchtGrund, waehleKettenKandidaten, abgeben, laufendeKarten, journalLesen, staendeNachtragen,
  REVIEW_FERTIG_LABEL, BESTAETIGUNGSFRIST_MS,
} from "../kit/night.mjs";
import { run, board, mitProjekt, fachplan, umgebung, VORFLUG_KAPUTT } from "./helpers/kette-fixture.mjs";

const HOST = "hier";
const laufIdVon = (name, pid = process.pid) => `${HOST}/${pid}/${name}`;

/** Eine PID, deren Prozess sicher beendet ist. */
function totePid() {
  const res = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf-8" });
  return Number(res.stdout);
}

/**
 * Ein Board mit Karten im Format von GitHub (Kommentare als Array). `issue stand` ersetzt
 * den juengsten Laufstand oder legt ihn an und setzt `lauf:laeuft` — wie kit/board.mjs.
 */
function fakeBoard(karten) {
  const ablage = new Map(karten.map((k) => [String(k.id), { labels: [], comments: [], ...k, id: String(k.id) }]));
  const schreibvorgaenge = [];
  return {
    schreibvorgaenge,
    lesen: (id) => structuredClone(ablage.get(String(id)) ?? null),
    schreibenAls: (laufId) => (id, zustand, text) => {
      const karte = ablage.get(String(id));
      schreibvorgaenge.push({ laufId, id: String(id), zustand });
      const body = `## Laufstand\n\n${text}\n\nLauf-ID: ${laufId}\nStand: ${new Date().toISOString()}\n`;
      const alt = karte.comments.findLastIndex((c) => c.body.startsWith("## Laufstand"));
      if (alt >= 0) karte.comments[alt] = { body };
      else karte.comments.push({ body });
      karte.labels = karte.labels.filter((l) => !l.startsWith("lauf:"));
      if (zustand !== "fertig") karte.labels.push(`lauf:${zustand}`);
      return "geschrieben";
    },
  };
}

const ANFORDERUNG = { id: "10", title: "[Fachlich] Die Wurzel", body: "Ziel" };
const auftragZu = (karte) => ({ karte, art: "fachlich", F: String(karte.id) });

/** Ein Laufstand, wie ihn ein frueherer Lauf hinterliess. */
const laufstandKommentar = (laufId, eintrag = "Lauf angenommen") => ({
  body: `## Laufstand\n\n${eintrag}\n\nLauf-ID: ${laufId}\nStand: ${new Date().toISOString()}\n`,
});

/**
 * Ein `lesen`, dessen erster Aufruf den Stand von jetzt liefert — der Runner las die Karte,
 * bevor der andere schrieb —, jeder weitere den aktuellen.
 */
function lasVorher(fb) {
  const vorher = fb.lesen("10");
  let erster = true;
  return (id) => {
    if (!erster) return fb.lesen(id);
    erster = false;
    return structuredClone(vorher);
  };
}

/** Ein Runner gegen das eingespeiste Board; `warten` und `lesen` lassen sich vorgeben. */
function runner(fb, name, { warten = () => {}, lesen = fb.lesen, abgegeben = [] } = {}) {
  const laufId = laufIdVon(name);
  return {
    laufId,
    abgegeben,
    beanspruchen: (auftraege) => beanspruchen(auftraege, {
      lesen, schreiben: fb.schreibenAls(laufId), warten, laufId, host: HOST,
      abgeben: (id) => abgegeben.push(String(id)),
    }),
  };
}

test("die Bestaetigungsfrist betraegt zehn Sekunden (E4)", () => {
  assert.equal(BESTAETIGUNGSFRIST_MS, 10_000);
});

test("ohne fremden Laufstand: schreiben, warten, wiederlesen — die Wurzel gehoert dem Runner", () => {
  const fb = fakeBoard([ANFORDERUNG]);
  const gewartet = [];
  const a = runner(fb, "A", { warten: (ms) => gewartet.push(ms) });
  const r = a.beanspruchen([auftragZu(ANFORDERUNG)]);
  assert.deepEqual(r.beansprucht.map((x) => x.karte.id), ["10"]);
  assert.deepEqual(r.abgegeben, []);
  assert.deepEqual(gewartet, [BESTAETIGUNGSFRIST_MS], "gewartet wird die Frist ab dem eigenen Schreiben");
  assert.deepEqual(fb.schreibvorgaenge, [{ laufId: a.laufId, id: "10", zustand: "laeuft" }]);
  assert.deepEqual(r.beansprucht[0].laufstandVorher, [], "vorher stand kein Laufstand an der Karte");
});

test("der letzte Schreiber gewinnt, der Verlierer schreibt nichts mehr und traegt die Karte als abgegeben aus", () => {
  const fb = fakeBoard([{ ...ANFORDERUNG, comments: [laufstandKommentar(laufIdVon("alt", totePid()), "fertig: alter Lauf")] }]);
  // B las die Karte, bevor A schrieb, und schreibt waehrend A's Bestaetigungsfrist.
  const b = runner(fb, "B", { lesen: lasVorher(fb) });
  let ergebnisB;
  const a = runner(fb, "A", { warten: () => { ergebnisB = b.beanspruchen([auftragZu(ANFORDERUNG)]); } });
  const ergebnisA = a.beanspruchen([auftragZu(ANFORDERUNG)]);

  assert.deepEqual(ergebnisB.beansprucht.map((x) => x.karte.id), ["10"], "B schrieb zuletzt und gewinnt");
  assert.deepEqual(ergebnisA.beansprucht, [], "A verliert");
  assert.deepEqual(ergebnisA.abgegeben, [{ id: "10", title: ANFORDERUNG.title, grund: beanspruchtGrund(b.laufId) }]);
  assert.equal(beanspruchtGrund(b.laufId), `bereits von einem laufenden Runner beansprucht (${b.laufId})`);
  assert.deepEqual(a.abgegeben, ["10"], "der Verlierer traegt die Karte im Journal als abgegeben aus");
  assert.deepEqual(b.abgegeben, []);
  assert.deepEqual(fb.schreibvorgaenge.map((s) => s.laufId), [a.laufId, b.laufId], "nach dem Verlust schreibt A nichts mehr");
  // Der Gewinner traegt den Laufstand vor der Kollision, nicht den des Verlierers.
  const vorher = ergebnisB.beansprucht[0].laufstandVorher;
  assert.equal(vorher.length, 1);
  assert.match(vorher[0], /fertig: alter Lauf/);
  assert.doesNotMatch(vorher[0], new RegExp(a.laufId));
});

test("ein gelesener Laufstand mit lebender Lauf-ID fuehrt zum Auslassen ohne Schreiben", () => {
  const halter = laufIdVon("halter");
  const fb = fakeBoard([{ ...ANFORDERUNG, labels: ["lauf:laeuft"], comments: [laufstandKommentar(halter)] }]);
  const gewartet = [];
  const a = runner(fb, "A", { warten: (ms) => gewartet.push(ms) });
  const r = a.beanspruchen([auftragZu(ANFORDERUNG)]);
  assert.deepEqual(r.beansprucht, []);
  assert.deepEqual(r.abgegeben, [{ id: "10", title: ANFORDERUNG.title, grund: beanspruchtGrund(halter) }]);
  assert.deepEqual(fb.schreibvorgaenge, [], "kein Schreiben an einer belegten Wurzel");
  assert.deepEqual(gewartet, [], "ohne eigenes Schreiben keine Frist");
});

test("Uebernahme nach Absturz: ein Laufstand laeuft, dessen Runner nicht mehr lebt, gilt als frei", () => {
  const alt = laufIdVon("abgestuerzt", totePid());
  const fb = fakeBoard([{ ...ANFORDERUNG, labels: ["lauf:laeuft"], comments: [laufstandKommentar(alt)] }]);
  const a = runner(fb, "A");
  const r = a.beanspruchen([auftragZu(ANFORDERUNG)]);
  assert.deepEqual(r.beansprucht.map((x) => x.karte.id), ["10"]);
  assert.deepEqual(r.uebernommen, [{ id: "10", laufId: alt }], "die Uebernahme nennt die alte Lauf-ID");
  assert.match(r.beansprucht[0].laufstandVorher[0], new RegExp(alt));
});

test("nach dem Verlust schreibt der Verlierer auch bei Abbruch und Nachtrag nichts an die Karte", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "night-beanspruchen-"));
  try {
    const lauf = "2026-10-05-010000";
    // Der Verlierer schrieb `laeuft` — das Board nahm es an oder nicht, die Zeile steht offen
    // im Journal —, dann verlor er die Bestaetigung.
    const fb = fakeBoard([ANFORDERUNG]);
    const b = runner(fb, "B", { lesen: lasVorher(fb) });
    const a = { laufId: laufIdVon("A") };
    const echtesAbgeben = (id) => abgeben(id, { lauf, repoRoot });
    const ergebnis = beanspruchen([auftragZu(ANFORDERUNG)], {
      lesen: fb.lesen, laufId: a.laufId, host: HOST, abgeben: echtesAbgeben,
      schreiben: (id, zustand, text) => {
        // Die Journalzeile wie in standSetzen, offen: Ob das Board sie annahm, spielt keine Rolle.
        journalOffen(repoRoot, lauf, id, zustand);
        return fb.schreibenAls(a.laufId)(id, zustand, text);
      },
      warten: () => b.beanspruchen([auftragZu(ANFORDERUNG)]),
    });
    assert.deepEqual(ergebnis.beansprucht, []);
    const staende = journalLesen(join(repoRoot, ".claude", "lauf", `${lauf}.jsonl`)).staende;
    assert.equal(staende.at(-1).zustand, "abgegeben");
    assert.deepEqual(laufendeKarten(staende), [], "ein Abbruch setzte die Karte sonst auf abgebrochen");
    assert.deepEqual(staendeNachtragen(repoRoot), [], "der Nachtrag uebergeht die abgegebene Karte");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

/** Eine offene Journalzeile `stand`, wie standSetzen sie vor dem Board-Aufruf schreibt. */
function journalOffen(repoRoot, lauf, karte, zustand) {
  const ordner = join(repoRoot, ".claude", "lauf");
  const pfad = join(ordner, `${lauf}.jsonl`);
  mkdirSync(ordner, { recursive: true });
  const nr = journalLesen(pfad).staende.length + 1;
  appendFileSync(pfad, `${JSON.stringify({ art: "stand", nr, zeit: new Date().toISOString(), karte: String(karte), zustand, text: "Lauf angenommen", status: "offen" })}\n`, "utf-8");
}

test("die Auswahl laesst eine belegte Wurzel mit dem Grund aus Kriterium 3 aus, die uebrigen Gruende bleiben", () => {
  const geprueft = ["kit:night", REVIEW_FERTIG_LABEL];
  const karten = [
    { id: "1", title: "[Fachlich] Belegt", status: "backlog", labels: geprueft },
    { id: "2", title: "[Fachlich] Frei", status: "backlog", labels: geprueft },
    { id: "3", title: "[Fachlich] Ungeprueft", status: "backlog", labels: ["kit:night"] },
  ];
  const belegt = (F) => (F === "1" ? { karte: "1", laufId: "dort/42/2026-10-05-010000" } : null);
  const r = waehleKettenKandidaten(karten, "kit:night", 1, { belegt });
  assert.deepEqual(r.kandidaten.map((a) => a.karte.id), ["2"], "die belegte Wurzel verbraucht keinen Platz unter --max");
  assert.deepEqual(r.uebersprungen.map((u) => u.id), ["1", "3"]);
  assert.equal(r.uebersprungen[0].grund, "bereits von einem laufenden Runner beansprucht (dort/42/2026-10-05-010000)");
  assert.doesNotMatch(r.uebersprungen[1].grund, /beansprucht/, "der Ausschluss wegen fehlender Pruefung bleibt");
});

test("die Auswahl ohne Angabe zu belegten Wurzeln bleibt wie bisher", () => {
  const karten = [{ id: "1", title: "[Fachlich] Frei", status: "backlog", labels: ["kit:night", REVIEW_FERTIG_LABEL] }];
  assert.deepEqual(waehleKettenKandidaten(karten, "kit:night", 5).kandidaten.map((a) => a.karte.id), ["1"]);
});

test("scheitert die Vorbereitung, bleibt die Kennzeichnung stehen und der Laufstand wird abgebrochen", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel");
    const env = umgebung(dir);
    const res = run(dir, ["--kette"], { ...env, NIGHT_VORFLUG_CMD: VORFLUG_KAPUTT });
    assert.notEqual(res.status, 0, "ein kaputter Vorflug haelt den Lauf an");
    const karte = board(dir, "issue", "get", F);
    assert.ok(karte.labels.includes("kit:night"), `die Kennzeichnung muss stehen bleiben: ${karte.labels}`);
    assert.ok(karte.labels.includes("lauf:abgebrochen"), `der Laufstand muss abgebrochen sein: ${karte.labels}`);
  });
});

test("ein laufender Runner auf demselben Rechner: der zweite Start laesst die Wurzel aus und schreibt nichts", () => {
  mitProjekt((dir) => {
    const F = fachplan(dir, "[Fachlich] Die Wurzel");
    const datei = join(dir, "laufstand.md");
    // Der Halter ist dieser Testprozess — er lebt, solange der Test laeuft.
    const halter = `${hostname().split(".")[0]}/${process.pid}/2026-10-05-000000`;
    writeFileSync(datei, `Lauf angenommen\n\nLauf-ID: ${halter}\nStand: ${new Date().toISOString()}\n`, "utf-8");
    board(dir, "issue", "stand", F, "--zustand", "laeuft", "--text-file", datei);
    rmSync(datei);
    const env = umgebung(dir);
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok((res.stdout + res.stderr).includes(`bereits von einem laufenden Runner beansprucht (${halter})`), res.stdout);
    const karte = board(dir, "issue", "get", F);
    assert.ok(karte.labels.includes("kit:night"), "die Kennzeichnung bleibt");
    assert.match(karte.body, new RegExp(halter), "der Laufstand des Halters bleibt stehen");
  });
});
