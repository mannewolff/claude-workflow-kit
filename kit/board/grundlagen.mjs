/**
 * board/grundlagen.mjs — gemeinsame Grundlagen des Board-Werkzeugs (Issue #1211, Plan #1199,
 * E16, E17): Spalten und Status, Shell, Fehler, Config und die Hilfsfunktionen, die fast
 * jeder andere Teil nutzt.
 *
 * Ein Teil von kit/board.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nie aus dem Einstieg: Der Einstieg laedt die Teile, ein Rueckimport waere
 * ein Zyklus.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { readFileSync, existsSync, accessSync, constants } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const VALID_STATUSES = ["backlog", "ready", "in_progress", "in_review", "done"];

export const COLUMN_DEFAULTS = {
  backlog:     "Backlog",
  ready:       "Ready",
  in_progress: "In progress",
  in_review:   "In review",
  done:        "Done",
};

export function columnLabels(config) {
  return config.columns || COLUMN_DEFAULTS;
}

// Entscheidungskriterium fuer den GitLab-Adapter: 'done' ist immer der GitLab-Zustand
// Closed. 'backlog' ist der GitLab-Zustand Open nur, wenn so konfiguriert
// (columns.backlog === "Open"); sonst ein normales Label. Alle anderen Spalten sind
// immer Labels. Einzige Quelle der Wahrheit fuer createIssue/moveIssue/listIssues/labelToStatus.
export function isStateColumn(status, config) {
  if (status === "done") return true;
  if (status === "backlog") return columnLabels(config).backlog === "Open";
  return false;
}

// --- Shell-Hilfsfunktionen ---

// Kommandos werden OHNE Shell gestartet: Datei plus Argument-Array (Issue #196).
//
// Vorher lief alles ueber execSync mit einer zusammengesetzten Kommandozeile, und das
// Quoting musste zur Shell passen: Ein mehrzeiliger Issue-Body zerfiel in einzelne
// Argumente (Live-Befund #195).
//
// Ohne Shell gibt es das Problem nicht mehr: Die Argumente gehen als argv direkt ans
// Betriebssystem, es existiert kein Escaping-Layer. Nebenbei entfaellt jede
// Kommando-Injection-Flaeche — ein Issue-Titel kann keine zweite Kommandozeile mehr
// eroeffnen.
//
// Start und Umgebung sind injizierbar (Issue #1211, Plan #1199, E6): So belegt ein Test
// im selben Prozess, womit gestartet wird, statt das Werkzeug als Kindprozess gegen ein
// gefaelschtes CLI im PATH laufen zu lassen.
//
// `input` geht als Standardeingabe an den Prozess (Issue #1406): Ein JSON-Koerper fuer
// `gh api --input -` braucht so weder eine Zwischendatei noch eine Shell.
export function exec(datei, args = [], { spawn = spawnSync, env = process.env, input } = {}) {
  const res = spawn(datei, args, input === undefined ? { encoding: "utf-8", env } : { encoding: "utf-8", env, input });
  if (res.error) {
    // Haeufigster Fall: das CLI ist nicht installiert (ENOENT).
    throw new Error(res.error.code === "ENOENT"
      ? `${datei} nicht gefunden — ist es installiert und im PATH?`
      : res.error.message);
  }
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || "").trim() || `${datei} endete mit Exit ${res.status}`);
  }
  return (res.stdout || "").trim();
}

export function execJSON(datei, args = [], abhaengigkeiten = {}) {
  return JSON.parse(exec(datei, args, abhaengigkeiten));
}

// Die Remote-URL des Repos, oder null wenn es keine gibt (kein Repo, kein origin).
//
// Ersetzt die frueheren Shell-Kommandozeilen der drei getRepoName-Pfade (Issue #196),
// die `2>/dev/null`, `||` und `$(pwd)` brauchten. exec verwirft stderr ohnehin und wirft
// nur bei Exit ungleich 0 — daraus wird hier ein schlichtes null, das jeder Aufrufer nach
// seiner eigenen Regel behandelt.
export function gitRemoteUrl() {
  try {
    return exec("git", ["remote", "get-url", "origin"]) || null;
  } catch {
    return null;
  }
}

/**
 * Bringt jede Auskunft ueber das Repo auf die eine verbindliche Form: `owner/repo`.
 *
 * Noetig, weil die drei getRepoName-Implementierungen frueher drei verschiedene Formen
 * lieferten (Issue #214): GitHub gab bei erreichbarem gh `owner/repo` zurueck, bei
 * scheiterndem gh aber die volle Remote-URL — der einzige der drei Fallback-Zweige, in
 * dem die Normalisierung beim Umbau auf Starts ohne Shell (Issue #196) nicht mitgewandert ist. Der
 * lokale Host lieferte nur `repo`, ohne Owner.
 *
 * Verarbeitet HTTPS-URLs, die SSH-Form `git@host:owner/repo` und ein bereits
 * normalisiertes `owner/repo`. Untergruppen werden auf die letzten zwei Segmente
 * gekuerzt — die bisherige GitLab-Semantik, hier beibehalten.
 */
