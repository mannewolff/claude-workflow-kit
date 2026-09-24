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
// Die Konstanten aus dem Runner selbst, nicht abgeschrieben: Der Fake der
// Umsetzungs-Session soll genau das Label setzen und genau den Satz schreiben, an
// denen der Runner den Halt erkennt (wie in night-angehalten.test.mjs).
import { HALT_FOLGESATZ, KLAEREN_LABEL, REVIEW_FERTIG_LABEL } from "../../kit/night.mjs";

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
 *
 * `configZusatz` mischt weitere Felder in die Config (etwa `issueReview`), die schon
 * beim ersten Commit dastehen muessen: Die Umsetzungsstufe prueft die Hauptkopie auf
 * einen sauberen Arbeitsbaum, eine nachtraeglich geaenderte Config waere ein Rest.
 */
export function setupProjekt(kette = {}, praefix = "night-kette-", configZusatz = {}) {
  const dir = mkdtempSync(join(tmpdir(), praefix));
  mkdirSync(join(dir, ".claude", "kit"), { recursive: true });
  mkdirSync(join(dir, "issues"), { recursive: true });
  copyFileSync(join(repoRoot, "kit", "board.mjs"), join(dir, ".claude", "kit", "board.mjs"));
  // Der Rueckweg der Befunde ruft `befunde.mjs vorschlag` als Kindprozess (Issue #804);
  // ohne die Kopie waere jeder Ketten-Test blind fuer den Vorschlag am Board.
  copyFileSync(join(repoRoot, "kit", "befunde.mjs"), join(dir, ".claude", "kit", "befunde.mjs"));
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify({ ...CONFIG, ...configZusatz, night: { kette } }, null, 2));
  // helfer/ traegt Fake-Dateien und Protokoll der Tests — ignoriert, damit der Vorflug
  // des Runners den Arbeitsbaum weiter als sauber sieht.
  //
  // issues/ und die Pruef-Zusammenfassung ebenso: Der lokale Tracker legt seine Karten
  // im Repo ab, und `checks.mjs` schreibt seine Zusammenfassung unter `.claude/`. Beides
  // gehoert nicht zum Arbeitsstand — im Betrieb liegt das Board ausserhalb des Repos und
  // die Zusammenfassung im ignorierten `.claude/`. Ohne die beiden Zeilen saehe die
  // Umsetzungsstufe die Hauptkopie schon vor dem ersten Paket als unsauber.
  //
  // Der Umsetzungs-Lock (Issue #696), die Wegmarken (Issue #733), das
  // Bewegungsprotokoll (Issue #786) und das Befunde-Protokoll (Issue #803) stehen aus
  // demselben Grund hier: Im Betrieb deckt
  // sie der `.claude/*`-Block, den der Installer schreibt; das Fixture fuehrt die
  // `.claude`-Pfade einzeln, weil es seine Kit-Kopie committen muss. Fuer `gitReste()`
  // sind sie ohnehin ausgeschlossen — der Session-Fake der Umsetzung committet aber mit
  // einem rohen `git add -A`, das diese Ausschluesse nicht kennt.
  writeFileSync(join(dir, ".gitignore"), "*.log\n.claude/night-run-*\n.claude/checks-summary.json\n.claude/night-umsetzung.lock\n.claude/wegmarken.tsv\n.claude/bewegungen.tsv\n.claude/befunde.tsv\n.claude/befunde-vorschlaege.json\n.claude/befunde.md\n.claude/befunde.json\nissues/\nhelfer/\n");
  writeFileSync(join(dir, "README.md"), "fixture\n");
  for (const a of [["init", "-q"], ["config", "user.email", "t@example.invalid"],
                   ["config", "user.name", "T"], ["add", "-A"], ["commit", "-q", "-m", "setup"]]) {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  }
  return dir;
}

