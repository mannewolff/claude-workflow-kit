// Die Schutz-Logik ohne Host-Details (Issue #1407, Plan #1405).
//
// `kit/board/schutz.mjs` leitet aus den Operationen des Code-Host-Adapters ab, ob ein
// Projekt geschuetzt ist (E1, A7, A9, E10), beschreibt das Soll der Rulesets (A2, A8) samt
// Anleitung fuer den Menschen ohne Admin-Recht (A9), haelt den Notfallweg an einem gruenen
// lokalen Lauf der Stufe push fest (E9) und sperrt die schreibenden Aktionen in der Nacht
// (E8). Seit Issue #1408 dazu die Probe auf dem Pruefzweig (A3, E6, E7), `einrichten` mit
// seinen vier Ergebnissen (A4) und `nachpruefen` (A7). Der Host ist hier ein gefaelschtes Objekt mit den Methoden aus Issue #1406: Die
// `gh`-Aufrufe dahinter prueft `board-adapter-schutz-github.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { rulesetSoll, schutzZustand, anleitung, notfallGate, nachtSperre, NACHPRUEFEN_KOMMANDO, probe, einrichten,
  nachpruefen } from "../kit/board/schutz.mjs";

const SHA = "a".repeat(40);
const JOBS = ["check", "lint"];
const CONFIG = {
  mainBranch: "main",
  productionBranch: "production",
  pushPruefung: { ort: "buildDienst", zweig: "kit-pruefung" },
};

/** Ein Ruleset, wie `getRulesets` es liefert, aus dem Soll gebaut. */
function stehend(zweig, art, aenderung = {}) {
  const soll = rulesetSoll(zweig, JOBS, art);
  return {
    id: art === "haupt" ? 1 : 2,
    name: soll.name,
    zweig,
    enforcement: "active",
    regeln: soll.regeln,
    requiredStatusChecks: [...JOBS],
    bypassActors: [],
    ...aenderung,
  };
}

/** Ein gefaelschter Code-Host mit den Methoden aus Issue #1406. */
function host({ rulesets = [], ci = { status: "gruen", jobs: JOBS.map((name) => ({ name, ergebnis: "gruen", gestartet: null })) },
  admin = true, unterstuetzt = { ja: true } } = {}) {
  const aufrufe = [];
  return {
    aufrufe,
    schutzUnterstuetzt: () => unterstuetzt,
    getRulesets: async () => { aufrufe.push("getRulesets"); return rulesets; },
    hatAdminRecht: async () => { aufrufe.push("hatAdminRecht"); return admin; },
    getCiStatus: async (commit, zweig) => { aufrufe.push(`getCiStatus ${commit} ${zweig ?? ""}`.trim()); return ci; },
  };
}

const KOPF = { kopfVon: () => SHA };
const BEIDE = () => [stehend("main", "haupt"), stehend("production", "veroeffentlichung")];

// --- rulesetSoll (A2, A8) ---

test("[schutz] rulesetSoll: Hauptzweig mit Pflichtjobs, non_fast_forward und deletion, ohne pull_request und ohne Bypass", () => {
  const soll = rulesetSoll("main", JOBS, "haupt");
  assert.equal(soll.name, "claude-workflow-kit: main");
  assert.equal(soll.zweig, "main");
  assert.deepEqual(soll.bypass_actors, []);
  const typen = soll.regeln.map((r) => r.type);
  assert.deepEqual([...typen].sort(), ["deletion", "non_fast_forward", "required_status_checks"]);
  const pruefregel = soll.regeln.find((r) => r.type === "required_status_checks");
  assert.deepEqual(pruefregel.parameters.required_status_checks.map((c) => c.context), JOBS);
});