export function normalizeRepoName(raw) {
  if (!raw) return null;
  const ohneGit = String(raw).trim().replace(/\.git$/, "");
  if (!ohneGit) return null;
  // SSH-Form zuerst: dort trennt ein Doppelpunkt Host und Pfad, kein Slash.
  const ssh = /^[^@/]+@[^:/]+:(.+)$/.exec(ohneGit);
  const pfad = ssh ? ssh[1] : ohneGit.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, "");
  const teile = pfad.split("/").filter(Boolean);
  if (teile.length === 0) return null;
  // Ein einzelnes Segment bleibt es — ohne Owner wird keiner hinzuerfunden.
  return teile.length === 1 ? teile[0] : teile.slice(-2).join("/");
}

// --- Fehlerbehandlung ---

/**
 * Die drei Rueckmeldungen eines Board-Aufrufs (Issue #834). Sie beantworten die
 * einzige Frage, die nach einem Fehlschlag zaehlt: Darf ich es nochmal schicken?
 *
 *  - `ausgefuehrt`      — der Server hat mit 2xx geantwortet.
 *  - `nicht-ausgefuehrt`— eine beantwortete Ablehnung (4xx), oder es ging
 *                         nachweislich kein Aufruf hinaus (Verbindung abgelehnt).
 *                         Wiederholen ist gefahrlos.
 *  - `ausgang-unklar`   — ein schreibender Aufruf ging hinaus, die Antwort blieb
 *                         aus oder war ein Serverfehler. Die Wirkung kann
 *                         eingetreten sein. Nur mit demselben Idempotenz-
 *                         Schluessel wiederholen.
 *
 * Warum der dritte Wert eigenstaendig ist: Ein Zeitablauf als "nicht ausgefuehrt"
 * zu melden verleitet zu genau der Wiederholung, die einen Kommentar doppelt
 * anlegt.
 */
export const RUECKMELDUNG = {
  AUSGEFUEHRT: "ausgefuehrt",
  NICHT_AUSGEFUEHRT: "nicht-ausgefuehrt",
  AUSGANG_UNKLAR: "ausgang-unklar",
};

// Erwartete Fehler aus den Adaptern: abfangbar, im CLI-Layer als "Fehler: ..." ausgegeben.
// `rueckmeldung` ist die Auskunft ueber die Wirkung (siehe RUECKMELDUNG); der Default
// gilt fuer jeden lokal erzeugten Fehler — eine Validierung, die abbricht, hat nichts
// ausgefuehrt.
export class BoardError extends Error {
  constructor(message, rueckmeldung = RUECKMELDUNG.NICHT_AUSGEFUEHRT) {
    super(message);
    this.rueckmeldung = rueckmeldung;
  }
}

