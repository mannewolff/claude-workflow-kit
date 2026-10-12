// Meldungen des Nacht-Runners zweisprachig, Gruppe wartend, session, kitstand (Plan #1420 E13/E14).
//
// Jedes Modul der Gruppe traegt seine Texte an den Menschen in einer Tabelle TEXTE { de, en }
// und gibt sie ueber den Texthelfer aus kit/board/namen.mjs aus:
//   - Paritaet: je Tabelle dieselben Schluessel und Platzhalter in beiden Sprachen.
//   - Englische Stichproben: ein englisches Projekt sieht die englische Form; die Zeilen, die
//     kanban-kit aus Textprotokoll und Ergebnisdatei liest, stehen in der Form der Vorlage am
//     Plan #1420, die Anker der Vermerke unter ihrem englischen Namen aus dem Register MARKER.
//   - Die deutschen Wortlaut-Tests der Gruppe bleiben, wie sie sind, und laufen mit der
//     Vorgabe Deutsch.
//
// Der erste Teil (#1487) deckt kit/night/wartend.mjs, die Teile #1488 und #1489
// kit/night/session.mjs, der letzte (#1490) kit/night/kitstand.mjs.

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  TEXTE as WARTEND_TEXTE, GESCHUETZT_ABGEWIESEN, festgefahrenVermerk, pruefeIssueGates, rundenGrund,
  rundenMerkerZuruecksetzen, wartendAbhaengigkeiten, wartendVermerk, werteRunde, zeitlimitVermerk,
} from "../kit/night/wartend.mjs";
import {
  TEXTE as SESSION_TEXTE, FESTGEFAHREN_MARKE, aufgabenStufe, empfohlenesModell, frischeStufenFelder, ladeKetteBudget,
  ladeKetteUebergaenge, ladePruefLaufBudget, laufModell, modellFuerStufe, normalisiereVorflug, paketWahl,
  reviewerVorflug, stufeStartbar, verifyChecksForSalvage, zielLabelName,
} from "../kit/night/session.mjs";
import {
  TEXTE as KITSTAND_TEXTE, aufUmsetzungWarten, kitStandZeile, kitstandAbhaengigkeiten, nachziehenPruefen,
  umsetzungLockNehmen, vorbereitungFesthalten, vorbereitungPruefen, zusammenfassungBezeugt,
} from "../kit/night/kitstand.mjs";
import { CHECKS_PATH, UMSETZUNG_LOCK } from "../kit/night/grundlagen.mjs";
import { pruefeParitaet, spracheFestlegen } from "../kit/board/namen.mjs";
import { deutschAmHelferVorbei, deutschImEnglischen } from "./helpers/quelltext-texte.mjs";

/** Fuehrt `fn` mit der Prozesssprache `sprache` aus und vergisst sie danach wieder. */
async function inSprache(sprache, fn) {
  spracheFestlegen(sprache);
  try {
    return await fn();
  } finally {
    spracheFestlegen(null);
  }
}

/** Faengt die Protokollzeilen von `log` ab, solange `fn` laeuft. */
async function mitProtokoll(fn) {
  const zeilen = [];
  const schreiben = process.stdout.write;
  process.stdout.write = (chunk) => {
    zeilen.push(String(chunk));
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = schreiben;
  }
  return zeilen.join("");
}

// --- kit/night/wartend.mjs (Issue #1487) --------------------------------------------------

test("[1487] die Texttabelle von wartend hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(WARTEND_TEXTE), []);
  assert.ok(Object.keys(WARTEND_TEXTE.de).length >= 100, "die Tabelle traegt die Meldungen der Runde");
});

