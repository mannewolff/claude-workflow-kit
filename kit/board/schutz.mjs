/**
 * board/schutz.mjs — der Schutz von Haupt- und Veroeffentlichungszweig ohne Host-Details
 * (Issue #1407, Plan #1405): Zustand ableiten, Ruleset-Soll, Anleitung, Notfall-Gate und
 * Nacht-Sperre.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus.
 *
 * Alles, was den Code-Host betrifft, geht ueber die Operationen des Adapters (Issue #1406):
 * `schutzUnterstuetzt`, `getRulesets`, `getCiStatus`. Das Notfall-Gate laedt
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

// Der Satz aus Plan #1405, E10: Bis das Ruleset wieder steht, sagt `status`, was fehlt.
export const SCHUTZ_AUSGESETZT = "Schutz des Hauptzweigs ausgesetzt";
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
  if (!ARTEN.includes(art)) throw new BoardError(`Ruleset-Art '${art}' unbekannt. Erwartet: ${ARTEN.join(" | ")}`);
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
    if (!typen.has(regel.type)) befund.push(`Regel ${regel.type} fehlt`);
  }
  const sollJobs = soll.regeln.find((r) => r.type === "required_status_checks")
    .parameters.required_status_checks.map((c) => c.context);
  if (sollJobs.length === 0 || !gleicheMenge(stehend.requiredStatusChecks || [], sollJobs)) {
    befund.push(`Pflichtjobs ${liste(stehend.requiredStatusChecks)} statt ${liste(sollJobs)}`);
  }
  if ((stehend.bypassActors || []).length > 0) befund.push("Bypass-Liste nicht leer");
  if (soll.art === "veroeffentlichung") {
    const pr = (stehend.regeln || []).find((r) => r.type === "pull_request");
    const freigaben = pr?.parameters?.required_approving_review_count;
    if (pr && freigaben !== 0) befund.push(`pull_request verlangt ${freigaben} Freigabe(n) statt 0`);
  }
  return befund;
}

function gleicheMenge(a, b) {
  return a.length === b.length && b.every((x) => a.includes(x));
}

function liste(werte) {
  return Array.isArray(werte) && werte.length > 0 ? werte.join(", ") : "(keine)";
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
    : { ja: false, grund: "Der Code-Host kennt keinen Schutz." };
  if (!unterstuetzt.ja) return { geschuetzt: false, fehlt: [unterstuetzt.grund], ungeprueft: null };

  const mainBranch = config?.mainBranch || "main";
  const productionBranch = config?.productionBranch || "production";
  const fehlt = [];
  if (config?.pushPruefung?.ort !== "buildDienst") {
    fehlt.push("Pruefung vor dem Push nicht im Build-Dienst (pushPruefung)");
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
      fehlt.push(`Ruleset '${rulesetName(zweig)}' fehlt`);
      continue;
    }
    if (stehend.enforcement !== "active") {
      fehlt.push(art === "haupt" ? SCHUTZ_AUSGESETZT : `Ruleset '${rulesetName(zweig)}' ausgesetzt`);
    }
    const befund = abweichungen(stehend, rulesetSoll(zweig, jobs, art));
    if (befund.length > 0) fehlt.push(`Ruleset '${rulesetName(zweig)}' weicht ab: ${befund.join("; ")}`);
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
      `3. Target branches → Add target → Include by pattern: ${s.zweig} (Zielzweig: ${s.zweig})`,
      "4. Bypass list: leer lassen, keine Rolle und kein Nutzer",
      "5. Regeln einschalten:",
      ...s.regeln.map((r) => `   - ${REGEL_TEXT[r.type] || r.type}`),
      `6. Bei Require status checks to pass diese Jobs als Pflichtpruefung eintragen: ${jobs.join(", ")}`,
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
    const warum = bezeugt.rot?.hinweis || (bezeugt.rot?.pruefung ? `rot: ${bezeugt.rot.pruefung}` : "kein gruener Lauf");
    return { ok: false, grund: `Kein gruener voller Lauf der Stufe push im Worktree (${warum}). Erst: node .claude/kit/checks.mjs run --stufe push --wiederholen` };
  }
  if (bezeugt.stufe !== "push") {
    return { ok: false, grund: `Der letzte gruene Lauf hatte die Stufe ${bezeugt.stufe ?? "(unbekannt)"}, verlangt ist push.` };
  }
  let hashes = null;
  try {
    hashes = JSON.parse(readFileSync(join(pfad, ".claude", "checks-summary.json"), "utf-8")).hashes ?? null;
  } catch {
    // oben schon als gruen gelesen; faellt hier nur bei einem Wettlauf weg — unten abgelehnt
  }
  if (hashes === null || typeof hashes !== "object") {
    return { ok: false, grund: "Die Zusammenfassung nennt keine Blob-Hashes; der gepruefte Stand ist nicht belegt." };
  }
  let jetzt;
  try {
    jetzt = blobHashes(Object.keys(hashes), pfad);
  } catch (e) {
    return { ok: false, grund: `Der Stand der geprueften Dateien liess sich nicht lesen: ${e.message}` };
  }
  if (!hashesGleich(hashes, jetzt)) {
    const geaendert = Object.keys(hashes).filter((d) => hashes[d] !== jetzt[d]);
    return { ok: false, grund: `Seit dem Lauf geaendert: ${geaendert.join(", ")} — der Stand ist nicht mehr der gepruefte.` };
  }
  return { ok: true };
}

/**
 * Die Sperre der Nacht (E8): Mit gesetztem `KIT_AGENT_MODEL` brechen `einrichten`,
 * `aussetzen` und `nachpruefen` ab; `status` bleibt erlaubt.
 */
export function nachtSperre(aktion, env = process.env) {
  if (env.KIT_AGENT_MODEL && NACHT_GESPERRT.includes(aktion)) {
    throw new BoardError(`code schutz ${aktion} ist ohne Aufsicht gesperrt (KIT_AGENT_MODEL gesetzt): `
      + "Die Aktion pusht oder aendert den Code-Host, und die Nacht pusht nie. Nur status ist erlaubt.");
  }
}