export function fail(msg) {
  process.stderr.write(`Fehler: ${msg}\n`);
  process.exit(1);
}

export function out(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Config laden ---

// Zweiter Kandidat ist normalerweise der Ort des Einstiegs (<kit-dir>/..; dieser Teil liegt
// eine Ebene tiefer unter <kit-dir>/board/, darum zweimal ".."), damit der Adapter
// auch aus einem Unterverzeichnis des Projekts heraus die Config findet. KIT_ROOT
// ueberschreibt ihn und ist ein Test-Hook (Issue #188, dasselbe Muster wie in
// tools/sync-blobs.mjs, Issue #186): Ohne ihn faende ein Test, der das Fehlen der
// Config prueft, die Dogfooding-Config des Kit-Repos und liefe gegen echtes gh.
function configRoot() {
  return process.env.KIT_ROOT ? resolve(process.env.KIT_ROOT) : join(__dirname, "..", "..");
}

// Felder, die aus workflow.config.local.json gewinnen duerfen (Issue #207). Alles andere
// gilt teamweit und wird aus der lokalen Datei ignoriert.
//
// Die Allowlist ist die eigentliche Entscheidung hinter der Zwei-Datei-Trennung: Waeren
// buildChecks lokal ueberschreibbar, koennte sich jeder sein Gate wegkonfigurieren und die
// Trennung waere Kosmetik. Die geteilte Datei laesst sich zwar weiterhin lokal editieren —
// dann steht sie aber in `git status`, und sichtbare Abweichung ist etwas anderes als
// per Design unsichtbare.
//
// Punkt-Pfade greifen am Blatt, nicht am Elternobjekt: `toolbox.tokenFile` darf nicht das
// ganze toolbox-Objekt ersetzen. Genau dieser Fehler hat in Issue #188 den Mock-Host mit
// weggeraeumt und zwanzig Tests still ohne Token laufen lassen.
// SYNC: dieselbe Liste und Logik steckt in kit/night/grundlagen.mjs und kit/einstellungen.mjs — Aenderungen dort nachziehen.
const LOCAL_OVERRIDE_ALLOWLIST = ["reviewModel", "reviewCommand", "reviewLesegrenze", "reviewScope", "triggers", "toolbox.tokenFile"];

// Das Reviewer-Paar (Issue #432): genau eines von reviewModel und reviewCommand gilt.
// Beide Felder sind persoenlich ueberschreibbar — waere nur eines davon in der Allowlist,
// koennte jemand seinen Claude-Reviewer lokal setzen, seinen Kommando-Reviewer aber nicht.
// Das Paar ist eine Gruppe (Issue #1379, Plan #1375 E11): {reviewModel} <-> {reviewCommand,
// reviewLesegrenze}. Eine Lesegrenze ohne Kommando ist bedeutungslos — wer persoenlich auf
// Claude wechselt, nimmt die des Team-Kommandos nicht mit. Eine Lesegrenze allein verdraengt
// reviewModel dagegen nicht: Sie waehlt keinen Reviewer, sie schraenkt einen ein.
// SYNC: dieselbe Zuordnung steckt in kit/night/grundlagen.mjs und kit/einstellungen.mjs.
const REVIEWER_PAAR = { reviewModel: ["reviewCommand", "reviewLesegrenze"], reviewCommand: ["reviewModel"] };

/**
 * Mergt die persoenliche Config in die geteilte, aber nur an den erlaubten Pfaden.
 * Liefert `{ config, ignored }` — `ignored` nennt jedes verworfene Feld beim Namen,
 * damit der Aufrufer es melden kann statt still das Falsche zu tun.
 */
/**
 * Zerlegt die Allowlist in die zwei Formen, in denen sie abgefragt wird: ganze Felder
 * (`reviewModel`) und einzelne Blaetter unter einem Kopf (`toolbox.tokenFile`).
 *
 * Eigene Funktion, weil das eine andere Frage beantwortet als das Mischen darunter:
 * hier wird eine Schreibweise ausgewertet, dort eine Config zusammengefuehrt.
 */
function zerlegeAllowlist(allowlist) {
  const erlaubteBlaetter = new Map();
  const erlaubteFelder = new Set();
  for (const pfad of allowlist) {
    const [kopf, blatt] = pfad.split(".");
    if (blatt) {
      if (!erlaubteBlaetter.has(kopf)) erlaubteBlaetter.set(kopf, new Set());
      erlaubteBlaetter.get(kopf).add(blatt);
    } else {
      erlaubteFelder.add(kopf);
    }
  }
  return { erlaubteFelder, erlaubteBlaetter };
}

/**
 * Setzt ein persoenliches Feld und raeumt beim Reviewer-Paar das Gegenstueck weg.
 *
 * Eigene Funktion, weil hier eine Regel greift, die dem strikt feldweisen Mischen
 * fehlt: Von reviewModel und reviewCommand darf genau eines gelten (Issue #432). Ein
 * lokales reviewCommand neben dem geteilten reviewModel ergaebe sonst eine Config mit
 * beiden Feldern — und das ist kein Randfall, sondern der Normalfall, wenn das Team
 * den Claude-Default faehrt und einer mit fremder CLI reviewt.
 *
 * Stehen beide Felder in der lokalen Datei, bleiben auch beide stehen: Diese Datei ist
 * dann schon fuer sich ungueltig, und eines davon wegzuwerfen wuerde den Fehler
 * verstecken statt ihn der Schema-Pruefung zu ueberlassen.
 *
 * SYNC: strukturgleich in kit/night/grundlagen.mjs.
 */
function setzePersoenlichesFeld(config, feld, wert, local) {
  config[feld] = wert;
  for (const gegenstueck of REVIEWER_PAAR[feld] ?? []) {
    if (!(gegenstueck in local)) delete config[gegenstueck];
  }
}

export function mergeWorkflowConfig(shared, local) {
  const config = { ...shared };
  const ignored = [];
  if (!local) return { config, ignored };

  const { erlaubteFelder, erlaubteBlaetter } = zerlegeAllowlist(LOCAL_OVERRIDE_ALLOWLIST);

  for (const [feld, wert] of Object.entries(local)) {
    if (erlaubteFelder.has(feld)) {
      setzePersoenlichesFeld(config, feld, wert, local);
    } else if (erlaubteBlaetter.has(feld) && wert && typeof wert === "object") {
      const blaetter = erlaubteBlaetter.get(feld);
      const zusammen = { ...config[feld] };
      for (const [unterfeld, unterwert] of Object.entries(wert)) {
        if (blaetter.has(unterfeld)) zusammen[unterfeld] = unterwert;
        else ignored.push(`${feld}.${unterfeld}`);
      }
      config[feld] = zusammen;
    } else {
      ignored.push(feld);
    }
  }
  return { config, ignored };
}

// Die persoenliche Config neben der geteilten. Fehlt sie, aendert sich nichts; ist sie
// kaputt, wird sie mit Hinweis uebersprungen — eine Datei, die nur einem Entwickler
// gehoert, darf nicht die Arbeitsgrundlage des ganzen Teams kippen. Bei der geteilten
// Config bleibt ein Syntaxfehler dagegen ein harter Fehler.
function readLocalOverrides(sharedPfad) {
  const pfad = join(dirname(sharedPfad), "workflow.config.local.json");
  if (!existsSync(pfad)) return null;
  try {
    return JSON.parse(readFileSync(pfad, "utf-8"));
  } catch {
    process.stderr.write(`Hinweis: ${pfad} ist kein gueltiges JSON und wird ignoriert.\n`);
    return null;
  }
}

// Liefert die Config oder null, wenn es keine gibt. Der weiche Weg fuer Aufrufer, die
// ohne Config weiterarbeiten koennen (kontext paths, Issue #202). Eine vorhandene, aber
// kaputte Datei bleibt ein harter Fehler: Sie stillschweigend wie "keine Config" zu
// behandeln, wuerde einen Tippfehler in einen unsichtbaren Verhaltenswechsel verwandeln.
/**
 * Liest eine konkrete Config-Datei und bringt sie auf den heutigen Stand (Issue #404).
 *
 * Getrennt von der Kandidatensuche, weil es eine andere Frage ist: readWorkflowConfig
 * entscheidet, WELCHE Datei gilt; diese Funktion, WIE ihr Inhalt zu lesen ist —
 * Kompatibilitaets-Abbildung, persoenliche Overrides, Hinweise auf Ignoriertes.
 */
export function ladeConfigDatei(p) {
  const raw = JSON.parse(readFileSync(p, "utf-8"));
  // Rueckwaertskompatibilitaet: provider -> codeHost/issueTracker
  if (raw.provider && !raw.codeHost) raw.codeHost = raw.provider;
  if (raw.provider && !raw.issueTracker) raw.issueTracker = raw.provider;
  const { config, ignored } = mergeWorkflowConfig(raw, readLocalOverrides(p));
  // Hinweis auf stderr, nicht auf stdout: stdout bleibt maschinenlesbar, die Skills
  // parsen ihn als JSON. Kein Abbruch — die Wirkung bleibt ohnehin aus, und ein
  // harter Fehler waere bei jedem board.mjs-Aufruf laut.
  for (const feld of ignored) {
    process.stderr.write(
      `Hinweis: '${feld}' aus workflow.config.local.json wird ignoriert — das Feld gilt teamweit.\n`
    );
  }
  return config;
}

/** Die Wurzeln, unter denen die Config gesucht wird: erst das cwd, dann der Ort des Kits. */
function configKandidaten() {
  return [resolve("."), configRoot()];
}

/**
 * Die Projektwurzel, aus der `loadConfig` liest — die erste mit einer Config. Ohne Config
 * das cwd. Nicht `process.cwd()` allein: Aus einem Unterverzeichnis heraus laege dort keine
 * Einstellungsdatei, und die Schreibsperren des Projekts fielen still weg (Issue #1044).
 */
export function configWurzel() {
  return configKandidaten().find((w) => existsSync(join(w, ".claude", "workflow.config.json"))) ?? resolve(".");
}

export function readWorkflowConfig() {
  const candidates = configKandidaten().map((w) => join(w, ".claude", "workflow.config.json"));
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return ladeConfigDatei(p);
    } catch {
      fail(`workflow.config.json konnte nicht gelesen werden: ${p}`);
    }
  }
  return null;
}

