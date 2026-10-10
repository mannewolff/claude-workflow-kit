// Die Schutz-Logik ohne Host-Details (Issue #1407, Plan #1405).
//
// `kit/board/schutz.mjs` leitet aus den Operationen des Code-Host-Adapters ab, ob ein
// Projekt geschuetzt ist (E1, A7, A9, E10), beschreibt das Soll der Rulesets (A2, A8) samt
// Anleitung fuer den Menschen ohne Admin-Recht (A9), haelt den Notfallweg an einem gruenen
// lokalen Lauf der Stufe push fest (E9) und sperrt die schreibenden Aktionen in der Nacht
// (E8). Der Host ist hier ein gefaelschtes Objekt mit den Methoden aus Issue #1406: Die
// `gh`-Aufrufe dahinter prueft `board-adapter-schutz-github.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { rulesetSoll, schutzZustand, anleitung, notfallGate, nachtSperre, NACHPRUEFEN_KOMMANDO } from "../kit/board/schutz.mjs";

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
