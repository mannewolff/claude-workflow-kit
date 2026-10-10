/**
 * board/issue-review.mjs — Issue-Review-Achse des Board-Werkzeugs (Issue #1221, Plan #1199, E17):
 * Reviewer-Auswahl, Pruefstufen, Verfuegbarkeit mit Probelauf und die Befehle
 * `issue-review reviewers | roles | matrix | check | pruefauftrag | start`.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus. Darum bekommt `dispatchIssueReview` die Hilfe als Argument.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BoardError, fail, out, loadConfig, findeImPath, umgebungsWert, configWurzel } from "./grundlagen.mjs";
import { istFachlich, istPlan, herkunftNummern, normalisiereZeilenenden } from "./dokumente.mjs";
import { resolveTracker } from "./adapter.mjs";

// ============================================================
// Issue-Review-Achse (Issue #220)
// ============================================================
//
// Ein Issue ist die Quelle der Wahrheit fuer die Implementierung — ein Fehler darin
// pflanzt sich in die ganze Umsetzung fort. Der Autor sieht ihn nicht, weil er den
// Kontext im Kopf hat, aus dem das Issue entstanden ist. Deshalb pruefen zwei andere
// Modelle, und deshalb ist der Autor hier nie sein eigener Reviewer.
//
// Reviewer sind ein Adapter, keine Modell-Liste: `kind: "claude"` laeuft ueber das
// Agent-Tool, `kind: "command"` ueber ein beliebiges fremdes CLI. Damit nehmen auch
// Modelle aus anderen Haeusern teil — die teilen die blinden Flecken einer Familie
// nicht. Das Kit kennt das fremde Werkzeug nicht und muss es nicht kennen.

const REVIEWER_KINDS = ["claude", "command"];

// Die drei Stufen der Pruefung (Issue #278): das fachliche Anliegen, der Plan dorthin,
// das einzelne Arbeitspaket. Jede schaut anders hin und ist anders besetzt — fachlich
// und Plan mit je zwei Reviewern, das Arbeitspaket mit einem.
const REVIEW_STUFEN = ["fachlich", "plan", "issue"];

// Rueckfallebene, wenn `reviewStufen` ganz fehlt: je Stufe die Rollen des Rollenkatalogs,
// ein Reviewer je Rolle (Plan #1375, E5). Jede Rolle braucht ihren Wortlaut unter
// kit/rollen/ — eine Vorgaberolle ohne Datei liesse jeden Pruefer eines Projekts ohne
// `reviewStufen` ausfallen. Die Stufe issue hat nur eine Rolle und darum einen Pruefer.
// SYNC: STUFEN_VORGABE in kit/einstellungen.mjs
const REVIEW_STUFEN_DEFAULT = {
  fachlich: { reviewer: 2, rollen: ["form-beobachtbarkeit", "abgrenzung"] },
  plan: { reviewer: 2, rollen: ["architektur-bestand", "schnitt-abhaengigkeiten"] },
  issue: { reviewer: 1, rollen: ["pruefbarkeit"] },
};

// Die Rollen der Stufe plan, aus denen eine vom Lauf erhoehte Pruefzahl aufgefuellt wird
// (Issue #1245). Abgeschrieben statt importiert: kit/einstellungen.mjs ist ein Download
// und wird nicht nach .claude/kit/ gespiegelt (Plan #1243, Review-Fund 1).
// SYNC: ROLLEN_KATALOG.plan in kit/einstellungen.mjs
const PLAN_ROLLEN = ["architektur-bestand", "schnitt-abhaengigkeiten"];

/**
 * Uebersetzt einen Autor-Wert auf einen Reviewer-Kurznamen (Issue #241).
 *
 * `/issues` schreibt die volle Modell-ID in den Kontext-Abschnitt
 * (`Autor-Modell: claude-opus-5`), `pairs` und `reviewers[].name` benutzen Kurznamen
 * (`opus`). Ohne Uebersetzung greift `pairs` nicht — und der Regel-Zweig filtert ueber
 * `r.name !== autor`, wo `"opus" !== "claude-opus-5"` wahr ist: Der Autor bleibt im
 * Kandidatenfeld und prueft sein eigenes Issue. Genau das, was `pairs` aus Issue #225
 * verhindern sollte, nur eine Ebene tiefer.
 *
 * Die Zuordnung steht schon in der Config — `reviewers[].model`. Es braucht deshalb
 * weder eine zweite Tabelle noch eine Heuristik auf Namensbestandteilen.
 *
 * Rueckgabe `null`, wenn nichts trifft: Das ist der erlaubte Fall (aelteres Issue ohne
 * Autor-Zeile, ein Mensch als Autor) — er soll nur nicht mehr stumm bleiben.
 */
function aufloesenAutor(alle, autor) {
  if (!autor) return null;
  const liste = alle || [];
  if (liste.some((r) => r.name === autor)) return autor;
  // `model` ist bei kind:"command" nicht gesetzt; der Vergleich gegen undefined
  // duerfte niemals treffen, deshalb die Existenzpruefung.
  const perModell = liste.find((r) => r.model && r.model === autor);
  return perModell ? perModell.name : null;
}

/**
 * Waehlt die Reviewer fuer ein Issue: die ersten `anzahl` Eintraege, deren Name nicht
 * der Autor ist. Reine Funktion — die Reihenfolge der Config ist die Steuerung, wer
 * eine feste Paarung will, sortiert entsprechend.
 *
 * `unterbesetzt` statt eines Fehlers, wenn zu wenige uebrig bleiben: Der Skill
 * entscheidet, ob er mit einem Reviewer faehrt — er muss es nur sichtbar machen.
 *
 * `autorAufgeloest` sagt, ob der uebergebene Autor einem Reviewer zugeordnet werden
 * konnte. Bei `false` ist die Auswahl unveraendert gueltig, beruht aber nicht auf einem
 * erkannten Autor — ein Aufrufer ohne Menschen davor soll das sehen koennen.

 */