test("[schutz] rulesetSoll: Veroeffentlichungszweig zusaetzlich mit pull_request ohne Freigaben, ohne Bypass", () => {
  const soll = rulesetSoll("production", JOBS, "veroeffentlichung");
  assert.equal(soll.name, "claude-workflow-kit: production");
  assert.deepEqual(soll.bypass_actors, []);
  const pr = soll.regeln.find((r) => r.type === "pull_request");
  assert.ok(pr, "pull_request fehlt");
  assert.equal(pr.parameters.required_approving_review_count, 0);
  for (const typ of ["required_status_checks", "non_fast_forward", "deletion"]) {
    assert.ok(soll.regeln.some((r) => r.type === typ), `${typ} fehlt`);
  }
});

test("[schutz] rulesetSoll: unbekannte Art wird abgewiesen", () => {
  assert.throws(() => rulesetSoll("main", JOBS, "irgendwas"), /Art 'irgendwas'/);
});

// --- schutzZustand: die fuenf Antworten von `code schutz status` (E1, A7, A9, E10) ---

test("[schutz] status: ohne Ruleset nicht geschuetzt, fehlt nennt beide Zweige", async () => {
  const zustand = await schutzZustand(host(), CONFIG, KOPF);
  assert.equal(zustand.geschuetzt, false);
  assert.ok(zustand.fehlt.some((f) => f.includes("main")), zustand.fehlt.join(" | "));
  assert.ok(zustand.fehlt.some((f) => f.includes("production")), zustand.fehlt.join(" | "));
  assert.equal(zustand.ungeprueft, null);
});

test("[schutz] status: ausgesetztes Ruleset des Hauptzweigs steht unter fehlt", async () => {
  const rulesets = [stehend("main", "haupt", { enforcement: "disabled" }), stehend("production", "veroeffentlichung")];
  const zustand = await schutzZustand(host({ rulesets }), CONFIG, KOPF);
  assert.equal(zustand.geschuetzt, false);
  assert.ok(zustand.fehlt.includes("Schutz des Hauptzweigs ausgesetzt"), zustand.fehlt.join(" | "));
});

test("[schutz] status: beide Rulesets nach Soll, Pflichtjobs am Kopf gruen — geschuetzt", async () => {
  const h = host({ rulesets: BEIDE() });
  const zustand = await schutzZustand(h, CONFIG, KOPF);
  assert.deepEqual(zustand, { geschuetzt: true, fehlt: [], ungeprueft: null });
  assert.ok(h.aufrufe.includes(`getCiStatus ${SHA}`), h.aufrufe.join(" | "));
});

test("[schutz] status: Pflichtjob am Kopf nicht gruen — geschuetzt mit ungeprueft samt Kommando", async () => {
  const ci = { status: "gruen", jobs: [{ name: "check", ergebnis: "gruen", gestartet: null }, { name: "sonar", ergebnis: "gruen", gestartet: null }] };
  const zustand = await schutzZustand(host({ rulesets: BEIDE(), ci }), CONFIG, KOPF);
  assert.equal(zustand.geschuetzt, true);
  assert.deepEqual(zustand.ungeprueft, { commit: SHA, kommando: NACHPRUEFEN_KOMMANDO });
  assert.match(zustand.ungeprueft.kommando, /board\.mjs code schutz nachpruefen$/);
});

test("[schutz] status: stehende Rulesets ohne Admin-Recht zaehlen als vollstaendig", async () => {
  const zustand = await schutzZustand(host({ rulesets: BEIDE(), admin: false }), CONFIG, KOPF);
  assert.equal(zustand.geschuetzt, true);
  assert.deepEqual(zustand.fehlt, []);
});

test("[schutz] status: fremde, nicht gatende Laeufe machen den Kopf nicht ungeprueft", async () => {
  const ci = { status: "rot", jobs: [
    ...JOBS.map((name) => ({ name, ergebnis: "gruen", gestartet: null })),
    { name: "sonar", ergebnis: "rot", gestartet: null },
  ] };
  const zustand = await schutzZustand(host({ rulesets: BEIDE(), ci }), CONFIG, KOPF);
  assert.equal(zustand.ungeprueft, null);
});

