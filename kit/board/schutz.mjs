/**
 * board/schutz.mjs — der Schutz von Haupt- und Veroeffentlichungszweig ohne Host-Details
 * (Issue #1407, Plan #1405): Zustand ableiten, Ruleset-Soll, Anleitung, Notfall-Gate und
 * Nacht-Sperre; dazu die Probe auf dem Pruefzweig, `einrichten` und `nachpruefen`
 * (Issue #1408), die `code schutz` im Einstieg ruft.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus.
 *
 * Alles, was den Code-Host betrifft, geht ueber die Operationen des Adapters (Issue #1406):
 * `schutzUnterstuetzt`, `getRulesets`, `getCiStatus`, `hatAdminRecht`, `upsertRuleset`,
 * `pushRef`, `deleteRef`. Nur ob der Pruefzweig auf origin schon steht und wo
 * `origin/<mainBranch>` steht, fragt dieser Teil `git` selbst. Das Notfall-Gate laedt
 * `kit/checks.mjs` und `kit/night/kitstand.mjs` erst beim Aufruf: Jeder andere Aufruf von
 * board.mjs braucht sie nicht, und sie liegen in jeder Installation neben board.mjs.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { BoardError } from "./grundlagen.mjs";
import { rulesetName } from "./adapter.mjs";
import { text } from "./namen.mjs";

// ============================================================
// Texte an den Menschen (Issue #1482, Plan #1420 E13/E14)
// ============================================================

/**
 * Die Meldungen des Schutzes je Sprache. Vertragswerte bleiben ausserhalb (E14): die
 * Feldnamen der Ergebnisse, die Werte von `ergebnis` und `status`, die Ruleset-Arten, die
 * Aktionsnamen von `code schutz`, die Kommandos und die Bezeichnungen der Oberflaeche des
 * Code-Hosts, die die Anleitung woertlich nennt.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    artUnbekannt: "Ruleset-Art '{art}' unbekannt. Erwartet: {arten}",
    regelFehlt: "Regel {typ} fehlt",
    pflichtjobs: "Pflichtjobs {ist} statt {soll}",
    bypassNichtLeer: "Bypass-Liste nicht leer",
    freigaben: "pull_request verlangt {anzahl} Freigabe(n) statt 0",
    keine: "(keine)",
    keinSchutz: "Der Code-Host kennt keinen Schutz.",
    pushPruefung: "Pruefung vor dem Push nicht im Build-Dienst (pushPruefung)",
    schutzAusgesetzt: "Schutz des Hauptzweigs ausgesetzt",
    rulesetFehlt: "Ruleset '{name}' fehlt",
    rulesetAusgesetzt: "Ruleset '{name}' ausgesetzt",
    rulesetAbweichung: "Ruleset '{name}' weicht ab: {befund}",
    anleitungZiel: "3. Target branches → Add target → Include by pattern: {zweig} (Zielzweig: {zweig})",
    anleitungBypass: "4. Bypass list: leer lassen, keine Rolle und kein Nutzer",
    anleitungRegeln: "5. Regeln einschalten:",
    anleitungJobs: "6. Bei Require status checks to pass diese Jobs als Pflichtpruefung eintragen: {jobs}",
    keinGruenerLauf: "kein gruener Lauf",
    rotPruefung: "rot: {pruefung}",
    keinVollerLauf: "Kein gruener voller Lauf der Stufe push im Worktree ({warum}). Erst: node .claude/kit/checks.mjs run --stufe push --wiederholen",
    falscheStufe: "Der letzte gruene Lauf hatte die Stufe {stufe}, verlangt ist push.",
    stufeUnbekannt: "(unbekannt)",
    keineHashes: "Die Zusammenfassung nennt keine Blob-Hashes; der gepruefte Stand ist nicht belegt.",
    standUnlesbar: "Der Stand der geprueften Dateien liess sich nicht lesen: {fehler}",
    seitLaufGeaendert: "Seit dem Lauf geaendert: {dateien} — der Stand ist nicht mehr der gepruefte.",
    nachtGesperrt: "code schutz {aktion} ist ohne Aufsicht gesperrt (KIT_AGENT_MODEL gesetzt): Die Aktion pusht oder aendert den Code-Host, und die Nacht pusht nie. Nur status ist erlaubt.",
    originFehltLokal: "origin/{zweig} fehlt im lokalen Repository — erst git fetch origin {zweig}.",
    pruefzweigBelegt: "Der Pruefzweig '{zweig}' ist auf origin schon vorhanden — vielleicht laeuft dort ein push main. Die Probe ueberschreibt ihn nicht; erst wenn er weg ist, erneut aufrufen.",
    probeLaeuft: "Probe auf {zweig}: {minuten} min gewartet, Lauf laeuft",
    probeOhneLauf: "Probe auf {zweig}: {minuten} min gewartet, noch kein Lauf",
    offenerSchritt: "Der Build-Dienst muss bei einem Push auf den Pruefzweig '{zweig}' den Lauf der Stufe push fahren: {kommando}",
    originFehlt: "origin/{zweig} fehlt — ohne Remote-Stand gibt es nichts zu pruefen.",
    nichtZuEnde: "Der Build-Dienst lief nicht binnen 60 Minuten zu Ende auf '{zweig}'.",
    keinLauf: "Der Build-Dienst fuhr binnen 5 Minuten keinen Lauf auf '{zweig}'.",
    ohneAdmin: "Ohne Admin-Recht am Repository richtet das Kit nichts ein.",
    abgewiesen403: "Der Code-Host wies das Einrichten ab (403): {fehler}",
  }),
  en: Object.freeze({
    artUnbekannt: "Ruleset kind '{art}' unknown. Expected: {arten}",
    regelFehlt: "rule {typ} missing",
    pflichtjobs: "required jobs {ist} instead of {soll}",
    bypassNichtLeer: "bypass list not empty",
    freigaben: "pull_request requires {anzahl} approval(s) instead of 0",
    keine: "(none)",
    keinSchutz: "The code host knows no protection.",
    pushPruefung: "Check before push not in the build service (pushPruefung)",
    schutzAusgesetzt: "Main branch protection suspended",
    rulesetFehlt: "Ruleset '{name}' is missing",
    rulesetAusgesetzt: "Ruleset '{name}' suspended",
    rulesetAbweichung: "Ruleset '{name}' deviates: {befund}",
    anleitungZiel: "3. Target branches → Add target → Include by pattern: {zweig} (target branch: {zweig})",
    anleitungBypass: "4. Bypass list: leave empty, no role and no user",
    anleitungRegeln: "5. Enable rules:",
    anleitungJobs: "6. Under Require status checks to pass, enter these jobs as required checks: {jobs}",
    keinGruenerLauf: "no green run",
    rotPruefung: "red: {pruefung}",
    keinVollerLauf: "No green full run of stage push in the worktree ({warum}). First: node .claude/kit/checks.mjs run --stufe push --wiederholen",
    falscheStufe: "The last green run had stage {stufe}, push is required.",
    stufeUnbekannt: "(unknown)",
    keineHashes: "The summary names no blob hashes; the checked state is not proven.",
    standUnlesbar: "The state of the checked files could not be read: {fehler}",
    seitLaufGeaendert: "Changed since the run: {dateien} — the state is no longer the checked one.",
    nachtGesperrt: "code schutz {aktion} is blocked without supervision (KIT_AGENT_MODEL set): the action pushes or changes the code host, and the night never pushes. Only status is allowed.",
    originFehltLokal: "origin/{zweig} is missing in the local repository — first git fetch origin {zweig}.",
    pruefzweigBelegt: "The check branch '{zweig}' already exists on origin — perhaps a push main is running there. The probe does not overwrite it; call again only once it is gone.",
    probeLaeuft: "Probe on {zweig}: waited {minuten} min, run in progress",
    probeOhneLauf: "Probe on {zweig}: waited {minuten} min, no run yet",
    offenerSchritt: "On a push to the check branch '{zweig}' the build service must run the stage push: {kommando}",
    originFehlt: "origin/{zweig} is missing — without a remote state there is nothing to check.",
    nichtZuEnde: "The build service did not finish within 60 minutes on '{zweig}'.",
    keinLauf: "The build service started no run within 5 minutes on '{zweig}'.",
    ohneAdmin: "Without admin rights on the repository the kit sets up nothing.",
    abgewiesen403: "The code host rejected the setup (403): {fehler}",
  }),
});

/** Ein Text dieses Teils in der Projektsprache (Issue #1482, E13). */
const t = (schluessel, werte) => text(TEXTE, schluessel, werte);