export function mitProjekt(fn, kette = {}, praefix, configZusatz) {
  const dir = setupProjekt(kette, praefix, configZusatz);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FACHPLAN_BODY = "## Ziel\n\nEin Anliegen.\n\nAutor-Modell: claude-opus-5\n\n## Fachliche Akzeptanzkriterien\n\n- Eines.\n\n## Nicht-Ziele\n\n- Keines.\n\n## Offene Fragen an den PO\n\nKeine offenen Fragen.\n";

/**
 * Ein [Fachlich]-Issue im Backlog, wahlweise mit Label. Liefert die Nummer (lokal: 0001 …).
 *
 * `review:fertig` haengt per Default mit dran: Die Kette nimmt seit Issue #718 nur
 * gepruefte Anforderungen auf, und ohne das Label liefe in keinem Ablauf-Test mehr eine
 * Kette an. `geprueft: false` ist der Weg fuer die Ablehnungsfaelle.
 */
export function fachplan(dir, titel = "[Fachlich] Ein Anliegen", label = "kit:night", geprueft = true) {
  const issue = board(dir, "issue", "create", "--title", titel, "--body", FACHPLAN_BODY);
  if (label) board(dir, "issue", "label", "add", String(issue.id), label);
  if (geprueft) board(dir, "issue", "label", "add", String(issue.id), REVIEW_FERTIG_LABEL);
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
 * Ein startbereites [Plan]-Dokument im Backlog, wie es der Mensch fuer einen
 * Plan-Auftrag kennzeichnet (Fachplan #883, Plan #890; Issue #895).
 *
 * `F` ist die Nummer der fachlichen Anforderung: Sie ersetzt `__F__` in der
 * Herkunftszeile des Bodys und muss als Karte am Board liegen, sonst lehnt
 * `planAusschluss` den Plan ab. Wie `fachplan` haengt `review:fertig` per Default mit
 * dran — ohne das Label liefe kein Plan-Auftrag an.
 */
export function planauftrag(dir, F, { titel = "[Plan] Ein fertiger Weg", label = "kit:night", geprueft = true, body } = {}) {
  const text = (body ?? planBody()).replaceAll("__F__", String(F));
  const issue = board(dir, "issue", "create", "--title", titel, "--body", text);
  if (label) board(dir, "issue", "label", "add", String(issue.id), label);
  if (geprueft) board(dir, "issue", "label", "add", String(issue.id), REVIEW_FERTIG_LABEL);
  return String(issue.id);
}

/**
 * Der Session-Fake als POSIX-Shell. `stufen` bildet die Stufe auf Shell-Zeilen ab; was
 * nicht genannt ist, tut nichts. Jede Session protokolliert Stufe, cwd und
 * KIT_AGENT_MODEL in `$KETTE_LOG` und liefert ein result-Ereignis mit `$KETTE_KOSTEN`.
 *
 * Die vier erzeugenden Stufen nennt der Runner in NIGHT_KETTE_STUFE. Die Sessions der
 * Stufe `umsetzung` bekommen sie NICHT gesetzt — sie sehen ein regulaeres Ready-Paket
 * und erfahren von der Variante nichts (Plan #691, E11). Der Fake benennt sie deshalb
 * selbst, damit `sessions()` auch sie ausweist; die Salvage-Session ist daneben an
 * NIGHT_SALVAGE erkennbar und bekommt einen eigenen Namen, sonst liefe sie in den
 * Zweig der Umsetzung.
 *
 * `stop_reason` und `is_error` kommen aus `$KETTE_STOP` und `$KETTE_IS_ERROR` und
 * stehen ROH im JSON — der Wert traegt seine Anfuehrungszeichen also selbst
 * (`KETTE_STOP='"end_turn"'`). Ohne die beiden bleibt es bei `null`, dem Stand vor
 * Issue #807. Eine Fake-Zeile darf sie setzen: Das `case` laeuft vor dem `echo` in
 * derselben Shell, und nur so bekommen zwei Sessions derselben Stufe (Korrekturrunden)
 * verschiedene Werte.
 */
export function fake(stufen = {}) {
  const faelle = Object.entries(stufen).map(([stufe, zeilen]) => `  ${stufe}) ${zeilen} ;;`).join("\n");
  return [
    'stufe="$NIGHT_KETTE_STUFE"',
    'if [ -z "$stufe" ]; then',
    '  if [ -n "$NIGHT_SALVAGE" ]; then stufe=salvage; else stufe=umsetzung; fi',
    "fi",
    String.raw`printf "%s\t%s\t%s\n" "$stufe" "$(pwd -P)" "$KIT_AGENT_MODEL" >> "$KETTE_LOG"`,
    'case "$stufe" in',
    faelle,
    "  *) : ;;",
    "esac",
    'if [ -z "$KETTE_OHNE_RESULT" ]; then',
    `  echo '{"type":"result","total_cost_usd":'"\${KETTE_KOSTEN:-1}"',"duration_api_ms":5,"num_turns":1,"stop_reason":'"\${KETTE_STOP:-null}"',"is_error":'"\${KETTE_IS_ERROR:-null}"',"usage":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":30,"cache_read_input_tokens":40},"result":"'"\${KETTE_RESULT_TEXT:-}"'"}'`,
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

// --- Bausteine der Stufe umsetzung (Plan #691; Issue #695) ---

/**
 * Die Fake-Zeile einer erfolgreichen Umsetzungs-Session: eine echte Aenderung in der
 * Hauptkopie, committet, das Paket nach In review.
 *
 * Die Pruef-Zusammenfassung schreibt hier der Fake statt `checks.mjs` — ohne sie griffe
 * der Nachweis-Guard (#471) und die Runde endete als Fehlschlag, obwohl die Karte steht.
 */
export const UMSETZUNG_ERFOLG = [
  String.raw`printf "Paket %s\n" "$NIGHT_ISSUE_ID" >> umsetzung.txt`,
  "git add -A >/dev/null",
  'git commit -q -m "Paket $NIGHT_ISSUE_ID (Fake)"',
  String.raw`printf '%s' '{"laufen":[{"cmd":"true","ergebnis":"gruen","grund":"beruehrt"}],"ausgelassen":[]}' > .claude/checks-summary.json`,
  'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" in_review >/dev/null',
].join("; ");

/** Die Fake-Zeile einer Umsetzungs-Session, die an einer Stopp-Frage anhaelt: Label, Kommentar mit Folgesatz, Backlog. */
export const UMSETZUNG_HALT = [
  `node .claude/kit/board.mjs issue label add "$NIGHT_ISSUE_ID" ${KLAEREN_LABEL} >/dev/null`,
  `node .claude/kit/board.mjs issue comment "$NIGHT_ISSUE_ID" --text "Beim Umsetzen tauchte eine Abwaegung auf: zwei vertretbare Schnitte. ${HALT_FOLGESATZ}" >/dev/null`,
  'node .claude/kit/board.mjs issue move "$NIGHT_ISSUE_ID" backlog >/dev/null',
].join("; ");

/**
 * Verzweigt eine Fake-Zeile nach der Paketnummer. Die Nummern des lokalen Trackers sind
 * fortlaufend und damit vorhersagbar (Fachplan 0001, Plan 0002, Pakete ab 0003) — wie in
 * den uebrigen Ketten-Tests wird darauf gebaut.
 */
export function jePaket(faelle, sonst = ":") {
  const zweige = Object.entries(faelle).map(([id, zeilen]) => `  ${id}) ${zeilen} ;;`).join("\n");
  return ['case "$NIGHT_ISSUE_ID" in', zweige, `  *) ${sonst} ;;`, "esac"].join("\n");
}

/**
 * Die Fake-Zeile der Stufe pakete fuer die Umsetzung: drei Pakete mit `Plan: Issue #M`,
 * von denen das zweite im Abschnitt Abhaengigkeiten auf das erste zeigt.
 *
 * Die Nummer des ersten Pakets liest der Fake aus der Antwort von `issue create`, statt
 * sie zu raten: Nur so bleibt die Referenz richtig, wenn der Test weitere Karten anlegt.
 */
export const PAKETE_MIT_ABHAENGIGKEIT = String.raw`m=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s|^/issues #\([0-9]*\).*|\1|p"); erste=""; for n in 1 2 3; do if [ "$n" = 2 ]; then dep="Issue #$erste"; else dep="Keine."; fi; printf "## Kontext\n\nPlan: Issue #%s\nFachliche Quelle: Issue #%s\n\n## Aufgabe\n\nPaket %s.\n\n## Akzeptanzkriterium\n\n- node --test\n\n## Abhängigkeiten\n\n%s\n" "$m" "$NIGHT_ISSUE_ID" "$n" "$dep" > "$KETTE_LOG.p$n.md"; id=$(node .claude/kit/board.mjs issue create --title "Paket $n" --body-file "$KETTE_LOG.p$n.md" | node -e 'const i=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(i.id))'); if [ "$n" = 1 ]; then erste="$id"; fi; done`;

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
/**
 * Ersetzt die Kit-Kopie von board.mjs durch einen Umweg, der `nightrun melden` abfaengt
 * und jede Meldung nach `$KETTE_MELDE_CAPTURE` schreibt (Issue #794).
 *
 * Je Meldung eine JSON-Zeile `{ sessions, meldung }`: `sessions` ist die Zahl der bis
 * dahin gelaufenen Fake-Sessions aus `$KETTE_LOG` und ordnet die Meldung damit einer
 * Stelle im Ablauf zu — der Rumpf selbst nennt die Stufe nicht. `meldung` baut die
 * echte, reine `nachtlaufMeldung()` aus dem Bestand, damit der Mitschnitt zeigt, was
 * wirklich das Haus verliesse. Mit `$KETTE_MELDE_FEHLER` endet der Aufruf stattdessen
 * mit Exit 1 — der Weg, auf dem eine gescheiterte Einlieferung geprueft wird.
 *
 * Wie `boardFakeInstallieren` wird der Umweg committet (der Vorflug prueft den
 * Arbeitsbaum) und spiegelt sich mit `.claude/` in den Worktree jeder Kette.
 */
export function meldeCaptureInstallieren(dir) {
  const echt = join(repoRoot, "kit", "board.mjs");
  writeFileSync(join(dir, ".claude", "kit", "board.mjs"), [
    'import { spawnSync } from "node:child_process";',
    'import { readFileSync, appendFileSync } from "node:fs";',
    `import { nachtlaufMeldung } from ${JSON.stringify("file://" + echt)};`,
    "const args = process.argv.slice(2);",
    'if (args[0] === "nightrun" && args[1] === "melden") {',
    '  if (process.env.KETTE_MELDE_FEHLER) {',
    String.raw`    process.stderr.write("Fehler: Einlieferung abgewiesen (Melde-Fake)\n");`,
    "    process.exit(1);",
    "  }",
    '  const datei = args[args.indexOf("--datei") + 1];',
    '  const stand = JSON.parse(readFileSync(datei, "utf-8"));',
    "  let sessions = 0;",
    String.raw`  try { sessions = readFileSync(process.env.KETTE_LOG, "utf-8").split("\n").filter(Boolean).length; } catch { sessions = 0; }`,
    String.raw`  appendFileSync(process.env.KETTE_MELDE_CAPTURE, JSON.stringify({ sessions, meldung: nachtlaufMeldung(stand) }) + "\n");`,
    String.raw`  process.stdout.write(JSON.stringify({ ok: true, outcome: "TEST" }) + "\n");`,
    "  process.exit(0);",
    "}",
    `const res = spawnSync(process.execPath, [${JSON.stringify(echt)}, ...args], { stdio: "inherit" });`,
    "process.exit(res.status ?? 1);",
    "",
  ].join("\n"));
  for (const a of [["add", "-A"], ["commit", "-q", "-m", "melde-capture"]]) {
    const res = spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
    assert.equal(res.status, 0, `git ${a.join(" ")}: ${res.stderr}`);
  }
}

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
