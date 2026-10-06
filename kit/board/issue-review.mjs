/**
 * board/issue-review.mjs — Issue-Review-Achse des Board-Werkzeugs (Issue #1221, Plan #1199, E17):
 * Reviewer-Auswahl, Pruefstufen, Verfuegbarkeit mit Probelauf und die Befehle
 * `issue-review reviewers | roles | matrix | check`.
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

import { fail, out, loadConfig, findeImPath, umgebungsWert, spawnAufruf, startbefehlFuer } from "./grundlagen.mjs";
import { istFachlich, istPlan } from "./dokumente.mjs";

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

// Rueckfallebene, wenn `reviewStufen` ganz fehlt: das Verhalten vor dieser Aenderung —
// zwei Reviewer mit den beiden Rollen, die /issue-review schon kennt. Ein Kit-Update
// darf keinem Bestandsprojekt den Review umbauen, dieselbe Vorsicht wie bei
// `requiredBeforeReady`, das per Default aus ist.
const REVIEW_STUFEN_DEFAULT = { reviewer: 2, rollen: ["vollstaendigkeit-pruefbarkeit", "scope-risiko-bestand"] };

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
    return { stufen: Object.fromEntries(REVIEW_STUFEN.map((s) => [s, REVIEW_STUFEN_DEFAULT])), stufenQuelle: "default" };
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


// Verfuegbarkeit eines Kommandos: Das erste Wort muss als startbare Datei auffindbar
// sein. `command -v` waere kuerzer, gibt es unter cmd.exe aber nicht (Issue #196).
// Liefert zusaetzlich den aufgeloesten Pfad und den Startbefehl dazu — der Probelauf
// unten startet damit, statt noch einmal zu suchen. Unter Windows steckt in `pfad` die
// Endung aus PATHEXT, und ein per npm installiertes `codex.cmd` startet ueber seine
// sh-Huelle in der Git Bash (Issue #1135, E8); fehlt die Huelle, steht das in
// `start.fehler`. Umgebung, Plattform und Dateisystem sind injizierbar wie bei
// `startbefehlFuer`.
export function kommandoVerfuegbar(kommandozeile, { env = process.env, plattform = process.platform, existiert, ausfuehrbar } = {}) {
  const datei = kommandozeile.trim().split(/\s+/)[0];
  const pfad = findeImPath(datei, {
    platform: plattform,
    path: umgebungsWert(env, "PATH"),
    pathext: umgebungsWert(env, "PATHEXT"),
    existiert,
    ausfuehrbar,
  });
  if (pfad === null) return { datei, ok: false, pfad, start: null };
  return { datei, ok: true, pfad, start: startbefehlFuer(pfad, { env, plattform, existiert }) };
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
 * nicht abgedeckt, und das ist der Preis dafuer, dass es unter Windows laeuft.
 * Gestartet wird nach `start` aus kommandoVerfuegbar (Issue #1135, E8).
 *
 * `spawn`, Prompt, Zeitlimit und Umgebung sind injizierbar (Plan #1199, E6): Ein Test
 * reicht ein Ergebnis von spawnSync herein und belegt jeden Ausgang im selben Prozess,
 * ohne Attrappe, die haengt oder abstuerzt.
 */
export function probelauf(kommandozeile, start, { spawn = spawnSync, prompt = PROBE_PROMPT, timeoutMs = PROBE_TIMEOUT_MS, env = process.env } = {}) {
  const argumente = kommandozeile.trim().split(/\s+/).slice(1);
  const aufruf = spawnAufruf(start.befehl, [...start.vorArgs, ...argumente], start);
  const res = spawn(aufruf.befehl, aufruf.args, {
    ...aufruf.optionen,
    input: prompt,
    encoding: "utf-8",
    timeout: timeoutMs,
    env: { ...env, ...start.umgebung },
  });
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
 * STUFENBESETZUNG ("stufen" | "default").
 *
 * `--issue`, `--rolle` und `--ausschluss` sind mit der Pruefvorgabe und der
 * Synthese-Pruefung entfallen. Sie werden abgewiesen statt still uebergangen: Ein
 * stilles Flag waere eine zweite Wahrheit ueber das, was das Kommando tut.
 */
const ROLES_ENTFALLEN = ["issue", "rolle", "ausschluss"];

export function issueReviewRoles(args, config = loadConfig()) {
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
  const { reviewer, rollen } = reviewStufen.stufen[stufe];
  return {
    stufe,
    reviewer,
    rollen,
    stufenQuelle: reviewStufen.stufenQuelle,
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
  const { reviewers } = issueReviewConfig(config);
  const ergebnis = reviewers.map((r) => {
    const basis = { name: r.name, kind: r.kind, umgebung: CHECK_UMGEBUNG };
    if (r.kind === "claude") return { ...basis, verfuegbar: true };
    const { datei, ok, start } = verfuegbar(r.command);
    if (!ok) return { ...basis, verfuegbar: false, geprueft: "pfad", grund: `${datei} nicht im PATH` };
    // Im PATH, aber nicht startbar: eine `.cmd` ohne sh-Huelle unter Windows (E8).
    if (start.fehler) return { ...basis, verfuegbar: false, geprueft: "pfad", grund: start.fehler };
    if (nurPfad) return { ...basis, verfuegbar: true, geprueft: "pfad" };
    const lauf = probe(r.command, start);
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
    ? { reviewers: [], alleVerfuegbar: false, grund: "issueReview.reviewers ist leer oder fehlt — Block aus .claude/workflow.config.example.json uebernehmen" }
    : { reviewers: ergebnis, alleVerfuegbar: ergebnis.every((r) => r.verfuegbar) };
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

// Die Hilfe kommt vom Einstieg herein: Sie steht dort, und ein Import von dort waere ein Zyklus.
export function dispatchIssueReview(command, args, hilfe) {
  switch (command) {
    case "reviewers": return out(issueReviewReviewers(args));
    case "check": return out(issueReviewCheck(args));
    case "matrix": return out(issueReviewMatrix());
    case "roles": return out(issueReviewRoles(args));
    default:
      process.stdout.write(hilfe);
      fail(`Unbekannter issue-review-Befehl: '${command}'`);
  }
}