// Der Satz aus Plan #1405, E10: Bis das Ruleset wieder steht, sagt `status`, was fehlt. Die
// Konstante bleibt der deutsche Wortlaut; `status` meldet ihn in der Projektsprache.
export const SCHUTZ_AUSGESETZT = TEXTE.de.schutzAusgesetzt;
// A7: Ein Stand auf dem Hauptzweig ohne Nachweis des Build-Dienstes wird hiermit nachgeprueft.
export const NACHPRUEFEN_KOMMANDO = "node .claude/kit/board.mjs code schutz nachpruefen";
// E8: Diese Aktionen pushen oder aendern den Code-Host — die Nacht pusht nie.
export const NACHT_GESPERRT = Object.freeze(["einrichten", "aussetzen", "nachpruefen"]);

const ARTEN = Object.freeze(["haupt", "veroeffentlichung"]);

/**
 * Das Soll eines Rulesets (A2, A8) im Format, das `upsertRuleset` annimmt. Beide Arten
 * verlangen die Jobs als Pflichtpruefung, verbieten Force-Push und Loeschen; der
 * Veroeffentlichungszweig nimmt zusaetzlich nur einen Pull Request an, ohne Freigabe.
 * Umgehungen gibt es keine (A6): `bypass_actors` ist leer.
 */