test("[schutz] status: pushPruefung lokal steht unter fehlt", async () => {
  const zustand = await schutzZustand(host({ rulesets: BEIDE() }), { ...CONFIG, pushPruefung: "lokal" }, KOPF);
  assert.equal(zustand.geschuetzt, false);
  assert.ok(zustand.fehlt.some((f) => f.includes("pushPruefung")), zustand.fehlt.join(" | "));
});

test("[schutz] status: abweichendes Ruleset (Bypass, fehlender pull_request) steht unter fehlt", async () => {
  const ohnePr = stehend("production", "veroeffentlichung");
  ohnePr.regeln = ohnePr.regeln.filter((r) => r.type !== "pull_request");
  const rulesets = [stehend("main", "haupt", { bypassActors: [{ actor_id: 5 }] }), ohnePr];
  const zustand = await schutzZustand(host({ rulesets }), CONFIG, KOPF);
  assert.equal(zustand.geschuetzt, false);
  assert.ok(zustand.fehlt.some((f) => f.includes("main") && f.includes("Bypass")), zustand.fehlt.join(" | "));
  assert.ok(zustand.fehlt.some((f) => f.includes("production") && f.includes("pull_request")), zustand.fehlt.join(" | "));
});

test("[schutz] status: Veroeffentlichungszweig mit anderen Pflichtjobs als der Hauptzweig weicht ab", async () => {
  const rulesets = [stehend("main", "haupt"), stehend("production", "veroeffentlichung", { requiredStatusChecks: ["check"] })];
  const zustand = await schutzZustand(host({ rulesets }), CONFIG, KOPF);
  assert.equal(zustand.geschuetzt, false);
  assert.ok(zustand.fehlt.some((f) => f.includes("production") && f.includes("Pflichtjobs")), zustand.fehlt.join(" | "));
});

test("[schutz] status: Code-Host ohne Schutz nennt den Grund unter fehlt und fragt nichts weiter", async () => {
  const h = host({ unterstuetzt: { ja: false, grund: "Bei GitLab richtet das Kit keinen Schutz ein." } });
  const zustand = await schutzZustand(h, CONFIG, KOPF);
  assert.deepEqual(zustand, { geschuetzt: false, fehlt: ["Bei GitLab richtet das Kit keinen Schutz ein."], ungeprueft: null });
  assert.deepEqual(h.aufrufe, []);
});

// --- anleitung (A9) ---

test("[schutz] anleitung: Ort, Zielzweig, Regeln, Jobnamen und leere Bypass-Liste je Ruleset", () => {
  const text = anleitung([rulesetSoll("main", JOBS, "haupt"), rulesetSoll("production", JOBS, "veroeffentlichung")]);
  assert.match(text, /Settings → Rules → Rulesets → New branch ruleset/);
  assert.match(text, /claude-workflow-kit: main/);
  assert.match(text, /claude-workflow-kit: production/);
  assert.match(text, /refs\/heads\/main|Zielzweig: main/);
  for (const job of JOBS) assert.ok(text.includes(job), `Job ${job} fehlt`);
  assert.match(text, /Bypass/);
  assert.match(text, /Pull Request/i);
  assert.equal((text.match(/Settings → Rules → Rulesets/g) || []).length, 2);
});

// --- notfallGate (E9) ---

