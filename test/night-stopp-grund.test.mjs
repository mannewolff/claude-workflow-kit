// Jeder harte Stopp hinterlegt seinen Grund als Text (Issue #558).
//
// Bis hierher trug der Ergebnisstand nur die FEHLERKLASSE eines erkannten Stopps.
// Morgens wusste man damit, dass es `harterStopp` oder `umgebung` war, aber nicht, was
// passiert ist — und musste das Textprotokoll durchsuchen. Am 2026-09-08 ist genau das
// am Rest-Guard passiert.
//
// Der Grund ist im Bestand bereits bekannt: Jeder der sieben Abbruchwege schreibt eine
// brauchbare Log-Zeile. Diese Tests messen, dass sie am Ergebnisstand ankommt — je
// Abbruchweg einer, dazu die Kuerzung der Restliste und die drei Lagen des
// Sicherheitsnetzes.
//
// Was jeder Abbruchweg-Test prueft, ist dreiteilig: der Grund steht an der ERWARTETEN
// STELLE (Einheit der betroffenen Karte, sonst Lauf), er traegt den PROTOKOLLTEXT, und
// er ist NICHT der Ersatztext. Ohne die dritte Zusicherung bliebe gruen, was das
// Sicherheitsnetz nachtraeglich gerettet hat — und dann bewiese der Test nichts ueber
// den Abbruchweg.
//
// Wie in den uebrigen night-Tests laeuft alles lokal: issueTracker "local" in einem
// Temp-Repo, Session-Fake ueber NIGHT_CLAUDE_CMD, Vorflug-Fake ueber NIGHT_VORFLUG_CMD,
// und das ECHTE kit/night.mjs aus dem Repo (cwd + KIT_ROOT zeigen ins Fixture).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { sicherheitsnetzGrund, ERSATZ_GRUND, ANKER_FEHLT } from "../kit/night.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Das ECHTE Script aus dem Repo (nicht kopiert): nur so wird seine Coverage gemessen.
const NIGHT = join(repoRoot, "kit", "night.mjs");

const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

const NUR_CLAUDE = [
  { name: "opus", kind: "claude", model: "claude-opus-5" },
  { name: "sonnet", kind: "claude", model: "claude-sonnet-5" },
];

/** Fake fuer die Vorflug-Session (Issue #269) — sonst startete jeder Lauf hier eine echte. */
const VORFLUG_OK = `cat <<'EOF'
<<<VORFLUG
{"reviewers": [], "tracker": {"erreichbar": true, "geprueft": "issue list"}}
VORFLUG>>>
EOF`;

function run(cwd, cmd, cliArgs, env = {}) {
  return spawnSync(cmd, cliArgs, {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell", KIT_ROOT: cwd, NIGHT_VORFLUG_CMD: VORFLUG_OK, ...env },
  });
}

function board(cwd, ...cliArgs) {
  const res = run(cwd, process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs]);
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/**
 * Ein Fixture-Projekt mit lokalem Tracker.
 *
 * `buildChecks` ist Parameter, weil genau daran der Salvage haengt: Gruene Checks
 * fuehren in den Salvage-Versuch (Weg 3), rote lassen ihn aus und der regulaere
 * Dirty-Fehlschlag greift (Weg 4).
 */
function setupProjekt(praefix, buildChecks = ["true"]) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({
    codeHost: "local", issueTracker: "local", buildChecks,
    local: { issuesDir: "issues" }, issueReview: { reviewers: NUR_CLAUDE },
  }, null, 2));
  // Bewusst OHNE `.claude/*`: Der Ergebnisstand muss untracked sichtbar bleiben, sonst
  // pruefte der Rest-Guard-Test die falsche Datei. Das Textprotokoll und die
  // Pruef-Zusammenfassung bleiben ignoriert — sonst hinterliesse jeder Fake, der
  // prueft, einen Rest, und die erwartete Restliste bekaeme einen Eintrag zu viel.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*.log\n.claude/checks-summary.json\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    assert.equal(run(dir, "git", a).status, 0);
  }
  return dir;
}