test("[1487] englisch: die Zeilen, die kanban-kit liest, beginnen in der Form der Vorlage", () => {
  const vorlage = {
    erfolg: "  Success after {minuten} min, commit {commit}, issue #{id} in In review.",
    salvageErfolg: "  Salvage succeeded, commit {commit}, issue #{id} in In review.",
    fehlschlagDirty: "FAILURE after {minuten} min: issue #{id} — ",
    rueckstellungLog: "  Failure after {minuten} min: issue #{id}",
    infrastruktur: "INFRASTRUCTURE FAILURE after {minuten} min",
    resteNachErfolg: "HARD STOP: successful round for issue #{id}",
    salvageGescheitert: "SALVAGE ATTEMPT failed",
    salvageGestartet: "  SALVAGE ATTEMPT started",
    salvageNichtMoeglich: "  Salvage not possible: ",
    gateAbhaengigkeitLog: "#{id} deferred: dependency ",
    gateFachlichLog: "#{id} skipped: ",
    gateKlaerenLog: "#{id} skipped: ",
    session: "session {nummer}/{max}: issue #{id} — {titel}",
    cliMeldung: "CLI message: ",
    labelWarnung: "WARNING: ",
    labelVorhanden: "  Labels present in Ready: ",
    labelTippfehler: "  Typo in the --label value?",
    deferredGrund: "Session without In-review result",
    nachtlauf: "Night run: ",
  };
  for (const [schluessel, anfang] of Object.entries(vorlage)) {
    assert.ok(WARTEND_TEXTE.en[schluessel].startsWith(anfang), `${schluessel}: "${WARTEND_TEXTE.en[schluessel]}"`);
  }
  assert.match(WARTEND_TEXTE.en.gateAbhaengigkeit, /^dependency /, "der Grund an der Karte nennt die Abhaengigkeit");
});

test("[1487] englisch: die Gruende einer Runde ohne Ergebnis", async () => {
  await inSprache("en", () => {
    assert.equal(rundenGrund({ error: { code: "ETIMEDOUT" } }, { zustand: "gruen" }), "Reason: session ended at the time limit");
    assert.equal(rundenGrund({ stdout: "" }, { zustand: "rot", rotesKommando: "npm test" }),
      "Reason: required check red — npm test (session)");
    assert.equal(rundenGrund({ stdout: "" }, { zustand: "rot" }), "Reason: required check red — unnamed command (session)");
    assert.equal(rundenGrund({ stdout: "" }, { zustand: "gruen" }), "Reason: session ended without an evaluable result event");
    assert.equal(rundenGrund({ festgefahren: { pruefung: "x" } }, null), "Reason: session stuck on a check");
  });
});

