/**
 * board/wiederholung.mjs — Wiederholung gegen Ueberlast, Git Bash und Spawn (Issue #1215,
 * Plan #1199, E17): die Regeln, nach denen ein Board-Aufruf wiederholt wird, und die
 * Startregeln fuer Programme unter Windows.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus.
 *
 * Der Nacht-Runner und checks.mjs laden diesen Teil als Nachbarn ueber einen nicht
 * literalen Pfad (NACHBAR_DIR, #498; Windows-Import, #1176). Die Importanalyse sieht das
 * nicht; die Kopplung steht darum von Hand in den `areas` der Pruefkommandos (E3).
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { RUECKMELDUNG } from "./grundlagen.mjs";

// ============================================================
// Git Bash und Spawn
// ============================================================

// Die Suche nach der Git Bash und die Startregel stehen in grundlagen.mjs, denn `exec` dort
// startet jedes Programm ueber `startbefehlFuer`. Lagen sie hier, importierte grundlagen.mjs
// aus diesem Teil und dieser aus grundlagen.mjs — ein Zyklus. Die Nachbarn laden sie
// trotzdem von hier: Fuer sie ist dieser Teil die Adresse von Git Bash und Spawn.
export { GIT_BASH_UMGEBUNG, gitBashPfad, spawnAufruf, startbefehlFuer } from "./grundlagen.mjs";

// ============================================================
// Wiederholung gegen Ueberlast (Issue #834)
// ============================================================
//
// ACHTUNG, ZWILLING: Dieselbe Logik traegt `cli/tbx.mjs` im Projekt kanban-kit
// (dort Issue #1005). Die beiden Fassungen sind bewusst wortgleich kommentiert,
// damit eine spaetere Aenderung nicht nur eine Haelfte trifft — wer hier die
// Staffel, die Wiederholregeln oder die drei Rueckmeldungen anfasst, aendert
// die Schwesterfassung mit. Geteilter Code ist es nicht: Das Board-Werkzeug bleibt
// ohne Fremdabhaengigkeiten.
//
// Der Anlass: Das Board begrenzt seit kanban-kit 2.5 die Befehle je Person und
// weist mit `429`, `Retry-After` und dem Problem-Detail `type: urn:manban:overload`
// ab. Ein Nachtlauf schickt Hunderte Befehle in Folge; ohne Wiederholung bricht
// er irgendwo ab und hinterlaesst eine halb bearbeitete Kette.

/** Das Problem-Detail, an dem eine Ueberlast-Abweisung erkennbar ist. */
export const TOOLBOX_UEBERLAST_TYPE = "urn:manban:overload";

/**
 * Zeitgrenze je Einzelversuch, abgeleitet aus dem Budget (toolboxVersuchMs). Drei volle
 * Haenger passen so in beide Budgets: 3 × 10 s ins Tagesbudget, 3 × 30 s ins Nachtbudget.
 */
const TOOLBOX_VERSUCH_INTERAKTIV_MS = 10_000;
const TOOLBOX_VERSUCH_NACHT_MS = 30_000;
const TOOLBOX_BUDGET_INTERAKTIV_MS = 30_000;
/** Exportiert fuer den Nacht-Runner, der seinen Board-Aufrufen dieses Budget mitgibt (Issue #1067). */
export const TOOLBOX_BUDGET_NACHT_MS = 120_000;
const TOOLBOX_WARTE_BASIS_MS = 500;
const TOOLBOX_WARTE_MAX_MS = 8_000;
const TOOLBOX_WARTE_MIN_MS = 100;
/** Anteil der Wartezeit, der zufaellig obendrauf kommt (Streuung gegen Gleichtakt). */
const TOOLBOX_STREUUNG = 0.25;

/**
 * Netzfehler-Codes, bei denen nachweislich kein Aufruf hinausging. Sie sind keine
 * Wiederholung wert: Ein abgeschalteter Server oder ein unbekannter Name wird
 * innerhalb des Budgets nicht wieder da sein, und der Aufruf hat sicher nichts
 * bewirkt — deshalb "nicht ausgefuehrt" statt "Ausgang unklar".
 */
const NETZ_ENDGUELTIG = new Set(["ECONNREFUSED", "ENOTFOUND", "ERR_INVALID_URL", "EPROTO", "CERT_HAS_EXPIRED"]);

