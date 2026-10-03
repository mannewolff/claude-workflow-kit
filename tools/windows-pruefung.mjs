/**
 * windows-pruefung.mjs — meldet einen roten Windows-Job der CI beim naechsten
 * Arbeitsschritt im Kit-Repository (Issue #1129, Plan #1128, E3 bis E5).
 *
 * Bisher fiel ein roter Job `check (windows-latest)` erst beim CI-Gate in
 * `/merge-production` auf; Ende September blieb er so ueber sieben Veroeffentlichungen
 * rot. `push main` wartet weiter nicht auf die CI (#316) — stattdessen laeuft dieses
 * Werkzeug als `SessionStart`- und `UserPromptSubmit`-Hook in den Einstellungen des
 * Kit-Repositorys (nicht im Installer: Zielprojekte bekommen es nicht).
 *
 *   node tools/windows-pruefung.mjs --hook
 *
 * Ablauf: `git rev-parse origin/main` ohne Fetch, dann
 * `node .claude/kit/board.mjs code ci-status --commit <sha>` mit einer Frist von fuenf
 * Sekunden. Ausgewertet wird allein der Job `check (windows-latest)`; die uebrigen Jobs
 * bleiben beim Gate in `/merge-production` (E5).
 *
 * Vorrat in `.claude/windows-pruefung.json`: Ein Ergebnis `gruen` oder `rot` gilt fuer
 * seinen Commit endgueltig. Laeuft der Job noch oder scheiterte die Abfrage, fragt der
 * Hook fruehestens nach zwei Minuten erneut — ein Hook, der jeden Prompt um Netzlatenz
 * verlaengert, wird abgeschaltet (E4). Ein Abfragefehler ist kein Befund: Der Hook
 * schweigt dann.
 *
 * Rot meldet er einmal je `session_id` und bei jedem `SessionStart` erneut, solange es
 * rot bleibt — als JSON mit `systemMessage` auf stdout. Der Exit-Code ist immer 0.
 *
 * Umgebungsvariablen:
 *   WINDOWS_PRUEFUNG_CI_CMD  ersetzt den Pfad zu `.claude/kit/board.mjs` (Test-Hook,
 *                            Muster `NIGHT_CLAUDE_CMD`).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WINDOWS_JOB = "check (windows-latest)";
const FRIST_MS = 5000;
const SPERRE_MS = 2 * 60 * 1000;
const VORRAT = join(".claude", "windows-pruefung.json");

/**
 * Das Urteil fuer den Windows-Job aus der Ausgabe von `code ci-status`: `gruen`, `rot`
 * oder `laeuft`, `null` bei unlesbarer Ausgabe. Fehlt der Job, ist er noch nicht
 * sichtbar — wie `code ci-status` eine leere Jobliste als `laeuft` wertet.
 */
export function urteilFuer(ciStatus) {
  if (!ciStatus || !Array.isArray(ciStatus.jobs)) return null;
  const job = ciStatus.jobs.find((j) => j?.name === WINDOWS_JOB);
  if (!job) return "laeuft";
  return job.ergebnis === "gruen" || job.ergebnis === "rot" ? job.ergebnis : "laeuft";
}

/** Ob fuer `sha` jetzt die CI gefragt wird — nach Vorrat und Zwei-Minuten-Sperre. */
export function faelligeAbfrage(vorrat, sha, jetzt) {
  if (vorrat?.commit !== sha) return true;
  if (vorrat.ergebnis === "gruen" || vorrat.ergebnis === "rot") return false;
  return jetzt - (vorrat.abgefragtUm ?? 0) >= SPERRE_MS;
}

/**
 * Die Meldung fuer diese Hook-Eingabe und der fortgeschriebene Vorrat. Gemeldet wird nur
 * Rot, einmal je Sitzung und bei `SessionStart` immer.
 */
export function meldungFuer(vorrat, { session, ereignis }) {
  if (vorrat?.ergebnis !== "rot") return { meldung: null, vorrat };
  const gemeldet = Array.isArray(vorrat.gemeldet) ? vorrat.gemeldet : [];
  if (ereignis !== "SessionStart" && gemeldet.includes(session)) return { meldung: null, vorrat };
  const meldung = `Windows-Prüfung rot für ${vorrat.commit.slice(0, 7)} (\`${WINDOWS_JOB}\`), siehe \`gh run list --commit ${vorrat.commit}\``;
  const neu = gemeldet.includes(session) ? gemeldet : [...gemeldet, session];
  return { meldung, vorrat: { ...vorrat, gemeldet: neu } };
}

function leseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function leseVorrat(pfad) {
  try {
    return leseJson(readFileSync(pfad, "utf8"));
  } catch {
    return null;
  }
}

/** Ergebnis der Abfrage oder `null` bei Fristablauf, Exit ungleich 0 oder unlesbarem JSON. */
function frageCi(cwd, sha) {
  const skript = process.env.WINDOWS_PRUEFUNG_CI_CMD || join(cwd, ".claude", "kit", "board.mjs");
  const r = spawnSync(process.execPath, [skript, "code", "ci-status", "--commit", sha], {
    cwd,
    encoding: "utf8",
    timeout: FRIST_MS,
  });
  if (r.error || r.status !== 0) return null;
  return urteilFuer(leseJson(r.stdout));
}

function hook() {
  let eingabe = null;
  try {
    eingabe = leseJson(readFileSync(0, "utf8"));
  } catch {
    eingabe = null;
  }
  const cwd = process.cwd();
  const rev = spawnSync("git", ["rev-parse", "--verify", "-q", "origin/main"], { cwd, encoding: "utf8" });
  const sha = rev.status === 0 ? rev.stdout.trim() : "";
  if (!sha) return;

  const pfad = join(cwd, VORRAT);
  const alt = leseVorrat(pfad);
  let vorrat = alt?.commit === sha ? alt : { commit: sha, ergebnis: null, abgefragtUm: 0, gemeldet: [] };
  const jetzt = Date.now();
  if (faelligeAbfrage(alt, sha, jetzt)) {
    vorrat = { ...vorrat, ergebnis: frageCi(cwd, sha), abgefragtUm: jetzt };
  }
  const { meldung, vorrat: neu } = meldungFuer(vorrat, {
    session: String(eingabe?.session_id ?? ""),
    ereignis: eingabe?.hook_event_name,
  });
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, JSON.stringify(neu, null, 2) + "\n");
  } catch {
    // Ohne Vorrat fragt der naechste Schritt erneut; ein Grund zu stoeren ist das nicht.
  }
  if (meldung) process.stdout.write(JSON.stringify({ systemMessage: meldung }) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--hook")) {
  try {
    hook();
  } catch {
    // Exit-Code immer 0: Ein Hook-Fehler darf keinen Arbeitsschritt aufhalten.
  }
  process.exitCode = 0;
}