function mitProjekt(praefix, fn, buildChecks) {
  const dir = setupProjekt(praefix, buildChecks);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Legt eine Karte an; Labels stehen beim lokalen Tracker als CSV im Frontmatter. */
function karte(dir, titel, body, label = "") {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", body);
  if (label) {
    const pfad = join(dir, "issues", `${issue.id}.md`);
    const roh = readFileSync(pfad, "utf-8");
    writeFileSync(pfad, roh.replace(/^status:/m, `labels: ${label}\nstatus:`), "utf-8");
  }
  return String(issue.id);
}

/** Ein Arbeitspaket in Ready — die Quelle einer Implementierungsrunde. */
function readyIssue(dir, titel) {
  const id = karte(dir, titel, "## Abhaengigkeiten\nKeine.");
  board(dir, "issue", "move", id, "ready");
  return id;
}

const OHNE_MARKER = "## Kontext\n\nAutor-Modell: claude-opus-5\n\n## Abhaengigkeiten\n\nKeine.\n";
const PLAN_GEPRUEFT = "## Kontext\n\nAutor-Modell: claude-opus-5\nPlan-Review: fable (2026-09-08)\n\n"
  + "## Offene Fragen\n\n- Keine.\n\n## Verifizierung\n\n- night.mjs laeuft.\n";

/** Ein Backlog-Issue mit dem Review-Routing-Label. */
function reviewIssue(dir, titel) {
  return karte(dir, titel, OHNE_MARKER, "kit:nightreview");
}

/** Die Quelle eines `--stufe issue`-Laufs: ein geprueftes Plandokument mit Routing-Label. */
function erzeugeQuelle(dir, titel = "Ein Weg") {
  return karte(dir, `[Plan] ${titel}`, PLAN_GEPRUEFT, "kit:nightissues");
}

/** Die Ergebnisstand-Dateien im Fixture, nach Namen sortiert. */
function staende(dir) {
  return readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n))
    .sort();
}

/** Der eine Ergebnisstand des Laufs — mehr als einer waere hier ein Fehler. */
function stand(dir) {
  const dateien = staende(dir);
  assert.equal(dateien.length, 1, `genau eine Ergebnisstand-Datei erwartet, gefunden: ${dateien.join(", ")}`);
  return JSON.parse(readFileSync(join(dir, ".claude", dateien[0]), "utf-8"));
}

/** Die Einheit zu einer Karte — der Zugriff ueber die ID, nicht ueber die Position. */
function einheit(s, id) {
  const treffer = s.einheiten.find((e) => String(e.id) === String(id));
  assert.ok(treffer, `keine Einheit fuer Issue #${id} im Ergebnisstand: ${JSON.stringify(s.einheiten)}`);
  return treffer;
}

/**
 * Der Grund an der Einheit, auf die der Lauf verweist — samt der beiden Zusicherungen,
 * die jeder Abbruchweg-Test braucht.
 *
 * `fehlerEinheit` mitzupruefen ist kein Beiwerk: Ein Grund, der irgendwo an einer
 * Einheit haengt, ohne dass der Lauf auf sie zeigt, ist morgens nicht auffindbar — und
 * das Sicherheitsnetz zaehlt ihn ausdruecklich nicht als vorhandenen Grund.
 */
function grundDerKarte(s, id) {
  assert.equal(String(s.fehlerEinheit), String(id), `der Lauf verweist nicht auf Einheit #${id}`);
  const grund = einheit(s, id).grund;
  assert.ok(typeof grund === "string" && grund.length > 0, `der Grund fehlt an Einheit #${id}`);
  assert.notEqual(grund, ERSATZ_GRUND, "hier hat das Sicherheitsnetz gerettet — der Abbruchweg selbst schweigt");
  assert.doesNotMatch(grund, /Uebergabe-Anker/, "der Grund kam ueber das Netz statt ueber den Uebergabe-Anker");
  return grund;
}

// --- Session-Fakes ---

const BOARD_IM_FAKE = '"$KIT_ROOT/.claude/kit/board.mjs"';
const NACH_IN_REVIEW = `node ${BOARD_IM_FAKE} issue move "$NIGHT_ISSUE_ID" in_review > /dev/null`;
// Gezielt stagen statt `git add -A`: Die Board-Dateien und der Ergebnisstand sollen
// untracked bleiben, so wie sie es im echten Projekt sind.
const ARBEIT_UND_COMMIT = 'echo arbeit > "work-$NIGHT_ISSUE_ID.txt" && git add "work-$NIGHT_ISSUE_ID.txt"'
  + ' && git commit -q -m "arbeit (Issue #$NIGHT_ISSUE_ID)"';
