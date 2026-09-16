// Fixture fuer die Tests der Nacht-Kette (Plan #638; Issue #643).
//
// Wie in den uebrigen night-Tests laeuft das ECHTE kit/night.mjs gegen ein Temp-Repo
// mit lokalem Tracker (cwd + KIT_ROOT), die Sessions ueber NIGHT_CLAUDE_CMD, der
// Vorflug ueber NIGHT_VORFLUG_CMD. Neu ist der Fake, der an NIGHT_KETTE_STUFE
// verzweigt: Je Stufe tut er, was die echte Session am Board hinterliesse — er legt
// den Plan an, repariert die Form, zeichnet mit kit:klaeren.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const NIGHT = join(repoRoot, "kit", "night.mjs");

export const NUR_POSIX = process.platform === "win32"
  ? { skip: "Windows: Der Session-Fake laeuft ueber `sh -c`, das night.mjs dort nicht findet. Siehe Issue #199." }
  : {};

/** Der Vorflug meldet: Tracker erreichbar, keine Kommando-Reviewer zu pruefen. */
export const VORFLUG_OK = "cat <<'EOF'\n<<<VORFLUG\n{\"reviewers\":[],\"tracker\":{\"erreichbar\":true,\"geprueft\":\"issue list\"}}\nVORFLUG>>>\nEOF";

export function run(cwd, cliArgs, env = {}) {
  return spawnSync(process.execPath, [NIGHT, ...cliArgs], {
    cwd, encoding: "utf-8",
    env: { ...process.env, KIT_ROOT: cwd, NIGHT_VORFLUG_CMD: VORFLUG_OK, NIGHT_KILL_GRACE_MS: "200", ...env },
  });
}