export function rulesetSoll(zweig, jobs, art) {
  if (!ARTEN.includes(art)) throw new BoardError(t("artUnbekannt", { art, arten: ARTEN.join(" | ") }));
  const regeln = [
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: jobs.map((context) => ({ context })),
        strict_required_status_checks_policy: false,
      },
    },
    { type: "non_fast_forward" },
    { type: "deletion" },
  ];
  if (art === "veroeffentlichung") {
    regeln.push({
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    });
  }
  return { name: rulesetName(zweig), zweig, art, enforcement: "active", regeln, bypass_actors: [] };
}

/**
 * Was an einem stehenden Ruleset vom Soll abweicht, als Liste kurzer Merkmale. Geprueft
 * werden dieselben Merkmale, die `einrichten` setzt (A9): Regeln des Solls vorhanden,
 * Pflichtjobs, keine Umgehung, keine Freigabe am Pull Request. Zusaetzliche Regeln eines
 * Menschen sind strenger und keine Abweichung. `enforcement` beurteilt der Aufrufer.
 */
function abweichungen(stehend, soll) {
  const befund = [];
  const typen = new Set((stehend.regeln || []).map((r) => r.type));
  for (const regel of soll.regeln) {
    if (!typen.has(regel.type)) befund.push(t("regelFehlt", { typ: regel.type }));
  }
  const sollJobs = soll.regeln.find((r) => r.type === "required_status_checks")
    .parameters.required_status_checks.map((c) => c.context);
  if (sollJobs.length === 0 || !gleicheMenge(stehend.requiredStatusChecks || [], sollJobs)) {
    befund.push(t("pflichtjobs", { ist: liste(stehend.requiredStatusChecks), soll: liste(sollJobs) }));
  }
  if ((stehend.bypassActors || []).length > 0) befund.push(t("bypassNichtLeer"));
  if (soll.art === "veroeffentlichung") {
    const pr = (stehend.regeln || []).find((r) => r.type === "pull_request");
    const freigaben = pr?.parameters?.required_approving_review_count;
    if (pr && freigaben !== 0) befund.push(t("freigaben", { anzahl: freigaben }));
  }
  return befund;
}

function gleicheMenge(a, b) {
  return a.length === b.length && b.every((x) => a.includes(x));
}

function liste(werte) {
  return Array.isArray(werte) && werte.length > 0 ? werte.join(", ") : t("keine");
}