/**
 * Das Gesamtbudget einer Wiederholschleife. Dasselbe Signal wie agentModelHeader:
 * Ist KIT_AGENT_MODEL gesetzt, laeuft der Aufruf unbeaufsichtigt im Nachtbetrieb
 * und darf laenger auf ein ueberlastetes Board warten — dort sitzt niemand, den
 * zwei Minuten stoeren. Interaktiv ist eine halbe Minute die Grenze des Ertraeglichen.
 *
 * KIT_TOOLBOX_BUDGET_MS setzt das Budget ausdruecklich in Millisekunden und schlaegt
 * beide Regelwerte (Issue #842). Der Anlass sind Tests, die board.mjs als eigenen
 * Prozess gegen einen dauerhaft mit 5xx antwortenden Server starten: Dort greift die
 * gestellte Uhr der Unit-Tests nicht, und jeder Aufruf liefe bis zum vollen Budget.
 * Die Variable wirkt bewusst ueberall und nicht nur unter Test — eine nicht genannte
 * Hintertuer, die Verhalten aendert, waere schlechter als eine dokumentierte Stellschraube.
 * Es gilt nur ein positiver ganzzahliger Wert; alles andere faellt auf die Regel zurueck.
 */
export function toolboxBudgetMs(env = process.env) {
  const gesetzt = Number(String(env.KIT_TOOLBOX_BUDGET_MS ?? "").trim());
  if (Number.isInteger(gesetzt) && gesetzt > 0) return gesetzt;
  return (env.KIT_AGENT_MODEL || "").trim() ? TOOLBOX_BUDGET_NACHT_MS : TOOLBOX_BUDGET_INTERAKTIV_MS;
}

/**
 * Die Zeitgrenze eines Einzelversuchs folgt dem Budget (Issue #1067). Im Nachtbetrieb
 * (Budget ab TOOLBOX_BUDGET_NACHT_MS) sind es 30 s: `issue list --status ready` liefert
 * alle Bodies der Spalte, und bei langsamer Leitung riss schon die Uebertragung die
 * 10 s — jeder Wiederholversuch scheiterte genauso. Interaktiv bleiben es 10 s, damit
 * drei Versuche weiter ins Budget von 30 s passen; ebenso bei jedem ausdruecklich
 * kleineren Budget.
 */
export function toolboxVersuchMs(budget) {
  return budget >= TOOLBOX_BUDGET_NACHT_MS ? TOOLBOX_VERSUCH_NACHT_MS : TOOLBOX_VERSUCH_INTERAKTIV_MS;
}

/**
 * Muss board.mjs sich mit NODE_USE_ENV_PROXY=1 neu starten (Issue #998)? Nodes
 * eingebautes fetch nutzt HTTPS_PROXY nur mit diesem Schalter beim Start. Im Kind ist
 * er gesetzt — eine Schleife ist nicht moeglich.
 */
export function proxyNeustartNoetig(env) {
  return proxyGesetzt(env) && env.NODE_USE_ENV_PROXY === undefined;
}

export function proxyGesetzt(env) {
  return [env.HTTPS_PROXY, env.https_proxy].some((wert) => (wert ?? "").trim() !== "");
}

/**
 * Der Satz, der einem Netzfehler hinter einem Proxy die Ursache nennt (Issue #998):
 * "fetch failed" allein laedt zur Fehldiagnose und zum Umgehen der Sandbox ein.
 */
export const PROXY_HINWEIS = "Der Aufruf lief hinter einem Proxy (HTTPS_PROXY). Die uebliche Abhilfe ist "
  + "NODE_USE_ENV_PROXY=1 vor dem Aufruf, nicht das Verlassen der Sandbox.";

/**
 * Ordnet einen fetch-Wurf ein: `zeitablauf` (die eigene Zeitgrenze hat abgebrochen),
 * `endgueltig` (kein Aufruf ging hinaus) oder `abbruch` (die Verbindung brach
 * unterwegs ab — der Aufruf kann angekommen sein).
 */
export function netzfehlerArt(e) {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "zeitablauf";
  const code = e?.cause?.code ?? e?.code ?? "";
  return NETZ_ENDGUELTIG.has(code) ? "endgueltig" : "abbruch";
}

/**
 * Darf dieser Fehlschlag wiederholt werden? Die Regel in einem Satz: alles, was
 * entweder nichts ausgefuehrt hat (Abweisung wegen Ueberlast) oder gefahrlos
 * zweimal laufen darf (lesend, ersetzend, oder mit Idempotenz-Schluessel).
 *
 *  - `429` nur mit dem Ueberlast-`type`, dann aber bei JEDER Methode: Eine
 *    Abweisung hat die Wirkung nicht ausgefuehrt. Ein fremdes `429` ohne diesen
 *    `type` sagt nichts ueber den Ausgang und bleibt unwiederholt.
 *  - `5xx` bei `GET` (folgenlos), `PUT`/`DELETE` (dasselbe Ergebnis bei
 *    Wiederholung) und bei `POST` nur MIT Schluessel. Ein `POST` ohne Schluessel
 *    — `/labels`, `/night-runs` — wuerde sich sonst nach einem 502 des
 *    vorgeschalteten Proxys doppeln.
 *  - `401` nie: ein widerrufener Token wird durch Warten nicht gueltig.
 */