// SYNC: dieselbe Wahl bildet kit/einstellungen.mjs (waehleReviewer) fuer die Oberflaeche nach.
export function pickReviewers(alle, autor, anzahl = 2, pairs = {}) {
  const aufgeloest = aufloesenAutor(alle, autor);
  const schluessel = aufgeloest ?? autor;
  const gesperrt = new Set([schluessel]);

  // Explizite Zuordnung schlaegt die Regel (Issue #225). Ohne sie waehlt die Regel
  // immer die vordersten Eintraege — bei vier Reviewern kam der vierte nie zum Zug,
  // ausgerechnet das Modell aus dem fremden Haus. Und wer wissen will, wer sein Issue
  // prueft, soll es ablesen koennen statt es auszurechnen.
  const eintrag = pairs?.[schluessel];
  const genannt = Array.isArray(eintrag) ? eintrag.filter((n) => !gesperrt.has(n)) : [];
  if (genannt.length > 0) {
    // Auch hier auf `anzahl` kuerzen, nicht nur im Regel-Zweig unten (Issue #278):
    // Sonst liefert eine Stufe mit einem Reviewer trotzdem beide Namen aus der
    // Paar-Tabelle — der eine Reviewer waere stillschweigend zwei geblieben.
    // Gekuerzt wird in konfigurierter Reihenfolge, sie ist die Steuerung.
    const gewaehlt = genannt.map((n) => (alle || []).find((r) => r.name === n)).filter(Boolean).slice(0, anzahl);
    return { gewaehlt, unterbesetzt: gewaehlt.length < anzahl, quelle: "pairs", autorAufgeloest: aufgeloest !== null };
  }
  const passend = (alle || []).filter((r) => !gesperrt.has(r.name));
  const gewaehlt = passend.slice(0, anzahl);
  return { gewaehlt, unterbesetzt: gewaehlt.length < anzahl, quelle: "regel", autorAufgeloest: aufgeloest !== null };
}

// Beide Faelle sind harte Fehler, aus derselben Begruendung wie validateReviewers:
// Ein stiller Skip verwandelt einen Tippfehler in einen unsichtbaren Ein-Reviewer-Lauf.
// Und ein Autor, der sich selbst nennt, hebelt den Zweck des Verfahrens aus — das
// gehoert beim Schreiben der Config bemerkt, nicht beim Lesen des Review-Berichts.
// SYNC: dieselbe Regel prueft kit/einstellungen.mjs (regelPaare) vor dem Speichern.
function validatePairs(pairs, reviewers) {
  const bekannt = new Set(reviewers.map((r) => r.name));
  for (const [autor, genannt] of Object.entries(pairs || {})) {
    const wo = `issueReview.pairs['${autor}']`;
    if (!Array.isArray(genannt)) fail(`${wo}: muss eine Liste von Reviewer-Namen sein.`);
    for (const name of genannt) {
      if (name === autor) fail(`${wo}: nennt '${autor}' sich selbst — der Autor darf nicht sein eigener Reviewer sein.`);
      if (!bekannt.has(name)) fail(`${wo}: '${name}' steht nicht in issueReview.reviewers.`);
    }
  }
  return pairs || {};
}

// Eine halb ausgefuellte Reviewer-Definition still zu ueberspringen wuerde einen
// Tippfehler in einen unsichtbaren Ein-Reviewer-Lauf verwandeln — und der sieht am
// Board aus wie ein vollstaendiger. Deshalb harter Fehler mit sprechender Meldung.
function validateReviewers(reviewers) {
  reviewers.forEach((r, i) => {
    const wo = `issueReview.reviewers[${i}]`;
    if (!r || typeof r.name !== "string" || !r.name) fail(`${wo}: 'name' fehlt oder ist leer.`);
    if (!REVIEWER_KINDS.includes(r.kind)) {
      fail(`${wo} ('${r.name}'): 'kind' muss ${REVIEWER_KINDS.join(" oder ")} sein, ist '${r.kind}'.`);
    }
    if (r.kind === "claude" && !r.model) fail(`${wo} ('${r.name}'): 'model' fehlt.`);
    if (r.kind === "command" && !r.command) fail(`${wo} ('${r.name}'): 'command' fehlt.`);
    if (r.lesegrenze !== undefined && r.kind !== "command") fail(`${wo} ('${r.name}'): 'lesegrenze' gilt nur bei kind 'command'.`);
    if (r.lesegrenze !== undefined && typeof r.lesegrenze !== "string") fail(`${wo} ('${r.name}'): 'lesegrenze' muss ein Text sein.`);
  });
  return reviewers;
}

/**
 * Liest den `reviewStufen`-Block und prueft ihn (Issue #278).
 *
 * Hart wie im uebrigen Config-Bereich, aus derselben Begruendung wie validateReviewers
 * und validatePairs: Ein stiller Skip verwandelt einen Tippfehler in einen unsichtbaren
 * unterbesetzten Lauf — und der sieht am Board aus wie ein vollstaendiger.
 *
 * Defaults greifen ausschliesslich, wenn der GESAMTE Block fehlt. Waere eine einzelne
 * vergessene Stufe auch still ergaenzt, liesse sie sich von einer bewussten
 * Rueckfallebene nicht unterscheiden.
 */
// SYNC: die Regel rollen.length === reviewer prueft kit/einstellungen.mjs (regelRollenzahl) vor dem Speichern.
function validateReviewStufen(block) {
  if (block === undefined || block === null) {
    return { stufen: Object.fromEntries(REVIEW_STUFEN.map((s) => [s, REVIEW_STUFEN_DEFAULT[s]])), stufenQuelle: "default" };
  }
  if (typeof block !== "object" || Array.isArray(block)) {
    fail(`reviewStufen: muss ein Objekt mit den Stufen ${REVIEW_STUFEN.join(", ")} sein.`);
  }
  const stufen = {};
  for (const stufe of REVIEW_STUFEN) {
    const wo = `reviewStufen.${stufe}`;
    const eintrag = block[stufe];
    if (!eintrag || typeof eintrag !== "object" || Array.isArray(eintrag)) {
      fail(`${wo}: fehlt oder ist kein Objekt mit 'reviewer' und 'rollen'.`);
    }
    const { reviewer, rollen } = eintrag;
    if (!Number.isInteger(reviewer) || reviewer < 1) {
      fail(`${wo}.reviewer: muss eine positive Ganzzahl sein, ist '${reviewer}'.`);
    }
    if (!Array.isArray(rollen)) fail(`${wo}.rollen: muss eine Liste von Rollennamen sein.`);
    rollen.forEach((name, i) => {
      if (typeof name !== "string" || !name) fail(`${wo}.rollen[${i}]: muss ein nicht leerer Rollenname sein.`);
    });
    if (new Set(rollen).size !== rollen.length) fail(`${wo}.rollen: nennt einen Rollennamen doppelt.`);
    if (rollen.length !== reviewer) {
      fail(`${wo}: rollen.length (${rollen.length}) stimmt nicht mit reviewer (${reviewer}) ueberein.`);
    }
    stufen[stufe] = { reviewer, rollen };
  }
  return { stufen, stufenQuelle: "stufen" };
}