/** Der Kopf von `origin/<zweig>` im lokalen Repository, oder `null`. */
function kopfAusGit(zweig) {
  const res = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${zweig}`], { encoding: "utf-8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

/**
 * Der Zustand des Schutzes (E1): `{ geschuetzt, fehlt: [...], ungeprueft: null | { commit, kommando } }`.
 *
 * `fehlt` nennt: einen Code-Host ohne Schutz mit seinem Grund, eine Pruefung vor dem Push
 * ausserhalb des Build-Dienstes, fehlende oder abweichende Rulesets je Zweig und das
 * ausgesetzte Ruleset des Hauptzweigs (E10). Geschuetzt ist das Projekt, wenn nichts fehlt.
 * Das Admin-Recht fragt der Zustand nicht ab (A9): Stehen die Rulesets nach Soll, hat sie
 * jemand eingerichtet, und wer, ist gleich.
 *
 * `ungeprueft` nennt den Kopf von `origin/<mainBranch>`, wenn ein Pflichtjob aus dem
 * Ruleset des Hauptzweigs dort nicht gruen ist (A7). Fremde Laeufe am Commit (SonarQube)
 * zaehlen nicht. Es aendert `geschuetzt` nicht: Der Schutz steht, nur dieser eine Stand kam
 * am Nachweis vorbei.
 *
 * `abh.kopfVon(zweig)` liefert den Kopf; Vorgabe ist `git rev-parse` im aktuellen Verzeichnis.
 */
export async function schutzZustand(host, config, { kopfVon = kopfAusGit } = {}) {
  const unterstuetzt = typeof host.schutzUnterstuetzt === "function"
    ? host.schutzUnterstuetzt()
    : { ja: false, grund: t("keinSchutz") };
  if (!unterstuetzt.ja) return { geschuetzt: false, fehlt: [unterstuetzt.grund], ungeprueft: null };

  const mainBranch = config?.mainBranch || "main";
  const productionBranch = config?.productionBranch || "production";
  const fehlt = [];
  if (config?.pushPruefung?.ort !== "buildDienst") {
    fehlt.push(t("pushPruefung"));
  }

  const rulesets = await host.getRulesets();
  const haupt = rulesets.find((r) => r.zweig === mainBranch) || null;
  // Das Soll beider Zweige traegt die Pflichtjobs des Hauptzweigs: Sie stammen aus der Probe
  // (A3), und der Veroeffentlichungszweig verlangt dieselben (A8).
  const jobs = haupt?.requiredStatusChecks || [];
  fehlt.push(...rulesetBefunde(rulesets, jobs, [[mainBranch, "haupt"], [productionBranch, "veroeffentlichung"]]));

  const kopf = haupt && jobs.length > 0 ? kopfVon(mainBranch) : null;
  const ungeprueft = kopf && !(await pflichtjobsGruen(host, kopf, jobs))
    ? { commit: kopf, kommando: NACHPRUEFEN_KOMMANDO }
    : null;
  return { geschuetzt: fehlt.length === 0, fehlt, ungeprueft };
}

/** Was an den Rulesets der Zweige fehlt: fehlend, ausgesetzt (E10) oder abweichend. */
function rulesetBefunde(rulesets, jobs, zweige) {
  const fehlt = [];
  for (const [zweig, art] of zweige) {
    const stehend = rulesets.find((r) => r.zweig === zweig);
    if (!stehend) {
      fehlt.push(t("rulesetFehlt", { name: rulesetName(zweig) }));
      continue;
    }
    if (stehend.enforcement !== "active") {
      fehlt.push(art === "haupt" ? t("schutzAusgesetzt") : t("rulesetAusgesetzt", { name: rulesetName(zweig) }));
    }
    const befund = abweichungen(stehend, rulesetSoll(zweig, jobs, art));
    if (befund.length > 0) fehlt.push(t("rulesetAbweichung", { name: rulesetName(zweig), befund: befund.join("; ") }));
  }
  return fehlt;
}

/** Ob jeder Pflichtjob am Commit gruen ist; fremde Laeufe (SonarQube) zaehlen nicht (A7). */
async function pflichtjobsGruen(host, commit, jobs) {
  const ci = await host.getCiStatus(commit);
  const gruen = new Set((ci?.jobs || []).filter((j) => j.ergebnis === "gruen").map((j) => j.name));
  return jobs.every((job) => gruen.has(job));
}

const REGEL_TEXT = Object.freeze({
  required_status_checks: "Require status checks to pass",
  non_fast_forward: "Block force pushes",
  deletion: "Restrict deletions",
  pull_request: "Require a pull request before merging (Required approvals: 0)",
});

/**
 * Die Anleitung fuer den Menschen, wenn das Kit nichts einrichten darf (A9): je Ruleset die
 * Schritte mit ihrem Ort beim Code-Host. `soll` ist ein Soll aus `rulesetSoll` oder eine
 * Liste davon.
 */
export function anleitung(soll) {
  const abschnitte = [].concat(soll).map((s) => {
    const jobs = s.regeln.find((r) => r.type === "required_status_checks")
      .parameters.required_status_checks.map((c) => c.context);
    const zeilen = [
      `Ruleset '${s.name}':`,
      "1. Settings → Rules → Rulesets → New branch ruleset",
      `2. Ruleset Name: ${s.name}, Enforcement status: Active`,
      t("anleitungZiel", { zweig: s.zweig }),
      t("anleitungBypass"),
      t("anleitungRegeln"),
      ...s.regeln.map((r) => `   - ${REGEL_TEXT[r.type] || r.type}`),
      t("anleitungJobs", { jobs: jobs.join(", ") }),
      "7. Create",
    ];
    return zeilen.join("\n");
  });
  return abschnitte.join("\n\n");
}

/**
 * Das Gate des Notfallwegs (E9): gruen nur nach einem zu Ende gefahrenen, gruenen Lauf der
 * Stufe push, dessen gepruefte Dateien im Worktree `pfad` noch denselben Stand haben.
 * Ergebnis und Stufe liest `zusammenfassungBezeugt`, den Stand vergleichen `blobHashes`
 * und `hashesGleich` — dieselben Funktionen, die schon festlegen, wann ein Lauf gruen ist
 * und wann ein Stand derselbe ist. Die Zusammenfassung traegt keinen Commit; ein
 * Release-Commit nach dem Lauf aendert keine gepruefte Datei und haelt das Gate nicht auf.
 *
 * Liefert `{ ok: true }` oder `{ ok: false, grund }`.
 */
export async function notfallGate(pfad) {
  const { zusammenfassungBezeugt } = await import("../night/kitstand.mjs");
  const { blobHashes, hashesGleich } = await import("../checks.mjs");

  const bezeugt = zusammenfassungBezeugt(pfad, []);
  if (bezeugt.ergebnis !== "gruen") {
    const warum = bezeugt.rot?.hinweis || (bezeugt.rot?.pruefung ? t("rotPruefung", { pruefung: bezeugt.rot.pruefung }) : t("keinGruenerLauf"));
    return { ok: false, grund: t("keinVollerLauf", { warum }) };
  }
  if (bezeugt.stufe !== "push") {
    return { ok: false, grund: t("falscheStufe", { stufe: bezeugt.stufe ?? t("stufeUnbekannt") }) };
  }
  let hashes = null;
  try {
    hashes = JSON.parse(readFileSync(join(pfad, ".claude", "checks-summary.json"), "utf-8")).hashes ?? null;
  } catch {
    // oben schon als gruen gelesen; faellt hier nur bei einem Wettlauf weg — unten abgelehnt
  }
  if (hashes === null || typeof hashes !== "object") {
    return { ok: false, grund: t("keineHashes") };
  }
  let jetzt;
  try {
    jetzt = blobHashes(Object.keys(hashes), pfad);
  } catch (e) {
    return { ok: false, grund: t("standUnlesbar", { fehler: e.message }) };
  }
  if (!hashesGleich(hashes, jetzt)) {
    const geaendert = Object.keys(hashes).filter((d) => hashes[d] !== jetzt[d]);
    return { ok: false, grund: t("seitLaufGeaendert", { dateien: geaendert.join(", ") }) };
  }
  return { ok: true };
}

/**
 * Die Sperre der Nacht (E8): Mit gesetztem `KIT_AGENT_MODEL` brechen `einrichten`,
 * `aussetzen` und `nachpruefen` ab; `status` bleibt erlaubt.
 */
export function nachtSperre(aktion, env = process.env) {
  if (env.KIT_AGENT_MODEL && NACHT_GESPERRT.includes(aktion)) {
    throw new BoardError(t("nachtGesperrt", { aktion }));
  }
}

// --- Probe, Einrichten, Nachpruefen (Issue #1408) ---

// E6: Takt und Fristen der Probe, dieselben wie beim Warten in /push-main.
const PROBE_TAKT_MS = 30_000;
const PROBE_FRIST_LAUF_MS = 5 * 60_000;
const PROBE_FRIST_ABSCHLUSS_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

/**
 * Ob `zweig` auf origin schon steht. `git ls-remote --exit-code` endet mit 2, wenn kein
 * Ref passt; jeder andere Fehlschlag ist ein Fehler und kein „frei" — sonst ueberschriebe
 * die Probe einen laufenden `push main` (E7).
 */
function zweigAufOrigin(zweig) {
  const res = spawnSync("git", ["ls-remote", "--exit-code", "--heads", "origin", zweig], { encoding: "utf-8" });
  if (res.status === 0) return true;
  if (res.status === 2) return false;
  throw new BoardError(`git ls-remote --heads origin ${zweig}: ${(res.stderr || res.error?.message || "").trim()}`);
}

function vorgaben(optionen) {
  return {
    takt: PROBE_TAKT_MS,
    fristLauf: PROBE_FRIST_LAUF_MS,
    fristAbschluss: PROBE_FRIST_ABSCHLUSS_MS,
    jetzt: Date.now,
    schlafe: (ms) => new Promise((fertig) => setTimeout(fertig, ms)),
    melde: (zeile) => process.stderr.write(`${zeile}\n`),
    zweigBelegt: zweigAufOrigin,
    kopfVon: kopfAusGit,
    ...optionen,
  };
}

/** Ein Lauf ist abgeschlossen, wenn er Jobs hat und keiner mehr laeuft. */
function abgeschlossen(ci) {
  const jobs = ci?.jobs || [];
  return jobs.length > 0 && jobs.every((j) => j.ergebnis !== "laeuft");
}

/**
 * Die Probe (A3, E6, E7): pusht den Kopf von `origin/<mainBranch>` auf den Pruefzweig und
 * wartet, ob der Build-Dienst dort laeuft — hoechstens `fristLauf` auf den ersten Lauf, bis
 * `fristAbschluss` auf dessen Abschluss, im Takt `takt` mit einer Fortschrittszeile je
 * Minute. Gefragt wird mit Zweigfilter: Laeufe anderer Ausloeser am selben Commit zaehlen
 * nicht. Der Pruefzweig wird danach geloescht, auch bei einem Fehler. Ein schon stehender
 * Pruefzweig bricht ab, ohne Push und ohne Ueberschreiben.
 *
 * Liefert `{ commit, gefunden, abgeschlossen, jobs: [Namen], ci }`; `jobs` nennt nur die
 * Jobs eines abgeschlossenen Laufs, gruen wie rot (A4). Takt, Fristen, Uhr, Schlaf,
 * Meldung, Zweig- und Kopfabfrage sind fuer die Tests in `optionen` ersetzbar.
 */
export async function probe(host, config, zweig, optionen = {}) {
  const o = vorgaben(optionen);
  const mainBranch = config?.mainBranch || "main";
  const commit = o.kopfVon(mainBranch);
  if (!commit) throw new BoardError(t("originFehltLokal", { zweig: mainBranch }));
  if (o.zweigBelegt(zweig)) {
    const fehler = new BoardError(t("pruefzweigBelegt", { zweig }));
    fehler.pruefzweigBelegt = true;
    throw fehler;
  }
  await host.pushRef(commit, zweig);
  try {
    const ci = await warteAufLauf(host, commit, zweig, o);
    const fertig = abgeschlossen(ci);
    return {
      commit,
      gefunden: (ci?.jobs || []).length > 0,
      abgeschlossen: fertig,
      jobs: fertig ? ci.jobs.map((j) => j.name) : [],
      ci,
    };
  } finally {
    await host.deleteRef(zweig);
  }
}

async function warteAufLauf(host, commit, zweig, o) {
  const start = o.jetzt();
  let minuten = 0;
  for (;;) {
    const ci = await host.getCiStatus(commit, zweig);
    const vergangen = o.jetzt() - start;
    if (abgeschlossen(ci)) return ci;
    const gefunden = (ci?.jobs || []).length > 0;
    if (!gefunden && vergangen >= o.fristLauf) return ci;
    if (vergangen >= o.fristAbschluss) return ci;
    await o.schlafe(o.takt);
    const jetzt = Math.floor((o.jetzt() - start) / MINUTE_MS);
    if (jetzt > minuten) {
      minuten = jetzt;
      o.melde(t(gefunden ? "probeLaeuft" : "probeOhneLauf", { zweig, minuten }));
    }
  }
}

/** Der Schritt, der offen bleibt, wenn der Build-Dienst auf dem Pruefzweig nicht laeuft (A4). */
function offenerSchritt(mainBranch, zweig) {
  const kommando = `node .claude/kit/checks.mjs run --stufe push --since "$(git merge-base HEAD origin/${mainBranch})"`;
  return t("offenerSchritt", { zweig, kommando });
}

/**
 * Richtet den Schutz ein (A3, A4, A9). Liefert eines von vier Ergebnissen:
 * - `nicht moeglich` mit `grund`: Code-Host ohne Schutz, `origin/<mainBranch>` fehlt oder
 *   `gh` schlaegt fehl — ohne Aenderung am Code-Host;
 * - `offen` mit `schritt`: Der Build-Dienst lief auf dem Pruefzweig nicht (zu Ende);
 * - `anleitung` mit `anleitung`: ohne Admin-Recht oder bei 403 — der Mensch richtet ein;
 * - `scharf`: Rulesets fuer `mainBranch` und, falls gesetzt, `productionBranch` stehen.
 * Eine rote Probe schaltet ebenfalls scharf: Gefragt ist, ob der Build-Dienst laeuft, nicht
 * ob der Stand gruen ist (A4). Ein schon stehender Pruefzweig bricht mit BoardError ab (E7).
 */
export async function einrichten(host, config, zweig, optionen = {}) {
  const unterstuetzt = typeof host.schutzUnterstuetzt === "function"
    ? host.schutzUnterstuetzt()
    : { ja: false, grund: t("keinSchutz") };
  if (!unterstuetzt.ja) return { ergebnis: "nicht moeglich", grund: unterstuetzt.grund };

  const o = vorgaben(optionen);
  const mainBranch = config?.mainBranch || "main";
  if (!o.kopfVon(mainBranch)) {
    return { ergebnis: "nicht moeglich", grund: t("originFehlt", { zweig: mainBranch }) };
  }

  let admin;
  let ergebnis;
  try {
    admin = await host.hatAdminRecht();
    ergebnis = await probe(host, config, zweig, o);
  } catch (e) {
    if (e.pruefzweigBelegt) throw e;
    return { ergebnis: "nicht moeglich", grund: e.message };
  }
  if (!ergebnis.abgeschlossen) {
    const grund = t(ergebnis.gefunden ? "nichtZuEnde" : "keinLauf", { zweig });
    return { ergebnis: "offen", grund, schritt: offenerSchritt(mainBranch, zweig) };
  }

  return scharfSchalten(host, config, ergebnis.jobs, admin);
}

/**
 * Der Schluss von `einrichten` nach einer abgeschlossenen Probe: Rulesets fuer `mainBranch`
 * und, falls gesetzt, `productionBranch` — oder die Anleitung, wenn das Admin-Recht fehlt
 * oder der Code-Host mit 403 abweist (A9).
 */
async function scharfSchalten(host, config, jobs, admin) {
  const soll = [rulesetSoll(config?.mainBranch || "main", jobs, "haupt")];
  if (config?.productionBranch) soll.push(rulesetSoll(config.productionBranch, jobs, "veroeffentlichung"));
  const zurAnleitung = (grund) => ({ ergebnis: "anleitung", grund, jobs, anleitung: anleitung(soll) });
  if (!admin) return zurAnleitung(t("ohneAdmin"));
  const rulesets = [];
  for (const s of soll) {
    try {
      rulesets.push(await host.upsertRuleset(s));
    } catch (e) {
      if (e.httpStatus === 403) return zurAnleitung(t("abgewiesen403", { fehler: e.message }));
      throw e;
    }
  }
  return { ergebnis: "scharf", jobs, rulesets };
}

/**
 * Prueft einen Stand auf dem Hauptzweig nach, der ohne Nachweis des Build-Dienstes dorthin
 * kam (A7): derselbe Weg wie die Probe — Kopf erneut auf den Pruefzweig, warten mit
 * Zweigfilter, Zweig loeschen. Liefert `{ commit, zweig, status, jobs }`; `status` ist das
 * Urteil des Build-Dienstes oder `offen`, wenn kein Lauf zu Ende kam.
 */
export async function nachpruefen(host, config, zweig, optionen = {}) {
  const ergebnis = await probe(host, config, zweig, optionen);
  return {
    commit: ergebnis.commit,
    zweig,
    status: ergebnis.abgeschlossen ? ergebnis.ci.status : "offen",
    jobs: ergebnis.ci?.jobs || [],
  };
}