const SUMMARY_GRUEN = `printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[]}'`
  + " > .claude/checks-summary.json";

/**
 * Die Fake-Session eines Erzeugungslaufs — sie unterscheidet die beiden Phasen am Auftrag.
 *
 * `/issues #Quelle` legt ein Arbeitspaket an (Phase 1), `/issue-review #Dokument`
 * fuehrt aus, was `pruefTeil` vorgibt (Phase 2).
 */
function erzeugeFake(erzeugeTeil, pruefTeil) {
  return `case "$NIGHT_PROMPT" in
  /issue-review*) ${pruefTeil} ;;
  *) ${erzeugeTeil} ;;
esac`;
}

const PAKET_ANLEGEN = `node ${BOARD_IM_FAKE} issue create --title "Paket A" `
  + `--body "## Kontext\n\nPlan: Issue #$NIGHT_ISSUE_ID\n" > /dev/null`;

/** Die Kartennummer des erzeugten Dokuments — sie unterscheidet sich von der Quelle. */
function dokumentId(dir) {
  const dok = board(dir, "issue", "list").find((i) => !String(i.title).startsWith("[Plan]"));
  assert.ok(dok, "die Erzeugungs-Session hat kein Dokument angelegt");
  return String(dok.id);
}

// --- Weg 1: der Rest-Guard nach erfolgreicher Runde ---

test("[night-4] [night-11] der Rest-Guard hinterlegt seinen Protokollsatz und die liegengebliebene Datei", NUR_POSIX, () => {
  mitProjekt("night-grund-restguard-", (dir) => {
    const id = readyIssue(dir, "Runde mit Resten");
    const fake = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW, "echo rest > rest.txt"].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.notEqual(res.status, 0, `der Rest-Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.abschluss, "harterStopp");
    assert.equal(s.fehlerklasse, "harterStopp");
    const grund = grundDerKarte(s, id);
    assert.match(grund, /unkommittete Reste hinterlassen/, `der Protokollsatz fehlt: ${grund}`);
    // Der Kern des Pakets: Ohne den Dateinamen bliebe morgens genau die Frage offen,
    // wegen der man die Datei ueberhaupt oeffnet.
    assert.match(grund, /rest\.txt/, `die liegengebliebene Datei fehlt: ${grund}`);
  });
});

test("[night-11] ab dem elften Rest nennt der Grund die Anzahl und die ersten zehn", NUR_POSIX, () => {
  mitProjekt("night-grund-restguard-viele-", (dir) => {
    const id = readyIssue(dir, "Runde mit vielen Resten");
    // Zwoelf Reste mit sortierbaren Namen: `git status --porcelain` gibt sie
    // alphabetisch aus, die Erwartung an die Kuerzung ist damit eindeutig.
    const viele = "for i in 01 02 03 04 05 06 07 08 09 10 11 12; do echo rest > \"rest-$i.txt\"; done";
    const fake = [SUMMARY_GRUEN, ARBEIT_UND_COMMIT, NACH_IN_REVIEW, viele].join("\n");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"], { NIGHT_CLAUDE_CMD: fake });
    assert.notEqual(res.status, 0, `der Rest-Guard haette anschlagen muessen:\n${res.stdout}`);

    const grund = grundDerKarte(stand(dir), id);
    assert.match(grund, /12 unkommittierte Reste, die ersten zehn:/, `die Anzahl fehlt: ${grund}`);
    assert.match(grund, /rest-01\.txt/, `der erste Rest fehlt: ${grund}`);
    assert.match(grund, /rest-10\.txt/, `der zehnte Rest fehlt: ${grund}`);
    // Die Kuerzung muss wirklich kuerzen — sonst waere die Anzahl nur Zierde.
    assert.doesNotMatch(grund, /rest-11\.txt/, `der elfte Rest haette wegfallen muessen: ${grund}`);
    assert.doesNotMatch(grund, /rest-12\.txt/, `der zwoelfte Rest haette wegfallen muessen: ${grund}`);
  });
});

// --- Weg 2: der Infrastruktur-Guard der Implementierungsrunde ---

test("[night-11] der Infrastruktur-Guard der Implementierungsrunde nennt exitInfo und die CLI-Meldung", NUR_POSIX, () => {
  mitProjekt("night-grund-infra-", (dir) => {
    const id = readyIssue(dir, "Session-Start scheitert");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: "echo 'CLI kaputt: Auth abgelaufen' >&2; exit 1" });
    assert.notEqual(res.status, 0, `der Infrastruktur-Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.fehlerklasse, "umgebung", "mit dem Issue ist nichts falsch — die Umgebung ist es");
    const grund = grundDerKarte(s, id);
    assert.match(grund, /INFRASTRUKTUR-FEHLSCHLAG/, `die Kopfzeile fehlt: ${grund}`);
    assert.match(grund, /Exit 1/, `exitInfo fehlt: ${grund}`);
    assert.match(grund, /CLI-Meldung: .*CLI kaputt: Auth abgelaufen/, `die CLI-Meldung fehlt: ${grund}`);
  });
});

