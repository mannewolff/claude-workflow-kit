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
 * Zweiter Modus, vor dem Push auf `main` (Issue #1147, Kriterium 1; Plan #1150, E1 bis
 * E10): Der fertige Commit wird unter Windows geprueft, bevor er veroeffentlicht ist.
 *
 *   node tools/windows-pruefung.mjs --vorab
 *
 * Ablauf: `git rev-parse HEAD`, dann zuerst `code ci-status --commit <sha>` — liegt fuer
 * den Windows-Job schon `gruen` oder `rot` vor, gilt es ohne Push und ohne Warten (E10).
 * Sonst wird der Vorab-Zweig `windows-vorab` ohne Force-Push ersetzt: loeschen (ein
 * fehlender Zweig ist kein Fehler), dann neu anlegen (E2). Danach alle 30 Sekunden eine
 * Abfrage mit je einer Fortschrittszeile (E8); gezaehlt wird allein `check (windows-latest)`
 * (E9). Die Frist betraegt 30 Minuten ab dem Start des Jobs (`jobs[].gestartet`, #1151),
 * vorher gilt die Startgrenze ab dem Vorab-Push (E4).
 *
 * Ausgabe: Fortschrittszeilen, eine Schlusszeile und als letzte Zeile das JSON
 * `{ ergebnis: "gruen"|"rot"|"kein-ergebnis", commit, grund }`. Exit 0 bei gruen, 1 bei
 * rot, 2 ohne verwertbares Ergebnis (Frist, Startgrenze, dauerhaft scheiternde Abfrage,
 * gescheiterter Push).
 *
 * Umgebungsvariablen:
 *   WINDOWS_PRUEFUNG_CI_CMD    ersetzt den Pfad zu `.claude/kit/board.mjs` (Test-Hook,
 *                              Muster `NIGHT_CLAUDE_CMD`).
 *   WINDOWS_PRUEFUNG_PUSH_CMD  ersetzt `git` fuer die beiden Pushes von `--vorab` durch ein
 *                              Node-Skript, das dieselben Argumente erhaelt (Test-Hook).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WINDOWS_JOB = "check (windows-latest)";
const FRIST_MS = 5000;
const SPERRE_MS = 2 * 60 * 1000;
const VORRAT = join(".claude", "windows-pruefung.json");

export const VORAB_ZWEIG = "windows-vorab";
/** Abfrageintervall von `--vorab` (E8). */
export const INTERVALL_MS = 30 * 1000;
/** Frist ab dem Start des Windows-Jobs (Issue #1147, Kriterium 1; E4). */
export const FRIST_NACH_START_MS = 30 * 60 * 1000;
/**
 * Startgrenze ab dem Vorab-Push, solange der Job nicht gestartet ist — eigene Festlegung
 * von Plan #1150, nicht aus der fachlichen Quelle (E4).
 */
export const STARTGRENZE_MS = 15 * 60 * 1000;
/** So viele Abfragen in Folge duerfen scheitern, bevor `--vorab` aufgibt. */
export const MAX_FEHLABFRAGEN = 5;
const VORAB_ABFRAGE_FRIST_MS = 60 * 1000;
const PUSH_FRIST_MS = 2 * 60 * 1000;

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

/** Ausgabe von `code ci-status` oder `null` bei Fristablauf, Exit ungleich 0 oder unlesbarem JSON. */
function frageCiStatus(cwd, sha, frist) {
  const skript = process.env.WINDOWS_PRUEFUNG_CI_CMD || join(cwd, ".claude", "kit", "board.mjs");
  const r = spawnSync(process.execPath, [skript, "code", "ci-status", "--commit", sha], {
    cwd,
    encoding: "utf8",
    timeout: frist,
  });
  if (r.error || r.status !== 0) return null;
  return leseJson(r.stdout);
}

/** Urteil der Abfrage oder `null` bei Fristablauf, Exit ungleich 0 oder unlesbarem JSON. */
function frageCi(cwd, sha) {
  return urteilFuer(frageCiStatus(cwd, sha, FRIST_MS));
}

/**
 * Grund, warum `--vorab` ohne verwertbares Ergebnis endet, oder `null`, solange gewartet
 * wird: vor dem Start des Jobs die Startgrenze ab `pushUm`, danach die Frist ab `gestartet`.
 */
export function fristUeberschritten({ pushUm, gestartet, jetzt }) {
  const start = gestartet ? Date.parse(gestartet) : Number.NaN;
  if (Number.isNaN(start)) {
    return jetzt - pushUm >= STARTGRENZE_MS
      ? `Startgrenze: \`${WINDOWS_JOB}\` ist ${STARTGRENZE_MS / 60_000} Minuten nach dem Vorab-Push nicht gestartet`
      : null;
  }
  return jetzt - start >= FRIST_NACH_START_MS
    ? `Frist: \`${WINDOWS_JOB}\` ist ${FRIST_NACH_START_MS / 60_000} Minuten nach seinem Start nicht fertig`
    : null;
}

/** Exit-Code von `--vorab` zum Ergebnis. */
export function exitCodeFuer(ergebnis) {
  if (ergebnis === "gruen") return 0;
  if (ergebnis === "rot") return 1;
  return 2;
}

function minuten(ms) {
  return `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")} min`;
}

/**
 * Ersetzt den Vorab-Zweig ohne Force-Push: loeschen, dann anlegen (E2). Liefert den Grund
 * eines Fehlschlags oder `null`. Ein fehlender Zweig beim Loeschen ist kein Fehler.
 */
function vorabPush(deps) {
  const loeschen = deps.push(["push", "origin", "--delete", VORAB_ZWEIG]);
  if (!loeschen.ok && !/remote ref does not exist/i.test(loeschen.stderr ?? "")) {
    return `Push: ${VORAB_ZWEIG} liess sich nicht loeschen: ${(loeschen.stderr ?? "").trim()}`;
  }
  const anlegen = deps.push(["push", "origin", `HEAD:refs/heads/${VORAB_ZWEIG}`]);
  return anlegen.ok ? null : `Push: ${VORAB_ZWEIG} liess sich nicht anlegen: ${(anlegen.stderr ?? "").trim()}`;
}

/**
 * Der Ablauf von `--vorab` mit ersetzbaren Abhaengigkeiten: `revParse()`,
 * `frageCiStatus(sha)`, `push(args)` → `{ ok, stderr }`, `jetzt()`, `warte(ms)` und
 * `ausgabe(zeile)`. Liefert `{ ergebnis, commit, grund }`.
 */
export async function vorab(deps) {
  const commit = deps.revParse();
  if (!commit) return { ergebnis: "kein-ergebnis", commit: null, grund: "git rev-parse HEAD scheiterte" };
  const kurz = commit.slice(0, 7);

  const vorher = urteilFuer(deps.frageCiStatus(commit));
  if (vorher === "gruen" || vorher === "rot") {
    return { ergebnis: vorher, commit, grund: `Endurteil fuer ${kurz} lag bereits vor, kein Vorab-Push` };
  }

  const pushFehler = vorabPush(deps);
  if (pushFehler) return { ergebnis: "kein-ergebnis", commit, grund: pushFehler };
  const pushUm = deps.jetzt();
  deps.ausgabe(`Windows-Prüfung ${kurz}: Vorab-Push nach ${VORAB_ZWEIG}, Abfrage alle ${INTERVALL_MS / 1000} s`);

  let gestartet = null;
  let fehlabfragen = 0;
  for (let n = 1; ; n += 1) {
    await deps.warte(INTERVALL_MS);
    const ciStatus = deps.frageCiStatus(commit);
    const urteil = urteilFuer(ciStatus);
    const seitPush = minuten(deps.jetzt() - pushUm);
    if (urteil === null) {
      fehlabfragen += 1;
      deps.ausgabe(`Windows-Prüfung ${kurz}: Abfrage ${n} gescheitert (${fehlabfragen} in Folge), ${seitPush} seit Vorab-Push`);
      if (fehlabfragen >= MAX_FEHLABFRAGEN) {
        return { ergebnis: "kein-ergebnis", commit, grund: `Abfrage: code ci-status scheiterte ${fehlabfragen}-mal in Folge` };
      }
      continue;
    }
    fehlabfragen = 0;
    gestartet = ciStatus.jobs.find((j) => j?.name === WINDOWS_JOB)?.gestartet ?? gestartet;
    const zustand = gestartet ? `${urteil}, gestartet ${gestartet}` : `${urteil}, noch nicht gestartet`;
    deps.ausgabe(`Windows-Prüfung ${kurz}: Abfrage ${n}: ${zustand}, ${seitPush} seit Vorab-Push`);
    if (urteil === "gruen" || urteil === "rot") {
      return { ergebnis: urteil, commit, grund: `\`${WINDOWS_JOB}\` des Vorab-Laufs ist ${urteil}` };
    }
    const grund = fristUeberschritten({ pushUm, gestartet, jetzt: deps.jetzt() });
    if (grund) return { ergebnis: "kein-ergebnis", commit, grund };
  }
}

/** git meldet englisch, damit die Auswertung seiner Meldungen nicht an der Sprache haengt (Issue #1171). */
const GIT_ENV = { ...process.env, LC_ALL: "C" };

function standardDeps(cwd) {
  return {
    revParse: () => {
      const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", env: GIT_ENV });
      return r.status === 0 ? r.stdout.trim() : "";
    },
    frageCiStatus: (sha) => frageCiStatus(cwd, sha, VORAB_ABFRAGE_FRIST_MS),
    push: (args) => {
      const ersatz = process.env.WINDOWS_PRUEFUNG_PUSH_CMD;
      const r = ersatz
        ? spawnSync(process.execPath, [ersatz, ...args], { cwd, encoding: "utf8", env: GIT_ENV, timeout: PUSH_FRIST_MS })
        : spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, timeout: PUSH_FRIST_MS });
      return { ok: !r.error && r.status === 0, stderr: r.error ? r.error.message : (r.stderr ?? "") };
    },
    jetzt: () => Date.now(),
    warte: (ms) => new Promise((fertig) => setTimeout(fertig, ms)),
    ausgabe: (zeile) => process.stdout.write(zeile + "\n"),
  };
}