function worktree(datei = "a.txt", inhalt = "eins\n") {
  const dir = mkdtempSync(join(tmpdir(), "schutz-gate-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, datei), inhalt);
  return dir;
}

function hashVon(dir, datei) {
  return spawnSync("git", ["hash-object", datei], { cwd: dir, encoding: "utf-8" }).stdout.trim();
}

function zusammenfassung(dir, { stufe = "push", ergebnis = "gruen", ohneHashes = false } = {}) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const daten = { stufe, abgeschlossen: true, laufen: [{ cmd: "node --test", ergebnis }] };
  if (!ohneHashes) daten.hashes = { "a.txt": hashVon(dir, "a.txt") };
  writeFileSync(join(dir, ".claude", "checks-summary.json"), JSON.stringify(daten));
}

async function mitWorktree(fn) {
  const dir = worktree();
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("[schutz] notfallGate: ohne Zusammenfassung abgelehnt", () => mitWorktree(async (dir) => {
  const gate = await notfallGate(dir);
  assert.equal(gate.ok, false);
  assert.match(gate.grund, /gruen|Zusammenfassung/);
}));

test("[schutz] notfallGate: Lauf der Stufe paket abgelehnt", () => mitWorktree(async (dir) => {
  zusammenfassung(dir, { stufe: "paket" });
  const gate = await notfallGate(dir);
  assert.equal(gate.ok, false);
  assert.match(gate.grund, /push/);
}));

test("[schutz] notfallGate: roter Lauf abgelehnt", () => mitWorktree(async (dir) => {
  zusammenfassung(dir, { ergebnis: "rot" });
  const gate = await notfallGate(dir);
  assert.equal(gate.ok, false);
  assert.match(gate.grund, /gruen/);
}));

test("[schutz] notfallGate: Datei nach dem Lauf geaendert abgelehnt", () => mitWorktree(async (dir) => {
  zusammenfassung(dir);
  writeFileSync(join(dir, "a.txt"), "zwei\n");
  const gate = await notfallGate(dir);
  assert.equal(gate.ok, false);
  assert.match(gate.grund, /Stand|geaendert/);
}));

test("[schutz] notfallGate: Zusammenfassung ohne hashes abgelehnt", () => mitWorktree(async (dir) => {
  zusammenfassung(dir, { ohneHashes: true });
  const gate = await notfallGate(dir);
  assert.equal(gate.ok, false);
}));

test("[schutz] notfallGate: gruener push-Lauf mit unveraendertem Stand geht durch", () => mitWorktree(async (dir) => {
  zusammenfassung(dir);
  assert.deepEqual(await notfallGate(dir), { ok: true });
}));

// --- nachtSperre (E8) ---

test("[schutz] nachtSperre: mit KIT_AGENT_MODEL gesperrt fuer einrichten, aussetzen, nachpruefen, nicht fuer status", () => {
  const nacht = { KIT_AGENT_MODEL: "claude-sonnet-5-5" };
  for (const aktion of ["einrichten", "aussetzen", "nachpruefen"]) {
    assert.throws(() => nachtSperre(aktion, nacht), new RegExp(aktion));
  }
  assert.doesNotThrow(() => nachtSperre("status", nacht));
});

test("[schutz] nachtSperre: ohne KIT_AGENT_MODEL alles erlaubt, Vorgabe ist process.env", () => {
  for (const aktion of ["einrichten", "aussetzen", "nachpruefen", "status"]) {
    assert.doesNotThrow(() => nachtSperre(aktion, {}));
  }
  const vorher = process.env.KIT_AGENT_MODEL;
  process.env.KIT_AGENT_MODEL = "claude-sonnet-5-5";
  try {
    assert.throws(() => nachtSperre("aussetzen"));
  } finally {
    if (vorher === undefined) delete process.env.KIT_AGENT_MODEL; else process.env.KIT_AGENT_MODEL = vorher;
  }
});

// --- probe, einrichten, nachpruefen (Issue #1408: A3, A4, A7, E6, E7) ---
//
// Der Host ist gefaelscht, die Uhr auch: `schlafe` rueckt `jetzt` vor, statt zu warten.
// So laufen die Fristen von 5 und 60 Minuten ohne echte Wartezeit (Entscheidung im Paket).

const KOPF_SHA = "b".repeat(40);
const ZWEIG = "kit-pruefung";

function job(name, ergebnis) { return { name, ergebnis, gestartet: null }; }

/**
 * Ein Host fuer die Probe: `ciFolge` liefert je Abfrage den naechsten CI-Status (der letzte
 * bleibt stehen), `admin` und `upsertFehler` steuern den Schluss von `einrichten`.
 */
function probeHost({ ciFolge = [{ status: "gruen", jobs: [job("check", "gruen"), job("lint", "gruen")] }],
  admin = true, adminFehler = null, upsertFehler = null, ciFehler = null, unterstuetzt = { ja: true } } = {}) {
  const aufrufe = [];
  let i = 0;
  return {
    aufrufe,
    schutzUnterstuetzt: () => unterstuetzt,
    hatAdminRecht: async () => {
      aufrufe.push("hatAdminRecht");
      if (adminFehler) throw adminFehler;
      return admin;
    },
    getCiStatus: async (commit, zweig) => {
      aufrufe.push(`getCiStatus ${commit} ${zweig ?? ""}`.trim());
      if (ciFehler) throw ciFehler;
      const ci = ciFolge[Math.min(i, ciFolge.length - 1)];
      i += 1;
      return ci;
    },
    pushRef: async (sha, zweig) => { aufrufe.push(`pushRef ${sha} ${zweig}`); },
    deleteRef: async (zweig) => { aufrufe.push(`deleteRef ${zweig}`); },
    upsertRuleset: async (soll) => {
      aufrufe.push(`upsertRuleset ${soll.zweig}`);
      if (upsertFehler) throw upsertFehler;
      return { name: soll.name, angelegt: true };
    },
  };
}

/** Optionen mit falscher Uhr; `zeilen` sammelt die Fortschrittszeilen. */
function uhr({ belegt = false, kopf = KOPF_SHA } = {}) {
  let t = 0;
  const zeilen = [];
  const schlaefe = [];
  return {
    zeilen,
    schlaefe,
    jetzt: () => t,
    schlafe: async (ms) => { schlaefe.push(ms); t += ms; },
    melde: (z) => zeilen.push(z),
    zweigBelegt: () => belegt,
    kopfVon: () => kopf,
  };
}

const LEER = { status: "laeuft", jobs: [] };
const LAEUFT = { status: "laeuft", jobs: [job("check", "laeuft")] };

test("[schutz] probe: pusht den Kopf von origin/main, fragt mit Zweigfilter und loescht den Zweig", async () => {
  const h = probeHost();
  const o = uhr();
  const ergebnis = await probe(h, CONFIG, ZWEIG, o);
  assert.deepEqual(ergebnis.jobs, ["check", "lint"]);
  assert.equal(ergebnis.gefunden, true);
  assert.equal(ergebnis.abgeschlossen, true);
  assert.deepEqual(h.aufrufe, [`pushRef ${KOPF_SHA} ${ZWEIG}`, `getCiStatus ${KOPF_SHA} ${ZWEIG}`, `deleteRef ${ZWEIG}`]);
});

test("[schutz] probe: wartet im 30-Sekunden-Takt mit einer Fortschrittszeile je Minute", async () => {
  const h = probeHost({ ciFolge: [LEER, LEER, LAEUFT, LAEUFT, LAEUFT, { status: "rot", jobs: [job("check", "rot")] }] });
  const o = uhr();
  const ergebnis = await probe(h, CONFIG, ZWEIG, o);
  assert.deepEqual(ergebnis.jobs, ["check"]);
  assert.ok(o.schlaefe.every((ms) => ms === 30_000), `Takt: ${o.schlaefe}`);
  assert.equal(o.schlaefe.length, 5);
  // 150 Sekunden gewartet: zwei volle Minuten, zwei Zeilen.
  assert.equal(o.zeilen.length, 2);
  assert.match(o.zeilen[0], /1 min/);
});

test("[schutz] probe: ohne Lauf binnen 5 Minuten nicht gefunden, Zweig trotzdem geloescht", async () => {
  const h = probeHost({ ciFolge: [LEER] });
  const o = uhr();
  const ergebnis = await probe(h, CONFIG, ZWEIG, o);
  assert.equal(ergebnis.gefunden, false);
  assert.deepEqual(ergebnis.jobs, []);
  assert.ok(o.jetzt() >= 5 * 60_000 && o.jetzt() < 6 * 60_000, `gewartet: ${o.jetzt()}`);
  assert.equal(h.aufrufe.at(-1), `deleteRef ${ZWEIG}`);
});

test("[schutz] probe: ein Lauf ohne Abschluss binnen 60 Minuten ist gefunden, aber nicht abgeschlossen", async () => {
  const h = probeHost({ ciFolge: [LAEUFT] });
  const o = uhr();
  const ergebnis = await probe(h, CONFIG, ZWEIG, o);
  assert.equal(ergebnis.gefunden, true);
  assert.equal(ergebnis.abgeschlossen, false);
  assert.ok(o.jetzt() >= 60 * 60_000 && o.jetzt() < 61 * 60_000, `gewartet: ${o.jetzt()}`);
  assert.equal(h.aufrufe.at(-1), `deleteRef ${ZWEIG}`);
});

test("[schutz] probe: vorhandener Pruefzweig bricht ohne Push ab (E7)", async () => {
  const h = probeHost();
  await assert.rejects(probe(h, CONFIG, ZWEIG, uhr({ belegt: true })), /kit-pruefung.*(vorhanden|belegt)/);
  assert.deepEqual(h.aufrufe, []);
});

test("[schutz] probe: ein Fehler beim Warten loescht den Zweig trotzdem", async () => {
  const h = probeHost({ ciFehler: new Error("gh run list: HTTP 502") });
  await assert.rejects(probe(h, CONFIG, ZWEIG, uhr()), /HTTP 502/);
  assert.equal(h.aufrufe.at(-1), `deleteRef ${ZWEIG}`);
});

test("[schutz] einrichten: scharf — Rulesets fuer main und production mit den Jobs der Probe", async () => {
  const h = probeHost();
  const ergebnis = await einrichten(h, CONFIG, ZWEIG, uhr());
  assert.equal(ergebnis.ergebnis, "scharf");
  assert.deepEqual(ergebnis.jobs, ["check", "lint"]);
  assert.deepEqual(h.aufrufe.filter((a) => a.startsWith("upsertRuleset")), ["upsertRuleset main", "upsertRuleset production"]);
});

test("[schutz] einrichten: eine rote Probe schaltet ebenfalls scharf (A4)", async () => {
  const h = probeHost({ ciFolge: [{ status: "rot", jobs: [job("check", "rot"), job("lint", "gruen")] }] });
  const ergebnis = await einrichten(h, CONFIG, ZWEIG, uhr());
  assert.equal(ergebnis.ergebnis, "scharf");
  assert.deepEqual(ergebnis.jobs, ["check", "lint"]);
});

test("[schutz] einrichten: ohne productionBranch nur das Ruleset des Hauptzweigs", async () => {
  const h = probeHost();
  const { productionBranch, ...ohne } = CONFIG;
  assert.ok(productionBranch);
  const ergebnis = await einrichten(h, ohne, ZWEIG, uhr());
  assert.equal(ergebnis.ergebnis, "scharf");
  assert.deepEqual(h.aufrufe.filter((a) => a.startsWith("upsertRuleset")), ["upsertRuleset main"]);
});

test("[schutz] einrichten: offen ohne Lauf binnen 5 Minuten, mit dem offenen Schritt, ohne Ruleset", async () => {
  const h = probeHost({ ciFolge: [LEER] });
  const ergebnis = await einrichten(h, CONFIG, ZWEIG, uhr());
  assert.equal(ergebnis.ergebnis, "offen");
  assert.match(ergebnis.schritt, /checks\.mjs run --stufe push --since "\$\(git merge-base HEAD origin\/main\)"/);
  assert.match(ergebnis.schritt, /kit-pruefung/);
  assert.equal(h.aufrufe.some((a) => a.startsWith("upsertRuleset")), false);
});

test("[schutz] einrichten: anleitung ohne Admin-Recht, mit dem Text aus anleitung und ohne Ruleset", async () => {
  const h = probeHost({ admin: false });
  const ergebnis = await einrichten(h, CONFIG, ZWEIG, uhr());
  assert.equal(ergebnis.ergebnis, "anleitung");
  assert.equal(ergebnis.anleitung, anleitung([rulesetSoll("main", ["check", "lint"], "haupt"),
    rulesetSoll("production", ["check", "lint"], "veroeffentlichung")]));
  assert.equal(h.aufrufe.some((a) => a.startsWith("upsertRuleset")), false);
});

test("[schutz] einrichten: anleitung bei 403 des Code-Hosts", async () => {
  const fehler = Object.assign(new Error("gh api: (HTTP 403)"), { httpStatus: 403 });
  const h = probeHost({ upsertFehler: fehler });
  const ergebnis = await einrichten(h, CONFIG, ZWEIG, uhr());
  assert.equal(ergebnis.ergebnis, "anleitung");
  assert.match(ergebnis.anleitung, /Settings → Rules → Rulesets/);
});

test("[schutz] einrichten: nicht moeglich ohne origin/main, ohne Push", async () => {
  const h = probeHost();
  const ergebnis = await einrichten(h, CONFIG, ZWEIG, uhr({ kopf: null }));
  assert.equal(ergebnis.ergebnis, "nicht moeglich");
  assert.match(ergebnis.grund, /origin\/main/);
  assert.deepEqual(h.aufrufe, []);
});

test("[schutz] einrichten: nicht moeglich bei Fehlschlag von gh, mit Grund und ohne Aenderung", async () => {
  const h = probeHost({ adminFehler: new Error("gh: command not found") });
  const ergebnis = await einrichten(h, CONFIG, ZWEIG, uhr());
  assert.equal(ergebnis.ergebnis, "nicht moeglich");
  assert.match(ergebnis.grund, /command not found/);
  assert.equal(h.aufrufe.some((a) => a.startsWith("pushRef") || a.startsWith("upsertRuleset")), false);
});

test("[schutz] einrichten: nicht moeglich bei einem Code-Host ohne Schutz", async () => {
  const h = probeHost({ unterstuetzt: { ja: false, grund: "Kein Schutz bei local." } });
  const ergebnis = await einrichten(h, CONFIG, ZWEIG, uhr());
  assert.deepEqual(ergebnis, { ergebnis: "nicht moeglich", grund: "Kein Schutz bei local." });
});

test("[schutz] nachpruefen: pusht den Kopf erneut, wartet mit Zweigfilter und loescht den Zweig (A7)", async () => {
  const h = probeHost();
  const ergebnis = await nachpruefen(h, CONFIG, ZWEIG, uhr());
  assert.equal(ergebnis.commit, KOPF_SHA);
  assert.equal(ergebnis.status, "gruen");
  assert.deepEqual(h.aufrufe, [`pushRef ${KOPF_SHA} ${ZWEIG}`, `getCiStatus ${KOPF_SHA} ${ZWEIG}`, `deleteRef ${ZWEIG}`]);
});

test("[schutz] einrichten: ein vorhandener Pruefzweig bricht ab, statt nicht moeglich zu melden (E7)", async () => {
  const h = probeHost();
  await assert.rejects(einrichten(h, CONFIG, ZWEIG, uhr({ belegt: true })), /schon vorhanden/);
  assert.equal(h.aufrufe.some((a) => a.startsWith("pushRef")), false);
});