// --- Weg 3: der gescheiterte Salvage ---

test("[night-11] ein gescheiterter Salvage hinterlegt seinen Satz samt Resten", NUR_POSIX, () => {
  // Gruene buildChecks fuehren in den Salvage-Versuch; die Salvage-Session hinterlaesst
  // wieder nur Dreck, also endet sie als `gescheitert`.
  mitProjekt("night-grund-salvage-", (dir) => {
    const id = readyIssue(dir, "Runde ohne Board-Ergebnis");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: "echo dreck > uebrig.txt" });
    assert.notEqual(res.status, 0, `der Salvage haette scheitern muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.fehlerklasse, "harterStopp");
    const grund = grundDerKarte(s, id);
    assert.match(grund, /SALVAGE-VERSUCH gescheitert/, `der Salvage-Satz fehlt: ${grund}`);
    assert.match(grund, /uebrig\.txt/, `die liegengebliebene Datei fehlt: ${grund}`);
  });
});

// --- Weg 4: der regulaere Dirty-Fehlschlag ---

test("[night-11] ohne moeglichen Salvage traegt der Dirty-Fehlschlag seine Fehlschlag-Zeile", NUR_POSIX, () => {
  // Rote buildChecks: Der Salvage ist nicht moeglich, die regulaere Fehlschlag-Meldung
  // des Aufrufers gilt — ein anderer Weg mit einem anderen Text.
  mitProjekt("night-grund-dirty-", (dir) => {
    const id = readyIssue(dir, "Runde ohne Board-Ergebnis");
    const res = run(dir, process.execPath, [NIGHT, "--label", "none"],
      { NIGHT_CLAUDE_CMD: "echo dreck > uebrig.txt" });
    assert.notEqual(res.status, 0, `der Dirty-Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.fehlerklasse, "harterStopp");
    const grund = grundDerKarte(s, id);
    assert.match(grund, /nicht in In review UND Working Tree dirty/, `die Fehlschlag-Zeile fehlt: ${grund}`);
    assert.doesNotMatch(grund, /SALVAGE/, "ohne moeglichen Salvage darf sein Text nicht auftauchen");
    assert.match(grund, /uebrig\.txt/, `die liegengebliebene Datei fehlt: ${grund}`);
  }, ["false"]);
});

// --- Die Testmatrix: Wege 5 und 6 in allen drei Sessionarten ---