export function loadConfig() {
  const config = readWorkflowConfig();
  if (!config) {
    fail("Keine .claude/workflow.config.json gefunden. Bitte zuerst den Installer ausfuehren.");
  }
  return config;
}

// ============================================================
// Hilfsfunktionen
// ============================================================

// Normalisiert die roh vom Backend gelieferten Labels auf ein flaches Array von
// Namen: GitLab liefert Objekte ({name}), andere Backends evtl. nackte Strings,
// oder das Feld fehlt ganz. Fehlform oder fehlendes Feld -> [].
//
// Von `listIssues` UND `getIssue` aller Tracker geteilt (Issue #312), damit
// dieselbe Karte ueber beide Wege dieselben Labels liefert. Aufrufer (z. B. das
// Routing-Label in night.mjs, Issue #159) bekommen verlaesslich ein Array — ein
// fehlendes Feld wuerde sonst still zu "keine Labels" statt zu einem Fehler
// (Issue #158).
export function labelNamesFrom(rawLabels) {
  if (!Array.isArray(rawLabels)) return [];
  return rawLabels
    .map((l) => (l && typeof l === "object" ? l.name : l))
    .filter((n) => n != null);
}

// Labels nachbeschaffen fuer den GitHub-Tracker (Issue #180).
//
// `gh project item-list` liefert pro Item nur body, number, repository, title, type
// und url — kein labels-Feld, und ein Flag zur Feldauswahl gibt es nicht. Ohne
// Nachschlag traegt bei issueTracker: github kein Ready-Issue jemals ein Label, und
// das Routing-Label des Nacht-Runners (Issue #159) ueberspringt zwangslaeufig alles.
//
// Aufgeteilt in zwei reine Funktionen, weil die Tracker-Klassen selbst wegen ihrer
// CLI-Nebenwirkungen nicht exportiert und damit nicht direkt testbar sind.