/**
 * Pruefzahl der Stufe plan aus dem Lauf (Issue #1245, Plan #1243, A8 und E2).
 *
 * Der Runner traegt `planreview:<n>` als KIT_PLAN_REVIEWER in die Review-Session; der
 * Wert gilt vor `reviewStufen`, ohne die Config zu aendern. Die Rollen kommen aus dem
 * Config-Eintrag `eintrag`, gekuerzt auf die Zahl oder aus PLAN_ROLLEN aufgefuellt.
 * `verfuegbar` ist die Zahl der Reviewer, die fuer diesen Autor in Frage kommen.
 *
 * Rein und werfend statt `fail` (A8): Ein Test prueft jeden Fall im selben Prozess.
 * Zwei verlangt und nur einer verfuegbar ist ein Fehler, kein `unterbesetzt` — sonst
 * liefe die Pruefung still mit einem Modell (Review-Fund 6). Ohne Wert: `null`.
 */
export function planReviewerAusLauf({ env = process.env, eintrag, verfuegbar }) {
  const wert = env.KIT_PLAN_REVIEWER;
  if (wert === undefined || wert === "") return null;
  if (wert !== "1" && wert !== "2") {
    throw new BoardError(`KIT_PLAN_REVIEWER '${wert}' ist ungueltig — erlaubt sind 1 oder 2.`);
  }
  const reviewer = Number(wert);
  if (reviewer > verfuegbar) {
    throw new BoardError("planreview:2 verlangt zwei Reviewer, verfügbar ist einer");
  }
  const rollen = eintrag.rollen.slice(0, reviewer);
  for (const rolle of PLAN_ROLLEN) {
    if (rollen.length >= reviewer) break;
    if (!rollen.includes(rolle)) rollen.push(rolle);
  }
  return { reviewer, rollen, stufenQuelle: "lauf" };
}

// Die Config ist injizierbar (Plan #1199, E6): Ein Test reicht sie im selben Prozess
// herein, statt dafuer ein Fixture-Verzeichnis und einen Kindprozess zu brauchen.
function issueReviewConfig(config = loadConfig()) {
  const block = config.issueReview || {};
  const reviewers = validateReviewers(Array.isArray(block.reviewers) ? block.reviewers : []);
  return {
    reviewers,
    pairs: validatePairs(block.pairs, reviewers),
    // `reviewStufen` steht auf oberster Ebene, nicht in `issueReview`: Die Besetzung
    // gilt fuer die drei Stufen der Pruefung, waehrend `issueReview` beschreibt, WER
    // ueberhaupt prueft. Geprueft wird trotzdem hier, damit ein kaputter Block bei
    // jedem issue-review-Befehl auffaellt und nicht erst beim ersten `roles`.
    reviewStufen: validateReviewStufen(config.reviewStufen),
  };
}


// ============================================================
// Lesegrenze fremder Pruefer (Issue #1381, Plan #1375, A5, A6)
// ============================================================
//
// Ein fremder Pruefer darf nur lesen. Die Grenze setzt das Kit, nicht die Bitte im Auftrag:
// Es haengt die Argumente der Lesegrenze als letzte an die Kommandozeile. Das Kit kennt
// fremde Werkzeuge nicht, darum zwei Quellen — eine kleine Tabelle fuer bekannte Werkzeuge
// und das Feld `lesegrenze` (bzw. `reviewLesegrenze` fuer reviewCommand), das sie schlaegt.

const LESEGRENZE_TABELLE = { codex: ["--sandbox", "read-only"] };

// Die Lesegrenze eines Claude-Pruefers ist der Leser-Agent mit der Positivliste Read, Grep, Glob.
const CLAUDE_LESEGRENZE = "kit-pruefer";

const woerter = (text) => text.trim().split(/\s+/).filter(Boolean);

/** Argumente der Lesegrenze, `null` heisst: keine bekannt. Ein leeres Feld ist keine Grenze. */
export function lesegrenzeVon({ command, lesegrenze }) {
  if (typeof lesegrenze === "string" && lesegrenze.trim()) return woerter(lesegrenze);
  return LESEGRENZE_TABELLE[basename(woerter(command)[0] ?? "")] ?? null;
}

// Schalter, die die Grenze aufheben oder ueberschreiben koennen (A6, Review-Fund 7). Erkannt
// werden auch die Formen mit `=` und mit angehaengtem Wert (`-sX`, `-cX`, `-pX`).
const AUFHEBEND = new Set(["--full-auto", "--dangerously-bypass-approvals-and-sandbox"]);

function optionswert(argumente, i, lang, kurz) {
  const t = argumente[i];
  if (t === lang || t === kurz) return argumente[i + 1] ?? "";
  if (t.startsWith(`${lang}=`)) return t.slice(lang.length + 1);
  if (t.startsWith(kurz) && !t.startsWith("--")) return t.slice(kurz.length);
  return null;
}