test("[night-11] Review-Session, Infrastruktur-Stopp: der Grund nennt die Kopfzeile, nicht die CLI-Meldung", NUR_POSIX, () => {
  mitProjekt("night-grund-review-infra-", (dir) => {
    const id = reviewIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: "echo laut >&2; exit 1" });
    assert.notEqual(res.status, 0, `der Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.fehlerklasse, "umgebung");
    const grund = grundDerKarte(s, id);
    assert.match(grund, /INFRASTRUKTUR-FEHLSCHLAG/, `die Kopfzeile fehlt: ${grund}`);
    assert.match(grund, /Exit 1/, `exitInfo fehlt: ${grund}`);
    // Anders als Weg 2: `reviewRundeGestoppt` schreibt die CLI-Meldung heute nicht ins
    // Protokoll, und dieses Paket reicht weiter, was das Protokoll sagt.
    assert.doesNotMatch(grund, /CLI-Meldung/, `hier steht mehr als im Protokoll: ${grund}`);
  });
});

test("[night-11] Review-Session, veraenderter Working Tree: der Grund nennt Sessionart und Rest", NUR_POSIX, () => {
  mitProjekt("night-grund-review-dirty-", (dir) => {
    const id = reviewIssue(dir, "Ein Issue");
    const res = run(dir, process.execPath, [NIGHT, "--review"], { NIGHT_CLAUDE_CMD: "echo dreck > uebrig.txt" });
    assert.notEqual(res.status, 0, `der Guard haette anschlagen muessen:\n${res.stdout}`);

    const grund = grundDerKarte(stand(dir), id);
    assert.match(grund, /die Review-Session zu Issue #/, `die Sessionart fehlt: ${grund}`);
    assert.match(grund, /uebrig\.txt/, `die liegengebliebene Datei fehlt: ${grund}`);
  });
});

test("[night-11] Erzeugungs-Session, Infrastruktur-Stopp: der Grund haengt an der Quelle", NUR_POSIX, () => {
  mitProjekt("night-grund-erzeuge-infra-", (dir) => {
    const src = erzeugeQuelle(dir);
    const res = run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", "issue"],
      { NIGHT_CLAUDE_CMD: erzeugeFake("exit 1", "true") });
    assert.notEqual(res.status, 0, `der Guard haette anschlagen muessen:\n${res.stdout}`);

    const s = stand(dir);
    assert.equal(s.fehlerklasse, "umgebung");
    const grund = grundDerKarte(s, src);
    assert.match(grund, /INFRASTRUKTUR-FEHLSCHLAG/, `die Kopfzeile fehlt: ${grund}`);
    assert.match(grund, new RegExp(`Issue #${src}`), `die Quelle fehlt im Grund: ${grund}`);
  });
});

test("[night-11] Erzeugungs-Session, veraenderter Working Tree: der Grund haengt an der Quelle", NUR_POSIX, () => {
  mitProjekt("night-grund-erzeuge-dirty-", (dir) => {
    const src = erzeugeQuelle(dir);
    const res = run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", "issue"],
      { NIGHT_CLAUDE_CMD: erzeugeFake("echo dreck > uebrig.txt", "true") });
    assert.notEqual(res.status, 0, `der Guard haette anschlagen muessen:\n${res.stdout}`);

    const grund = grundDerKarte(stand(dir), src);
    assert.match(grund, /die Erzeugungs-Session zu Issue #/, `die Sessionart fehlt: ${grund}`);
    assert.match(grund, /uebrig\.txt/, `die liegengebliebene Datei fehlt: ${grund}`);
  });
});

test("[night-11] Pruef-Session, Infrastruktur-Stopp: fehlerEinheit zeigt auf die Quelle, der Grund nennt das Dokument", NUR_POSIX, () => {
  // Der eine Fall, in dem betroffene Karte und benanntes Dokument auseinanderfallen:
  // Die Einheit ist die Quelle, geprueft wurde ein Dokument mit eigener Nummer.
  mitProjekt("night-grund-pruef-infra-", (dir) => {
    const src = erzeugeQuelle(dir);
    const res = run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", "issue"],
      { NIGHT_CLAUDE_CMD: erzeugeFake(PAKET_ANLEGEN, "exit 1") });
    assert.notEqual(res.status, 0, `der Guard haette anschlagen muessen:\n${res.stdout}`);

    const dok = dokumentId(dir);
    assert.notEqual(dok, src, "Dokument und Quelle muessen sich unterscheiden, sonst misst der Test nichts");
    const grund = grundDerKarte(stand(dir), src);
    assert.match(grund, /INFRASTRUKTUR-FEHLSCHLAG/, `die Kopfzeile fehlt: ${grund}`);
    assert.match(grund, new RegExp(`Issue #${dok}`), `das gepruefte Dokument fehlt im Grund: ${grund}`);
  });
});