// Rohantwort von `gh issue list --json number,labels` -> Map "<nummer>" -> [Namen].
// Schluessel bewusst als String: Die Items tragen ihre id als String, ein
// Zahlen-Schluessel wuerde nie treffen.
export function labelMapFrom(rawIssues) {
  const map = new Map();
  if (!Array.isArray(rawIssues)) return map;
  for (const issue of rawIssues) {
    if (issue?.number == null) continue;
    map.set(String(issue.number), labelNamesFrom(issue.labels));
  }
  return map;
}

// Heftet die nachgeschlagenen Labels an die Items. Die Reihenfolge bleibt
// unangetastet — sie ist bei status-gefilterten Listen die Board-Reihenfolge
// (Issue #128), nach der der Nacht-Runner abarbeitet. Eine fehlende Nummer fuehrt
// zu [] statt undefined, damit Aufrufer nie auf einem fehlenden Feld arbeiten.
export function withLabels(items, labelMap) {
  if (!Array.isArray(items)) return [];
  return items.map((i) => ({ ...i, labels: labelMap.get(String(i.id)) || [] }));
}

// Normalisiert die roh gelieferten Kommentare auf {author, body, createdAt}
// (kanban-kit#449). Die drei Tracker liefern drei Formen:
//   GitHub        author.login   + createdAt
//   GitLab        author.username + created_at, dazu System-Notes (system: true),
//                 die keine echten Kommentare sind ("changed the description")
//   kanbancompat  author bereits als String + createdAt
// Fehlform oder fehlendes Feld -> []. Fehlende Einzelfelder werden zu leeren
// Strings statt undefined, damit Aufrufer nicht pro Feld pruefen muessen.
// Kommentare ohne Body werden verworfen: Es gibt nichts anzuzeigen, und ein
// leerer Eintrag im Verlauf ist irrefuehrender als gar keiner.
//
// Abgrenzung (siehe Issue #155): Kommentare tragen Verlauf und Berichte. Die
// fachliche PO-Verhandlung bleibt im Body — daran aendert dieses Feld nichts.
export function normalizeComments(rawComments) {
  if (!Array.isArray(rawComments)) return [];
  return rawComments
    .filter((c) => c && typeof c === "object" && !c.system)
    .map((c) => ({
      author: typeof c.author === "object" && c.author !== null
        ? String(c.author.login ?? c.author.username ?? "")
        : String(c.author ?? ""),
      body: String(c.body ?? ""),
      createdAt: String(c.createdAt ?? c.created_at ?? ""),
      id: kommentarIdAus(c),
    }))
    .filter((c) => c.body !== "");
}