const SCHLUSS = { gruen: "grün", rot: "rot", "kein-ergebnis": "kein verwertbares Ergebnis" };

async function vorabHaupt() {
  const deps = standardDeps(process.cwd());
  let r;
  try {
    r = await vorab(deps);
  } catch (e) {
    r = { ergebnis: "kein-ergebnis", commit: null, grund: `Fehler: ${e?.message ?? e}` };
  }
  deps.ausgabe(`Windows-Prüfung ${r.commit ? r.commit.slice(0, 7) : "?"}: ${SCHLUSS[r.ergebnis]} — ${r.grund}`);
  deps.ausgabe(JSON.stringify(r));
  process.exitCode = exitCodeFuer(r.ergebnis);
}

function hook() {
  let eingabe = null;
  try {
    eingabe = leseJson(readFileSync(0, "utf8"));
  } catch {
    eingabe = null;
  }
  const cwd = process.cwd();
  const rev = spawnSync("git", ["rev-parse", "--verify", "-q", "origin/main"], { cwd, encoding: "utf8", env: GIT_ENV });
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

const direkt = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (direkt && process.argv.includes("--vorab")) {
  await vorabHaupt();
} else if (direkt && process.argv.includes("--hook")) {
  try {
    hook();
  } catch {
    // Exit-Code immer 0: Ein Hook-Fehler darf keinen Arbeitsschritt aufhalten.
  }
  process.exitCode = 0;
}