test("[1487] englisch: die drei Vermerke stehen unter dem englischen Anker", async () => {
  await inSprache("en", () => {
    const wartend = wartendVermerk("Waiting.", ["a.txt"]);
    assert.match(wartend, /^## Night run: waiting session\n\nReason: the session waited for work it had started itself/);
    assert.ok(wartend.includes("### Last known state\n\nWaiting."), wartend);
    assert.ok(wartend.includes("### In the working directory\n\nuncommitted leftovers: a.txt"), wartend);
    assert.match(wartendVermerk("x".repeat(2100)), /\(Final text shortened to 2000 characters\.\)\n$/);

    const zeit = zeitlimitVermerk(30, { zeilen: [] });
    assert.match(zeit, /^## Night run: time limit reached\n\nReason: session ended at the time limit — the limit of this round: 30 minutes\.\n/);
    assert.ok(zeit.includes("no information from the session"), zeit);
    assert.ok(zeit.includes("### Next step (human)"), zeit);
    assert.match(zeitlimitVermerk(null, null), /limit unknown\.\n[\s\S]*Progress not observed \(no stream\)/);
    assert.ok(zeitlimitVermerk(1.5, { zeilen: ["AK1"], gesehen: 4 }).includes("(4 progress lines reported, the latest 1 are shown here.)"));

    const fest = festgefahrenVermerk({ pruefung: "npm test", fehler: "boom", versuche: 3 }, null, 10, true);
    assert.match(fest, /^## Night run: stuck on a check\n\nReason: session stuck on a check — the brake ended/);
    assert.ok(fest.includes("- Attempts: failed the same way 3 times"), fest);
    assert.ok(fest.includes("- Running time until the abort: unknown"), fest);
    assert.ok(fest.includes("- Time limit of the session: 10 minutes"), fest);
    assert.ok(fest.endsWith("Nothing was saved: no changes in the working directory.\n"), fest);
    for (const deutsch of ["Nachtlauf", "Grund:", "Stand", "Minuten", "nicht bekannt"]) {
      assert.ok(![wartend, zeit, fest].some((v) => v.includes(deutsch)), `deutsch im Vermerk: ${deutsch}`);
    }
  });
});

test("[1487] englisch: die Titel- und Label-Gates", async () => {
  await inSprache("en", () => {
    const fachlich = pruefeIssueGates({ id: 5, title: "[Requirement] Self-service", labels: [] });
    assert.equal(fachlich.log, "#5 skipped: requirement ([Fachlich]), not implemented.");
    assert.equal(fachlich.kommentar, "Night run: Requirement — not implemented, please turn it into technical issues via /techplan #5.");
    const plan = pruefeIssueGates({ id: 6, title: "[Plan] Something", labels: [] });
    assert.match(plan.kommentar, /^Night run: Plan document — not implemented/);
    const klaeren = pruefeIssueGates({ id: 7, title: "Package", labels: ["kit:clarify"] });
    assert.equal(klaeren.grundArt, "klaeren");
    assert.equal(klaeren.log, "#7 skipped: carries kit:clarify, an open decision is waiting.");
    assert.equal(klaeren.kommentar, "Night run: Carries kit:clarify — an open decision waits for a human, not implemented.");
    const geschuetzt = pruefeIssueGates({ id: 8, title: "Package", labels: ["kit:geschuetzt"] });
    assert.match(geschuetzt.kommentar, /^Night run: Carries kit:protected — a human action on a protected file is waiting/);
  });
});

// --- Die Runde im selben Prozess, mit eingesetztem Board ----------------------------------

const TOP = { id: "7", title: "Package" };
const VORHER = { id: "7", status: "in_progress", labels: [], comments: [] };

function attrappe({ status, sauber = true, reste = [] }) {
  const aufrufe = [];
  wartendAbhaengigkeiten({
    board: (...args) => {
      aufrufe.push(args);
      return args[1] === "get" ? { ...VORHER, status } : { ok: true };
    },
    boardRoh: (...args) => {
      aufrufe.push(args);
      return { status: 0, json: null, text: "" };
    },
    leseKarte: () => ({ ...VORHER, status }),
    gitClean: () => sauber,
    gitReste: () => reste,
    lesePruefung: () => ({ zustand: "ungeprueft" }),
  });
  return aufrufe;
}

const kommentare = (aufrufe) => aufrufe.filter((a) => a[1] === "comment").map((a) => a[a.indexOf("--text") + 1]);

function runde(pruefung) {
  return werteRunde({
    top: TOP, res: { status: 0, stdout: "", stderr: "" }, minutes: "0.1", args: {}, salvageAttempted: new Set(),
    pruefung, vorher: VORHER, sessionWahl: {},
  });
}

beforeEach(() => rundenMerkerZuruecksetzen());
after(() => wartendAbhaengigkeiten());

test("[1487] englisch: eine Runde ohne In-review-Ergebnis bei sauberem Baum", async () => {
  const aufrufe = attrappe({ status: "ready" });
  let ausgang;
  const protokoll = await inSprache("en", () => mitProtokoll(async () => {
    ausgang = await runde({ zustand: "ungeprueft" });
  }));
  assert.equal(ausgang, "deferred");
  assert.ok(protokoll.includes("  Failure after 0.1 min: issue #7 not in In review, tree clean — issue to Backlog, continuing."), protokoll);
  assert.deepEqual(kommentare(aufrufe),
    ["Night run: Session without In-review result — issue deferred, the run continued with the next issue."]);
});

test("[1487] englisch: eine Runde in In review ohne Nachweis", async () => {
  const aufrufe = attrappe({ status: "in_review" });
  const protokoll = await inSprache("en", () => mitProtokoll(() => runde({ zustand: "ungeprueft" })));
  assert.match(protokoll, / {2}Success after 0\.1 min, commit \S+, issue #7 in In review\./);
  assert.ok(protokoll.includes("issue #7 in In review, but evidence missing — the session ran no check — card stays"), protokoll);
  assert.deepEqual(kommentare(aufrufe),
    ["Night run: evidence missing — the session ran no check. The card stays in In review and the commit untouched — please check the state."]);
});

test("[1487] ohne Spracheinstellung bleibt die Runde deutsch", async () => {
  const aufrufe = attrappe({ status: "ready" });
  const protokoll = await mitProtokoll(() => runde({ zustand: "ungeprueft" }));
  assert.ok(protokoll.includes("  Fehlschlag nach 0.1 min: Issue #7 nicht in In review, Tree sauber — Issue ins Backlog, weiter."), protokoll);
  assert.deepEqual(kommentare(aufrufe),
    ["Nachtlauf: Session ohne In-review-Ergebnis beendet — Issue zurueckgestellt, Lauf ging mit dem naechsten Issue weiter."]);
});

// --- kit/night/session.mjs, Teil 1: bis vor permissionArgs (Issue #1488) ------------------

test("[1488] die Texttabelle von session hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(SESSION_TEXTE), []);
  assert.ok(Object.keys(SESSION_TEXTE.de).length >= 15, "die Tabelle traegt die Meldungen des ersten Teils");
});

test("[1488] englisch: die Gruende zu Modell und Aufgabenstufe der Karte", async () => {
  await inSprache("en", () => {
    assert.equal(empfohlenesModell("Empfohlenes Modell: --yolo", ["m1"]).grund,
      'Recommended model "--yolo" starts with a hyphen and is not a model name — model of the run.');
    assert.equal(empfohlenesModell("Recommended model: m2", ["m1"]).grund,
      'Recommended model "m2" is not in night.modelle — model of the run.');
    assert.equal(aufgabenStufe("Aufgabenstufe: mittelschwer").grund,
      'Task tier "mittelschwer" is not a known tier value (schwer, mittel, leicht) — no tier.');
    assert.equal(paketWahl({ body: "Empfohlenes Modell: m1\nAufgabenstufe: leicht", erlaubteModelle: ["m1"], laufModell: "m0" }).grund,
      "Card names a model and task tier leicht — the model name wins.");
  });
});

test("[1488] englisch: warum eine Stufe nicht startet", async () => {
  await inSprache("en", () => {
    assert.equal(stufeStartbar({ modell: "m9" }, ["m1"]).grund, 'model "m9" is not in night.modelle');
    assert.equal(stufeStartbar({}, []).grund, "neither modell nor kommando set");
    assert.equal(stufeStartbar({ kommando: "A=1 B=2" }, []).grund, 'the command line "A=1 B=2" names only environment and no program');
    assert.equal(stufeStartbar({ kommando: "gibt-es-nicht-1488 --x" }, []).grund,
      'the program "gibt-es-nicht-1488" cannot be found via the shell');
    assert.equal(modellFuerStufe({ stufen: {} }, "extrem", []).grund, '"extrem" is not a task tier');
    assert.equal(modellFuerStufe({ stufen: { schwer: { modell: "m9" } } }, "mittel", ["m1"]).grund,
      'tier mittel not assigned; tier schwer not startable: model "m9" is not in night.modelle');
  });
});

test("[1488] englisch: eine unlesbare Einstellung beim frischen Lesen der Stufen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "night-1488-"));
  try {
    const pfad = join(dir, "workflow.config.json");
    writeFileSync(pfad, "{ kaputt");
    const { grund } = await inSprache("en", () => frischeStufenFelder(pfad, { night: { stufen: {} } }));
    assert.match(grund, /^the settings could not be read fresh \(.+\) — the state at the start of the run applies\.$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[1488] ohne Spracheinstellung bleiben die Gruende von session deutsch", () => {
  assert.equal(empfohlenesModell("Empfohlenes Modell: m2", ["m1"]).grund,
    'Empfohlenes Modell "m2" steht nicht in night.modelle — Modell des Laufs.');
  assert.equal(modellFuerStufe({ stufen: {} }, "schwer", []).grund, "Stufe schwer nicht belegt");
  assert.equal(stufeStartbar({}, []).grund, "weder modell noch kommando gesetzt");
});

// --- kit/night/session.mjs, Teil 2: ab permissionArgs (Issue #1489) -----------------------

test("[1489] die Texttabelle von session traegt auch die Meldungen des zweiten Teils", () => {
  assert.deepEqual(pruefeParitaet(SESSION_TEXTE), []);
  for (const schluessel of ["claudeFehlt", "formatFixStart", "formatFixGruen", "zahlGroesserNull", "vorflugOhneBlock"]) {
    assert.ok(Object.hasOwn(SESSION_TEXTE.de, schluessel), `"${schluessel}" fehlt in der Tabelle`);
  }
});

test("[1489] englisch: die Pruefung der Einstellungen von Lauf, Kette und Prueflauf", async () => {
  await inSprache("en", () => {
    assert.equal(laufModell({}, { night: { modell: "m9", modelle: ["m1"] } }).fehler,
      "night.modell 'm9' is not in night.modelle — add it there or change night.modell.");
    assert.throws(() => ladeKetteBudget({ night: { kette: { label: " " } } }), { message: "night.kette.label must be a non-empty text" });
    assert.throws(() => ladeKetteBudget({ night: { kette: { varianteBLabel: 3 } } }),
      { message: "night.kette.varianteBLabel must be a non-empty text" });
    assert.throws(() => ladeKetteBudget({ night: { kette: { planMin: 0 } } }), { message: "night.kette.planMin must be a number greater than 0, is 0" });
    assert.throws(() => ladeKetteBudget({ night: { kette: { korrekturrunden: 1.5 } } }),
      { message: "night.kette.korrekturrunden must be an integer, is 1.5" });
    assert.throws(() => ladeKetteUebergaenge({ night: { kette: { uebergaenge: [] } } }),
      { message: "night.kette.uebergaenge must be an object of booleans" });
    assert.throws(() => ladeKetteUebergaenge({ night: { kette: { uebergaenge: { quer: true } } } }),
      { message: /^night\.kette\.uebergaenge\.quer is not a transition of the chain \(known: planReview, / });
    assert.throws(() => ladeKetteUebergaenge({ night: { kette: { uebergaenge: { planReview: "ja" } } } }),
      { message: 'night.kette.uebergaenge.planReview must be true or false, is "ja"' });
    assert.throws(() => ladePruefLaufBudget({ pruefLauf: { label: "" } }), { message: "pruefLauf.label must be a non-empty text" });
    assert.throws(() => ladePruefLaufBudget({ pruefLauf: { kostenUsd: -1 } }), { message: "pruefLauf.kostenUsd must be a number greater than 0, is -1" });
    assert.throws(() => zielLabelName("mond", {}), { message: 'zielLabelName: unknown goal "mond"' });
  });
});

/** Ein leeres Projektverzeichnis als Arbeitsverzeichnis, solange `fn` laeuft. */
async function imLeerenProjekt(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-1489-"));
  const vorher = process.cwd();
  mkdirSync(join(dir, ".claude"), { recursive: true });
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(vorher);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[1489] englisch: die Zeilen des Format-Fix stehen in der Form der Vorlage", async () => {
  const exitcodes = [1, 0];
  const spawnSync = (_befehl, args) => (args[0] === CHECKS_PATH
    ? { status: exitcodes.shift(), stdout: "", stderr: "" }
    : { status: 0, stdout: "", stderr: "" });
  const text = await imLeerenProjekt(() => inSprache("en", () => mitProtokoll(() =>
    verifyChecksForSalvage({ formatFixCommand: "npm run format" }, 7, { spawnSync }))));
  assert.match(text, / {2}buildChecks red — one-time format fix being applied: npm run format/);
  assert.match(text, / {2}FORMAT FIX applied, buildChecks now green — the run continues\./);
});

test("[1489] englisch: die Gruende des Reviewer-Vorflugs", async () => {
  await inSprache("en", () => {
    const { reviewers, tracker } = normalisiereVorflug({ reviewers: [{ name: "b", verfuegbar: false }] }, [
      { name: "a", kind: "command" }, { name: "b", kind: "command" },
    ]);
    assert.deepEqual(reviewers.map((r) => r.grund), ["the preflight session reported nothing about this reviewer",
      "reported as unavailable without a reason"]);
    assert.equal(tracker.grund, "the preflight session reported no tracker finding");
  });
  const vorher = process.env.NIGHT_VORFLUG_CMD;
  try {
    process.env.NIGHT_VORFLUG_CMD = "echo kein Block";
    const ohneBlock = await inSprache("en", () => reviewerVorflug({}, [], null));
    assert.equal(ohneBlock.grund, "the preflight session ended without an evaluable finding block");
    process.env.NIGHT_VORFLUG_CMD = "exit 3";
    const mitExit = await inSprache("en", () => reviewerVorflug({}, [], null));
    assert.equal(mitExit.grund, "the preflight session ended with exit 3 and without an evaluable finding block");
  } finally {
    if (vorher === undefined) delete process.env.NIGHT_VORFLUG_CMD;
    else process.env.NIGHT_VORFLUG_CMD = vorher;
  }
});

test("[1489] ohne Spracheinstellung bleiben die Meldungen des zweiten Teils deutsch", () => {
  assert.throws(() => ladeKetteBudget({ night: { kette: { planMin: 0 } } }), { message: "night.kette.planMin muss eine Zahl groesser 0 sein, ist 0" });
  assert.equal(laufModell({}, { night: { modell: "m9", modelle: [] } }).fehler,
    "night.modell 'm9' steht nicht in night.modelle — bitte dort eintragen oder night.modell aendern.");
  assert.equal(normalisiereVorflug({}, [{ name: "a", kind: "command" }]).reviewers[0].grund,
    "die Vorflug-Session hat zu diesem Reviewer nichts gemeldet");
});

// --- kit/night/kitstand.mjs (Issue #1490) ----------------------------------------------

test("[1490] die Texttabelle von kitstand hat in beiden Sprachen dieselben Schluessel und Platzhalter", () => {
  assert.deepEqual(pruefeParitaet(KITSTAND_TEXTE), []);
  assert.ok(Object.keys(KITSTAND_TEXTE.de).length >= 30, "die Tabelle traegt die Meldungen des Kit-Stands");
});

/** Ein leeres Verzeichnis als Hauptkopie, solange `fn` laeuft. */
async function inLeeremBaum(fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-1490-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Ein Lock in `dir`, den dieser Prozess haelt. */
function eigenerLock(dir) {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, UMSETZUNG_LOCK), `${process.pid}\n`);
}

test("[1490] englisch: Umsetzungs-Lock und Nachziehen", async () => {
  await inLeeremBaum((dir) => inSprache("en", async () => {
    eigenerLock(dir);
    assert.equal(umsetzungLockNehmen(dir).grund, `another implementation holds ${UMSETZUNG_LOCK} (process ${process.pid})`);
    assert.equal(nachziehenPruefen(dir).grund,
      `${UMSETZUNG_LOCK} is held (process ${process.pid}) — a run of the runner is working in the main copy`);

    const uhr = [0, 0, 120000, 120000];
    const staende = [];
    const lock = await aufUmsetzungWarten({
      nehmen: () => ({ ok: false, art: "belegt", grund: "held" }), jetzt: () => uhr.shift(), schlafen: async () => {},
      budgetMs: 60000, standSetzen: (zustand, text) => staende.push([zustand, text]),
    });
    assert.deepEqual(staende, [["laeuft", "waiting for the implementation since 1970-01-01T00:00:00.000Z"]]);
    assert.equal(lock.grund, "held, waited 2 min within the implementation budget");
  }));
});

test("[1490] englisch: die vorbereitete Veroeffentlichung", async () => {
  await inLeeremBaum((dir) => inSprache("en", () => {
    assert.equal(vorbereitungPruefen({ repoRoot: dir }).grund,
      "no prepared release (.claude/push-vorbereitung.json is missing or unreadable)");
    assert.throws(() => vorbereitungFesthalten({ repoRoot: dir, pfad: dir, ergebnis: "blau" }),
      { message: "--ergebnis 'blau' is unknown — expected gruen, gruen-offen, rot" });
    assert.throws(() => vorbereitungFesthalten({ repoRoot: dir, pfad: dir, ergebnis: "rot", fetch: "nie" }),
      { message: "--fetch 'nie' is unknown — expected ok, fehlgeschlagen" });
    assert.equal(zusammenfassungBezeugt(dir, ["1"]).rot.hinweis, "no completed summary in the worktree");
  }));
});

test("[1490] englisch: die Zeile des Kit-Stands steht unter dem englischen Marker", async () => {
  await inSprache("en", () => {
    assert.equal(kitStandZeile({ commit: "abcdef1234567890", ref: "origin/main", commitZeit: "2026-10-11T13:35:30+02:00" }),
      "Kit-Revision: abcdef123456 (origin/main from 2026-10-11 13:35)");
    assert.equal(kitStandZeile({ commit: "abcdef1234567890", ref: "origin/main", commitZeit: "" }), "Kit-Revision: abcdef123456 (origin/main)");
    assert.throws(() => kitstandAbhaengigkeiten({ mond: () => {} }), { message: "kitstandAbhaengigkeiten knows no dependency 'mond'" });
  });
});

test("[1490] ohne Spracheinstellung bleiben die Meldungen von kitstand deutsch", async () => {
  assert.equal(kitStandZeile({ commit: "abcdef1234567890", ref: "origin/main", commitZeit: "2026-10-11T13:35:30+02:00" }),
    "Kit-Stand: abcdef123456 (origin/main vom 2026-10-11 13:35)");
  await inLeeremBaum((dir) => {
    eigenerLock(dir);
    assert.equal(umsetzungLockNehmen(dir).grund, `eine andere Umsetzung haelt ${UMSETZUNG_LOCK} (Prozess ${process.pid})`);
    assert.equal(vorbereitungPruefen({ repoRoot: dir }).grund,
      "keine vorbereitete Veroeffentlichung (.claude/push-vorbereitung.json fehlt oder ist unlesbar)");
  });
});

// --- Keine deutsche Meldung am Texthelfer vorbei ------------------------------------------

// Vertragswerte (E14), die deutsch bleiben: die Abweisungszeile des geschuetzten Halts, die
// `kit/board/geschuetzt.mjs` zurueckliest, der Rueckfall im Stash-Namen `nachtrest #<id> <lauf>`
// die Bremsmarke von `checks.mjs run`, die der Runner aus dem Strom der Session liest, und der
// Ergebniswert `nicht gestartet` der Pruef-Zusammenfassung, den kitstand.mjs zurueckliest.
const VERTRAG = [GESCHUETZT_ABGEWIESEN, "ohne-lauf", FESTGEFAHREN_MARKE, "nicht gestartet"];

// Nicht ueber die Tabelle von session.mjs laufen (Issue #1489): die Prompts an Sessions, die
// ein Modell liest und kein Mensch, und `gueteAuswerten`, die Kopie des Originals in
// kit/checks.mjs — ihr Wortlaut folgt dem Original, gleich gehalten von
// test/guete-wertung-sync.test.mjs.
const SESSION_OHNE = [
  { von: "export function gueteAuswerten", bis: "const FEHLERMERKMALE" },
  { von: "export function salvagePrompt", bis: "// --- Das Modell des Laufs" },
  { von: "const VORFLUG_PROBE_PROMPT", bis: "// Der Stempel, an dem" },
  { von: "export function vorflugPrompt", bis: "/** Schneidet den Befund-Block" },
];

const GRUPPE = [
  ["kit/night/wartend.mjs", WARTEND_TEXTE],
  ["kit/night/session.mjs", SESSION_TEXTE, { ohne: SESSION_OHNE }],
  ["kit/night/kitstand.mjs", KITSTAND_TEXTE],
];

// Die Tabellen der Teile unter kit/night/ liegen seit Issue #1525 in kit/texte/; gescannt wird das Modul ohne sie.
test("[1487] die Gruppe gibt in einem englischen Projekt keine deutsche Meldung aus", () => {
  for (const [datei, tabelle, bereich] of GRUPPE) {
    assert.deepEqual(deutschAmHelferVorbei(datei, null, VERTRAG, bereich), [], `${datei}: deutsche Texte am Texthelfer vorbei`);
    assert.deepEqual(deutschImEnglischen(tabelle), [], `${datei}: deutsche Woerter in der englischen Tabelle`);
  }
});