/** Der erste Schalter in `argumente`, der die Lesegrenze aufhebt, sonst `null`. */
function aufhebenderSchalter(argumente) {
  for (let i = 0; i < argumente.length; i += 1) {
    const t = argumente[i];
    if (AUFHEBEND.has(t)) return t;
    const sandbox = optionswert(argumente, i, "--sandbox", "-s");
    if (sandbox !== null && sandbox !== "read-only") return `${t} ${sandbox}`.trim();
    const schluessel = optionswert(argumente, i, "--config", "-c");
    if (schluessel?.startsWith("sandbox")) return `${t} ${schluessel}`.trim();
    if (optionswert(argumente, i, "--profile", "-p") !== null) return t;
  }
  return null;
}

/**
 * Argumente fuer den Start ohne Shell: Kommandozeile ohne erstes Wort, dahinter die
 * Lesegrenze. Antwort `{ argumente, lesegrenze }` oder `{ fehler, grund[, schalter] }`.
 */
function startArgumente(command, lesegrenze) {
  const grenze = lesegrenzeVon({ command, lesegrenze });
  if (grenze === null) return { fehler: "keine-lesegrenze", grund: "keine Lesegrenze" };
  const argumente = [...woerter(command).slice(1), ...grenze];
  const schalter = aufhebenderSchalter(argumente);
  if (schalter !== null) return { fehler: "lesegrenze-aufgehoben", schalter, grund: `'${schalter}' hebt die Lesegrenze auf` };
  return { argumente, lesegrenze: grenze.join(" ") };
}

// Verfuegbarkeit eines Kommandos: Das erste Wort muss als startbare Datei auffindbar
// sein — eine Dateisystem-Pruefung statt `command -v`, das eine Shell braucht (Issue #196).
// Liefert zusaetzlich den aufgeloesten Pfad — der Probelauf unten startet damit, statt
// noch einmal zu suchen. Umgebung und Dateisystem sind injizierbar wie bei `findeImPath`.
export function kommandoVerfuegbar(kommandozeile, { env = process.env, existiert, ausfuehrbar } = {}) {
  const datei = kommandozeile.trim().split(/\s+/)[0];
  const pfad = findeImPath(datei, { path: umgebungsWert(env, "PATH"), existiert, ausfuehrbar });
  return { datei, ok: pfad !== null, pfad };
}

// Ein Prompt, der nichts verlangt: Der Probelauf startet ein frei konfiguriertes
// fremdes Werkzeug, das seinerseits ein Agent sein kann. Er soll feststellen, ob es
// laeuft — nicht, was es kann.
// KIT_PROBE_PROMPT ist ein Test-Hook (dasselbe Muster wie KIT_PROBE_TIMEOUT_MS): Nur
// mit einem Prompt oberhalb des Pipe-Puffers laesst sich EPIPE deterministisch
// erzeugen, also der Fall, dass das Kommando weg ist, bevor der Prompt geschrieben
// wurde (Issue #393).
const PROBE_PROMPT = process.env.KIT_PROBE_PROMPT || "Antworte nur mit dem Wort OK.\n";

// Zeitlimit ist Pflicht, nicht Kuer: Ein haengender Reviewer ist fuer den Vorflug
// dasselbe Problem wie ein fehlender, und ohne Limit haengt der Vorflug mit.
// KIT_PROBE_TIMEOUT_MS ist ein Test-Hook (dasselbe Muster wie NIGHT_TIMEOUT_MS).
const PROBE_TIMEOUT_MS = Number(process.env.KIT_PROBE_TIMEOUT_MS) || 60_000;

/**
 * Startet ein Reviewer-Kommando einmal mit einem harmlosen Prompt ueber stdin.
 *
 * Der Grund (Issue #262): Die PATH-Suche sagt, dass etwas startbar ist, nicht dass es
 * benutzbar ist. Am 2026-08-08 lag `codex` im PATH und scheiterte trotzdem bei jedem
 * Aufruf an einem HTTP 400 — der Vorflug meldete `verfuegbar`, und nachts haette der
 * Lauf mit einem toten Reviewer begonnen.
 *
 * Ohne Shell, wie alles in dieser Datei (Issue #196): Die Kommandozeile wird am
 * Whitespace zerlegt und als argv uebergeben. Dieselbe Annahme wie in
 * kommandoVerfuegbar — eine Reviewer-Kommandozeile mit Quotes oder Pipes ist damit
 * nicht abgedeckt, und das ist der Preis dafuer, dass keine Shell dazwischen steht.
 * Gestartet wird `pfad` aus kommandoVerfuegbar.
 *
 * `spawn`, Prompt, Zeitlimit und Umgebung sind injizierbar (Plan #1199, E6): Ein Test
 * reicht ein Ergebnis von spawnSync herein und belegt jeden Ausgang im selben Prozess,
 * ohne Attrappe, die haengt oder abstuerzt.
 */
export function probelauf(kommandozeile, pfad, { spawn = spawnSync, prompt = PROBE_PROMPT, timeoutMs = PROBE_TIMEOUT_MS, env = process.env } = {}) {
  const argumente = kommandozeile.trim().split(/\s+/).slice(1);
  const res = spawn(pfad, argumente, { input: prompt, encoding: "utf-8", timeout: timeoutMs, env });
  if (res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM") {
    return { ok: false, grund: `Zeitlimit von ${timeoutMs} ms ueberschritten` };
  }
  // Der Exit-Status schlaegt den Fehler (Issue #393). Endet das Kommando, bevor der
  // Prompt in seine stdin geschrieben ist, meldet spawnSync EPIPE — zusaetzlich zum
  // Status und zusaetzlich zu dem, was in stderr steht. Wer den Fehler zuerst prueft,
  // gibt `spawnSync ... EPIPE` aus und wirft genau die Auskunft weg, fuer die es den
  // Probelauf gibt.
  if (res.status !== null) {
    if (res.status === 0) return { ok: true };
    // Die Fehlermeldung des Werkzeugs ist die eigentliche Auskunft — sie sagt, ob ein
    // Modell fehlt, ein Token abgelaufen ist oder etwas ganz anderes klemmt.
    const letzte = (res.stderr || "").trim().split(/\r?\n/).findLast(Boolean);
    return { ok: false, grund: (letzte || `Exit ${res.status}`).slice(0, 300) };
  }
  if (res.error) return { ok: false, grund: res.error.message };
  // Kein Status und kein Fehler heisst: durch ein Signal gestorben (SIGSEGV, SIGKILL).
  // Ohne diesen Zweig fiele der Fall auf `ok: true` durch, und ein abgestuerzter
  // Reviewer gaelte als verfuegbar.
  return { ok: false, grund: `Durch Signal ${res.signal} beendet` };
}

