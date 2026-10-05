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
import path, { resolve, join, dirname, extname } from "node:path";
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
// Vorher lief alles ueber execSync mit einer zusammengesetzten Kommandozeile. Node
// waehlt dann die Shell nach Plattform — /bin/sh auf POSIX, cmd.exe auf Windows —
// und das Quoting muesste zu beiden passen. Es passte nur zu einer: Ein mehrzeiliger
// Issue-Body zerfiel unter Windows in einzelne Argumente (Live-Befund #195).
//
// Ohne Shell gibt es das Problem nicht mehr: Die Argumente gehen als argv direkt ans
// Betriebssystem, es existiert kein Escaping-Layer, der pro Plattform anders arbeitet.
// Nebenbei entfaellt jede Kommando-Injection-Flaeche — ein Issue-Titel kann keine
// zweite Kommandozeile mehr eroeffnen.
//
// Unter Windows liegt ein per npm installiertes CLI nur als `.cmd`-Huelle vor, und die
// startet Node ohne Shell nicht (CVE-2024-27980). Den Startbefehl bestimmt darum
// `startbefehlFuer` (Issue #1135, Plan #1128, E8): eine `.exe` direkt, eine `.cmd` ueber
// ihre sh-Huelle in der Git Bash — nie ueber die Shell-Option von spawn.
//
// Start, Umgebung, Plattform und Dateisystem sind injizierbar (Issue #1211, Plan #1199,
// E6): So belegt ein Test im selben Prozess, womit gestartet wird, statt das Werkzeug als
// Kindprozess gegen ein gefaelschtes CLI im PATH laufen zu lassen.
export function exec(datei, args = [], { spawn = spawnSync, env = process.env, plattform = process.platform, existiert = existsSync } = {}) {
  const start = startbefehlFuer(datei, { env, plattform, existiert });
  if (start.fehler) throw new Error(start.fehler);
  const aufruf = spawnAufruf(start.befehl, [...start.vorArgs, ...args], start);
  const res = spawn(aufruf.befehl, aufruf.args, {
    ...aufruf.optionen,
    encoding: "utf-8",
    env: { ...env, ...start.umgebung },
  });
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
// Ersetzt die frueheren POSIX-Kommandozeilen der drei getRepoName-Pfade (Issue #196):
// `2>/dev/null` gibt es unter cmd.exe nicht, `||` und `$(pwd)` ebenso wenig. exec
// verwirft stderr ohnehin und wirft nur bei Exit ungleich 0 — daraus wird hier ein
// schlichtes null, das jeder Aufrufer nach seiner eigenen Regel behandelt.
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
 * dem die Normalisierung beim Windows-Umbau (Issue #196) nicht mitgewandert ist. Der
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
// SYNC: dieselbe Liste und Logik steckt in kit/night.mjs und kit/einstellungen.mjs — Aenderungen dort nachziehen.
const LOCAL_OVERRIDE_ALLOWLIST = ["reviewModel", "reviewCommand", "reviewScope", "triggers", "toolbox.tokenFile"];

// Das Reviewer-Paar (Issue #432): genau eines von reviewModel und reviewCommand gilt.
// Beide Felder sind persoenlich ueberschreibbar — waere nur eines davon in der Allowlist,
// koennte jemand seinen Claude-Reviewer lokal setzen, seinen Kommando-Reviewer aber nicht.
// SYNC: dieselbe Zuordnung steckt in kit/night.mjs und kit/einstellungen.mjs.
const REVIEWER_PAAR = { reviewModel: "reviewCommand", reviewCommand: "reviewModel" };

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
 * SYNC: strukturgleich in kit/night.mjs.
 */
function setzePersoenlichesFeld(config, feld, wert, local) {
  config[feld] = wert;
  const gegenstueck = REVIEWER_PAAR[feld];
  if (gegenstueck && !(gegenstueck in local)) delete config[gegenstueck];
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

// Windows-Default aus der Doku von cmd.exe, falls PATHEXT nicht gesetzt ist.
const PATHEXT_DEFAULT = ".COM;.EXE;.BAT;.CMD";

/**
 * Sucht ein Kommando im PATH und liefert den gefundenen Pfad oder null (Issue #231).
 *
 * Bewusst eine Dateisystem-Pruefung statt eines Prozessstarts. Der Vorflug will wissen,
 * ob das Werkzeug DA ist — dafuer braucht es keinen Prozess. Der fruehere Weg (`datei
 * --version` starten) lieferte unter Windows falsch negative Ergebnisse: Ein per npm
 * installiertes CLI liegt dort als `codex.cmd`, und fuer `.cmd` wirft Node seit
 * CVE-2024-27980 `EINVAL` ohne die Shell-Option von spawn — die aber hat board.mjs in Issue #196
 * bewusst abgeschafft. Getroffen haette es ausgerechnet die fremden Modelle, fuer die
 * der `command`-Adapter gebaut wurde.
 *
 * Nebenbei: kein Startaufwand, keine Annahme darueber, dass ein CLI `--version` kennt,
 * und kein Risiko, dass ein Probeaufruf Nebenwirkungen hat.
 *
 * Plattform und Dateisystem sind injizierbar, damit die Windows-Semantik ohne Windows
 * pruefbar ist — reine Funktion in der Linie von `normalizeRepoName` und `pickReviewers`.
 */
export function findeImPath(datei, opts = {}) {
  const istWindows = (opts.platform || process.platform) === "win32";
  const existiert = opts.existiert || existsSync;
  const ausfuehrbar = opts.ausfuehrbar || ((p) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false; // vorhanden, aber nicht ausfuehrbar — kein Kommando
    }
  });

  // Unter Windows entscheidet die Endung, ob etwas startbar ist. Traegt der Name schon
  // eine, gilt nur sie ('codex.exe' darf nicht zu 'codex.exe.CMD' werden).
  const kandidaten = (name) => {
    if (!istWindows) return [name];
    if (extname(name)) return [name];
    return (opts.pathext ?? PATHEXT_DEFAULT).split(";").filter(Boolean).map((e) => name + e);
  };

  // Das X-Bit gibt es nur unter POSIX; unter Windows waere die Pruefung bedeutungslos.
  const passt = (p) => existiert(p) && (istWindows || ausfuehrbar(p));

  // Wer einen Pfad angibt, meint diesen Pfad — keine PATH-Suche, auch nicht als Fallback.
  if ((istWindows ? /[\\/]/ : /\//).test(datei)) {
    return kandidaten(datei).find(passt) || null;
  }

  for (const dir of (opts.path ?? "").split(istWindows ? ";" : ":").filter(Boolean)) {
    for (const kandidat of kandidaten(datei)) {
      // Nicht join(): Das ist immer die Variante des LAUFENDEN Hosts, waehrend hier die
      // Semantik der uebergebenen `platform` gilt. Beide Richtungen gehen sonst schief —
      // win32-Faelle auf einem POSIX-Host bekamen '/' statt '\', POSIX-Faelle auf einem
      // Windows-Host '\' statt '/'. Der zweite Fall hat den Windows-Job gekippt, nachdem
      // der erste bereits bedacht war.
      const voll = istWindows ? `${dir}\\${kandidat}` : `${dir}/${kandidat}`;
      if (passt(voll)) return voll;
    }
  }
  return null;
}

/**
 * Der Wert einer Umgebungsvariablen ohne Ruecksicht auf Gross-/Kleinschreibung (Issue #1131).
 *
 * `process.env` ist unter Windows case-insensitiv, eine Kopie davon nicht mehr: Dort heisst
 * die Variable meist `Path`, und `{ ...process.env, PATH: x }` traegt dann beide Schluessel.
 * Gewonnen hat der spaetere, wie bei der Kopie gemeint.
 */
export function umgebungsWert(env, name) {
  let wert;
  for (const [schluessel, w] of Object.entries(env || {})) {
    if (schluessel.toUpperCase() === name) wert = w;
  }
  return wert;
}

const GIT_BASH_FEHLT = "Git Bash nicht gefunden (Voraussetzung unter Windows)"
  + String.raw` — Git for Windows installieren oder CLAUDE_CODE_GIT_BASH_PATH auf bin\bash.exe setzen`;

/**
 * Die Umgebung jedes Starts ueber die Git Bash (Issue #1131). Ohne sie verwandelt die Git Bash
 * ein Argument mit fuehrendem Schraegstrich auf dem Weg zu einem nativen Programm in einen
 * Windows-Pfad — aus dem Auftrag `/implement-next #1` wuerde `C:/Program Files/Git/implement-next #1`.
 * Beide Schreibweisen, weil MSYS2 die zweite liest und Git for Windows die erste.
 */
export const GIT_BASH_UMGEBUNG = Object.freeze({ MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" });

/**
 * Wo liegt die Git Bash (Issue #1131, Plan #1128, E1)? Liefert `{ pfad, fehler }`.
 *
 * Der Reihe nach: `CLAUDE_CODE_GIT_BASH_PATH`, wenn die Datei existiert — dieselbe Variable,
 * mit der Claude Code selbst seine Shell findet. Dann vom Pfad der im PATH gefundenen
 * `git.exe` aufwaerts bis zu dem Verzeichnis, das `bin\bash.exe` enthaelt; so trifft die Suche
 * `<Git>\cmd\git.exe`, `<Git>\bin\git.exe` und `<Git>\mingw64\bin\git.exe` gleichermassen.
 *
 * **Nie `bash` ueber den PATH:** `C:\Windows\System32\bash.exe` ist der WSL-Starter, und WSL
 * gilt als Linux, nicht als natives Windows. Eine Fundstelle dort waere eine fremde Shell mit
 * eigenem Dateisystem.
 *
 * Umgebung, Plattform und Dateisystem sind injizierbar wie bei `findeImPath`.
 */
export function gitBashPfad({ env = process.env, plattform = "win32", existiert = existsSync } = {}) {
  const eingestellt = umgebungsWert(env, "CLAUDE_CODE_GIT_BASH_PATH");
  if (eingestellt && existiert(eingestellt)) return { pfad: eingestellt, fehler: null };

  const git = findeImPath("git", {
    platform: plattform,
    path: umgebungsWert(env, "PATH"),
    pathext: umgebungsWert(env, "PATHEXT"),
    existiert,
  });
  if (git) {
    // path.win32 statt path: Die Semantik ist die der uebergebenen Plattform, nicht die des
    // Hosts — derselbe Grund wie beim Zusammensetzen in findeImPath.
    let dir = path.win32.dirname(git);
    for (;;) {
      const bash = path.win32.join(dir, "bin", "bash.exe");
      if (existiert(bash)) return { pfad: bash, fehler: null };
      const oben = path.win32.dirname(dir);
      if (oben === dir) break;
      dir = oben;
    }
  }
  return { pfad: null, fehler: GIT_BASH_FEHLT };
}

/**
 * Die Kommandozeile eines Starts (Issue #1143). Liefert `{ befehl, args, optionen }`; gestartet
 * wird `befehl` mit `args` und `optionen` zusaetzlich zu den eigenen spawn-Optionen.
 *
 * Ohne `gitBash` unveraendert, ebenso auf einem Rechner, der nicht Windows ist: Die
 * Kommandozeile gibt es nur dort, und eine injizierte Plattform in `startbefehlFuer` oder
 * `posixShell` aendert nichts am Rechner, auf dem gestartet wird. `plattform` ist darum die
 * des Rechners und nur fuer Tests injizierbar.
 *
 * Ein Start ueber die Git Bash unter Windows schreibt seine Kommandozeile selbst: Die Git Bash ist ein MSYS-Programm und zerlegt die Windows-Kommandozeile nach
 * eigenen Regeln, nicht nach denen, nach denen Node sie baut. In Anfuehrungszeichen wird `\\`
 * zu `\`, und ein Wort mit `*`, `?`, `[` oder `{` laeuft durch die Dateinamen-Erweiterung
 * (dcrt0.cc der MSYS-Laufzeit, `quoted` und `globify`). Darum steht jedes Argument in
 * Anfuehrungszeichen, `\` und `"` darin mit `\` geschuetzt: So schuetzt die Laufzeit jedes
 * Zeichen vor der Erweiterung und gibt es woertlich weiter. `windowsVerbatimArguments` haelt
 * Node davon ab, noch einmal zu quoten; `argv0` traegt den Programmpfad in Anfuehrungszeichen,
 * weil er Leerzeichen enthalten kann (`C:\Program Files\Git`).
 */
export function spawnAufruf(befehl, args, { gitBash = false, plattform = process.platform } = {}) {
  if (!gitBash || plattform !== "win32") return { befehl, args, optionen: {} };
  const schutz = String.raw`\$&`;
  const woertlich = (arg) => `"${String(arg).replaceAll(/[\\"]/g, schutz)}"`;
  return { befehl, args: args.map(woertlich), optionen: { windowsVerbatimArguments: true, argv0: `"${befehl}"` } };
}

/**
 * Wie startet das Kit ein Programm (Issue #1131, Plan #1128, E8)? Liefert
 * `{ befehl, vorArgs, umgebung, fehler }`; gestartet wird `befehl` mit `[...vorArgs, ...args]`
 * und `umgebung` zusaetzlich zur eigenen. Ein Start ueber die Git Bash traegt dazu
 * `gitBash: true` und geht ueber `spawnAufruf` (Issue #1143).
 *
 * Auf POSIX unveraendert der Name. Unter Windows:
 *   - Liefert die Suche im PATH eine `.exe` oder `.com`, startet sie direkt.
 *   - Liegt nur eine `.cmd`- oder `.bat`-Huelle vor und daneben eine gleichnamige Datei ohne
 *     Endung, startet diese ueber die Git Bash: `bash.exe <datei> …args`. npm legt eine solche
 *     sh-Huelle unter Windows immer mit an.
 *   - Fehlt sie, ist das Programm ohne `cmd.exe` nicht startbar, und genau das steht im Fehler.
 *     Ein `.cmd` ueber die Shell-Option von spawn faellt aus: Node lehnt `.cmd` ohne Shell seit
 *     CVE-2024-27980 ab, und cmd-Quoting kann keine Zeilenumbrueche.
 *
 * Liegt das Programm gar nicht im PATH, bleibt es beim Namen: Der Start scheitert dann mit
 * ENOENT, und die Meldung dazu kennt der Aufrufer.
 */
export function startbefehlFuer(name, { env = process.env, plattform = process.platform, existiert = existsSync } = {}) {
  const direkt = { befehl: name, vorArgs: [], umgebung: {}, fehler: null };
  if (plattform !== "win32") return direkt;

  const gefunden = findeImPath(name, {
    platform: plattform,
    path: umgebungsWert(env, "PATH"),
    pathext: umgebungsWert(env, "PATHEXT"),
    existiert,
  });
  if (!gefunden) return direkt;

  const endung = path.win32.extname(gefunden).toLowerCase();
  if (endung === ".exe" || endung === ".com") return { ...direkt, befehl: gefunden };

  const nichtStartbar = (grund) => ({ befehl: null, vorArgs: [], umgebung: {}, fehler: grund });
  const huelle = gefunden.slice(0, -endung.length);
  if ((endung === ".cmd" || endung === ".bat") && existiert(huelle)) {
    const bash = gitBashPfad({ env, plattform, existiert });
    if (bash.fehler) return nichtStartbar(`"${name}" liegt als sh-Huelle vor (${huelle}): ${bash.fehler}`);
    return { befehl: bash.pfad, vorArgs: [huelle], umgebung: { ...GIT_BASH_UMGEBUNG }, gitBash: true, fehler: null };
  }
  return nichtStartbar(`"${name}" liegt nur als ${gefunden} ohne sh-Huelle daneben vor und ist nicht ohne cmd.exe startbar`);
}