test("[night-11] Pruef-Session, veraenderter Working Tree: fehlerEinheit zeigt auf die Quelle, der Grund nennt das Dokument", NUR_POSIX, () => {
  mitProjekt("night-grund-pruef-dirty-", (dir) => {
    const src = erzeugeQuelle(dir);
    const res = run(dir, process.execPath, [NIGHT, "--erzeuge", "--stufe", "issue"],
      { NIGHT_CLAUDE_CMD: erzeugeFake(PAKET_ANLEGEN, "echo dreck > uebrig.txt") });
    assert.notEqual(res.status, 0, `der Guard haette anschlagen muessen:\n${res.stdout}`);

    const dok = dokumentId(dir);
    assert.notEqual(dok, src, "Dokument und Quelle muessen sich unterscheiden, sonst misst der Test nichts");
    const grund = grundDerKarte(stand(dir), src);
    assert.match(grund, new RegExp(`die Pruef-Session zu Issue #${dok}`), `das gepruefte Dokument fehlt im Grund: ${grund}`);
    assert.match(grund, /uebrig\.txt/, `die liegengebliebene Datei fehlt: ${grund}`);
  });
});

// --- Das Sicherheitsnetz in seinen drei Lagen ---
//
// Reine Funktion mit explizitem Laufzustand: `laufAbschliessen` ist nicht exportiert,
// und ein kompletter Lauf je Lage waere drei Nachtlaeufe fuer eine Fallunterscheidung.

test("[night-11] Sicherheitsnetz (a): ohne Grund und ohne gemerkten Stoppgrund entsteht der Ersatztext", () => {
  const lauf = { einheiten: [{ id: "1", ausgang: "harterStopp" }] };
  assert.equal(sicherheitsnetzGrund(lauf, ""), ERSATZ_GRUND);
  assert.equal(sicherheitsnetzGrund(lauf, null), ERSATZ_GRUND);
});

test("[night-11] Sicherheitsnetz (b): ohne Grund, aber mit gemerktem Stoppgrund kommt dessen Text plus der Ankervermerk", () => {
  const lauf = { einheiten: [{ id: "1", ausgang: "harterStopp" }] };
  const netz = sicherheitsnetzGrund(lauf, "HARTER STOPP: irgendetwas ist passiert.");
  assert.match(netz, /HARTER STOPP: irgendetwas ist passiert\./, "der gemerkte Text fehlt");
  assert.ok(netz.includes(ANKER_FEHLT), `der Vermerk zum fehlenden Uebergabe-Anker fehlt: ${netz}`);
  assert.notEqual(netz, ERSATZ_GRUND, "mit gemerktem Grund darf der reine Ersatztext nicht entstehen");
});

test("[night-11] Sicherheitsnetz (c): der Grund einer FREMDEN Einheit unterdrueckt das Netz nicht", () => {
  // Eine begruendet uebersprungene Einheit hat mit dem spaeteren Stopp nichts zu tun.
  // Zaehlte ihr Grund, bliebe der eigentliche Stopp fuer immer unbegruendet — und die
  // Datei saehe vollstaendig aus.
  const lauf = {
    einheiten: [
      { id: "1", ausgang: "uebersprungen", grund: "traegt bereits einen Issue-Review-Marker" },
      { id: "2", ausgang: "harterStopp" },
    ],
  };
  assert.equal(sicherheitsnetzGrund(lauf, ""), ERSATZ_GRUND);
  // Auch der Verweis auf eine Einheit OHNE Grund rettet nicht.
  assert.equal(sicherheitsnetzGrund({ ...lauf, fehlerEinheit: "2" }, ""), ERSATZ_GRUND);
});

test("[night-11] das Sicherheitsnetz schweigt, wo ein Grund vorliegt", () => {
  const amLauf = { einheiten: [], fehlerText: "git status schlug fehl" };
  assert.equal(sicherheitsnetzGrund(amLauf, "etwas anderes"), null, "ein Lauf-Fehlertext genuegt");

  const anDerEinheit = { einheiten: [{ id: "7", grund: "der echte Grund" }], fehlerEinheit: "7" };
  assert.equal(sicherheitsnetzGrund(anDerEinheit, "etwas anderes"), null, "die referenzierte Einheit genuegt");
});