// Die Befehle unten liefern ihre Antwort zurueck, statt sie auszugeben; `dispatchIssueReview`
// gibt sie aus. So prueft ein Test die Antwort im selben Prozess (Plan #1199, E6).
export function issueReviewReviewers(args, config = loadConfig()) {
  const autor = args.author === true ? fail("--author braucht einen Wert") : args.author;
  const { reviewers, pairs } = issueReviewConfig(config);
  return { autor: autor || null, ...pickReviewers(reviewers, autor, 2, pairs) };
}

/**
 * Besetzung und Blickwinkel einer Pruefstufe (Issue #278; gekuerzt in Plan #638, A15).
 *
 * `--author` ist verpflichtend, nicht bequem: `pickReviewers` braucht den Autor fuer
 * `pairs` und fuer den Selbstausschluss. Ohne ihn koennte der Befehl genau das nicht
 * leisten, wofuer es ihn gibt — und wuerde trotzdem eine Reviewer-Liste ausgeben.
 *
 * Zwei Quellen, zwei Felder: `quelle` bleibt die Quelle der Reviewer-AUSWAHL
 * ("pairs" | "regel", Bestandsverhalten), `stufenQuelle` nennt die Herkunft der
 * STUFENBESETZUNG ("stufen" | "default", bei der Stufe plan auch "lauf" aus
 * KIT_PLAN_REVIEWER, Issue #1245).
 *
 * `--issue`, `--rolle` und `--ausschluss` sind mit der Pruefvorgabe und der
 * Synthese-Pruefung entfallen. Sie werden abgewiesen statt still uebergangen: Ein
 * stilles Flag waere eine zweite Wahrheit ueber das, was das Kommando tut.
 */
const ROLES_ENTFALLEN = ["issue", "rolle", "ausschluss"];

export function issueReviewRoles(args, config = loadConfig(), env = process.env) {
  for (const option of ROLES_ENTFALLEN) {
    if (args[option] !== undefined) {
      fail(`--${option} gibt es seit Stufe 2 des Prozess-Umbaus nicht mehr — roles kennt nur --stufe und --author.`);
    }
  }
  const stufe = args.stufe === true ? fail("--stufe braucht einen Wert") : args.stufe;
  if (!stufe) fail(`--stufe fehlt. Erwartet: ${REVIEW_STUFEN.join(" | ")}`);
  if (!REVIEW_STUFEN.includes(stufe)) {
    fail(`--stufe '${stufe}' ist keine bekannte Stufe. Erwartet: ${REVIEW_STUFEN.join(" | ")}`);
  }
  const autor = args.author === true ? fail("--author braucht einen Wert") : args.author;
  if (!autor) fail("--author fehlt — ohne Autor greifen weder pairs noch der Selbstausschluss.");

  const { reviewers, pairs, reviewStufen } = issueReviewConfig(config);
  // Bei der Stufe plan schlaegt die Pruefzahl des Laufs die Config (Issue #1245).
  // Verfuegbar ist, wen die Auswahl fuer zwei Plaetze faende — dieselbe Wahl wie unten.
  const ausLauf = stufe === "plan"
    ? planReviewerAusLauf({ env, eintrag: reviewStufen.stufen.plan, verfuegbar: pickReviewers(reviewers, autor, 2, pairs).gewaehlt.length })
    : null;
  const { reviewer, rollen, stufenQuelle } = ausLauf ?? { ...reviewStufen.stufen[stufe], stufenQuelle: reviewStufen.stufenQuelle };
  return {
    stufe,
    reviewer,
    rollen,
    // Je Rolle, ob ihr Wortlaut unter kit/rollen/ liegt (Issue #1381): Fehlt er, faellt der
    // Pruefer dieser Rolle aus, und der Skill bucht das in Zeile 2.
    rollenDateien: rollenDateien(rollen),
    stufenQuelle,
    autor,
    ...pickReviewers(reviewers, autor, reviewer, pairs),
  };
}

// Die Tabelle, nach der man eigentlich fragt: wer prueft wen. Autoren sind alle
// Reviewer-Namen plus alle pairs-Schluessel — letztere auch dann, wenn sie selbst nicht
// als Reviewer auftreten (ein Modell kann schreiben, ohne zu pruefen).
export function issueReviewMatrix(config = loadConfig()) {
  const { reviewers, pairs } = issueReviewConfig(config);
  const autoren = [...new Set([...reviewers.map((r) => r.name), ...Object.keys(pairs)])];
  return {
    matrix: autoren.map((autor) => {
      const { gewaehlt, quelle } = pickReviewers(reviewers, autor, 2, pairs);
      // Die Modell-ID dazu (Issue #241): In den Issues steht `Autor-Modell:
      // claude-opus-5`, in dieser Tabelle stand bisher nur `opus`. Wer die Matrix
      // liest, soll den Wert wiedererkennen, der in seinen Issues steht.
      const modell = reviewers.find((r) => r.name === autor)?.model || null;
      return { autor, modell, reviewer: gewaehlt.map((r) => r.name), quelle };
    }),
  };
}

// Die Umgebung, in der dieses Kommando misst (Issue #269). Ein Befund von hier stammt
// immer aus dem aufrufenden Prozess — interaktiv ist das die Session des Menschen, im
// Runner der Runner selbst. Der Wert steht ausdruecklich im Befund, damit niemand ein
// `verfuegbar: true` auf eine Umgebung bezieht, in der gar nicht geprueft wurde. Der
// Nacht-Runner erkennt seinen eigenen Session-Vorflug am Gegenwert "review-session";
// ein direkt hier gestarteter Prozess kann ihn nie erzeugen.
const CHECK_UMGEBUNG = "runner";