// Die ID, unter der ein Kommentar sich ersetzen laesst (Issue #1021, Plan #1015 E10),
// als String oder null. GitHub liefert in `id` die GraphQL-Knoten-ID (`IC_…`), die
// REST-Route zum Bearbeiten will aber die Zahl aus dem `url`-Anker
// `#issuecomment-<n>`. Traegt ein Kommentar ein `url`, gilt deshalb nur dieser Anker
// — nie die Knoten-ID, auch nicht als Rueckfall.
function kommentarIdAus(c) {
  if (typeof c.url === "string") return c.url.match(/#issuecomment-(\d+)/)?.[1] ?? null;
  return c.id === undefined || c.id === null ? null : String(c.id);
}

// Normalisiert das Anlagedatum eines Issues auf den Kalendertag `JJJJ-MM-TT`
// (Issue #457). Von `getIssue` aller vier Tracker geteilt, analog zu
// labelNamesFrom (#158) und normalizeComments (kanban-kit#449) — sonst stuende
// dieselbe Kuerzung viermal da und koennte viermal auseinanderlaufen.
//
// Uebernommen werden die ersten zehn Zeichen des Plattformwerts, OHNE Umrechnung
// in eine Zeitzone: GitHub liefert UTC mit `Z`, GitLab mit Offset. "In UTC
// umrechnen" und "den Tag nehmen, den die Plattform nennt" sind verschiedene
// Ergebnisse, und das Gate aus Ausbaustufe 4 vergleicht Tage.
//
// Rueckgabe ist ein Objekt zum Spreaden, kein String: Fehlt oder taugt der Wert
// nicht, kommt {} zurueck und das Feld `created` fehlt im Ergebnis. Weder "" noch
// "heute" — ein erfundenes Anlagedatum waere schlimmer als keins, weil das Gate ein
// altes Paket als neu werten und an ihm scheitern wuerde. Das gilt auch fuer das
// handgeschriebene Frontmatter des local-Trackers: `14.08.2026` wird nicht
// umgedeutet, es faellt weg.
//
// Variadisch, weil der Toolbox-Adapter mehrere Feldnamen in Betracht zieht: Der
// erste Kandidat, der einen gueltigen Tag ergibt, gewinnt.
export function createdFrom(...kandidaten) {
  for (const roh of kandidaten) {
    if (typeof roh !== "string") continue;
    const tag = roh.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(tag)) return { created: tag };
  }
  return {};
}