export function darfWiederholen({ method, status = null, typ = null, hatSchluessel = false, netz = null }) {
  if (netz) return netz !== "endgueltig";
  if (status === 429) return typ === TOOLBOX_UEBERLAST_TYPE;
  if (status === null || status < 500) return false;
  const m = (method || "GET").toUpperCase();
  if (m === "POST") return hatSchluessel;
  return true;
}

/**
 * Die Rueckmeldung zu einem abgeschlossenen Versuch (siehe RUECKMELDUNG).
 * Entscheidend ist, ob der Aufruf etwas veraendert haben KANN: Nur ein
 * schreibender Aufruf, der hinausging und ohne Antwort blieb, ist unklar.
 */
export function rueckmeldungFuer({ ok = false, status = null, netz = null, method = "GET" }) {
  if (ok) return RUECKMELDUNG.AUSGEFUEHRT;
  const schreibend = (method || "GET").toUpperCase() !== "GET";
  if (!schreibend) return RUECKMELDUNG.NICHT_AUSGEFUEHRT;
  if (netz) return netz === "endgueltig" ? RUECKMELDUNG.NICHT_AUSGEFUEHRT : RUECKMELDUNG.AUSGANG_UNKLAR;
  return status >= 500 ? RUECKMELDUNG.AUSGANG_UNKLAR : RUECKMELDUNG.NICHT_AUSGEFUEHRT;
}

/**
 * Wartezeit vor dem naechsten Versuch: verdoppelnd bis zur Deckelung, mit
 * Streuung nach oben. `Retry-After` (Sekunden) schlaegt die eigene Staffel — der
 * Server weiss besser, wann sein Fenster wieder offen ist. Die Untergrenze
 * verhindert eine Schleife ohne Fortschritt bei `Retry-After: 0`.
 */
export function wartezeitMs(versuch, retryAfterSek = null, zufall = Math.random) {
  const roh = Number(retryAfterSek);
  const basis = retryAfterSek !== null && retryAfterSek !== undefined && Number.isFinite(roh) && roh >= 0
    ? roh * 1000
    : Math.min(TOOLBOX_WARTE_BASIS_MS * 2 ** (versuch - 1), TOOLBOX_WARTE_MAX_MS);
  return Math.max(TOOLBOX_WARTE_MIN_MS, Math.round(basis + basis * TOOLBOX_STREUUNG * zufall()));
}

// Gleichzeitige Verlaufsabrufe der Sammelform (Issue #1095): genug, dass sich die
// Wartezeiten ueberlappen, wenig genug fuer eine API, die drosselt.
export const VERLAUF_GLEICHZEITIG = 4;

/**
 * Wendet `fn` auf jeden Eintrag an, hoechstens `grenze` Aufrufe zugleich, und liefert
 * die Ergebnisse in Eingabereihenfolge. Der erste Fehler laesst das Ganze scheitern;
 * danach beginnt kein Arbeiter einen neuen Eintrag mehr. Die Arbeiter rufen sich
 * selbst wieder auf statt in einer Schleife zu warten.
 */
export async function hoechstensGleichzeitig(grenze, eintraege, fn) {
  const ergebnisse = new Array(eintraege.length);
  let naechster = 0;
  let gescheitert = false;
  const arbeiter = async () => {
    if (gescheitert || naechster >= eintraege.length) return;
    const i = naechster++;
    try {
      ergebnisse[i] = await fn(eintraege[i], i);
    } catch (e) {
      gescheitert = true;
      throw e;
    }
    return arbeiter();
  };
  await Promise.all(Array.from({ length: Math.min(grenze, eintraege.length) }, arbeiter));
  return ergebnisse;
}

/** Shell-sicheres Zitat fuer das Wiederholkommando — nur, wo noetig. */
function zitiere(arg) {
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg;
  const maskiert = String(arg).replaceAll("'", String.raw`'\''`);
  return `'${maskiert}'`;
}

/**
 * Baut das Kommando, mit dem sich ein unklar ausgegangener Aufruf gefahrlos
 * wiederholen laesst: derselbe Aufruf, derselbe Schluessel. Ein bereits
 * uebergebener `--idempotency-key` wird ersetzt statt gedoppelt.
 */
export function wiederholKommando(schluessel, argv = process.argv) {
  const args = [];
  const roh = argv.slice(2);
  let i = 0;
  while (i < roh.length) {
    if (roh[i] === "--idempotency-key") { i += 2; continue; }  // Option und ihr Wert
    args.push(roh[i]);
    i += 1;
  }
  if (schluessel) args.push("--idempotency-key", schluessel);
  return ["node", argv[1] ?? "board.mjs", ...args].map(zitiere).join(" ");
}