// Auskunft, kein Gate: Exit bleibt 0, auch wenn ein Reviewer fehlt. Wer daraus ein
// Gate macht, ist der Skill — er kann den Menschen fragen, dieses Kommando nicht.
// PATH-Suche und Probelauf sind injizierbar wie die Config (Plan #1199, E6).
export function issueReviewCheck(args = {}, { config = loadConfig(), verfuegbar = kommandoVerfuegbar, probe = probelauf } = {}) {
  // `--nur-pfad` faellt auf das Verhalten vor Issue #262 zurueck, fuer den Fall, dass
  // ein Probelauf zu teuer oder unerwuenscht ist. Das Feld `geprueft` macht in beiden
  // Faellen sichtbar, worauf sich die Aussage stuetzt.
  const nurPfad = args["nur-pfad"] === true;
  const { reviewers, reviewStufen } = issueReviewConfig(config);
  // Fehlende Rollendateien aller Stufen (Issue #1381): Ein Pruefer ohne Rolle faellt im
  // Review aus — hier steht es vorher, auch wenn kein Reviewer konfiguriert ist.
  const rollen = Object.entries(reviewStufen.stufen).flatMap(([stufe, { rollen: namen }]) =>
    rollenDateien(namen).filter((r) => !r.rolleVorhanden).map(({ rolle, pfad }) => ({ stufe, rolle, pfad })));
  const ergebnis = reviewers.map((r) => {
    const basis = { name: r.name, kind: r.kind, umgebung: CHECK_UMGEBUNG };
    if (r.kind === "claude") return { ...basis, lesegrenze: CLAUDE_LESEGRENZE, verfuegbar: true };
    // Ohne Lesegrenze startet `issue-review start` nicht (A6) — der Pruefer ist dann nicht
    // verfuegbar, gleich ob das Werkzeug liefe.
    const start = startArgumente(r.command, r.lesegrenze);
    if (start.fehler) {
      return { ...basis, lesegrenze: start.fehler === "keine-lesegrenze" ? null : lesegrenzeVon(r).join(" "), verfuegbar: false, geprueft: "lesegrenze", grund: start.grund };
    }
    Object.assign(basis, { lesegrenze: start.lesegrenze });
    const { datei, ok, pfad } = verfuegbar(r.command);
    if (!ok) return { ...basis, verfuegbar: false, geprueft: "pfad", grund: `${datei} nicht im PATH` };
    if (nurPfad) return { ...basis, verfuegbar: true, geprueft: "pfad" };
    const lauf = probe(r.command, pfad);
    return lauf.ok
      ? { ...basis, verfuegbar: true, geprueft: "probelauf" }
      : { ...basis, verfuegbar: false, geprueft: "probelauf", grund: lauf.grund };
  });
  // Ohne konfigurierte Reviewer waere `every()` auf dem leeren Array true — der Vorflug
  // haette einen Lauf durchgelassen, der garantiert nichts liefert: Jede Session startet,
  // der Skill beendet sich mangels Reviewern, und der Runner bucht sie als "ohne
  // Ergebnis". Eine ganze Nacht verbrannt, ohne dass etwas nach Fehler aussieht.
  // Dieselbe Fehlerklasse wie beim [Idee]-Gate (Issue #192): eine vorhersehbare Lage
  // gehoert ins Gate, nicht in einen Prompt.
  return reviewers.length === 0
    ? { reviewers: [], alleVerfuegbar: false, grund: "issueReview.reviewers ist leer oder fehlt — Block aus .claude/workflow.config.example.json uebernehmen", rollen }
    : { reviewers: ergebnis, alleVerfuegbar: ergebnis.every((r) => r.verfuegbar), rollen };
}

// ============================================================
// Pruefauftrag (Issue #1380, Plan #1375 A3, E2, E3, E7)
// ============================================================
//
// Den Auftrag eines Pruefers setzt das Kit zusammen, nicht die Sitzung: Platzhalter fuellen
// ist eine Bedienvorgabe und gehoert ins Werkzeug. Die Sitzung sieht nur Pfad und
// Zeichenzahl, und alle Pruefer einer Rolle bekommen denselben Wortlaut. Der Name grenzt
// sich von `issue auftrag <id>` ab, dem Umsetzungsauftrag einer Karte.