export function labelToStatus(labelNames, config, state) {
  for (const [status, label] of Object.entries(columnLabels(config))) {
    if (isStateColumn(status, config)) continue;
    if (labelNames.includes(label)) return status;
  }
  if (state === "closed") return "done";
  if (state === "opened" && isStateColumn("backlog", config)) return "backlog";
  return null;
}

/**
 * Sucht ein Kommando im PATH und liefert den gefundenen Pfad oder null (Issue #231).
 *
 * Bewusst eine Dateisystem-Pruefung statt eines Prozessstarts. Der Vorflug will wissen,
 * ob das Werkzeug DA ist — dafuer braucht es keinen Prozess. Nebenbei: kein Startaufwand,
 * keine Annahme darueber, dass ein CLI `--version` kennt, und kein Risiko, dass ein
 * Probeaufruf Nebenwirkungen hat.
 *
 * Dateisystem und PATH sind injizierbar — reine Funktion in der Linie von
 * `normalizeRepoName` und `pickReviewers`.
 */
export function findeImPath(datei, opts = {}) {
  const existiert = opts.existiert || existsSync;
  const ausfuehrbar = opts.ausfuehrbar || ((p) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false; // vorhanden, aber nicht ausfuehrbar — kein Kommando
    }
  });
  const passt = (p) => existiert(p) && ausfuehrbar(p);

  // Wer einen Pfad angibt, meint diesen Pfad — keine PATH-Suche, auch nicht als Fallback.
  if (datei.includes("/")) return passt(datei) ? datei : null;

  for (const dir of (opts.path ?? "").split(":").filter(Boolean)) {
    const voll = `${dir}/${datei}`;
    if (passt(voll)) return voll;
  }
  return null;
}

/**
 * Der Wert einer Umgebungsvariablen ohne Ruecksicht auf Gross-/Kleinschreibung (Issue #1131).
 *
 * Traegt eine Kopie der Umgebung denselben Namen in mehreren Schreibweisen, gewinnt der
 * spaetere Schluessel, wie bei `{ ...env, PATH: x }` gemeint.
 */
export function umgebungsWert(env, name) {
  let wert;
  for (const [schluessel, w] of Object.entries(env || {})) {
    if (schluessel.toUpperCase() === name) wert = w;
  }
  return wert;
}