export function board(cwd, ...cliArgs) {
  const res = spawnSync(process.execPath, [join(cwd, ".claude", "kit", "board.mjs"), ...cliArgs], {
    cwd, encoding: "utf-8", env: { ...process.env, KIT_AGENT_MODEL: "fixture-modell" },
  });
  assert.equal(res.status, 0, `board.mjs ${cliArgs.join(" ")} schlug fehl: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const CONFIG = {
  codeHost: "local", issueTracker: "local", buildChecks: ["true"],
  local: { issuesDir: "issues" },
  issueReview: { reviewers: [{ name: "opus", kind: "claude", model: "claude-opus-5" }] },
};

/**
 * Ein Repo mit Commit, lokalem Tracker, Kit-Kopie und `night.kette`-Block. Alles, was
 * der Runner braucht, ist committet — der Vorflug prueft den Arbeitsbaum.
 */
export function setupProjekt(kette = {}, praefix = "night-kette-") {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  mkdirSync(join(dir, "issues"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({ ...CONFIG, night: { kette } }, null, 2));
  // helfer/ traegt Fake-Dateien und Protokoll der Tests — ignoriert, damit der Vorflug
  // des Runners den Arbeitsbaum weiter als sauber sieht.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*\nhelfer/\n");
  writeFileSync(join(dir, "README.md"), "fixture\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  }
  return dir;
}

export function mitProjekt(fn, kette = {}, praefix) {
  const dir = setupProjekt(kette, praefix);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FACHPLAN_BODY = "## Ziel\n\nEin Anliegen.\n\nAutor-Modell: claude-opus-5\n\n## Fachliche Akzeptanzkriterien\n\n- Eines.\n\n## Nicht-Ziele\n\n- Keines.\n\n## Offene Fragen an den PO\n\nKeine offenen Fragen.\n";

/** Ein [Fachlich]-Issue im Backlog, wahlweise mit Label. Liefert die Nummer (lokal: 0001 …). */
export function fachplan(dir, titel = "[Fachlich] Ein Anliegen", label = "kit:night") {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", FACHPLAN_BODY);
  if (label) board(dir, "issue", "label", "add", String(issue.id), label);
  return String(issue.id);
}

/**
 * Der Body eines Plans, wie ihn /techplan anlegte. `__F__` ersetzt der Fake durch die
 * Nummer des Fachplans (NIGHT_ISSUE_ID). `offeneFragen` ist der Inhalt des Abschnitts;
 * `ohneVerifizierung` laesst den letzten Pflichtabschnitt weg (rote Formpruefung).
 */
export function planBody({ offeneFragen = "- Keine.", ohneVerifizierung = false } = {}) {
  const teile = [
    "Plan-Modell: fixture-modell",
    "Fachliche Quelle: Issue #__F__",
    "",
    "## Ziel", "", "Ein Plan aus dem Fake.", "",
    "## Betroffene Bereiche", "", "- kit/night.mjs", "",
    "## Architektonische Entscheidungen", "",
    "- A1 — Ein Weg, weil er der kuerzeste ist.",
    "- E1: Wie heisst das Feld? Gewaehlt: kurz. Verworfen: lang. Grund: Bestand. Rueckbau: trivial.", "",
    "## Geplante Änderungen", "", "- kit/night.mjs: eine Funktion.", "",
    "## Offene Fragen", "", offeneFragen, "",
  ];
  if (!ohneVerifizierung) teile.push("## Verifizierung", "", "- node --test", "");
  return teile.join("\n");
}

/**
 * Der Session-Fake als POSIX-Shell. `stufen` bildet NIGHT_KETTE_STUFE auf Shell-Zeilen
 * ab; was nicht genannt ist, tut nichts. Jede Session protokolliert Stufe, cwd und
 * KIT_AGENT_MODEL in `$KETTE_LOG` und liefert ein result-Ereignis mit `$KETTE_KOSTEN`.
 */
export function fake(stufen = {}) {
  const faelle = Object.entries(stufen).map(([stufe, zeilen]) => `  ${stufe}) ${zeilen} ;;`).join("\n");
  return [
    String.raw`printf "%s\t%s\t%s\n" "$NIGHT_KETTE_STUFE" "$(pwd -P)" "$KIT_AGENT_MODEL" >> "$KETTE_LOG"`,
    'case "$NIGHT_KETTE_STUFE" in',
    faelle,
    "  *) : ;;",
    "esac",
    'if [ -z "$KETTE_OHNE_RESULT" ]; then',
    `  echo '{"type":"result","total_cost_usd":'"\${KETTE_KOSTEN:-1}"',"duration_api_ms":5,"num_turns":1,"usage":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":30,"cache_read_input_tokens":40},"result":"'"\${KETTE_RESULT_TEXT:-}"'"}'`,
    "fi",
  ].join("\n");
}

/** Die Fake-Zeile der Stufe plan: legt den Plan aus `$KETTE_PLAN_BODY` mit der Herkunftszeile an. */
export const PLAN_ANLEGEN = 'sed "s/__F__/$NIGHT_ISSUE_ID/" "$KETTE_PLAN_BODY" > "$KETTE_LOG.plan.md"; node .claude/kit/board.mjs issue create --title "[Plan] Ein Weg" --body-file "$KETTE_LOG.plan.md" >/dev/null';

/** Die Fake-Zeile der Stufe form: schreibt den Body aus `$KETTE_PLAN_FIX` an das Dokument aus dem Prompt. */
export const FORM_REPARIEREN = String.raw`id=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s/^Das Dokument #\([0-9]*\).*/\1/p"); sed "s/__F__/$NIGHT_ISSUE_ID/" "$KETTE_PLAN_FIX" > "$KETTE_LOG.fix.md"; node .claude/kit/board.mjs issue update "$id" --body-file "$KETTE_LOG.fix.md" >/dev/null`;

/** Die Fake-Zeile der Stufe review: zeichnet das Dokument aus dem Prompt mit kit:klaeren und einem Kommentar. */
export const REVIEW_HALT = String.raw`id=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s|^/issue-review #\([0-9]*\).*|\1|p"); node .claude/kit/board.mjs issue comment "$id" --text "Einarbeitung: Frage der Stopp-Klasse — ist das eine Schnittstelle nach aussen?" >/dev/null; node .claude/kit/board.mjs issue label add "$id" kit:klaeren >/dev/null`;

/** Der Einarbeitungs-Kommentar, den der Review-Fake an den Plan haengt — ein Fund uebernommen, einer abgelehnt (#645). */
export const EINARBEITUNG_ZEILE_ABGELEHNT = "- Fund 2 (opus, WICHTIG): abgelehnt — der Bestand deckt den Fall schon.";
const EINARBEITUNG_KOMMENTAR = `## Einarbeitung, Runde 1\n\n- Fund 1 (opus, HINWEIS): übernommen.\n${EINARBEITUNG_ZEILE_ABGELEHNT}\n`;

/** Die Fake-Zeile der Stufe review: setzt den Marker im Kopf des Plans und haengt den Einarbeitungs-Kommentar an. */
export const REVIEW_MARKER = String.raw`id=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s|^/issue-review #\([0-9]*\).*|\1|p"); node .claude/kit/board.mjs issue get "$id" | node -e 'const i=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(i.body.replace("Plan-Modell: fixture-modell","Plan-Modell: fixture-modell\nPlan-Review: opus (2026-09-14, Nachtlauf)"))' > "$KETTE_LOG.review.md"; node .claude/kit/board.mjs issue update "$id" --body-file "$KETTE_LOG.review.md" >/dev/null; printf "%s" "$KETTE_EINARBEITUNG" > "$KETTE_LOG.einarbeitung.md"; node .claude/kit/board.mjs issue comment "$id" --text-file "$KETTE_LOG.einarbeitung.md" >/dev/null`;

/** Der Ergebnisstand des juengsten Laufs im Fixture. */
export function stand(dir) {
  const dateien = readdirSync(join(dir, ".claude"))
    .filter((n) => /^night-run-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(n))
    .sort();
  assert.ok(dateien.length > 0, "kein Ergebnisstand geschrieben");
  return JSON.parse(readFileSync(join(dir, ".claude", dateien.at(-1)), "utf-8"));
}

/** Das Fake-Protokoll: je Session eine Zeile `stufe<TAB>cwd<TAB>modell`. */
export function sessions(logPfad) {
  try {
    return readFileSync(logPfad, "utf-8").trim().split("\n").filter(Boolean).map((z) => {
      const [stufe, cwd, modell] = z.split("\t");
      return { stufe, cwd, modell };
    });
  } catch {
    return [];
  }
}

/** Umgebung fuer einen Kettenlauf: Fake, Plan-Body-Dateien, Protokoll. */
export function umgebung(dir, { stufen = {}, plan = planBody(), fix = planBody(), kosten, ohneResult = false } = {}) {
  const helfer = join(dir, "helfer");
  mkdirSync(helfer, { recursive: true });
  const log = join(helfer, "kette-sessions.log");
  writeFileSync(join(helfer, "plan-body.md"), plan);
  writeFileSync(join(helfer, "plan-fix.md"), fix);
  return {
    NIGHT_CLAUDE_CMD: fake(stufen),
    KETTE_LOG: log,
    KETTE_PLAN_BODY: join(helfer, "plan-body.md"),
    KETTE_PLAN_FIX: join(helfer, "plan-fix.md"),
    KETTE_EINARBEITUNG: EINARBEITUNG_KOMMENTAR,
    KETTE_PAKET_ENTSCHEIDUNG: PAKET_ENTSCHEIDUNG,
    ...(kosten !== undefined ? { KETTE_KOSTEN: String(kosten) } : {}),
    ...(ohneResult ? { KETTE_OHNE_RESULT: "1" } : {}),
    logPfad: log,
  };
}

/** Die Fake-Zeile der Stufe pakete: zwei Pakete mit `Plan: Issue #M` und eine Karte ohne Herkunftszeile. */
export const PAKET_ENTSCHEIDUNG = "Entscheidung: Wie heisst die Datei? Gewählt: kurz. Verworfen: lang. Grund: Bestand. Rückbau: trivial.";
export const PAKETE_ANLEGEN = String.raw`m=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s|^/issues #\([0-9]*\).*|\1|p"); for n in 1 2; do printf "## Kontext\n\nPlan: Issue #%s\nFachliche Quelle: Issue #%s\n\n%s\n\n## Aufgabe\n\nPaket %s.\n\n## Akzeptanzkriterium\n\n- node --test\n\n## Abhängigkeiten\n\nKeine.\n" "$m" "$NIGHT_ISSUE_ID" "$([ "$n" = 1 ] && printf "%s" "$KETTE_PAKET_ENTSCHEIDUNG" || printf "Keine Entscheidung.")" "$n" > "$KETTE_LOG.paket$n.md"; node .claude/kit/board.mjs issue create --title "Paket $n" --body-file "$KETTE_LOG.paket$n.md" >/dev/null; done; printf "## Kontext\n\nOhne Herkunft.\n\n## Aufgabe\n\nx\n\n## Akzeptanzkriterium\n\n- y\n\n## Abhängigkeiten\n\nKeine.\n" > "$KETTE_LOG.fremd.md"; node .claude/kit/board.mjs issue create --title "Fremde Karte" --body-file "$KETTE_LOG.fremd.md" >/dev/null`;

/** Die Fake-Zeile der Stufe pakete: ein Paket ohne den Abschnitt Abhaengigkeiten (rote Form). */
export const PAKET_OHNE_ABHAENGIGKEITEN = String.raw`m=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s|^/issues #\([0-9]*\).*|\1|p"); printf "## Kontext\n\nPlan: Issue #%s\n\n## Aufgabe\n\nPaket.\n\n## Akzeptanzkriterium\n\n- node --test\n" "$m" > "$KETTE_LOG.paket.md"; node .claude/kit/board.mjs issue create --title "Paket ohne Abhaengigkeiten" --body-file "$KETTE_LOG.paket.md" >/dev/null`;

/** Die Fake-Zeile der Stufe form fuer ein Paket: haengt den Abschnitt Abhaengigkeiten an. */
export const PAKET_REPARIEREN = String.raw`id=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s/^Das Dokument #\([0-9]*\).*/\1/p"); node .claude/kit/board.mjs issue get "$id" | node -e 'const i=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(i.body.trimEnd()+"\n\n## Abhängigkeiten\n\nKeine.\n")' > "$KETTE_LOG.paketfix.md"; node .claude/kit/board.mjs issue update "$id" --body-file "$KETTE_LOG.paketfix.md" >/dev/null`;

/** Die Fake-Zeile der Stufe pakete: kein Paket, dafuer der Halt-Kommentar von /issues am Plan. */
export const PAKETE_HALT = String.raw`m=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s|^/issues #\([0-9]*\).*|\1|p"); node .claude/kit/board.mjs issue comment "$m" --text "Kein Eingang für /issues: offene Stopp-Frage — Ist der Endpunkt ein Vertrag nach aussen?" >/dev/null`;

/** Die Fake-Zeile der Stufe abdeckung, die verbotenerweise am Fachplan schreibt. */
export const ABDECKUNG_SCHREIBT = String.raw`node .claude/kit/board.mjs issue comment "$NIGHT_ISSUE_ID" --text "Abdeckung als Kommentar — verboten" >/dev/null`;

/** Ein Vorflug ohne Befund-Block: die Vorflug-Session gilt als nicht auswertbar, der Lauf stoppt hart. */
export const VORFLUG_KAPUTT = "echo 'kein Befund'";

/**
 * Ersetzt die Kit-Kopie von board.mjs im Fixture durch einen Umweg ueber das echte
 * board.mjs, der `issue comment <id>` abweist, wenn `BOARD_FAKE_ABLEHNEN` die Nummer
 * nennt — der Tracker ist dann fuer genau diesen Kommentar "nicht erreichbar". Nennt
 * `BOARD_FAKE_SCHLUCKEN` die Nummer, nimmt der Fake den Kommentar an (Exit 0, JSON auf
 * stdout) und speichert ihn nicht — die Karte liegt danach ohne ihn vor, wie am
 * 2026-09-14 an Plan #577 (Issue #653). Der Umweg wird committet, damit der Vorflug den
 * Arbeitsbaum weiter als sauber sieht; er spiegelt sich mit `.claude/` in den Worktree
 * jeder Kette.
 */
export function boardFakeInstallieren(dir) {
  const echt = join(repoRoot, "kit", "board.mjs");
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), [
    'import { spawnSync } from "node:child_process";',
    "const args = process.argv.slice(2);",
    'const kommentarAn = (nummer) => nummer && args[0] === "issue" && args[1] === "comment" && String(args[2]) === nummer;',
    "if (kommentarAn(process.env.BOARD_FAKE_ABLEHNEN)) {",
    String.raw`  process.stderr.write("Fehler: Tracker nicht erreichbar (Board-Fake)\n");`,
    "  process.exit(1);",
    "}",
    "if (kommentarAn(process.env.BOARD_FAKE_SCHLUCKEN)) {",
    String.raw`  process.stdout.write(JSON.stringify({ ok: true, id: args[2] }) + "\n");`,
    "  process.exit(0);",
    "}",
    `const res = spawnSync(process.execPath, [${JSON.stringify(echt)}, ...args], { stdio: "inherit" });`,
    "process.exit(res.status ?? 1);",
    "",
  ].join("\n"));
  for (const a of [["add", "-A"], ["commit", "-q", "-m", "board-fake"]]) {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  }
}