// Die Rollen liegen neben dem Teil board/, in der Quelle wie in der Kopie unter .claude/kit/.
const ROLLEN_VERZEICHNIS = join(dirname(fileURLToPath(import.meta.url)), "..", "rollen");
const ROLLEN_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHECKS_SUMMARY = join(".claude", "checks-summary.json");
// Platzhalter und Blockmarken der Rollendateien: `{{NAME}}`, `{{#NAME}}`, `{{/NAME}}`.
const PLATZHALTER = /\{\{([#/]?[A-Z_]+)\}\}/g;

/** Pfad und Vorhandensein der Rollendatei je Rollenname. */
function rollenDateien(namen) {
  return namen.map((rolle) => {
    const pfad = join(ROLLEN_VERZEICHNIS, `${rolle}.md`);
    return { rolle, pfad, rolleVorhanden: existsSync(pfad) };
  });
}

function liesDatei(pfad) {
  return existsSync(pfad) ? readFileSync(pfad, "utf-8") : null;
}

const mitZeilenende = (text) => (text.endsWith("\n") ? text : `${text}\n`);

// `Vorlage: <Pfad> — verbindlich | Anregung` (Issue #683); der Pfad darf in Backticks stehen.
// Zeilenweise statt eines `^…$`-Ausdrucks mit m-Flag (sonarjs/slow-regex).
function vorlagePfad(...bodies) {
  for (const body of bodies) {
    if (body === null) continue;
    for (const zeile of normalisiereZeilenenden(body).split("\n")) {
      const rest = zeile.trimStart();
      if (!rest.startsWith("Vorlage:")) continue;
      const pfad = rest.slice("Vorlage:".length).trim().split(/\s/)[0].replaceAll("`", "");
      if (pfad) return pfad;
    }
  }
  return null;
}

/**
 * Entfernt jeden Block `{{#NAME}}…{{/NAME}}` samt Zeilenumbruch (E3): den direkt dahinter,
 * sonst den direkt davor — so bleibt weder eine Leerzeile noch ein angeklebter Satz.
 * Steht der Inhalt fest, entfallen nur die Blockmarken.
 */
function block(text, name, behalten) {
  const auf = `{{#${name}}}`;
  const zu = `{{/${name}}}`;
  let ergebnis = text;
  let start = ergebnis.indexOf(auf);
  while (start !== -1) {
    const ende = ergebnis.indexOf(zu, start);
    if (ende === -1) break;
    let von = start;
    if (behalten) {
      ergebnis = ergebnis.slice(0, start) + ergebnis.slice(start + auf.length, ende) + ergebnis.slice(ende + zu.length);
    } else {
      let bis = ende + zu.length;
      if (ergebnis[bis] === "\n") bis += 1;
      else if (ergebnis[von - 1] === "\n") von -= 1;
      ergebnis = ergebnis.slice(0, von) + ergebnis.slice(bis);
    }
    start = ergebnis.indexOf(auf, von);
  }
  return ergebnis;
}

/** Holt Dokument, fachliche Quelle und Vorlage vom Board; `null` heisst: entfaellt. */
async function dokumentWerte(tracker, id) {
  const lesen = async (nr) => {
    try {
      return { body: (await tracker.getIssue(String(nr))).body ?? "" };
    } catch (e) {
      return { fehler: { ok: false, fehler: "dokument-nicht-lesbar", id: String(nr), grund: e.message } };
    }
  };
  const dokument = await lesen(id);
  if (dokument.fehler) return dokument;
  const quelleNr = herkunftNummern(dokument.body, "Fachliche Quelle")[0] ?? null;
  const quelle = quelleNr === null ? null : await lesen(quelleNr);
  if (quelle?.fehler) return quelle;
  return {
    werte: {
      ISSUE_BODY: dokument.body,
      QUELLE_BODY: quelle?.body ?? null,
      VORLAGE_PFAD: vorlagePfad(dokument.body, quelle?.body ?? null),
    },
  };
}

// Ein Aufruffehler wirft, statt den Prozess zu beenden: Der Test laeuft im selben Prozess,
// und `dispatchIssueReview` macht daraus wie bei `roles` ein `fail`.
function fehlerArg(meldung) {
  throw new BoardError(`issue-review pruefauftrag: ${meldung}`);
}

function pruefauftragArgumente(args) {
  const wert = (name) => (args[name] === true ? fehlerArg(`--${name} braucht einen Wert`) : args[name]);
  const eingang = { rolle: wert("rolle"), datei: wert("datei"), id: wert("id"), material: wert("material-datei") };
  if (!eingang.rolle) fehlerArg("--rolle fehlt");
  if (!ROLLEN_NAME.test(eingang.rolle)) fehlerArg(`--rolle '${eingang.rolle}' ist kein Rollenname (Kleinbuchstaben, Ziffern, Bindestrich)`);
  if (!eingang.datei) fehlerArg("--datei fehlt");
  if (Boolean(eingang.id) === Boolean(eingang.material)) fehlerArg("entweder --id <N> oder --material-datei <pfad> angeben");
  return eingang;
}

/**
 * Setzt die Werte in den Rahmen der Rolle. Erst die Bloecke, dann die Platzhalter in einem
 * Durchgang: Was eingesetzt wird, wird nicht noch einmal gelesen — ein Dokument darf selbst
 * `{{…}}` enthalten. Rueckgabe `{ text }` oder `{ offen }`.
 */
function montiere(rahmen, werte) {
  let text = block(normalisiereZeilenenden(rahmen), "VORLAGE", werte.VORLAGE_PFAD != null);
  text = block(text, "QUELLE", werte.QUELLE_BODY != null);
  const offen = [...new Set([...text.matchAll(PLATZHALTER)].map((m) => m[1]))].filter((name) => werte[name] == null);
  if (offen.length > 0) return { offen };
  return { text: text.replaceAll(PLATZHALTER, (_, name) => werte[name]) };
}

/**
 * Montiert den Pruefauftrag einer Rolle in die Datei `--datei` (A3).
 *
 * Eingang entweder `--id <N>` (Dokument vom Board, `Fachliche Quelle:` und `Vorlage:`
 * aufgeloest) oder `--material-datei <pfad>` (Code-Pruefung). Fehlt die Rollendatei,
 * antwortet der Befehl `rolle-fehlt` mit Pfad — der Skill bucht das als Ausfall dieses
 * Pruefers. Bleibt ein Platzhalter ausserhalb der Bloecke offen, entsteht keine Datei:
 * Ein halb gefuellter Auftrag saehe am Board aus wie ein vollstaendiger (E3).
 */
export async function issueReviewPruefauftrag(args, { config = loadConfig(), board = null, lies = liesDatei } = {}) {
  const { rolle, datei, id, material } = pruefauftragArgumente(args);
  const pfad = join(ROLLEN_VERZEICHNIS, `${rolle}.md`);
  const rahmen = lies(pfad);
  if (rahmen === null) return { ok: false, fehler: "rolle-fehlt", rolle, pfad };

  let werte;
  if (id) {
    const ergebnis = await dokumentWerte(board ?? resolveTracker(config), id);
    if (ergebnis.fehler) return ergebnis.fehler;
    werte = ergebnis.werte;
  } else {
    const inhalt = lies(material);
    if (inhalt === null) return { ok: false, fehler: "material-fehlt", pfad: material };
    werte = { REVIEW_MATERIAL: inhalt };
  }
  const { arten } = await import("../befunde.mjs");
  werte.ARTEN = arten().arten.map((a) => `${a.name} — ${a.erklaerung}`).join("\n");

  const { text, offen } = montiere(rahmen, werte);
  if (offen) return { ok: false, fehler: "platzhalter-offen", rolle, platzhalter: offen };

  // Die lokale Pruefung kann ein Pruefer ohne Ausfuehrungsrecht nicht selbst erzeugen (E7).
  const summary = rolle === "code-review" ? lies(join(configWurzel(), CHECKS_SUMMARY)) : null;
  const auftrag = summary === null ? text : `${mitZeilenende(text)}--- LOKALE PRUEFUNG ---\n${mitZeilenende(summary)}`;

  writeFileSync(datei, auftrag);
  return { ok: true, rolle, datei, zeichen: auftrag.length };
}

// ============================================================
// Start eines fremden Pruefers (Issue #1381, Plan #1375, A4, A6)
// ============================================================

// Die Antwort eines Pruefers kann lang sein; der Vorgabewert von spawnSync (1 MiB) schnitte sie ab.
const START_PUFFER = 64 * 1024 * 1024;
// Ausschnitt aus stderr bei einem Ausfall: das Ende, dort steht die Fehlermeldung.
const STDERR_AUSSCHNITT = 1000;

function fehlerStart(meldung) {
  throw new BoardError(`issue-review start: ${meldung}`);
}

const pflichtwert = (args, name) => (args[name] === true || !args[name] ? fehlerStart(`--${name} fehlt`) : args[name]);

/** Wer startet: ein `kind: command`-Reviewer oder das persoenliche reviewCommand. */
function startPruefer(args, config) {
  const wert = (name) => (args[name] === true ? fehlerStart(`--${name} braucht einen Wert`) : args[name]);
  const codeReview = args["code-review"] === true;
  const name = args.reviewer === undefined ? undefined : wert("reviewer");
  if (codeReview === Boolean(name)) fehlerStart("entweder --reviewer <name> oder --code-review angeben");
  if (codeReview) {
    if (!config.reviewCommand) fehlerStart("--code-review braucht reviewCommand in der Config");
    return { name: "reviewCommand", command: config.reviewCommand, lesegrenze: config.reviewLesegrenze };
  }
  const { reviewers } = issueReviewConfig(config);
  const reviewer = reviewers.find((r) => r.name === name);
  if (!reviewer) fehlerStart(`'${name}' steht nicht in issueReview.reviewers`);
  if (reviewer.kind !== "command") fehlerStart(`'${name}' hat kind '${reviewer.kind}' — Claude-Pruefer laufen ueber den Agenten kit-pruefer`);
  return reviewer;
}

/** Das Ende von stderr, bei einem Lauf ohne Exit-Status der Startfehler oder das Signal. */
function ausfallGrund(res) {
  if (res.status !== null) return res.stderr || "";
  return res.error ? res.error.message : `Durch Signal ${res.signal} beendet`;
}

/**
 * Startet einen fremden Pruefer mit Lesegrenze (A4): Auftrag ueber stdin, Antwort aus stdout
 * in `--ausgabe`. Gestartet wird ohne Shell wie im Probelauf — die Kommandozeile wird am
 * Leerraum zerlegt, Quotes und Pipes traegt sie nicht. Ohne bekannte Lesegrenze oder mit einem
 * Schalter, der sie aufhebt, startet nichts (A6). Exit ungleich 0 ist ein Ausfall mit dem Ende
 * von stderr; die Ausgabedatei entsteht dann nicht, damit kein halber Befund als ganzer gilt.
 */
export function issueReviewStart(args, { config = loadConfig(), spawn = spawnSync, verfuegbar = kommandoVerfuegbar, env = process.env } = {}) {
  const pruefer = startPruefer(args, config);
  const auftrag = pflichtwert(args, "auftrag");
  const ausgabe = pflichtwert(args, "ausgabe");
  const reviewer = pruefer.name;

  const start = startArgumente(pruefer.command, pruefer.lesegrenze);
  if (start.fehler) return { ok: false, reviewer, ...start };
  const prompt = liesDatei(auftrag);
  if (prompt === null) return { ok: false, reviewer, fehler: "auftrag-fehlt", pfad: auftrag };
  const { datei, ok, pfad } = verfuegbar(pruefer.command);
  if (!ok) return { ok: false, reviewer, fehler: "nicht-im-path", grund: `${datei} nicht im PATH` };

  const res = spawn(pfad, start.argumente, { input: prompt, encoding: "utf-8", env, maxBuffer: START_PUFFER });
  if (res.status !== 0) {
    return { ok: false, reviewer, fehler: "ausfall", exit: res.status, stderr: ausfallGrund(res).trim().slice(-STDERR_AUSSCHNITT) };
  }
  const antwort = res.stdout ?? "";
  writeFileSync(ausgabe, antwort);
  return { ok: true, reviewer, lesegrenze: start.lesegrenze, ausgabe, zeichen: antwort.length };
}

/**
 * Die Pruefstufe aus dem Titel-Praefix, wie sie auch `/issue-review` bestimmt.
 *
 * Nutzt die Praedikate aus dem Teil dokumente. Bis Issue #464 stand die Praefix-Form hier
 * ein drittes Mal — damals in derselben Datei, in der sie definiert war.
 */
export function stufeAusTitel(title) {
  if (istFachlich(title)) return "fachlich";
  if (istPlan(title)) return "plan";
  return "issue";
}

// `pruefauftrag` und `start`: Ein Aufruffehler wirft und wird zu fail, eine Antwort mit
// `ok: false` gibt der Befehl aus und endet mit Exit 1.
async function antwortMitExit(befehl) {
  let antwort;
  try {
    antwort = await befehl();
  } catch (err) {
    if (err instanceof BoardError) return fail(err.message);
    throw err;
  }
  out(antwort);
  if (!antwort.ok) process.exitCode = 1;
}

// Die Hilfe kommt vom Einstieg herein: Sie steht dort, und ein Import von dort waere ein Zyklus.
export async function dispatchIssueReview(command, args, hilfe) {
  switch (command) {
    case "pruefauftrag": return antwortMitExit(() => issueReviewPruefauftrag(args));
    case "start": return antwortMitExit(() => issueReviewStart(args));
    case "reviewers": return out(issueReviewReviewers(args));
    case "check": return out(issueReviewCheck(args));
    case "matrix": return out(issueReviewMatrix());
    case "roles":
      // Den BoardError der Pruefzahl aus dem Lauf macht erst der Befehl zu fail (A8).
      try {
        return out(issueReviewRoles(args));
      } catch (err) {
        if (err instanceof BoardError) return fail(err.message);
        throw err;
      }
    default:
      process.stdout.write(hilfe);
      fail(`Unbekannter issue-review-Befehl: '${command}'`);
  }
}
