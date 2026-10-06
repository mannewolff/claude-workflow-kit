/**
 * night/session.mjs — die Session des Nacht-Runners (Issue #1228, Plan #1199, E17): der
 * Session-Strom mit Verbose-Stream, Werkzeugzeit, Prueflaeufen, Fortschrittszeilen und
 * Board-Auskuenften, die Session-Kennzahlen und der Verbrauch je Einheit und Lauf, Modell und
 * Stufe einer Karte, die Nacht-Session selbst, der Salvage, das Modell des Laufs, die Budgets
 * der Nacht-Kette und des Prueflaufs, der Reviewer-Vorflug und die Kommentare einer Session.
 *
 * Ein Teil von kit/night.mjs. Der Einstieg laedt ihn erst nach der Auskunft ueber
 * --version und --help und exportiert seine Namen unveraendert weiter. Dieser Teil
 * importiert nur aus Teilen unter kit/night/ und kit/board/, nie aus dem Einstieg:
 * Der Einstieg laedt die Teile, ein Rueckimport waere ein Zyklus.
 *
 * Mitgezogen, obwohl E17 sie dem Teil bericht zuordnet: `lesePruefung` aus dem Abschnitt
 * "Pruef-Zusammenfassungen der Sessions". Die Salvage-Vorpruefung liest den Nachweis ueber
 * sie, und der Teil bericht braucht seinerseits die Paketstufe und die Pflicht-Checks von
 * hier — laege sie dort, importierten sich die beiden Teile gegenseitig.
 *
 * Bewusst ohne eigene KIT_VERSION (Plan #1199, E19): Die Teile kommen im selben
 * Verzeichnis-Blob wie der Einstieg und werden nie einzeln verteilt.
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { ZUSTAND, NACHBAR_DIR, NACHBAR_CHECKS, CHECKS_PATH, DEFAULT_MODEL, log,
  schrittZweiterVersuch, schrittProtokollieren, fail, schreibeErgebnisstand, ladeConfigMitOverrides,
  salvageSauberkeitsKommando } from "./grundlagen.mjs";
import { pulsSchreiben, zweiterVersuch, sitzungsStartGescheitert, exitText } from "./laufstand.mjs";
import { kitStandUmgebung, laufKennungUmgebung } from "./kitstand.mjs";

// Der Finder der Git Bash und die Startregel fuer Programme unter Windows (Issue #1131, Plan
// #1128, E2) kommen aus dem Board-Teil wiederholung, der sie fuehrt (Issue #1215). Abgefangen
// wie im Einstieg: Fehlt der Teil, melden sie das erst, wenn jemand sie wirklich braucht. Der
// Pfad ist nicht literal, deshalb nennt die Gruppe dieses Teils den Bereich board-wiederholung
// von Hand (E3).
const { gitBashPfad, startbefehlFuer, spawnAufruf, GIT_BASH_UMGEBUNG } = await import(pathToFileURL(join(NACHBAR_DIR, "board", "wiederholung.mjs")).href).catch(() => {
  const fehlt = () => {
    throw new Error("board/wiederholung.mjs fehlt neben night.mjs — der Nacht-Runner braucht den Board-Adapter.");
  };
  return { gitBashPfad: fehlt, startbefehlFuer: fehlt, spawnAufruf: fehlt, GIT_BASH_UMGEBUNG: {} };
});

// Der Ort der Pruef-Zusammenfassung kommt aus checks.mjs und wird NICHT nachgerechnet (Issue
// #428). Bedingt und mit werfendem Ersatz wie im Einstieg: Fehlt der Nachbar, wirft der Stub
// erst, wenn wirklich jemand den Pfad braucht. Der Pfad ist nicht literal, deshalb nennt die
// Gruppe dieses Teils den Bereich pruefungen von Hand (E3).
const { zusammenfassungPfad } = existsSync(NACHBAR_CHECKS)
  ? await import(pathToFileURL(NACHBAR_CHECKS).href)
  : {
      zusammenfassungPfad: () => {
        throw new Error(`checks.mjs liegt nicht neben night.mjs (${NACHBAR_CHECKS}) — der Ort der Pruef-Zusammenfassung ist unbekannt.`);
      },
    };

// --- Verbose-Stream (Issue #154) ---

// Kuerzt Text auf eine kompakte, einzeilige Log-Zeile.
export function flatten(str, max) {
  const flat = (str || "").replaceAll(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// Waehlt das aussagekraeftigste Argument eines Tool-Aufrufs (Kommando, Pfad),
// faellt auf ein kompaktes JSON zurueck.
function toolArg(block) {
  const input = block.input || {};
  for (const key of ["command", "file_path", "path", "pattern", "url"]) {
    if (typeof input[key] === "string") return input[key];
  }
  const json = JSON.stringify(input);
  return json && json !== "{}" ? json : "";
}

// Uebersetzt eine stream-json-Zeile (ein NDJSON-Objekt) in 0..n kompakte
// Ereigniszeilen: Tool-Aufrufe (Bash/Edit/…) und Text-Snippets der Session.
function interpretStreamEvent(obj) {
  const out = [];
  if (!obj || typeof obj !== "object") return out;
  if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
    for (const block of obj.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        out.push(`Claude: ${flatten(block.text, 200)}`);
      } else if (block.type === "tool_use" && block.name) {
        const arg = toolArg(block);
        out.push(arg ? `${block.name}: ${flatten(arg, 160)}` : block.name);
      }
    }
  }
  return out;
}

function emitVerbose(issueId, line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return; // unparsebare Zeilen tolerant ueberspringen
  }
  for (const ev of interpretStreamEvent(obj)) {
    log(`  #${issueId} > ${ev}`);
  }
}

// --- Werkzeugzeit am Session-Strom (Issue #748) ---

/**
 * Beobachtet einen `stream-json`-Strom und misst, wie lange eine Session an ihren
 * Werkzeugen gehangen hat (Plan #745, E1/E2).
 *
 * Gemessen wird allein die SPANNE: Ein `assistant`-Ereignis mit `tool_use`-Bloecken
 * eroeffnet einen Schub, das letzte zugehoerige `tool_result` schliesst ihn. Der Inhalt
 * eines Aufrufs wird nie gelesen — kein Werkzeugname, kein Argument wird gespeichert.
 * Deutete der Beobachter den Aufruf, haette er eine Meinung darueber, was "Arbeit" ist;
 * so hat er nur eine Uhr.
 *
 * Drei parallele Aufrufe eines Schubs zaehlen als EIN Zeitraum. Ihre Einzelspannen zu
 * addieren buchte dieselbe Wanduhr dreifach — die Session hat einmal gewartet, nicht
 * dreimal. Dass es mehr als einer war, steht darum in `nebenlaeufigeSchuebe` und nicht
 * in der Zeit.
 *
 * Ein Schub, dessen `tool_result` nie ankommt (abgeschnittener Strom, Zeitlimit), zaehlt
 * als `offeneSchuebe` und geht NICHT in `werkzeugMs` ein: Ein fehlender Messwert darf
 * nicht als Null erscheinen, und die Spanne bis zum letzten gesehenen Ereignis waere eine
 * Schaetzung, die sich als Messung ausgaebe.
 *
 * Eigener Zustand statt einer reinen Funktion ueber dem ganzen stdout (wie
 * `leseKennzahlen`), weil die Zeitstempel aus der ANKUNFT der Zeilen stammen — im
 * gesammelten stdout stehen sie nicht mehr. Der Aufrufer gibt den Zeitstempel darum mit;
 * das haelt den Beobachter an Fixtures prueffbar, und deshalb ist er exportiert.
 *
 * `zeile(roh, ts)` nimmt eine Rohzeile oder ein bereits geparstes Objekt, `ergebnis()`
 * liefert jederzeit `{ werkzeugMs, schuebe, nebenlaeufigeSchuebe, offeneSchuebe }`.
 * Unlesbare Zeilen werden tolerant uebersprungen, wie in `leseKennzahlen()` — eine
 * Kennzahl darf einen laufenden Nachtlauf nicht zu Fall bringen.
 */
/**
 * Liest eine Zeile des Session-Stroms und gibt das Ereignis zurueck — oder `null`,
 * wenn die Zeile keines ist (Issue #960).
 *
 * Ein bereits geparstes Objekt wird durchgereicht: Die Beobachter bekommen ihre Zeile
 * teils schon gelesen, und ein zweites `JSON.parse` darauf wuerde werfen.
 *
 * Billiger Vorfilter auf `{`: Ein Stream-Ereignis ist immer ein JSON-Objekt. Das haelt
 * `JSON.parse` von jeder Fliesstext-Zeile fern — und die Beobachter sitzen im
 * stdout-Handler jeder Session.
 *
 * Eine unlesbare Zeile ergibt `null`, statt zu werfen: Eine Kennzahl darf einen
 * laufenden Nachtlauf nicht zu Fall bringen.
 *
 * Exportiert, damit ein Test genau diese Funktion trifft und keine Kopie, die ab der
 * ersten Abweichung etwas anderes bescheinigt — Muster `globZuRegex` in
 * `kit/checks.mjs`.
 */
export function leseStromereignis(roh) {
  if (roh && typeof roh === "object") return roh;
  if (typeof roh !== "string") return null;
  const trimmed = roh.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function werkzeugZeitBeobachter() {
  let werkzeugMs = 0;
  let schuebe = 0;
  let nebenlaeufigeSchuebe = 0;
  let verwaiste = 0;
  // Der Schub, der gerade laeuft: Startzeit, noch offene tool_use-Ids und die Zahl der
  // Aufrufe, mit der er begonnen hat.
  let offen = null;

  return {
    zeile(roh, ts) {
      const obj = leseStromereignis(roh);
      if (!obj || !Array.isArray(obj.message?.content)) return;

      if (obj.type === "assistant") {
        // Ohne Id liesse sich einem Aufruf kein Ergebnis zuordnen; er eroeffnet darum
        // keinen Schub, statt einen zu eroeffnen, der nie schliesst.
        const ids = obj.message.content
          .filter((b) => b?.type === "tool_use" && typeof b.id === "string" && b.id)
          .map((b) => b.id);
        if (!ids.length) return;
        // Ein neuer Schub, waehrend der alte noch offen ist: Der alte bekommt kein
        // Ergebnis mehr und zaehlt als offen.
        if (offen) verwaiste += 1;
        offen = { start: ts, ids: new Set(ids), aufrufe: ids.length };
        return;
      }

      if (!offen) return;
      for (const block of obj.message.content) {
        if (block?.type === "tool_result") offen.ids.delete(block.tool_use_id);
      }
      if (offen.ids.size === 0) {
        werkzeugMs += ts - offen.start;
        schuebe += 1;
        if (offen.aufrufe > 1) nebenlaeufigeSchuebe += 1;
        offen = null;
      }
    },
    ergebnis() {
      // Der noch laufende Schub wird hier dazugezaehlt statt beim Eintreffen abgeschlossen:
      // ergebnis() darf mehrfach abgerufen werden, ohne den Zustand zu veraendern.
      return { werkzeugMs, schuebe, nebenlaeufigeSchuebe, offeneSchuebe: verwaiste + (offen ? 1 : 0) };
    },
  };
}

// --- Prueflaeufe am Session-Strom (Issue #924) ---

/**
 * Das erste Programm einer Kommandozeile, ohne Pfad (Issue #924).
 *
 * Vorangestellte Umgebungszuweisungen (`NODE_OPTIONS=… node …`) werden uebersprungen:
 * Sie sind keine Programme, und ein Aufruf mit Zuweisung ist derselbe Lauf wie einer
 * ohne. Alles Weitere bleibt absichtlich einfach — gefragt ist das erste Wort, nicht
 * eine Shell-Grammatik im Runner.
 */
function erstesProgramm(kommando) {
  for (const wort of String(kommando ?? "").trim().split(/\s+/)) {
    if (wort === "") continue;
    if (/^[A-Za-z_]\w*=/.test(wort)) continue;
    const ohnePfad = wort.split(/[/\\]/).pop();
    return ohnePfad || null;
  }
  return null;
}

/** Vergleichsform einer Kommandozeile: getrimmt, Whitespace auf ein Leerzeichen. */
function kommandoNormal(kommando) {
  return String(kommando ?? "").trim().replaceAll(/\s+/g, " ");
}

/**
 * Der Satzteil, an dem `checks.mjs run` eine Uebernahme meldet (Issue #926).
 *
 * Der Zaehler sieht vom Abschlussversuch nur den Aufruf und seine Ausgabe — dass ein Lauf
 * uebernommen wurde, steht in der Zusammenfassung, aber die liest er nicht: Sie traegt
 * immer nur den letzten Lauf einer Session, und gefragt ist jeder einzelne Versuch.
 */
// SYNC: dieselbe Marke steht in kit/checks.mjs als UEBERNAHME_MARKE und wird dort in die
// Ausgabe geschrieben; ein Test in test/night-prueflaeufe.test.mjs haelt beide zusammen.
export const UEBERNAHME_MARKE = "Ergebnis uebernommen";

/**
 * Der Text eines `tool_result` — als String oder als Bloecke mit `text`.
 *
 * Beide Formen kommen im Strom vor, je nachdem, was das Werkzeug zurueckgibt. Was sich
 * nicht lesen laesst, ist ein leerer Text und keine Ausnahme: Der Zaehler faellt dann auf
 * die gemessene Spanne zurueck, und das ist die vorsichtigere Auskunft.
 */
function ergebnisText(block) {
  const inhalt = block?.content;
  if (typeof inhalt === "string") return inhalt;
  if (!Array.isArray(inhalt)) return "";
  return inhalt.map((teil) => (typeof teil?.text === "string" ? teil.text : "")).join("\n");
}

/**
 * Wie ein Bash-Aufruf zu zaehlen ist (Plan #917, E2/E3/E9) — oder gar nicht.
 *
 *   "voll"      woertlich ein `buildChecks`-Kommando: die vollstaendige Gruppe waehrend
 *               der Arbeit, und genau das ist der Verstoss, den dieser Zaehler sichtbar macht.
 *   "bereich"   `checks.mjs run --bereich <name>`: der sanktionierte Gruppenlauf (E3).
 *               Er zaehlt eigens, damit er nicht unter die Verstoesse geraet.
 *   "gezielt"   dasselbe Programm wie ein `buildChecks`-Kommando, aber anderer Umfang.
 *   "abschluss" `checks.mjs run` ohne `--bereich`: der Abschlussversuch (E9). Er zaehlt in
 *               seinem EIGENEN Block und nie in der Arbeit — dort stuende er zweimal.
 *   null        kein Prueflauf.
 *
 * Der Aufrufweg entscheidet, nicht die Absicht: `checks.mjs` wird am Kommando erkannt,
 * nicht am Programmabgleich — in einem Projekt mit `mvn verify` als Pruefgruppe traegt
 * der Bereichslauf ein anderes Programm als jede konfigurierte Gruppe.
 */
function prueflaufArt(kommando, programme, woertlich) {
  const text = kommandoNormal(kommando);
  if (text === "") return null;
  const worte = text.split(" ");
  const idx = worte.findIndex((w) => w.replaceAll(/["']/g, "").endsWith("checks.mjs"));
  if (idx >= 0 && worte[idx + 1] === "run") {
    return worte.slice(idx + 2).some((w) => w === "--bereich" || w.startsWith("--bereich=")) ? "bereich" : "abschluss";
  }
  if (woertlich.has(text)) return "voll";
  const programm = erstesProgramm(text);
  return programm && programme.has(programm) ? "gezielt" : null;
}

/**
 * Beobachtet denselben `stream-json`-Strom wie `werkzeugZeitBeobachter` und zaehlt, was
 * eine Session waehrend ihrer Arbeit an Prueflaeufen startet (Plan #917, E1).
 *
 * Ein eigener Beobachter neben der Uhr, kein Ausbau von ihr: Jener liest bewusst keinen
 * Inhalt — "so hat er nur eine Uhr" (Plan #745, E1/E2) —, dieser hier MUSS deuten, um
 * einen Prueflauf von einem `git status` zu unterscheiden. Beide Aufgaben in einem
 * Beobachter haetten die Entscheidung von damals stillschweigend aufgehoben.
 *
 * Gezaehlt wird je AUFRUF, nicht je Schub: Zwei nebeneinander gestartete Testlaeufe sind
 * zwei Laeufe. Die Zuordnung geht ueber `tool_use.id` zu `tool_result.tool_use_id`; ein
 * Aufruf ohne Ergebnis (abgeschnittener Strom) zaehlt als gestartet, seine Spanne geht
 * nicht ein — sie waere eine Schaetzung, die sich als Messung ausgibt.
 *
 * `buildChecks` kommt aus der Konfiguration, in beiden Eintragsformen (String oder Objekt
 * mit `cmd`, E2): Sie ist die einzige Stelle, die weiss, was "vollstaendig" heisst.
 *
 * `zeile(roh, ts)` nimmt eine Rohzeile oder ein geparstes Objekt mit dem Zeitstempel ihrer
 * ANKUNFT, `ergebnis()` liefert jederzeit `{ anzahl, volle, volleNoetig, dauerMs, abschluss }`.
 * `abschluss` (Issue #926, E9) zaehlt die Abschlussversuche — `checks.mjs run` ohne
 * `--bereich` — und ihre Spannen, in einem eigenen Block neben der Arbeit: In `anzahl`
 * stuende derselbe Lauf zweimal. Was aus beidem FOLGT — Laeufe je Abschluss, Anteil an der
 * Laufzeit, Abstand zur Zielmarke — rechnet der Bericht, nicht dieser Zaehler (E7).
 */
export function prueflaufBeobachter(buildChecks) {
  const kommandos = (Array.isArray(buildChecks) ? buildChecks : [])
    .map((eintrag) => (typeof eintrag === "string" ? eintrag : eintrag?.cmd))
    .map(kommandoNormal)
    .filter((cmd) => cmd !== "");
  const woertlich = new Set(kommandos);
  const programme = new Set(kommandos.map(erstesProgramm).filter(Boolean));

  let anzahl = 0;
  let volle = 0;
  let volleNoetig = 0;
  let dauerMs = 0;
  let abschlussAnzahl = 0;
  let abschlussDauerMs = 0;
  // Die noch laufenden Prueflaeufe: tool_use.id -> { start, abschluss }. Nur Prueflaeufe
  // stehen darin — jeder andere Aufruf ist fuer diesen Beobachter nicht vorhanden. Die Art
  // gehoert dazu, weil erst das Ergebnis eines Abschlussversuchs zeigt, ob er wirklich lief.
  const offen = new Map();

  // Ein gestarteter Aufruf: gezaehlt wird beim tool_use, denn gemessen wird, was die
  // Session STARTET. Die Spanne kommt spaeter dazu, wenn sein Ergebnis eintrifft.
  const aufrufGesehen = (block, ts) => {
    if (block?.type !== "tool_use" || block.name !== "Bash") return;
    if (typeof block.id !== "string" || block.id === "") return;
    const art = prueflaufArt(block.input?.command, programme, woertlich);
    if (!art) return;
    if (art === "abschluss") {
      abschlussAnzahl += 1;
      offen.set(block.id, { start: ts, abschluss: true });
      return;
    }
    anzahl += 1;
    if (art === "voll") volle += 1;
    else if (art === "bereich") volleNoetig += 1;
    offen.set(block.id, { start: ts, abschluss: false });
  };

  const ergebnisGesehen = (block, ts) => {
    if (block?.type !== "tool_result") return;
    const lauf = offen.get(block.tool_use_id);
    if (lauf === undefined) return;
    offen.delete(block.tool_use_id);
    if (!lauf.abschluss) {
      dauerMs += ts - lauf.start;
      return;
    }
    // Ein uebernommener Abschlusslauf hat nichts ausgefuehrt (Issue #926): `uebernehmen`
    // reicht die Werte des frueheren Laufs weiter, die Spanne dieses Aufrufs waere die
    // Dauer eines Dateischreibens und gaebe sich als Pruefdauer aus. Der Versuch zaehlt,
    // die Dauer nicht — dieselbe Regel wie beim Aufruf ohne Ergebnis.
    if (!ergebnisText(block).includes(UEBERNAHME_MARKE)) abschlussDauerMs += ts - lauf.start;
  };

  return {
    zeile(roh, ts) {
      const obj = leseStromereignis(roh);
      if (!obj || !Array.isArray(obj.message?.content)) return;
      const behandle = obj.type === "assistant" ? aufrufGesehen : ergebnisGesehen;
      for (const block of obj.message.content) behandle(block, ts);
    },
    ergebnis() {
      return { anzahl, volle, volleNoetig, dauerMs, abschluss: { anzahl: abschlussAnzahl, dauerMs: abschlussDauerMs } };
    },
  };
}

// --- Fortschrittszeilen am Session-Strom (Issue #975, Plan #974) ---

// Der Anker, mit dem eine Sitzung ihren eigenen Stand meldet. Ihn zu schreiben ist Auftrag
// des implement-next-Skills (Issue #981) — kein Werkzeug kann fuer die Sitzung ueber ihren
// Stand sprechen.
const FORTSCHRITT_ANKER = "FORTSCHRITT:";

// Je Zeile derselbe Platz wie bei jeder anderen Zeile, die aus einem Strom in einen Text
// geht (`flatten`): Ein halber Satz je Punkt des Akzeptanzkriteriums passt darin.
const FORTSCHRITT_ZEILE_MAX = 200;

// Mehr als zehn Zeilen machen den Vermerk unlesbar. Behalten werden die JUENGSTEN: Gefragt
// ist der Stand, den die Sitzung zuletzt erreicht hat, nicht ihr Anfang. Dass gekuerzt
// wurde, bleibt an `gesehen` ablesbar — sonst saehe eine gekappte Liste wie die ganze aus.
const FORTSCHRITT_ZEILEN_MAX = 10;

/**
 * Beobachtet denselben `stream-json`-Strom wie `werkzeugZeitBeobachter` und
 * `prueflaufBeobachter` und sammelt, was die Sitzung unterwegs ueber ihren eigenen Stand
 * gesagt hat (Plan #974, E1).
 *
 * Der Anlass ist das Zeitlimit: Dort wird die Sitzung samt Prozessgruppe gekillt, ein
 * `result`-Ereignis kommt nie an, und `leseErgebnisText` liefert `null`. Der Schlusstext
 * fehlt also genau im Fall, fuer den er gebraucht wuerde — was bleibt, ist allein das
 * live Mitgelesene.
 *
 * Ein dritter Beobachter neben den beiden bestehenden, aus deren Grund: Jeder liest den
 * Strom fuer genau eine Frage. Eine unlesbare Zeile wird uebersprungen, wie dort — eine
 * Kennzahl darf einen laufenden Nachtlauf nicht zu Fall bringen.
 *
 * `zeile(roh, ts)` nimmt eine Rohzeile oder ein geparstes Objekt, `ergebnis()` liefert
 * jederzeit `{ zeilen, gesehen }`. Wer diese Ausgabe liest, entsteht in den Folgepaketen.
 */
export function fortschrittBeobachter() {
  const zeilen = [];
  let gesehen = 0;

  return {
    zeile(roh) {
      const obj = leseStromereignis(roh);
      if (obj?.type !== "assistant" || !Array.isArray(obj.message?.content)) return;
      for (const block of obj.message.content) {
        if (block?.type !== "text" || typeof block.text !== "string") continue;
        for (const zeile of block.text.split("\n")) {
          const getrimmt = zeile.trim();
          if (!getrimmt.startsWith(FORTSCHRITT_ANKER)) continue;
          gesehen += 1;
          zeilen.push(flatten(getrimmt, FORTSCHRITT_ZEILE_MAX));
          if (zeilen.length > FORTSCHRITT_ZEILEN_MAX) zeilen.shift();
        }
      }
    },
    ergebnis() {
      // Eine Kopie: `ergebnis()` darf mehrfach abgerufen werden, und ein Aufrufer, der die
      // Liste weiterreicht, darf den Zustand des Beobachters nicht in der Hand halten.
      return { zeilen: [...zeilen], gesehen };
    },
  };
}

// --- Board-Auskuenfte am Session-Strom (Issue #1026, Plan #1015, E11) ---

/**
 * Das Verzeichnis, in dem Claude Code ein zu grosses Werkzeugergebnis ablegt; die Session
 * liest es danach ueber seinen Pfad nach. Wer einen solchen Pfad nennt, bereitet eine
 * Antwort auf, statt an der Aufgabe zu arbeiten.
 *
 * Beleg: Claude Code 2.1.236, Transkript vom 2026-09-21, ein `Read` mit
 * `{"file_path":"<home>/.claude/projects/<projekt>/<session-id>/tool-results/<kennung>.txt"}`.
 * Die Beispielzeile liegt gekuerzt unter `test/fixtures/auskunft/transkript-tool-results.jsonl`.
 */
export const TOOL_RESULTS_PFAD = "tool-results/";

// Die Rueckfragen aus E11. Jeweils mit Grenze nach dem Unterbefehl, damit `issue list`
// nicht auch `issue lists` trifft; eine Grenze davor, damit `gh` nicht in `sigh` steckt.
const RUECKFRAGE_MUSTER = [
  /board\.mjs["']?\s+(?:issue\s+(?:get|list|epics|activity|auftrag)|kontext)(?![\w-])/,
  /(?:^|[\s;&|(])(?:gh|glab)\s+issue\s+(?:view|list)(?![\w-])/,
  /(?:^|[\s;&|(])gh\s+api\b[^|;&\n]*issues/,
];

// Eine einfache Pipe (nicht `||`) an ein Programm, das die Antwort zerlegt.
const AUFBEREITUNG_PIPE = /(?<!\|)\|(?!\|)\s*(?:jq|node\s+-e|python3?)(?![\w-])/g;

/**
 * Ob ein `tool_use`-Block eine Board-Auskunft ist (E11) — und welche Art.
 *
 *   "rueckfrage"    ein Bash-Aufruf, der das Board oder den Tracker fragt.
 *   "aufbereitung"  ein Aufruf, der die Antwort einer Rueckfrage zerlegt: eine Rueckfrage
 *                   per Pipe an `jq`, `node -e` oder `python`, oder jeder Aufruf, dessen
 *                   Eingabe einen ausgelagerten Werkzeugergebnis-Pfad nennt.
 *   null            keine Auskunft — auch ein schreibender Board-Aufruf (`issue move`,
 *                   `issue comment`, `issue melden`) und ein `node -e` ohne Rueckfrage.
 *
 * Gezaehlt wird am Aufruf, nicht an der Absicht: Das Muster nach `prueflaufArt`.
 *
 * SYNC: `TOOL_RESULTS_PFAD`, `RUECKFRAGE_MUSTER`, `AUFBEREITUNG_PIPE` und diese Funktion
 * stehen als Kopie in kit/aufwand.mjs (Issue #1027), das damit Transkripte nachtraeglich
 * misst. Den Gleichlauf haelt test/night-auskunft-gleichlauf.test.mjs.
 */
export function auskunftArt(block) {
  if (block?.type !== "tool_use" || !block.input || typeof block.input !== "object") return null;
  const bashText = block.name === "Bash" && typeof block.input.command === "string" ? block.input.command : null;
  if (JSON.stringify(block.input).includes(TOOL_RESULTS_PFAD)) return "aufbereitung";
  if (bashText === null) return null;
  let erste = -1;
  for (const muster of RUECKFRAGE_MUSTER) {
    const treffer = muster.exec(bashText);
    if (treffer && (erste < 0 || treffer.index < erste)) erste = treffer.index;
  }
  if (erste < 0) return null;
  for (const pipe of bashText.matchAll(AUFBEREITUNG_PIPE)) {
    if (pipe.index > erste) return "aufbereitung";
  }
  return "rueckfrage";
}

/**
 * Beobachtet denselben `stream-json`-Strom wie die drei anderen Beobachter und misst die
 * Zeit fuer Board-Auskuenfte (Plan #1015, E11): die Spanne tool_use bis tool_result jedes
 * Aufrufs, den `auskunftArt` erkennt. Nachdenkzeit zwischen den Aufrufen zaehlt nicht.
 *
 * Ein eigener Beobachter aus demselben Grund wie `prueflaufBeobachter`: Jeder liest den
 * Strom fuer genau eine Frage. Gezaehlt wird je Aufruf beim tool_use; ein Aufruf ohne
 * Ergebnis zaehlt mit, seine Spanne nicht — sie waere eine Schaetzung.
 *
 * `zeile(roh, ts)` nimmt eine Rohzeile oder ein geparstes Objekt mit dem Zeitstempel ihrer
 * ANKUNFT, `ergebnis()` liefert jederzeit `{ ms, aufrufe }`.
 */
export function auskunftBeobachter() {
  let ms = 0;
  let aufrufe = 0;
  const offen = new Map();

  return {
    zeile(roh, ts) {
      const obj = leseStromereignis(roh);
      if (!obj || !Array.isArray(obj.message?.content)) return;
      for (const block of obj.message.content) {
        if (obj.type === "assistant") {
          if (typeof block?.id !== "string" || block.id === "" || !auskunftArt(block)) continue;
          aufrufe += 1;
          offen.set(block.id, ts);
        } else if (block?.type === "tool_result" && offen.has(block.tool_use_id)) {
          ms += ts - offen.get(block.tool_use_id);
          offen.delete(block.tool_use_id);
        }
      }
    },
    ergebnis() {
      return { ms, aufrufe };
    },
  };
}

/**
 * Ob ein Session-Prompt eine Umsetzung startet (Plan #1015, E12): `/implement-next`,
 * `/implement-ready`, `/implement-test` oder `/implement-done` am Anfang. Die Kette, die
 * Kartenanlage, der Prueflauf und die Rettung einer Runde starten anders.
 */
export function umsetzungsStart(prompt) {
  return typeof prompt === "string" && /^\s*\/implement-(?:next|ready|test|done)(?![\w-])/.test(prompt);
}

// --- Session-Kennzahlen (Issue #487) ---

// Ein Feld gilt nur als gelesen, wenn es eine endliche Zahl ist — auch die 0. Alles
// andere (fehlend, null, String, Objekt) wird zu null. Ein `|| null` taete das nicht:
// Es machte aus einer echten 0 ein "nicht verfuegbar", und im Ergebnisstand liesse sich
// eine Session ohne Zug nicht mehr von einer ohne Messwert unterscheiden.
export function endlicheZahl(wert) {
  return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
}

// Dieselbe Strenge fuer die beiden Felder, an denen der Ausgang einer Session haengt
// (Issue #668): Ein `stop_reason`, das kein String ist, und ein `is_error`, das kein
// Boolean ist, sind kein Messwert, sondern eine unbekannte Fassung des Ereignisses.
// Sie als `null` zu fuehren sagt "nicht gemessen"; sie durchzureichen hiesse, einen
// Grund-Praefix auf ein Objekt zu stuetzen.
function nurString(wert) {
  return typeof wert === "string" ? wert : null;
}

function nurBoolean(wert) {
  return typeof wert === "boolean" ? wert : null;
}

/**
 * Liest Kosten, API-Dauer und Zahl der Zuege aus dem `result`-Ereignis eines
 * Session-Streams.
 *
 * Reine Funktion ueber dem stdout aus `runSession`: Board, Dateisystem und Subprozesse
 * bleiben draussen, damit das Fehlerverhalten an Fixtures pruefbar ist (Linie von
 * `parseDeps`). Exportiert genau deshalb.
 *
 * `interpretStreamEvent` bleibt unberuehrt — es wertet ausschliesslich `assistant`-
 * Ereignisse fuer das Live-Protokoll aus. Diese Funktion tritt daneben, nicht an seine
 * Stelle.
 *
 * Das `result`-Ereignis gibt es nur mit `--verbose`; ohne das Flag liefert `claude -p`
 * reinen Text, und die Antwort ist `null`. Unlesbare Zeilen (abgeschnitten beim Kill am
 * Zeitlimit, Fremdausgabe) werden uebersprungen statt geworfen: Eine Kennzahl darf einen
 * ausgewerteten Lauf nicht zu Fall bringen.
 *
 * Bei mehreren `result`-Zeilen zaehlt die letzte. `subtype` bleibt unbeachtet — auch
 * eine abgebrochene Session hat gekostet, und ihr Ausgang steht ohnehin am Board.
 *
 * Seit Issue #668 kommen `stop_reason` und `is_error` mit: An ihnen haengt, ob eine
 * Runde ohne Ergebnis regulaer beendet wurde (`end_turn` — die Session hat auf etwas
 * gewartet, das nie kam) oder abgebrochen ist. Sie stehen in derselben Zeile; ein
 * zweiter Durchlauf ueber dasselbe stdout waere Aufwand ohne Gewinn, und zwei Stellen,
 * die dieselbe Zeile deuten, laufen auseinander.
 *
 * Rueckgabe: `{ kostenUsd, apiDauerMs, zuege, stopReason, isError }` in US-Dollar,
 * Millisekunden, Anzahl, Zeichenkette und Ja/Nein — je ein Wert oder `null` —, oder
 * `null`, wenn keine `result`-Zeile im stdout steht. Die Schluessel sind verbindlich:
 * Issue #488 uebernimmt sie in den Ergebnisstand.
 */
export function leseKennzahlen(stdout) {
  let letzte = null;
  for (const zeile of String(stdout ?? "").split(/\r\n|\r|\n/)) {
    // Vorfilter, Trimmen und das tolerante Ueberspringen einer unlesbaren Zeile
    // stehen in `leseStromereignis`. Hier kommen ausschliesslich Strings aus dem
    // `split` an — das Durchreichen eines bereits geparsten Objekts greift also nie.
    const obj = leseStromereignis(zeile);
    if (obj && typeof obj === "object" && obj.type === "result") letzte = obj;
  }
  if (!letzte) return null;
  // Die vier Mengen aus `usage` (Issue #669): Die CLI meldet sie ohnehin, und nur wer sie
  // nicht verwirft, kann sie am Board zeigen. Kein Rechnen, nur Durchreichen.
  const usage = letzte.usage && typeof letzte.usage === "object" ? letzte.usage : {};
  // Die Teilung des Zwischenspeichers nach Haltedauer (Issue #749, Review-Fund W2): Die
  // Preistabelle (kit/preise.mjs) fuehrt zwei Saetze, die um bis zu 60 Prozent auseinander
  // liegen — ohne die Teilung waere die Kostenverteilung geraten. `cacheErzeugtTokens`
  // bleibt unveraendert die Summe; fehlt `usage.cache_creation` im Strom, bleiben beide
  // neuen Felder `null` statt einer Schaetzung.
  const teilung = usage.cache_creation && typeof usage.cache_creation === "object" ? usage.cache_creation : null;
  return {
    kostenUsd: endlicheZahl(letzte.total_cost_usd),
    apiDauerMs: endlicheZahl(letzte.duration_api_ms),
    zuege: endlicheZahl(letzte.num_turns),
    stopReason: nurString(letzte.stop_reason),
    isError: nurBoolean(letzte.is_error),
    eingabeTokens: endlicheZahl(usage.input_tokens),
    ausgabeTokens: endlicheZahl(usage.output_tokens),
    cacheErzeugtTokens: endlicheZahl(usage.cache_creation_input_tokens),
    cacheGelesenTokens: endlicheZahl(usage.cache_read_input_tokens),
    cache5mTokens: endlicheZahl(teilung?.ephemeral_5m_input_tokens),
    cache1hTokens: endlicheZahl(teilung?.ephemeral_1h_input_tokens),
  };
}

/**
 * Die Felder der Kennzahlen, die nicht summiert werden: Ueber einen `stop_reason` und
 * ein `is_error` ist keine Summe definiert. Sie tragen den Wert der letzten Session.
 */
const KENNZAHLEN_LETZTE = new Set(["stopReason", "isError"]);

/**
 * Die Kennzahlen mehrerer Sessions derselben Stufe zu einer zusammengefasst (Issue #807):
 * jedes numerische Feld summiert, die Felder aus `KENNZAHLEN_LETZTE` von der letzten
 * Session.
 *
 * Eine Stufe der Nacht-Kette faehrt bis zu `korrekturrunden` Sessions mehr als eine.
 * Behielte sie nur die letzte, entspraeche die Summe ueber die Stufen nicht dem Verbrauch
 * des Vorgangs — eine Plan-Stufe mit zwei Korrekturrunden saehe zu billig aus.
 *
 * `verbrauchAddieren` ist dafuer das Vorbild, nicht das Werkzeug: Es laeuft ueber
 * `VERBRAUCH_FELDER` und kennt weder `apiDauerMs` noch `zuege`, die hier mitzaehlen.
 * Deshalb entscheidet der Typ des Werts und keine Feldliste — was `leseKennzahlen`
 * spaeter als Zahl hinzunimmt, ist damit von selbst dabei.
 *
 * Reine Funktion: `ziel` bleibt unangetastet, das Ergebnis ist neu. `ziel` ist `null`,
 * solange die Stufe nichts gemessen hat; eine Session ohne Kennzahlen traegt nichts bei
 * und laesst den Stand, wie er war. Ein Feld, zu dem nie eine Zahl kam, bleibt `null` —
 * eine 0 behauptete, es sei nichts verbraucht worden.
 */
export function kennzahlenAddieren(ziel, kennzahlen) {
  if (!kennzahlen) return ziel;
  const summe = { ...ziel };
  for (const [feld, wert] of Object.entries(kennzahlen)) {
    if (KENNZAHLEN_LETZTE.has(feld)) summe[feld] = wert;
    else if (typeof wert === "number" && Number.isFinite(wert)) summe[feld] = (typeof summe[feld] === "number" ? summe[feld] : 0) + wert;
    else if (!(feld in summe)) summe[feld] = wert;
  }
  return summe;
}

// --- Verbrauch je Einheit und Lauf (Issue #669) ---

/** Die Felder des Verbrauchs, in dieser Reihenfolge im Ergebnisstand. */
const VERBRAUCH_FELDER = ["kostenUsd", "eingabeTokens", "ausgabeTokens", "cacheErzeugtTokens", "cacheGelesenTokens"];

/** Ein Verbrauch, in dem noch nichts gemessen wurde: jedes Feld `null`, nie 0. */
export function verbrauchLeer() {
  return Object.fromEntries(VERBRAUCH_FELDER.map((feld) => [feld, null]));
}

/**
 * Addiert die Mengen einer Session feldweise auf `ziel`. Eine fehlende Menge traegt nichts
 * bei; ein Feld, zu dem nie eine Menge kam, bleibt `null` — eine 0 behauptete, es sei
 * nichts verbraucht worden. Reine Funktion ueber dem uebergebenen Objekt.
 */
export function verbrauchAddieren(ziel, kennzahlen) {
  for (const feld of VERBRAUCH_FELDER) {
    const wert = kennzahlen?.[feld];
    if (typeof wert === "number" && Number.isFinite(wert)) ziel[feld] = (ziel[feld] ?? 0) + wert;
  }
  return ziel;
}

/**
 * Der Verbrauch, der zu keiner Einheit gehoert: Lauf-Summe minus Summe ueber die Einheiten.
 * Nur der Runner kennt beide Seiten — gerechnet aus den Einheiten allein waere der Rest per
 * Konstruktion null. Ohne Lauf-Menge bleibt ein Feld `null`; eine Seite ohne Einheiten zaehlt
 * 0, denn dann gehoert der ganze Verbrauch zu keiner Karte. Die Kosten werden auf sechs
 * Stellen gerundet, damit kein Gleitkomma-Rauschen als Rest erscheint.
 */
export function verbrauchOhneEinheit(lauf) {
  const einheiten = verbrauchLeer();
  for (const e of lauf?.einheiten ?? []) verbrauchAddieren(einheiten, e.verbrauch);
  const rest = verbrauchLeer();
  for (const feld of VERBRAUCH_FELDER) {
    const gesamt = lauf?.verbrauch?.[feld];
    if (typeof gesamt !== "number") continue;
    const differenz = gesamt - (einheiten[feld] ?? 0);
    // `+ 0` macht aus einer gerundeten -0 eine 0.
    rest[feld] = feld === "kostenUsd" ? Math.round(differenz * 1e6) / 1e6 + 0 : differenz;
  }
  return rest;
}

/**
 * Verbucht die Mengen einer Session auf den Lauf und — gehoert sie zu einer Karte — auf
 * deren juengste Einheit; danach steht der Rest neu im Stand. `issueId` ist `null` fuer
 * Sessions ohne Karte, etwa den Vorflug.
 */
function verbrauchErfassen(issueId, kennzahlen) {
  if (!ZUSTAND.LAUF || !kennzahlen) return;
  verbrauchAddieren(ZUSTAND.LAUF.verbrauch, kennzahlen);
  const einheit = issueId === null ? null : ZUSTAND.LAUF.einheiten.findLast((e) => e.id === String(issueId));
  if (einheit) {
    einheit.verbrauch ??= verbrauchLeer();
    verbrauchAddieren(einheit.verbrauch, kennzahlen);
  }
  ZUSTAND.LAUF.verbrauchOhneEinheit = verbrauchOhneEinheit(ZUSTAND.LAUF);
  schreibeErgebnisstand();
}

/**
 * Die Zeiten einer Session nach den Begriffen aus Issue #737 (Plan #745, E1/E2): Nachdenken
 * ist die API-Dauer der Session, Werkzeugarbeit kommt vom Beobachter aus Issue #748, und der
 * Rest ist die Session-Dauer selbst — kein gerechneter dritter Wert, sondern die Gesamtspanne,
 * aus der Nachdenken und Werkzeugarbeit ohnehin Teilmengen sind.
 *
 * Reine Funktion ueber den drei Quellen, damit sie an Fixtures pruefbar ist — dieselbe Linie
 * wie `verbrauchAddieren`. Ein nicht gemessener Wert bleibt `null`, nie 0.
 *
 * `offeneSchuebe` kommt vom Beobachter mit und entscheidet ueber `werkzeugMs` (Issue #820):
 * Blieb ein Schub ohne `tool_result`, ist die gemessene Spanne nur ein Teil der Werkzeugarbeit.
 * Als Zahl gaebe sie sich als vollstaendige Messung aus, und die Auswertung rechnete damit —
 * deshalb `null`, mit der Zahl der offenen Schuebe daneben als Grund.
 */
export function zeitenBauen(dauerMs, kennzahlen, werkzeug) {
  const offeneSchuebe = endlicheZahl(werkzeug?.offeneSchuebe);
  return {
    dauerMs: endlicheZahl(dauerMs),
    nachdenkenMs: endlicheZahl(kennzahlen?.apiDauerMs),
    werkzeugMs: offeneSchuebe > 0 ? null : endlicheZahl(werkzeug?.werkzeugMs),
    werkzeugSchuebe: endlicheZahl(werkzeug?.schuebe),
    nebenlaeufigeSchuebe: endlicheZahl(werkzeug?.nebenlaeufigeSchuebe),
    offeneSchuebe,
  };
}

/** Die Felder der Zeiten, in dieser Reihenfolge im Ergebnisstand. */
const ZEITEN_FELDER = ["dauerMs", "nachdenkenMs", "werkzeugMs", "werkzeugSchuebe", "nebenlaeufigeSchuebe", "offeneSchuebe"];

/**
 * Addiert die Zeiten zweier Sessions derselben Einheit feldweise (Issue #820).
 *
 * Vorbild ist `kennzahlenAddieren`: Die Einheit ist die Karte, nicht die Session, und wer je
 * Einheit rechnet, will wissen, was sie insgesamt gekostet hat. Eine Runde von 60 Minuten und
 * eine Rettung von 2 Minuten sind 62 Minuten Arbeit an diesem Paket.
 *
 * Anders als dort macht ein fehlender Wert auf EINER Seite die Summe `null`: Ein Teil, der als
 * Ganzes erschiene, ist schlimmer als ein offen fehlender Wert — 1000 ms Nachdenken der Runde
 * stehenzulassen, weil die Rettung nichts gemeldet hat, behauptete eine Zahl, die niemand
 * gemessen hat. Reine Funktion, `ziel` bleibt unangetastet.
 */
export function zeitenAddieren(ziel, zeiten) {
  const summe = {};
  for (const feld of ZEITEN_FELDER) {
    const a = endlicheZahl(ziel?.[feld]);
    const b = endlicheZahl(zeiten?.[feld]);
    summe[feld] = a === null || b === null ? null : a + b;
  }
  return summe;
}

/**
 * Schreibt die Zeiten einer Session auf die juengste Einheit der Karte — an derselben
 * Stelle aufgerufen wie `verbrauchErfassen()`, mit demselben Ziel-Muster (`findLast`) und
 * derselben Rechnung: Laeuft dieselbe Karte mehrfach in einem Lauf (etwa regulaere Runde und
 * Salvage), trifft jeder Aufruf dieselbe, juengste Einheit und addiert seine Zeiten zu denen
 * der vorigen Session.
 *
 * `issueId === null` (eine Session ohne Karte, etwa der Vorflug) schreibt nichts: Es gibt
 * keine Einheit, der die Zeit gehoert.
 */
function zeitenErfassen(issueId, dauerMs, kennzahlen, werkzeug) {
  if (!ZUSTAND.LAUF || issueId === null) return;
  const einheit = ZUSTAND.LAUF.einheiten.findLast((e) => e.id === String(issueId));
  if (!einheit) return;
  const zeiten = zeitenBauen(dauerMs, kennzahlen, werkzeug);
  einheit.zeiten = einheit.zeiten ? zeitenAddieren(einheit.zeiten, zeiten) : zeiten;
  schreibeErgebnisstand();
}

/** Die Felder der Prueflaeufe einer Arbeit, in dieser Reihenfolge im Ergebnisstand. */
const PRUEFLAUF_FELDER = ["anzahl", "volle", "volleNoetig", "dauerMs"];

/** Die Felder des Abschlussblocks (Issue #926) — ein Versuch hat keine Umfangsfrage. */
const ABSCHLUSS_FELDER = ["anzahl", "dauerMs"];

/**
 * Addiert die Prueflaeufe zweier Sessions derselben Einheit feldweise (Issue #924).
 *
 * Dieselbe Rechnung wie `zeitenAddieren` und aus demselben Grund: Die Einheit ist die
 * Karte, nicht die Session — was an einem Paket gepruft wurde, gehoert zusammen, ob es
 * die regulaere Runde war oder die Rettung danach. Reine Funktion, `ziel` bleibt
 * unangetastet. Gespeichert wird allein die Messung; Abschlusszahlen und Zielmarke
 * rechnet der Bericht (Plan #917, E7).
 */
export function prueflaeufeAddieren(ziel, zuwachs) {
  const summe = (block, felder) => {
    const werte = {};
    for (const feld of felder) {
      werte[feld] = (endlicheZahl(ziel?.[block]?.[feld]) ?? 0) + (endlicheZahl(zuwachs?.[block]?.[feld]) ?? 0);
    }
    return werte;
  };
  return { arbeit: summe("arbeit", PRUEFLAUF_FELDER), abschluss: summe("abschluss", ABSCHLUSS_FELDER) };
}

/**
 * Schreibt die Prueflaeufe einer Session auf die juengste Einheit der Karte — an
 * derselben Stelle und mit demselben `findLast`-Ziel wie `zeitenErfassen`.
 *
 * `prueflaeufe` steht NEBEN `zeiten`, nicht darin: Die Zeiten sind eine Messung, die
 * Prueflaeufe eine Deutung des Stroms (Plan #917, E1). `zeitenBauen` bleibt unberuehrt.
 *
 * Eine Session ohne Strom (`mess === null`) traegt nichts bei und laesst das Feld, wie
 * es ist. Hat keine Session der Einheit gemessen, fehlt es ganz — "nicht gemessen", und
 * nicht die Behauptung, es sei nichts gepruft worden.
 */
function prueflaeufeErfassen(issueId, mess) {
  if (!ZUSTAND.LAUF || issueId === null || !mess) return;
  const einheit = ZUSTAND.LAUF.einheiten.findLast((e) => e.id === String(issueId));
  if (!einheit) return;
  // Der Beobachter liefert die Arbeitsfelder flach und den Abschluss als Block; im
  // Ergebnisstand stehen beide als eigene Bloecke nebeneinander (Issue #926).
  const { abschluss, ...arbeit } = mess;
  einheit.prueflaeufe = prueflaeufeAddieren(einheit.prueflaeufe, { arbeit, abschluss });
  schreibeErgebnisstand();
}

/**
 * Schreibt die Auskunftszeit einer Session auf die juengste Einheit der Karte (Issue #1026)
 * und vermerkt, ob die Session eine Umsetzung war — an derselben Stelle wie
 * `prueflaeufeErfassen`.
 *
 * Zwei Sessions derselben Einheit (Runde und Rettung) addieren sich. Eine Session ohne
 * Beobachtung (`mess === null`) laesst `auskunft` stehen, wie es ist: `null` bleibt
 * "nicht gemessen". Das Merkmal bleibt gesetzt, sobald eine Session umsetzte.
 */
function auskunftErfassen(issueId, mess, prompt) {
  if (!ZUSTAND.LAUF || issueId === null) return;
  const einheit = ZUSTAND.LAUF.einheiten.findLast((e) => e.id === String(issueId));
  if (!einheit) return;
  if (umsetzungsStart(prompt)) einheit.umsetzung = true;
  if (mess) {
    einheit.auskunft = {
      ms: (einheit.auskunft?.ms ?? 0) + mess.ms,
      aufrufe: (einheit.auskunft?.aufrufe ?? 0) + mess.aufrufe,
    };
  }
  schreibeErgebnisstand();
}

/**
 * Addiert die Kosten einer Session auf den Lauf (Plan #638, A5; E1).
 *
 * `kostenUsd: null` — kein `result`-Ereignis, kein Wert — zaehlt 0 und erhoeht
 * `kostenUnbekannt`: Eine fehlende Kennzahl ist kein Verstoss gegen das Budget, aber
 * der Bericht soll sagen, dass eine Session nicht gemessen wurde. Reine Funktion ueber
 * dem uebergebenen Lauf-Objekt, damit sie an Fixtures pruefbar ist; die Pruefung gegen
 * das Budget sitzt dort, wo der Ausgang entschieden wird.
 */
export function kostenAddieren(lauf, kennzahlen) {
  lauf.kostenSumme = (lauf.kostenSumme ?? 0);
  lauf.kostenUnbekannt = (lauf.kostenUnbekannt ?? 0);
  const kosten = kennzahlen?.kostenUsd;
  if (typeof kosten === "number" && Number.isFinite(kosten)) lauf.kostenSumme += kosten;
  else lauf.kostenUnbekannt += 1;
  return lauf;
}

/**
 * Der Text der letzten Nachricht einer Session — das Feld `result` des letzten
 * `result`-Ereignisses (Plan #638, A9). Dieselbe Zeile, aus der `leseKennzahlen` die
 * Kosten liest; `null`, wenn keine da ist oder der Text leer ist.
 */
export function leseErgebnisText(stdout) {
  let letzte = null;
  for (const zeile of String(stdout ?? "").split(/\r\n|\r|\n/)) {
    const trimmed = zeile.trim();
    if (!trimmed.startsWith("{")) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object" && obj.type === "result") letzte = obj;
  }
  const text = typeof letzte?.result === "string" ? letzte.result.trim() : "";
  return text === "" ? null : text;
}

// --- Das Modell einer Karte (Issue #665) ---

// So eng gefasst wie AUTOR_MODELL_ZEILE in kit/board.mjs: Anker am Zeilenanfang, damit
// eine Erwaehnung im Fliesstext nicht trifft, und `\S+` als Wert — kein Leerraum, kein
// zweites Wort. Ein Wert wie `claude-opus-5 --yolo` faellt damit schon hier durch und
// nicht erst am Vergleich mit der Liste.
const EMPFOHLENES_MODELL_ZEILE = /^Empfohlenes Modell:[^\S\n]*(\S+)[^\S\n]*$/m;

/**
 * Das Modell, mit dem die Session dieser Karte starten soll (Issue #665).
 *
 * Reine Funktion ueber Body und Liste — kein Board, kein Dateisystem —, damit die
 * Zuordnung an Fixtures pruefbar ist.
 *
 * **Die Liste ist die einzige Pruefung** (Plan #663, E3), und sie ist der
 * Sicherheitskern dieses Wegs: Ohne sie wanderte ein Wert aus einem Issue-Body unbesehen
 * in `argv`. Ein Paket mit `Empfohlenes Modell: --dangerously-skip-permissions` waere ein
 * Angriff ueber eine Karte — deshalb gilt ein Wert mit fuehrendem Bindestrich nicht
 * einmal als Kandidat, und deshalb wird gegen eine Liste verglichen statt gegen ein
 * Muster. Ein Muster liesse sich erweitern, eine Liste nicht.
 *
 * Rueckgabe `{ modell, grund }`:
 *   - Name auf der Liste  -> `{ modell: <name>, grund: null }`
 *   - Name nicht auf der Liste -> `{ modell: null, grund: <ein Satz> }`
 *   - keine Zeile, leere oder fehlende Liste -> `{ modell: null, grund: null }`
 *
 * Der Unterschied zwischen den letzten beiden Faellen ist der Punkt: Ein abgewiesener
 * Name gehoert in die Einheit, eine fehlende Empfehlung ist der Normalfall und kein
 * Befund.
 */
export function empfohlenesModell(body, erlaubte) {
  const liste = Array.isArray(erlaubte) ? erlaubte : [];
  if (liste.length === 0) return { modell: null, grund: null };

  const treffer = EMPFOHLENES_MODELL_ZEILE.exec(String(body ?? ""));
  if (!treffer) return { modell: null, grund: null };

  const name = treffer[1];
  // Fuehrender Bindestrich: nie ein Modellname, immer ein Flag. Der Vergleich mit der
  // Liste wuerde ihn ohnehin abweisen — die eigene Zeile steht hier, weil diese Stelle
  // die ist, an der jemand spaeter eine Abkuerzung einbauen koennte.
  if (name.startsWith("-")) {
    return { modell: null, grund: `Empfohlenes Modell "${name}" beginnt mit einem Bindestrich und ist kein Modellname — Modell des Laufs.` };
  }
  if (!liste.includes(name)) {
    return { modell: null, grund: `Empfohlenes Modell "${name}" steht nicht in night.modelle — Modell des Laufs.` };
  }
  return { modell: name, grund: null };
}

// --- Die Stufe einer Karte (Issue #709, Plan #707) ---

// Derselbe enge Anker wie EMPFOHLENES_MODELL_ZEILE: Zeilenanfang, ein Wort ohne Leerraum.
// Eine Erwaehnung im Fliesstext ("... siehe Aufgabenstufe: leicht ...") trifft er nicht,
// und ein Wert aus zwei Woertern faellt schon hier durch.
const AUFGABENSTUFE_ZEILE = /^Aufgabenstufe:[^\S\n]*(\S+)[^\S\n]*$/m;

// Die Ordnung der Stufen, von der leichtesten zur schwersten. Sie ist die Richtung, in die
// ausgewichen wird: nach oben, nie nach unten. Eine Aufgabe, fuer die die vorgesehene Stufe
// fehlt, laeuft lieber mit einem staerkeren Modell als mit einem schwaecheren.
export const STUFEN_ORDNUNG = ["leicht", "mittel", "schwer"];

/**
 * Die Stufe, die ein Arbeitspaket sich selbst gibt (Issue #709).
 *
 * Reine Funktion ueber den Body — kein Board, kein Dateisystem, keine Einstellung.
 *
 * Rueckgabe `{ stufe, grund }`:
 *   - bekannter Wert -> `{ stufe: <schwer|mittel|leicht>, grund: null }`
 *   - anderer Wert   -> `{ stufe: null, grund: <ein Satz> }`
 *   - keine Zeile    -> `{ stufe: null, grund: null }`
 *
 * Der Unterschied zwischen den letzten beiden Faellen ist derselbe wie bei
 * `empfohlenesModell`: Ein abgewiesener Wert gehoert in die Einheit, eine fehlende Zeile ist
 * der Normalfall und kein Befund. Bestandspakete tragen die Zeile nicht (Plan #707, E12).
 */
export function aufgabenStufe(body) {
  const treffer = AUFGABENSTUFE_ZEILE.exec(String(body ?? ""));
  if (!treffer) return { stufe: null, grund: null };

  const wert = treffer[1];
  if (!STUFEN_ORDNUNG.includes(wert)) {
    return { stufe: null, grund: `Aufgabenstufe "${wert}" ist kein bekannter Stufenwert (schwer, mittel, leicht) — keine Stufe.` };
  }
  return { stufe: wert, grund: null };
}

const alsText = (wert) => (typeof wert === "string" && wert.trim() !== "" ? wert : null);

/**
 * `night.stufen` als normalisierte Abbildung Stufe -> `{ modell, kommando, name, effort }`
 * (Issue #709, erweitert um #846).
 *
 * Leere Stufen werden weggeworfen: Was weder `modell` noch `kommando` traegt, ist keine
 * Stufe, sondern eine Luecke — und eine Luecke soll zum Ausweichen nach oben fuehren und
 * nicht zu einem Eintrag, den `modellFuerStufe` erst wieder pruefen muesste.
 *
 * `aktiv` ist wahr, sobald **eine** Stufe belegt ist (Plan #707, E4): Teilbelegung ist der
 * beabsichtigte Normalfall — ein Projekt, das nur die leichten Pakete billiger fahren will,
 * belegt genau eine Stufe. Ein fehlender Block, ein leerer Block und drei leere Stufen
 * ergeben `aktiv: false`, und damit bleibt alles beim Modell des Laufs.
 */
export function stufenEinstellung(config) {
  const roh = config?.night?.stufen;
  const stufen = {};
  if (roh && typeof roh === "object") {
    for (const stufe of STUFEN_ORDNUNG) {
      const eintrag = roh[stufe];
      if (!eintrag || typeof eintrag !== "object") continue;
      const modell = alsText(eintrag.modell);
      const kommando = alsText(eintrag.kommando);
      if (!modell && !kommando) continue;
      // `effort` gehoert zum Eintrag und nicht zum Paket (Issue #846): Modell und
      // Gruendlichkeit kommen als Paar aus EINER Stufe, damit ein Ausweichen nach oben
      // nicht das Modell der einen mit der Gruendlichkeit der anderen mischt.
      stufen[stufe] = { modell, kommando, name: alsText(eintrag.name), effort: alsText(eintrag.effort) };
    }
  }
  return { aktiv: Object.keys(stufen).length > 0, stufen };
}

// Fuehrende Zuweisungen einer Kommandozeile (`OLLAMA_HOST=… PORT=9 mein-runner …`) sind
// Umgebung und nicht das Programm. Wer sie mitsucht, sucht nach einem Programm namens
// `OLLAMA_HOST=…` und weicht still nach oben aus, obwohl das Programm daliegt (E8).
const ZUWEISUNG = /^[A-Za-z_]\w*=/;

/**
 * Die POSIX-Shell des Kits (Issue #1131, Plan #1128, E1): `sh` auf POSIX, unter Windows die
 * Git Bash, gefunden ueber `gitBashPfad` aus board.mjs. Liefert `{ pfad, fehler, umgebung }`;
 * `umgebung` gehoert in die Umgebung jedes Starts ueber diese Shell. Die Git Bash traegt dazu
 * `gitBash: true`, und ihr Start geht ueber `spawnAufruf` aus board.mjs (Issue #1143).
 *
 * Nie `bash` ueber den PATH: Unter Windows ist das haeufig der WSL-Starter in System32.
 * Plattform, Umgebung und Dateisystem sind injizierbar, damit beide Wege auf jedem Host
 * pruefbar sind.
 */
export function posixShell({ env = process.env, plattform = process.platform, existiert } = {}) {
  if (plattform !== "win32") return { pfad: "sh", fehler: null, umgebung: {} };
  const { pfad, fehler } = gitBashPfad({ env, plattform, ...(existiert ? { existiert } : {}) });
  if (!pfad) return { pfad, fehler, umgebung: {} };
  return { pfad, fehler, umgebung: { ...GIT_BASH_UMGEBUNG }, gitBash: true };
}

/**
 * Wie eine konfigurierte Kommandozeile startet — buildChecks und formatFixCommand (Issue
 * #1176). Liefert `{ befehl, args, optionen, umgebung, fehler }`; gestartet wird `befehl` mit
 * `args`, dazu `optionen` zu den eigenen spawn-Optionen und `umgebung` zur eigenen Umgebung.
 *
 * Auf POSIX `/bin/sh -c <zeile>`, dasselbe wie vorher mit der Shell-Option von spawn. Unter Windows die
 * Git Bash aus `posixShell` statt `cmd.exe` — dieselbe Regel wie `kommandoStart` in
 * checks.mjs. Fehlt sie, startet nichts, und `fehler` ist die Meldung von `gitBashPfad`.
 * `umgebung` reicht Plattform, Umgebung und Dateisystem an `posixShell` durch (Tests).
 */
export function konfigKommandoStart(kommando, umgebung = {}) {
  const shell = posixShell(umgebung);
  if (shell.fehler) return { befehl: null, args: [], optionen: {}, umgebung: {}, fehler: shell.fehler };
  if (!shell.gitBash) return { befehl: "/bin/sh", args: ["-c", kommando], optionen: {}, umgebung: {}, fehler: null };
  const aufruf = spawnAufruf(shell.pfad, ["-c", kommando], shell);
  return { befehl: aufruf.befehl, args: aufruf.args, optionen: aufruf.optionen, umgebung: shell.umgebung, fehler: null };
}

/**
 * Faehrt eine konfigurierte Kommandozeile synchron (Issue #1176) und liefert das Ergebnis von
 * `spawnSync`; ohne Git Bash unter Windows `{ status: null, stdout: "", stderr: <Meldung> }`.
 * PATH-Aufloesung bewusst (S4036, Issue #183).
 */
function konfigKommandoSync(kommando, env) {
  const start = konfigKommandoStart(kommando);
  if (start.fehler) return { status: null, stdout: "", stderr: `${start.fehler}\n` };
  return spawnSync(start.befehl, start.args, { ...start.optionen, cwd: process.cwd(), encoding: "utf-8", env: { ...env, ...start.umgebung } });
}

/**
 * Die Kommandozeile einer Kommando-Stufe, wie sie in den Shell-String kommt (Issue #1143).
 *
 * Unter Windows ist das Programm oft ein Pfad mit Backslashes. Die Git Bash liest einen
 * ungequoteten Backslash als Maskierung, und aus `C:\Users\anna\prog` wuerde
 * `C:Usersannaprog`. Im Programmwort — dem ersten Wort nach den fuehrenden Zuweisungen,
 * dieselbe Zerlegung wie in `stufeStartbar` — stehen darum Schraegstriche, die die Git Bash
 * als Windows-Pfad nimmt. Der Rest der Zeile bleibt woertlich, auf POSIX die ganze Zeile.
 */
function kommandoFuerShell(kommando, plattform = process.platform) {
  if (plattform !== "win32") return kommando;
  return kommando.replace(/^(\s*(?:[A-Za-z_]\w*=\S*\s+)*)(\S+)/, (_, zuweisungen, programm) => zuweisungen + programm.replaceAll("\\", "/"));
}

/**
 * Laesst sich diese Stufe starten (Issue #709, Plan #707, E8)?
 *
 * Die Pruefung liegt nachweislich **vor** dem ersten Arbeitsschritt — das ist ihr Zweck:
 * Nur was hier scheitert, darf nach oben ausweichen, ohne eine begonnene Umsetzung zu
 * wiederholen. Jeder spaetere Fehlschlag faellt unter die bisherigen Fehlerregeln.
 *
 *   - `modell`: Der Name steht in `night.modelle` (E18). Dieselbe eine Liste wie bei
 *     `empfohlenesModell`; zwei Listen nebeneinander liefen auseinander.
 *   - `kommando`: Die POSIX-Shell des Kits ist da — unter Windows die Git Bash (Issue #1131)
 *     —, und das erste Wort nach den fuehrenden Zuweisungen ist ueber **dieselbe Shell**
 *     auffindbar, die spaeter startet. `command -v` statt einer eigenen PATH-Suche, damit
 *     auch Builtins und Funktionen gelten — eine halbe Nachbildung der Shell scheitert still
 *     am ersten Sonderfall.
 *
 * `umgebung` reicht Plattform, Umgebung und Dateisystem an `posixShell` durch (Tests).
 *
 * Rueckgabe `{ ok, grund }`; `grund` ist bei `ok: true` immer `null`.
 */
export function stufeStartbar(eintrag, erlaubteModelle, umgebung = {}) {
  const modell = alsText(eintrag?.modell);
  const kommando = alsText(eintrag?.kommando);

  if (modell) {
    const liste = Array.isArray(erlaubteModelle) ? erlaubteModelle : [];
    if (!liste.includes(modell)) return { ok: false, grund: `Modell "${modell}" steht nicht in night.modelle` };
    return { ok: true, grund: null };
  }

  if (!kommando) return { ok: false, grund: "weder modell noch kommando gesetzt" };

  const shell = posixShell(umgebung);
  if (shell.fehler) return { ok: false, grund: shell.fehler };

  const woerter = kommandoFuerShell(kommando.trim(), umgebung.plattform).split(/\s+/);
  const programm = woerter.find((w) => !ZUWEISUNG.test(w));
  if (!programm) return { ok: false, grund: `die Kommandozeile "${kommando}" nennt nur Umgebung und kein Programm` };

  // Das Wort steht als Argument daneben und nie im Shell-String — dieselbe Trennung wie
  // beim spaeteren Start (E9), damit die Pruefung nicht zur Einsetzungsluecke wird.
  const aufruf = spawnAufruf(shell.pfad, ["-c", 'command -v -- "$1" >/dev/null', "sh", programm], shell);
  const res = spawnSync(aufruf.befehl, aufruf.args, {
    ...aufruf.optionen,
    encoding: "utf-8",
    env: { ...process.env, ...shell.umgebung },
  });
  if (res.error) return { ok: false, grund: `die Shell fuer "${programm}" liess sich nicht starten: ${res.error.message}` };
  if (res.status !== 0) return { ok: false, grund: `das Programm "${programm}" ist ueber die Shell nicht auffindbar` };
  return { ok: true, grund: null };
}

/**
 * Die Stufe, mit der ein Paket dieser Aufgabenstufe laeuft (Issue #709, Plan #707, E7).
 *
 * Geht von `stufe` aus nach oben — leicht, mittel, schwer — und liefert die erste belegte
 * **und** startbare Stufe. Unbelegt und nicht startbar fuehren zur selben Bewegung: Beide
 * Anlaesse stehen deshalb in einer Funktion, damit sie bei einer Aenderung nicht
 * auseinanderlaufen. Der Unterschied liegt allein im Ende der Kette, und darueber
 * entscheidet der Aufrufer — diese Funktion liefert nur den Befund.
 *
 * Rueckgabe `{ stufeVerwendet, eintrag, grund }`. `grund` nennt je uebersprungener Stufe
 * einen Satz und ist `null`, wenn nichts uebersprungen wurde. Findet sich keine Stufe,
 * steht `stufeVerwendet: null` mit Grund.
 */
export function modellFuerStufe(einstellung, stufe, erlaubteModelle) {
  const stufen = einstellung?.stufen ?? {};
  const start = STUFEN_ORDNUNG.indexOf(stufe);
  if (start < 0) return { stufeVerwendet: null, eintrag: null, grund: `"${stufe}" ist keine Aufgabenstufe` };

  const uebersprungen = [];
  for (const kandidat of STUFEN_ORDNUNG.slice(start)) {
    const eintrag = stufen[kandidat];
    if (!eintrag) {
      uebersprungen.push(`Stufe ${kandidat} nicht belegt`);
      continue;
    }
    const { ok, grund } = stufeStartbar(eintrag, erlaubteModelle);
    if (!ok) {
      uebersprungen.push(`Stufe ${kandidat} nicht startbar: ${grund}`);
      continue;
    }
    return { stufeVerwendet: kandidat, eintrag, grund: uebersprungen.length > 0 ? uebersprungen.join("; ") : null };
  }
  return { stufeVerwendet: null, eintrag: null, grund: uebersprungen.join("; ") };
}

/** Die Gruende eines Pakets in einem Satz — leere Teile fallen weg. */
const gruendeFassen = (...teile) => {
  const gefuellt = teile.filter((t) => typeof t === "string" && t.trim() !== "");
  return gefuellt.length > 0 ? gefuellt.join(" ") : null;
};

/**
 * Womit dieses Arbeitspaket laeuft (Issue #711, Plan #707, E5/E6).
 *
 * Die eine Stelle, an der Modellname und Aufgabenstufe aufeinandertreffen — reine Funktion
 * ueber Body, Einstellung und Modell des Laufs, damit die Reihenfolge an Fixtures pruefbar
 * ist. Sie ist der Kern des Pakets, und ihre Reihenfolge ist die Sache selbst:
 *
 *   1. Der Modellname der Karte nach den heutigen Regeln. Er gewinnt gegen die Stufe
 *      (Kriterium 8); traegt das Paket beides, vermerkt der Grund die doppelte Angabe.
 *   2. Ein ABGEWIESENER Name faellt auf das Modell des Laufs und **nicht** auf die Stufe
 *      (E6). Ein Vertipper darf nicht still ein anderes Modell in Gang setzen — wer
 *      `claude-opus-5` falsch schreibt, bekommt den Lauf und einen Grund, nicht das Modell
 *      einer Stufe, an die er nicht gedacht hat.
 *   3. Sonst, und nur bei aktiver Einstellung, die Stufe mit dem Ausweichen nach oben.
 *   4. Sonst das Modell des Laufs.
 *
 * Rueckgabe: `{ modell, herkunft, grund, stufe, stufeVerwendet, kommando, stufenName,
 * effort, startbar }`. `effort` ist die Gruendlichkeit der verwendeten Stufe (Issue #846)
 * und `null`, wo die Stufe das Modell nicht gestellt hat — bei `herkunft` `karte` und
 * `lauf` — sowie im Kommando-Zweig. `startbar: false` heisst, dass die Stufe des Pakets auf keiner erreichbaren
 * Ebene startet — dann darf **keine** Session beginnen (Kriterium 10), und der Aufrufer
 * verbucht das Paket als Fehlschlag. `herkunft` kennt `karte`, `stufe` und `lauf`.
 *
 * Bei einer Kommando-Stufe steht in `modell` die Selbstauskunft der Stufe (ihr Feld `name`,
 * ersatzweise `stufe-<aufgabenstufe>`) — derselbe Wert, den `runSession` als
 * KIT_AGENT_MODEL setzt. Einen Modellnamen gibt es dort nicht, und `null` im Ergebnisstand
 * liesse offen, womit das Paket gelaufen ist.
 */
export function paketWahl({ body, einstellung, erlaubteModelle, laufModell }) {
  const { modell: ausKarte, grund: modellGrund } = empfohlenesModell(body, erlaubteModelle);
  const { stufe, grund: stufenGrund } = aufgabenStufe(body);
  const rahmen = { stufe, stufeVerwendet: null, kommando: null, stufenName: null, effort: null, startbar: true };

  if (ausKarte) {
    // Die doppelte Angabe ist kein Fehler, sondern eine Auskunft: Der Mensch soll sehen,
    // dass die Stufe der Karte an diesem Paket ohne Wirkung blieb.
    const doppelt = stufe ? `Karte nennt Modell und Aufgabenstufe ${stufe} — der Modellname gewinnt.` : null;
    return { ...rahmen, modell: ausKarte, herkunft: "karte", grund: gruendeFassen(doppelt, stufenGrund) };
  }

  const beimLauf = (grund) => ({ ...rahmen, modell: laufModell, herkunft: "lauf", grund: gruendeFassen(grund) });

  if (modellGrund) return beimLauf(modellGrund);
  if (!einstellung?.aktiv || !stufe) return beimLauf(stufenGrund);

  const { stufeVerwendet, eintrag, grund } = modellFuerStufe(einstellung, stufe, erlaubteModelle);
  if (!stufeVerwendet) {
    // Kein Rueckfall auf das Modell des Laufs (Kriterium 10): Wer eine Stufe setzt, will
    // dieses Paket auf dieser Ebene laufen lassen — ein stiller Ersatz waere eine Umsetzung,
    // die niemand so beauftragt hat.
    return { ...rahmen, modell: null, herkunft: "stufe", grund: gruendeFassen(grund), startbar: false };
  }
  const selbstauskunft = eintrag.name || `stufe-${stufe}`;
  return {
    ...rahmen,
    stufeVerwendet,
    kommando: eintrag.kommando,
    stufenName: eintrag.name,
    // Die Gruendlichkeit der WIRKLICH verwendeten Stufe (Issue #846) — dieselbe Stufe,
    // die auch das Modell stellt. Im Kommando-Zweig bleibt sie null: Dort startet ein
    // fremdes Programm, das `--effort` nicht kennt; das Schema verbietet das Feld dort
    // ohnehin, und diese Zeile verlaesst sich nicht darauf.
    effort: eintrag.kommando ? null : (eintrag.effort ?? null),
    modell: eintrag.modell ?? selbstauskunft,
    herkunft: "stufe",
    grund: gruendeFassen(grund),
  };
}

/**
 * `night.stufen` und `night.stufenRegel`, frisch von Platte (Issue #711, Plan #707, E19).
 *
 * Nur diese beiden Felder: Alles andere bleibt beim Stand des Laufbeginns, weil ein Lauf,
 * der mitten in der Nacht sein Label, seine Checks oder seinen Tracker wechselt, nicht mehr
 * derselbe Lauf waere. Die Stufen dagegen sollen wirken, sobald sie jemand aendert — sonst
 * saehe ein laufender Nachtlauf eine Aenderung erst am naechsten Abend.
 *
 * Ein unlesbarer Stand haelt den Lauf nie auf: Dann gilt, was beim Start gelesen wurde, und
 * `grund` sagt es. Reine Funktion ueber Pfad und Startstand, damit dieser Fall ohne einen
 * kaputten Nachtlauf pruefbar ist.
 */
export function frischeStufenFelder(configPfad, stand) {
  const vomStart = (grund) => ({ stufen: stand?.night?.stufen, stufenRegel: stand?.night?.stufenRegel, grund });
  if (!configPfad) return vomStart(null);
  try {
    const frisch = ladeConfigMitOverrides(configPfad);
    return { stufen: frisch?.night?.stufen, stufenRegel: frisch?.night?.stufenRegel, grund: null };
  } catch (err) {
    return vomStart(`die Einstellung liess sich nicht frisch lesen (${err.message}) — es gilt der Stand des Laufbeginns.`);
  }
}

// --- Nacht-Session ---

/**
 * Wartet, bis in der Prozessgruppe einer beendeten Session kein Prozess mehr laeuft
 * (Issue #668).
 *
 * `runProcess` gibt jedem Kind eine eigene Prozessgruppe, toetet sie aber nur am
 * Zeitlimit. Endet eine Session regulaer, waehrend sie noch einen Hintergrundlauf haelt
 * — den Pflichtcheck, auf den sie zu warten glaubte —, laeuft dieser weiter. Zwei
 * Schaeden entstehen daraus, und beide sind in der Nacht zu #900 zu besichtigen:
 *
 *   1. Die Vorpruefung des Salvage startet ihren eigenen `mvn verify` daneben. Zwei
 *      gleichzeitige Testcontainers-Laeufe reissen einander die Ressourcen weg; die
 *      Vorpruefung war nach 72 Sekunden rot, bei einem Lauf, der Minuten braucht.
 *   2. Der ueberlebende `checks.mjs run` schreibt seine Zusammenfassung spaeter — im
 *      schlimmsten Fall nach `verwerfeZusammenfassung()` der naechsten Runde, deren
 *      Nachweis er damit faelscht.
 *
 * Gewartet wird hoechstens `restMs`; was laenger braucht, als die Runde hat, ist ohnehin
 * verloren, und ein unbegrenztes Warten waere genau der Hang, den der Zeitlimit-Timer
 * verhindern soll. Rueckgabe: `true`, wenn die Gruppe leer ist, `false` bei Ablauf der
 * Frist — der Aufrufer protokolliert das, haelt den Lauf aber nicht an.
 *
 * Windows kennt diese Prozessgruppen nicht (`runProcess` setzt `detached` dort nicht).
 * Dort fragt die Funktion `prozesse` — in `runProcess` die Suche nach der Marke der
 * Session, `sitzungsProzesse` (Issue #1144) — und wartet, bis sie nichts mehr findet. Ohne
 * `prozesse` gibt es dort nichts zu fragen, und sie meldet sofort `true`.
 *
 * Wirft `prozesse`, weil die Abfrage der Prozessliste scheiterte, geht der Grund an
 * `vermerk` — ins Protokoll —, und die Funktion meldet `true` wie bei leerer Gruppe
 * (Issue #1174): Die Runde laeuft weiter wie bisher, aber nicht mehr stumm.
 */
export async function warteAufProzessgruppe(pgid, restMs, { pollMs = 200, jetzt = Date.now, plattform = process.platform, prozesse, vermerk = () => {} } = {}) {
  if (!pgid || restMs <= 0) return true;
  if (plattform === "win32" && !prozesse) return true;
  const frist = jetzt() + restMs;
  // `ps -o pid= -g <pgid>` listet die Prozesse der Gruppe; leere Ausgabe heisst leer.
  // Ein Fehlschlag von ps (Gruppe schon weg, ps nicht da) gilt ebenfalls als leer: Diese
  // Wartezeit ist eine Vorsichtsmassnahme und darf keine Runde aufhalten, weil ein
  // Werkzeug fehlt. Unter Windows haelt die Runde ebenfalls nicht an, vermerkt den
  // Fehlschlag aber (Issue #1174).
  const gruppeLaeuft = plattform === "win32" ? () => prozesse().length > 0 : () => {
    const res = spawnSync("ps", ["-o", "pid=", "-g", String(pgid)], { encoding: "utf-8" });
    if (res.error || res.status !== 0) return false;
    return (res.stdout || "").trim() !== "";
  };
  try {
    while (gruppeLaeuft()) {
      if (jetzt() >= frist) return false;
      await new Promise((r) => setTimeout(r, pollMs));  // NOSONAR S9382: Abfragen in festem Takt
    }
  } catch (err) {
    vermerk(`${err.message} — der Runner wartet nicht auf die Prozesse der Session.`);
  }
  return true;
}

// Startet einen Prozess asynchron, sammelt stdout/stderr und (bei useStream)
// parst stdout live zeilenweise. Eigener Timeout-Timer statt spawnSync-timeout,
// weil wir waehrend des Laufs streamen muessen. Das Rueckgabe-Objekt spiegelt
// die von spawnSync bekannten Felder (status, signal, error, stdout, stderr),
// damit der Infrastruktur-Guard (#149) und die Erfolgs-/Fehlschlag-Pfade
// unveraendert weiterarbeiten; seit Issue #748 kommt `werkzeugzeit` dazu.
//
// `useStream` und `verbose` sind seit Issue #748 zwei Schalter und nicht mehr einer
// (Plan #745, Fund B1): MESSEN gehoert an den angeforderten Strom, AUSGEBEN an
// --verbose. Waeren sie weiterhin derselbe Schalter, gaebe es nur zwei gleich falsche
// Stellungen — die Werkzeugzeit in jedem normalen Nachtlauf dauerhaft "nicht gemessen",
// oder jedes Stream-Ereignis jeder Session in Konsole und Tagesprotokoll.
/**
 * Die Umgebung einer vom Runner gestarteten Session. Beide Schalter stehen hier zentral
 * und vor dem Spread von `extraEnv`: Ein Aufrufer kann sie bewusst ueberschreiben, aber
 * kein kuenftiger Session-Weg sie vergessen.
 *
 * CLAUDE_CODE_DISABLE_AUTO_MEMORY (Issue #772): Das Auto-Memory des Menschen ist fuer die
 * Zusammenarbeit mit ihm geschrieben und wirkt in einer unbeaufsichtigten Session falsch —
 * es sagt "im Gespraech klaeren", wo niemand danebensitzt. Was nachts gelten muss, steht
 * in den Skills und den CLAUDE-*.md des Kits, nicht im Gedaechtnis eines Menschen.
 *
 * NODE_USE_ENV_PROXY (Issue #998): In der Sandbox geht der Netzverkehr ueber einen Proxy,
 * und Nodes fetch nutzt ihn nur mit diesem Schalter beim Start. Ohne ihn scheitern
 * board.mjs, checks.mjs und Projektskripte der Session mit "fetch failed".
 *
 * SITZUNG_MARKE (Issue #1144): je Session ein eigener Wert, den jeder ihrer Prozesse erbt.
 * Unter Windows gibt es keine Prozessgruppe, und an der Marke erkennt der Runner dort, was
 * von der Session noch laeuft — siehe `sitzungsProzesse`.
 */
export function sessionUmgebung(issueId, extraEnv, basis = process.env, marke = sitzungsMarke()) {
  return {
    ...basis,
    NIGHT_ISSUE_ID: String(issueId),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    NODE_USE_ENV_PROXY: "1",
    [SITZUNG_MARKE]: marke,
    ...extraEnv,
  };
}

/** Der Name der Umgebungsvariable, die die Prozesse einer Session kennzeichnet (Issue #1144). */
export const SITZUNG_MARKE = "NIGHT_SITZUNG";

let sitzungsZaehler = 0;

/**
 * Eine Marke, die keine andere Session dieses oder eines anderen Runners traegt: PID des
 * Runners, laufende Nummer, Startzeit. Nur Ziffern, Buchstaben und Bindestriche — die Git
 * Bash deutet einen Wert, der wie ein Pfad aussieht, sonst beim Start um.
 */
function sitzungsMarke() {
  sitzungsZaehler += 1;
  return `s${process.pid}-${sitzungsZaehler}-${Date.now()}`;
}

/**
 * Die Suche nach den Prozessen einer Session unter Windows (Issue #1144). Windows kennt
 * keine Prozessgruppe, und eine Elternkette reisst, sobald ein Zwischenglied endet: Die
 * Session beendet sich, ihr Hintergrundlauf lebt weiter und nennt als Eltern eine PID, die
 * es nicht mehr gibt. Was bleibt, ist die geerbte Umgebung. Die MSYS-Laufzeit der Git Bash
 * legt sie fuer jeden ihrer Prozesse unter `/proc/<pid>/environ` offen, dazu dessen
 * Windows-PID unter `/proc/<pid>/winpid`.
 *
 * Gesucht wird die Zeile `NIGHT_SITZUNG=<marke>`. Die Marke kommt unter anderem Namen in
 * die Umgebung der Suche, sonst faende die Suche sich selbst. Erreicht werden die Prozesse
 * der Git Bash und die Programme, die sie gerade ausfuehrt — darunter die Bash-Aufrufe von
 * Claude Code und alles, was sie starten. Ein Windows-Programm, das ein anderes
 * Windows-Programm startet und vor ihm endet, hinterlaesst ein Kind ohne Eintrag; das ist
 * dieselbe Luecke wie auf POSIX ein Enkel, der eine eigene Prozessgruppe aufmacht.
 */
export function sitzungsSuche(marke) {
  return {
    skript: `for d in /proc/[0-9]*; do grep -qzx "${SITZUNG_MARKE}=$KIT_SITZUNG_SUCHE" "$d/environ" 2>/dev/null && cat "$d/winpid" 2>/dev/null; done; true`,
    umgebung: { KIT_SITZUNG_SUCHE: marke },
  };
}

/** Die Windows-PIDs aus der Ausgabe von `sitzungsSuche`, eine je Zeile (Issue #1144). */
export function sitzungsPids(ausgabe) {
  return String(ausgabe ?? "").split("\n").map((z) => Number(z.trim())).filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * Faehrt `sitzungsSuche` in der Git Bash. Liefert das Ergebnis von `spawnSync` oder
 * `{ fehler }`, wenn es keine Git Bash gibt.
 */
function sitzungsAbfrage(marke) {
  const shell = posixShell();
  if (shell.fehler) return { fehler: shell.fehler };
  const suche = sitzungsSuche(marke);
  const aufruf = spawnAufruf(shell.pfad, ["-c", suche.skript], shell);
  return spawnSync(aufruf.befehl, aufruf.args, {
    ...aufruf.optionen,
    encoding: "utf-8",
    windowsHide: true,
    env: { ...process.env, ...shell.umgebung, ...suche.umgebung },
  });
}

/**
 * Die Windows-PIDs der Prozesse, die die Marke einer Session tragen (Issue #1144).
 *
 * Scheitert die Abfrage — keine Git Bash, Startfehler, Exitcode ungleich 0 —, wirft die
 * Funktion (Issue #1174). Bis dahin lieferte sie eine leere Liste, und die war von "kein
 * Prozess laeuft mehr" nicht zu unterscheiden: Der Runner ging weiter, ohne dass im
 * Protokoll stand, dass er gar nicht nachsehen konnte. `abfrage` ist fuer die Tests
 * injizierbar und liefert dieselbe Form wie `spawnSync`.
 */
export function sitzungsProzesse(marke, { abfrage = sitzungsAbfrage } = {}) {
  const res = abfrage(marke);
  const grund = res.fehler ?? res.error?.message ?? exitGrund(res);
  if (grund) throw new Error(`Abfrage der Prozessliste gescheitert (${grund})`);
  return sitzungsPids(res.stdout);
}

/** Der Exitcode einer gescheiterten Abfrage samt erster Zeile von stderr, sonst `null`. */
function exitGrund(res) {
  if (res.status === 0) return null;
  const zeile = String(res.stderr ?? "").trim().split(/\r?\n/)[0];
  return zeile ? `Exitcode ${res.status}: ${zeile}` : `Exitcode ${res.status}`;
}

/** `sitzungsProzesse` fuer `killTree`: Dort genuegt bei gescheiterter Abfrage die Wurzel. */
function sitzungsProzesseOderKeine(marke) {
  try {
    return sitzungsProzesse(marke);
  } catch {
    return [];
  }
}

/**
 * Wie der Baum einer Session beendet wird (Issue #1132, Plan #1128 E10, Muster
 * `kit/checks.mjs` aus #1123): auf POSIX ein Signal an die Prozessgruppe, unter Windows
 * `taskkill /T /F`, denn ein Signal an die PID erreichte nur den direkten Kindprozess, und
 * seine Enkel hielten die geerbte Pipe offen. Unter Windows gibt es kein mildes SIGTERM fuer
 * einen Baum; beide Stufen des Zeitlimits werden zum harten Abbruch.
 */
export function baumBeendenAufruf(pid, signal, plattform = process.platform, weitere = []) {
  if (plattform === "win32") {
    // `weitere` sind die Prozesse mit der Marke der Session (Issue #1144): Ist die Wurzel
    // schon fort, reicht `taskkill /T` von ihr aus nicht mehr bis zu ihnen.
    const pids = [...new Set([pid, ...weitere].map(String))];
    return { taskkill: [...pids.flatMap((p) => ["/pid", p]), "/T", "/F"] };
  }
  return { pid: -pid, signal };
}

export function runProcess(cmd, cmdArgs, { issueId, timeoutMs, useStream, verbose, extraEnv, cwd, kommandoStufe, gitBash }) {
  return new Promise((resolve) => {
    // detached: true gibt dem Kind eine eigene Prozessgruppe, damit das Zeitlimit den
    // ganzen Baum trifft und nicht nur den direkten Kindprozess (Issue #182). Ohne das
    // ueberlebt ein Enkel (bei `claude` etwa ein Bash-Tool-Aufruf wie `mvn verify`),
    // haelt die geerbte stdout-Pipe offen und verhindert das close-Event — der Runner
    // wartet dann die volle Laufzeit ab, obwohl er laengst gekillt hat.
    // Gemessen: Enkelprozess mit Einzel-Kill 5023 ms statt 307 ms bei 300 ms Limit.
    // Kein unref(): Der Runner soll weiterhin auf das Kind warten.
    // Ueber die Git Bash mit selbst geschriebener Kommandozeile (Issue #1143), sonst
    // unveraendert.
    const aufruf = spawnAufruf(cmd, cmdArgs, { gitBash });
    // Die Marke dieser Session (Issue #1144): Unter Windows findet der Runner an ihr die
    // Prozesse, die eine Prozessgruppe auf POSIX zusammenhaelt.
    const marke = sitzungsMarke();
    const windows = process.platform === "win32";
    const child = spawn(aufruf.befehl, aufruf.args, {
      ...aufruf.optionen,
      env: sessionUmgebung(issueId, extraEnv, process.env, marke),
      detached: process.platform !== "win32",
      // stdin geschlossen (Issue #620): Ohne Angabe waere es eine offene Pipe, die der
      // Runner nie schliesst — die CLI wartete je Session drei Sekunden auf Eingabe und
      // schrieb "no stdin data received" ins Protokoll. Niemand schreibt in stdin, der
      // Prompt geht als Argument; eine Session, die stdin liest, bekommt so sofort das
      // Dateiende. stdout und stderr bleiben Pipes fuer das Sammeln und Streamen.
      stdio: ["ignore", "pipe", "pipe"],
      // Plan #638, A4: Die Kette laesst ihre Sessions im Worktree laufen. Ohne Angabe
      // erbt das Kind das cwd des Runners, wie bisher.
      cwd: cwd ?? process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    let buf = "";
    let timedOut = false;
    let settled = false;
    const timers = [];
    // Nur angelegt, wenn der Strom auch angefordert ist (Issue #748). Ohne Strom gibt es
    // nichts zu messen, und `werkzeugzeit: null` sagt genau das — ein Ergebnis mit Nullen
    // waere die Behauptung, eine Session habe kein Werkzeug benutzt.
    const werkzeugzeit = useStream ? werkzeugZeitBeobachter() : null;
    // Derselbe Strom, dieselbe Bedingung, zweiter Beobachter (Issue #924, Plan #917, E1).
    // Die Pruefgruppen kommen aus der geladenen Config; ohne sie zaehlt nur noch der
    // Bereichslauf, den der Aufrufweg allein ausweist.
    const prueflaufZaehler = useStream ? prueflaufBeobachter(ZUSTAND.config?.buildChecks) : null;
    // Derselbe Strom, dritter Beobachter (Issue #975) — mit einer Bedingung mehr: Die
    // Kommando-Stufe startet ein fremdes Programm ohne `--output-format stream-json`.
    // `useStream` ist dort trotzdem wahr, und der Beobachter lieferte `{ zeilen: [],
    // gesehen: 0 }`; am spaeteren Vermerk stuende dann "keine Auskunft der Sitzung",
    // obwohl gar nicht beobachtet werden konnte. `null` sagt "nicht beobachtet", dieselbe
    // Unterscheidung wie "nicht gemessen" gegen 0.
    const fortschritt = useStream && !kommandoStufe ? fortschrittBeobachter() : null;
    // Vierter Beobachter (Issue #1026), mit derselben Bedingung wie der dritte: Ohne
    // `stream-json` gibt es keine Aufrufe zu sehen, und `null` heisst nicht gemessen.
    const auskunft = useStream && !kommandoStufe ? auskunftBeobachter() : null;
    // Fuer die Restfrist, in der nach dem Ende der Session auf ihre Prozessgruppe
    // gewartet wird (Issue #668): Sie teilt sich das Zeitlimit mit der Session selbst.
    const gestartet = Date.now();

    const done = (result) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      // An genau einer Stelle angehaengt, damit auch die Zeitlimit- und Fehlerpfade das
      // Gemessene mitbringen: Gerade eine abgebrochene Session ist die, bei der die
      // Werkzeugzeit erklaert, woran die Runde haengengeblieben ist.
      resolve({
        ...result,
        werkzeugzeit: werkzeugzeit ? werkzeugzeit.ergebnis() : null,
        prueflaeufe: prueflaufZaehler ? prueflaufZaehler.ergebnis() : null,
        fortschritt: fortschritt ? fortschritt.ergebnis() : null,
        auskunft: auskunft ? auskunft.ergebnis() : null,
      });
    };

    // Signal an die ganze Prozessgruppe (negative PID, POSIX), unter Windows `taskkill`
    // auf den Baum (Issue #1132). Ein bereits beendeter Prozess laesst kill mit ESRCH
    // scheitern und taskkill mit einem Exitcode ungleich 0; das ist der Normalfall, kein
    // Fehler.
    const killTree = (signal) => {
      const aufruf = baumBeendenAufruf(child.pid, signal, process.platform, windows ? sitzungsProzesseOderKeine(marke) : []);
      if (aufruf.taskkill) {
        spawnSync("taskkill", aufruf.taskkill, { stdio: "ignore", windowsHide: true });
        return;
      }
      try {
        process.kill(aufruf.pid, aufruf.signal);
      } catch {
        /* Prozess(gruppe) bereits weg */
      }
    };

    // Nachfrist bis zum harten Nachsetzen. Ueber NIGHT_KILL_GRACE_MS testbar gemacht,
    // analog zu NIGHT_TIMEOUT_MS.
    const killGraceMs = process.env.NIGHT_KILL_GRACE_MS
      ? Number(process.env.NIGHT_KILL_GRACE_MS)
      : 5000;

    // Das Zeitlimit laeuft in drei Stufen, je durch die Nachfrist getrennt. Sie
    // stehen nebeneinander statt ineinander, weil jede fuer sich lesbar ist:
    // freundlich beenden, hart nachsetzen, und wenn auch das close-Event ausbleibt,
    // selbst aufloesen. Ein Nachtlauf darf unter keinen Umstaenden unbegrenzt warten.
    const selbstAufloesen = () => done({
      status: null,
      signal: "SIGKILL",
      error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      stdout,
      stderr,
    });
    // Reagiert der Baum nicht auf SIGTERM (ignoriertes Signal, haengender I/O),
    // wird nachgesetzt.
    const hartNachsetzen = () => {
      killTree("SIGKILL");
      timers.push(setTimeout(selbstAufloesen, killGraceMs));
    };
    const zeitlimitErreicht = () => {
      timedOut = true;
      killTree("SIGTERM");
      timers.push(setTimeout(hartNachsetzen, killGraceMs));
    };
    timers.push(setTimeout(zeitlimitErreicht, timeoutMs));

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (useStream) {
        // Der Zeitstempel je Zeile stammt aus ihrer ANKUNFT — daraus entsteht die Spanne,
        // und im gesammelten stdout am Ende steht sie nicht mehr. Ein Stempel je Chunk
        // genuegt: Die Zeilen eines Chunks sind zusammen eingetroffen.
        const ts = Date.now();
        buf += text;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const zeile = buf.slice(0, idx);
          werkzeugzeit.zeile(zeile, ts);
          prueflaufZaehler.zeile(zeile, ts);
          // Kein Beobachter in der Kommando-Stufe (Issue #975) — dort bleibt das Feld null.
          fortschritt?.zeile(zeile, ts);
          auskunft?.zeile(zeile, ts);
          // Getrennt von der Messung (Issue #748): Ausgegeben wird nur bei --verbose,
          // gemessen wird immer, sobald der Strom angefordert ist.
          if (verbose) emitVerbose(issueId, zeile);
          buf = buf.slice(idx + 1);
        }
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => done({ status: null, signal: null, error: err, stdout, stderr }));
    child.on("close", async (code, signal) => {
      // Die letzte Zeile ohne Zeilenumbruch — oft die interessanteste einer Session, und
      // beim Zeitlimit die abgeschnittene. Auch sie geht erst in die Messung, dann in die
      // Ausgabe.
      if (useStream && buf.trim()) {
        const ts = Date.now();
        werkzeugzeit.zeile(buf, ts);
        prueflaufZaehler.zeile(buf, ts);
        fortschritt?.zeile(buf, ts);
        auskunft?.zeile(buf, ts);
        if (verbose) emitVerbose(issueId, buf);
      }
      const error = timedOut
        ? Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
        : null;
      // Erst messen, wenn niemand mehr arbeitet (Issue #668). Nach einem Zeitlimit
      // entfaellt das: Dort hat killTree die Gruppe gerade erledigt, und ein weiteres
      // Warten haenge den Lauf genau an dem Baum auf, den er eben abgeraeumt hat.
      if (!timedOut) {
        const restMs = Math.max(0, timeoutMs - (Date.now() - gestartet));
        const leer = await warteAufProzessgruppe(child.pid, restMs, {
          vermerk: (text) => log(`  Hinweis: ${text}`),
          ...(windows ? { prozesse: () => sitzungsProzesse(marke) } : {}),
        });
        if (!leer) {
          log(`  Hinweis: Nach dem Ende der Session liefen noch Prozesse ihrer Gruppe, als die Frist ablief — die folgende Messung kann von ihnen gestoert sein.`);
        }
      }
      done({ status: code, signal, error, stdout, stderr });
    });
  });
}

// opts (Issue #167): { prompt, timeoutMs, extraEnv } — die Salvage-Session nutzt
// denselben Mechanismus wie eine regulaere Runde, nur mit anderem Prompt und
// eigenem Zeitlimit. Ohne opts bleibt alles wie vor #167.
//
/**
 * Die Permission-Argumente einer Nacht-Session (Issue #940).
 *
 * `auto` statt des frueheren Modus, der Edits pauschal annahm: Dort greift eine eingebaute
 * Sperre fuer sensible Dateien, die ein `permissions.allow`-Eintrag NICHT aufhebt — Paket
 * #933 scheiterte
 * zweimal daran, dass die Session `.claude/workflow.config.json` nicht schreiben durfte,
 * obwohl der Eintrag stand und derselbe Zugriff interaktiv im auto mode durchlief. Im auto
 * mode entscheidet ein Klassifikator, und damit wirkt die Allowlist auch nachts.
 *
 * `--permission-prompts none` gehoert zwingend dazu: Was der Klassifikator nicht entscheiden
 * kann, wird zur Rueckfrage. Die Vorgabe `host` schickte sie an einen SDK-Host, den der
 * Runner nicht hat — die Session hinge bis zum Rundenzeitlimit. `none` lehnt stattdessen ab
 * ("anything that would prompt is denied automatically; the permission mode still decides
 * everything else"): aus einem stillen Haenger wird eine klare Ablehnung, die der Morgen
 * im Protokoll sieht.
 *
 * Der Yolo-Zweig bleibt unberuehrt und setzt KEINEN Modus: `--dangerously-skip-permissions`
 * schaltet alle Checks ab, ein Modus daneben waere eine zweite Aussage ueber dieselbe Sache.
 *
 * Eine Funktion fuer beide Aufrufstellen — Session-Start und Vorflug. Zwei Orte fuer dieselbe
 * Entscheidung driften auseinander; genau diese Doppelung machte die Umstellung erst zu einer
 * Aenderung an zwei Stellen.
 */
export function permissionArgs(yolo) {
  if (yolo) return ["--dangerously-skip-permissions"];
  return ["--permission-mode", "auto", "--permission-prompts", "none"];
}

// Seit Plan #638 dazu: `cwd` (der Worktree der Kette, A4), `stream` (fordert den
// stream-json-Strom unabhaengig von --verbose an, A5 — das Kostenbudget darf nicht am
// Konsolenflag haengen; das Echo auf der Konsole bleibt an --verbose) und `stufe`
// (geht als NIGHT_KETTE_STUFE in die Kind-Umgebung, A14 — fuer die Test-Fakes und das
// Protokoll; KIT_AGENT_MODEL bleibt daneben das alleinige Erkennungsmerkmal der Skills).
//
// Seit Issue #668 `vordergrundCheck`: sperrt der Session das `Monitor`-Werkzeug und gibt
// ihr Bash-Zeitlimits in Hoehe des Rundenzeitlimits mit. Beides gehoert zusammen und
// traegt darum EINEN Schalter — die Sperre allein liesse die Session im Vordergrund an
// der Zehn-Minuten-Grenze des Bash-Werkzeugs sterben, die Zeitlimits allein aenderten
// nichts daran, dass sie weiterhin wartend enden kann. Gesetzt wird er fuer die
// Implementierungs-Runde; die Salvage-Session bekommt ihn nicht, ihr Prompt verbietet
// lange Laeufe ohnehin.
//
// Seit Issue #710 der Kommando-Zweig (Plan #707, E9/E10): `kommando` (die Kommandozeile
// der Stufe), `stufenName` (ihr Feld `name`) und `aufgabenstufe` (schwer, mittel, leicht)
// — gesetzt, wenn dieses Paket ueber ein Programm des Projekts statt ueber `claude` laufen
// soll. `aufgabenstufe` heisst bewusst nicht `stufe`: Das ist hier die Stufe der Nacht-Kette
// und bleibt es (E20). Ohne `kommando` aendert sich nichts.

/**
 * Womit eine Session startet: `{ cmd, cmdArgs }` fuer `runProcess()` (Issue #710).
 *
 * Drei Wege, und ihre Reihenfolge ist Teil der Sache:
 *
 *   1. `NIGHT_CLAUDE_CMD` — der Test-Hook. Er behaelt seinen Vorrang vor beiden anderen
 *      Zweigen; die Testsuite ersetzt damit die ganze Session. Er laeuft ueber
 *      `posixShell()` (Issue #1131): Die Fake-Skripte sind POSIX-Shell, unter Windows
 *      startet sie die Git Bash.
 *   2. `kommando` — das Programm der Stufe (Plan #707, E9). Der Auftrag steht als Argument
 *      daneben und erreicht das Programm ueber `"$@"`; er wird **nie** in den Shell-String
 *      eingesetzt. Eine Einsetzung waere die Einsetzungsluecke im eigenen Haus: Ein Auftrag
 *      mit Anfuehrungszeichen oder Backtick liefe dann als Shell-Kommando.
 *      Eine POSIX-Shell statt einer eigenen Zerlegung der Kommandozeile (E17) — sie darf
 *      Anfuehrungszeichen und fuehrende NAME=WERT-Zuweisungen tragen, und eine halbe
 *      Nachbildung der Shell scheitert still am ersten Sonderfall. Das ist `posixShell()`:
 *      `sh` auf POSIX, die Git Bash unter Windows (Issue #1131).
 *      `--model` entfaellt hier: Das Programm ist nicht `claude` und kennt das Flag nicht.
 *   3. sonst `claude --model <name>`, gestartet nach `startbefehlFuer` (Issue #1131, E8):
 *      unter Windows eine npm-Huelle `claude.cmd` ueber ihre sh-Huelle in der Git Bash.
 *
 * Zurueck kommt `{ cmd, cmdArgs, umgebung, startfehler }`. `umgebung` gehoert zusaetzlich in
 * die Umgebung des Starts; `startfehler` ist gesetzt, wenn sich gar nichts starten laesst —
 * dann ist `cmd` null. Ein Start ueber die Git Bash traegt `gitBash: true` und geht ueber
 * `spawnAufruf` (Issue #1143). `env` ist die Umgebung, in der Shell und Programm gesucht
 * werden; `plattform` und `existiert` sind wie bei `posixShell` injizierbar (Tests).
 *
 * NIGHT_PROMPT und der geschlossene stdin (Issue #620) haengen an `runProcess()` und gelten
 * darum in jedem der drei Wege.
 *
 * Exportiert fuer die Tests (Issue #846): `NIGHT_CLAUDE_CMD` ersetzt den ganzen Aufruf,
 * eine Fake-Session sieht die gebaute Kommandozeile also nie.
 */
/**
 * Die Reserve zwischen dem Zeitlimit eines einzelnen Bash-Befehls und dem der Runde:
 * genug Zeit, damit eine Session nach dem Tod ihres Befehls noch melden, kommentieren und
 * die Karte bewegen kann (Issue #902).
 */
export const BASH_RESERVE_MS = 10 * 60 * 1000;

/**
 * Das Bash-Zeitlimit der Session aus dem Rundenzeitlimit (Issue #902).
 *
 * Die Reserve ist das Kleinere aus `BASH_RESERVE_MS` und 20 Prozent der Runde — ein fester
 * Bruchteil naehme dem Befehl bei einer Stunde Runde die halbe Runde und machte Issue #668
 * wieder kaputt, der Anteil haelt die kleinen Werte aus `NIGHT_TIMEOUT_MS` in den Tests
 * positiv. Mindestens eine Millisekunde, damit das Ergebnis stets unter dem Rundenzeitlimit
 * liegt und selbst positiv bleibt.
 */
export function bashZeitlimit(timeoutMs) {
  const reserve = Math.max(1, Math.min(BASH_RESERVE_MS, Math.floor(timeoutMs * 0.2)));
  return Math.max(1, timeoutMs - reserve);
}

export function sessionStart({ testCmd, kommando, prompt, modell, args, opts, env = process.env, plattform = process.platform, existiert }) {
  const suche = { env, plattform, ...(existiert ? { existiert } : {}) };
  if (testCmd || kommando) {
    const shell = posixShell(suche);
    if (shell.fehler) return { cmd: null, cmdArgs: [], umgebung: {}, startfehler: shell.fehler };
    const cmdArgs = testCmd ? ["-c", testCmd] : ["-c", `${kommandoFuerShell(kommando, plattform)} "$@"`, "sh", prompt];
    return { cmd: shell.pfad, cmdArgs, umgebung: shell.umgebung, ...(shell.gitBash ? { gitBash: true } : {}), startfehler: null };
  }

  const permArgs = permissionArgs(args.yolo);
  const streamArgs = (args.verbose || opts.stream) ? ["--output-format", "stream-json", "--verbose"] : [];
  // Die Werkzeugsperre (Issue #668). `Monitor` ist das Werkzeug, mit dem eine Session
  // auf einen eigenen Hintergrundlauf wartet — und genau damit beendet sie ihren Zug,
  // weil eine headless -p-Session keinen Folge-Turn hat. Ohne das Werkzeug bleibt ihr
  // der Vordergrund-Aufruf, dessen Ergebnis sie noch verwerten kann.
  //
  // Die Sperre ersetzt eine Anweisung, die es laengst gibt: local-check verlangt seit
  // Issue #167 woertlich, einen Hintergrund-Check aktiv abzuwarten statt mit einer
  // Ankuendigung zu enden. Sie stand im Kontext der Sessions, die trotzdem so endeten
  // (kanban-kit #891, #899, #900). Das ist das #122-Prinzip am lebenden Objekt: Was ein
  // Modell klassenweise falsch macht, gehoert ins Gate und nicht in den Prompt.
  const werkzeugArgs = opts.vordergrundCheck ? ["--disallowedTools", "Monitor"] : [];
  // Die Gruendlichkeit der Stufe (Issue #846). Nur hier, und nur wenn gesetzt: Ohne das
  // Flag gilt die Voreinstellung der CLI, und eine Stufe ohne `effort` faehrt damit
  // zeichengleich zu vorher.
  const effortArgs = alsText(opts.effort) ? ["--effort", opts.effort] : [];
  const start = startbefehlFuer("claude", suche);
  return {
    cmd: start.befehl,
    cmdArgs: [...start.vorArgs, "-p", prompt, "--model", modell, ...permArgs, ...streamArgs, ...werkzeugArgs, ...effortArgs],
    umgebung: start.umgebung,
    ...(start.gitBash ? { gitBash: true } : {}),
    startfehler: start.fehler,
  };
}

/**
 * Das Ergebnis eines Starts, der gar nicht erst stattfand (Issue #1131): dieselbe Form wie das
 * von `runProcess`, mit ENOENT wie ein Spawn ohne Programm. So greifen die bestehenden
 * Fehlerwege unveraendert.
 */
function keinStart(grund) {
  const error = Object.assign(new Error(grund), { code: "ENOENT", vorStart: true });
  return {
    status: null, signal: null, error, stdout: "", stderr: "",
    werkzeugzeit: null, prueflaeufe: null, fortschritt: null, auskunft: null,
  };
}

/**
 * Ein ENOENT beim Start einer Session (Issue #710, #1131).
 *
 * Im Kommando-Zweig bedeutet es allein, dass die Shell selbst fehlt — `sh` auf POSIX, die Git
 * Bash unter Windows. Ein von der Shell nicht gefundenes Programm endet mit Exit 127 und ist
 * bereits von `stufeStartbar` vor dem Start gefangen (E8). Darum kein `fail()` wie beim
 * fehlenden claude-CLI: Der Aufrufer soll nach oben ausweichen koennen, statt den ganzen Lauf
 * an einer Stufe zu verlieren, die nur dieses eine Paket betrifft.
 */
function programmFehlt(res, { kommando, cmd, startfehler }) {
  if (!kommando) {
    fail(startfehler || "claude-CLI nicht gefunden. Ist Claude Code installiert und im PATH?", "umgebung");
    return;
  }
  res.startfehler = startfehler
    ? `die Shell fuer die Kommando-Stufe wurde nicht gefunden: ${startfehler}`
    : `die Shell "${cmd}" fuer die Kommando-Stufe wurde nicht gefunden`;
}

// Exportiert fuer die Kette und ihre Tests.
export async function runSession(issueId, args, opts = {}) {
  // NIGHT_TIMEOUT_STUFE (Issue #1080) beschraenkt NIGHT_TIMEOUT_MS auf die Sessions einer
  // Stufe. Ohne sie galt das kurze Testlimit JEDER Session einer Kette, und die Sessions,
  // die schnell sein sollten, rissen es unter Last — der Test wurde rot, obwohl die
  // gemeinte Stufe richtig reagierte. Sessions ohne Kettenstufe zaehlen als `umsetzung`,
  // wie im Fake der Tests.
  const nurStufe = process.env.NIGHT_TIMEOUT_STUFE;
  const testlimitGilt = process.env.NIGHT_TIMEOUT_MS && (!nurStufe || nurStufe === (opts.stufe || "umsetzung"));
  const timeoutMs = testlimitGilt
    ? Number(process.env.NIGHT_TIMEOUT_MS)
    : (opts.timeoutMs ?? args.timeoutMin * 60 * 1000);
  // Das Issue wird der Session verbindlich uebergeben (Issue #191) — sie waehlt
  // nicht mehr selbst. Der Prompt geht zusaetzlich als NIGHT_PROMPT in die
  // Kindprozess-Umgebung, damit der Auftrag auch im Test-Hook-Pfad sichtbar ist.
  const prompt = opts.prompt || `/implement-next #${issueId}`;
  // Das Modell dieser Session (Issue #665). `opts.model ?? args.model` statt eines
  // Pflichtparameters: `runSession` ist exportiert und wird an mehreren Stellen mit
  // `args` allein gerufen — die Kette behaelt so ohne Zutun das Modell des Laufs.
  const modell = opts.model ?? args.model;
  // Die Kommandozeile der Stufe (Issue #710). Leerer Text zaehlt wie nicht gesetzt: Eine
  // Stufe ohne Programm ist keine Kommando-Stufe, und `sh -c ' "$@"'` startete gar nichts.
  const kommando = alsText(opts.kommando);
  // Die Selbstauskunft dieser Session (Plan #707, E10). Im Kommando-Zweig gibt es keinen
  // Modellnamen, den man melden koennte — dort steht das Feld `name` der Stufe, ersatzweise
  // `stufe-<schwer|mittel|leicht>`. Leer darf der Wert unter keinen Umstaenden sein:
  // KIT_AGENT_MODEL ist das alleinige Erkennungsmerkmal des unbeaufsichtigten Laufs, und
  // ohne Wert hielte sich jeder Skill dieser Session fuer beaufsichtigt.
  const selbstauskunft = kommando
    ? (alsText(opts.stufenName) || `stufe-${alsText(opts.aufgabenstufe) || "unbekannt"}`)
    : modell;
  const testCmd = process.env.NIGHT_CLAUDE_CMD;
  // Shell und Programm werden in der Umgebung gesucht, die auch die Session bekommt
  // (Issue #1131) — ein PATH aus `opts.extraEnv` gilt fuer beides.
  const { cmd, cmdArgs, umgebung, gitBash, startfehler } = sessionStart({
    testCmd, kommando, prompt, modell, args, opts, env: { ...process.env, ...opts.extraEnv },
  });
  // Die Session-Dauer fuer die Zeiten-Erfassung (Issue #749): gemessen um genau den
  // Prozesslauf, wie Nachdenken (apiDauerMs) und Werkzeugarbeit (werkzeugzeit) es auch sind.
  const gestartet = Date.now();
  // Laesst sich nichts starten — unter Windows ohne Git Bash oder bei einer claude.cmd ohne
  // sh-Huelle —, steht derselbe Befund da wie bei einem Spawn ohne Programm: ENOENT.
  const res = startfehler ? keinStart(startfehler) : await runProcess(cmd, cmdArgs, {
    // Verarbeitet wird der Strom, sobald er angefordert ist — dieselbe Bedingung wie in
    // `sessionStart` (Issue #748). Bisher stand hier `args.verbose` allein, und damit lag
    // der Strom jedes normalen Nachtlaufs unausgewertet als Block in `res.stdout`.
    // `verbose` daneben steuert nur noch die Ausgabe der Ereignisse.
    issueId, timeoutMs, useStream: args.verbose || opts.stream, verbose: args.verbose, cwd: opts.cwd, gitBash,
    // Die Kommando-Stufe beobachtet ihren Fortschritt nicht (Issue #975): Ihr Programm
    // kennt das Strom-Format nicht, und ein leeres Ergebnis waere eine Aussage ueber eine
    // Sitzung, die nie beobachtet wurde.
    kommandoStufe: Boolean(kommando),
    // KIT_AGENT_MODEL (Issue #193): Modell-Selbstauskunft fuer den Aktivitaetsverlauf
    // des Boards. Die Variable wird von den Bash-Kindprozessen der Session geerbt und
    // von board.mjs als Header X-Agent-Model gesendet — so steht im Verlauf, mit
    // welchem Modell der Nachtlauf gearbeitet hat. Nur hier gesetzt: interaktive
    // Sessions machen bewusst keine Angabe.
    extraEnv: {
      NIGHT_PROMPT: prompt,
      // Derselbe Wert wie in --model (Issue #665): Der Aktivitaetsverlauf des Boards
      // soll das Modell zeigen, mit dem wirklich gearbeitet wurde, nicht das des Laufs.
      // Im Kommando-Zweig steht hier der Name der Stufe (Issue #710, E10) — nie leer.
      KIT_AGENT_MODEL: selbstauskunft,
      ...(opts.stufe ? { NIGHT_KETTE_STUFE: opts.stufe } : {}),
      // Der feste Kit-Stand des Laufs (Issue #1102, A2): Commit-Hook und board.mjs der
      // Session fragen ihn zusammen mit der Markierung des Baums ab.
      ...kitStandUmgebung(),
      // Die Laufkennung (Issue #1194): Das Board ordnet daran die Karten dieser Session
      // ihrem Lauf zu, auch wenn ein zweiter Lauf mit demselben Token parallel schreibt.
      ...laufKennungUmgebung(),
      // Die zweite Haelfte der Werkzeugsperre (Issue #668): Ohne `Monitor` faehrt die
      // Session ihren Pflichtcheck im Vordergrund — und liefe dann in das Zeitlimit des
      // Bash-Werkzeugs, das bei zehn Minuten endet. Ein voller `mvn verify` mit
      // Testcontainers liegt darueber; die Session staerbe an der Uhr statt am Code.
      // Die Obergrenze des Befehls liegt aber UNTER der der Runde (Issue #902): Stirbt der
      // Befehl an einer Grenze darunter, lebt die Session weiter, sieht den Fehler und kann
      // melden, kommentieren und die Karte bewegen. Stirbt er zeitgleich mit der Runde,
      // geht beides verloren. Die Reserve ist so bemessen, dass der volle Pruefstand aus
      // #668 weiter hineinpasst — siehe `bashZeitlimit`.
      ...(opts.vordergrundCheck
        ? (() => {
            const grenze = String(bashZeitlimit(timeoutMs));
            return { BASH_MAX_TIMEOUT_MS: grenze, BASH_DEFAULT_TIMEOUT_MS: grenze };
          })()
        : {}),
      // Die Umgebung der Git Bash (Issue #1131): unter Windows ohne Pfadumwandlung der
      // Argumente, auf POSIX leer.
      ...umgebung,
      ...opts.extraEnv,
    },
  });
  if (!testCmd && res.error?.code === "ENOENT") programmFehlt(res, { kommando, cmd, startfehler });
  const sessionOutput = `--- Session-Output Issue #${issueId} ---\n${res.stdout || ""}${res.stderr || ""}\n`;
  if (ZUSTAND.LOG_FILE) appendFileSync(ZUSTAND.LOG_FILE, sessionOutput, "utf-8");
  schrittProtokollieren(sessionOutput);
  // Jede Session einer Karte an genau einer Stelle verbucht (Issue #669): Implementierung,
  // Salvage und alle Stufen der Kette laufen hier durch.
  const kennzahlen = leseKennzahlen(res.stdout);
  verbrauchErfassen(issueId, kennzahlen);
  zeitenErfassen(issueId, Date.now() - gestartet, kennzahlen, res.werkzeugzeit);
  prueflaeufeErfassen(issueId, res.prueflaeufe);
  auskunftErfassen(issueId, res.auskunft, prompt);
  // Das wirksame Zeitlimit dieser Runde (Issue #976). Es wird hier oben gerechnet — aus
  // `NIGHT_TIMEOUT_MS`, `opts.timeoutMs` oder `args.timeoutMin` — und war bisher nach der
  // Rueckkehr nicht mehr zu erfahren. Der Zeitabbruch-Vermerk nennt die Grenze aber, und
  // `args.timeoutMin` waere dort die falsche: Ein Lauf unter `NIGHT_TIMEOUT_MS` oder eine
  // Salvage-Session mit eigenem `opts.timeoutMs` schrieben damit eine Zahl an die Karte,
  // an der nichts gemessen wurde. Angehaengt wie `werkzeugzeit`, also ohne die uebrigen
  // Felder von `runProcess` zu beruehren.
  res.timeoutMs = timeoutMs;
  // Ein Sitzungsstart, der an der Umgebung scheiterte, bekommt genau einen Versuch nach der
  // Pause (Issue #1088, E13). Scheitert auch er, traegt das Ergebnis `umgebungGescheitert`,
  // und der Aufrufer haelt den Lauf an. Ohne Stempel (Import durch Tests) kein Versuch.
  if (ZUSTAND.LAUF_STEMPEL && !opts.zweiterVersuch && sitzungsStartGescheitert(res, kommando)) {
    zweiterVersuch(`Sitzungsstart zu #${issueId} gescheitert (${exitText(res)})`);
    schrittZweiterVersuch();
    const zweiter = await runSession(issueId, args, { ...opts, zweiterVersuch: true });
    zweiter.zweiterVersuch = true;
    zweiter.umgebungGescheitert = sitzungsStartGescheitert(zweiter, kommando);
    return zweiter;
  }
  return res;
}

/**
 * Liest, was die soeben beendete Session hinterlassen hat. Fehlt die Datei, ist das
 * KEIN harter Stopp: Die Session hat dann keine Pruefung gefahren, und der Bericht
 * sagt genau das. Faehrt eine Session `run` mehrfach (rot, Fix, erneut), steht hier
 * der letzte Lauf — daraus entsteht bewusst keine Historie.
 */
export function lesePruefung(issueId) {
  const pfad = zusammenfassungPfad(process.cwd());
  if (!existsSync(pfad)) return { id: String(issueId), zustand: "ungeprueft" };
  try {
    const daten = JSON.parse(readFileSync(pfad, "utf-8"));
    // Der Umfang der Pruefung (Issue #749, Review-Fund): Kriterium 2 der Auswertung fragt,
    // wie oft eine Pruefung im vollen statt im eingegrenzten Umfang lief — ohne diese Felder
    // waere das nicht beantwortbar. Ein Stand aus der Zeit vor diesem Paket fuehrt sie nicht;
    // ein fehlendes Feld gilt als `unbekannt` und nicht als `eingegrenzt`, darum `null` und
    // nie `false`.
    const umfangFelder = {
      vollerUmfang: typeof daten.vollerUmfang === "boolean" ? daten.vollerUmfang : null,
      leeresPaket: typeof daten.leeresPaket === "boolean" ? daten.leeresPaket : null,
      basis: typeof daten.basis === "string" ? daten.basis : null,
      bereiche: Array.isArray(daten.bereiche) ? daten.bereiche : null,
      dauerGesamtMs: endlicheZahl(daten.dauerGesamtMs),
      // Die Wartezeit des Laufs vom Start bis zum Ergebnis, samt Warten auf die Sperre
      // (Issue #1069, #1073): Der Nachtbericht nennt sie als letzten Abschluss. Ein Stand
      // vor Issue #1069 fuehrt sie nicht — dann `null`, nie eine geratene 0.
      wartezeitMs: endlicheZahl(daten.wartezeitMs),
      // Die Dateien ohne Bereichsmuster (Issue #926, Plan #917, E8): Sie sind in der
      // Auswahl gelandet, ohne dass ein Bereich sie kennt — ein Loch in der Zuordnung, das
      // der Bericht namentlich nennt. Ein fehlendes Feld ist `null` und nicht `[]`: Ein
      // Stand aus der Zeit vor Issue #922 weiss darueber nichts, und eine leere Liste
      // behauptete, es habe keine Luecke gegeben.
      ohneZuordnung: Array.isArray(daten.ohneZuordnung) ? daten.ohneZuordnung : null,
      // Die Funde der Hinweis-Pruefungen je Kommando, `{ cmd, zeilen }` (Issue #1156, Plan
      // #1150, E11/E12): nur durchgereicht, nie gewertet — ein Hinweis-Eintrag endet `gruen`,
      // und der `zustand` bleibt, was `laufen` sagt. Ein Stand vor Issue #1155 fuehrt das
      // Feld nicht, darum `null` und nicht `[]`.
      hinweise: Array.isArray(daten.hinweise) ? daten.hinweise : null,
    };
    // Die Guetemessung (Issue #764): Das Feld steht nur da, wenn das Projekt eine Messung
    // benannt hat — dann aber in jedem Zustand, auch beim leeren Paket und beim roten Lauf
    // (Issue #763). Es wird hier nur weitergereicht und nirgends ausgewertet: Der Halt wegen
    // verfehlter Marke ist bereits der rote Lauf, und eine zweite Beurteilung an dieser
    // Stelle waere ein zweites Gate fuer dieselbe Entscheidung.
    const guete = daten.guete && typeof daten.guete === "object" ? { guete: daten.guete } : {};
    // `roh` ist das Durchreichen der gelesenen Datei an `bewertePruefung` und kommt dort
    // wieder weg (Issue #865): Der Abgleich mit dem Commit braucht `hashes` und
    // `abgeschlossen`, der Pruefstand der Einheit soll sie nicht tragen — er ist der
    // Vertrag mit den Auswertungen, und zwei Blob-Listen je Nacht sind kein Bericht.
    if (daten.leeresPaket) return { id: String(issueId), zustand: "leeresPaket", ...umfangFelder, ...guete, roh: daten };
    const laufen = daten.laufen ?? [];
    // Ein nicht gruener Eintrag ist etwas anderes als eine fehlende Datei: Dort ist
    // eine Pruefung gelaufen und hat versagt, hier ist keine gelaufen. Bis Issue
    // #471 fielen beide zusammen — jede lesbare Datei galt als "geprueft", auch
    // eine mit rotem Lauf, und der Zustand floss in werteRunde gar nicht ein.
    //
    // Genannt wird das erste `rot`, erst ohne ein solches das erste ungruene (Issue #1072):
    // Nach einem roten Teillauf stehen vor der roten Gruppe nicht gestartete.
    // SYNC: dieselbe Regel wie `rotesKommando` in kit/checks.mjs und in .githooks/gate.mjs.
    const ungruen = laufen.find((e) => e.ergebnis === "rot") ?? laufen.find((e) => e.ergebnis !== "gruen");
    return {
      id: String(issueId),
      zustand: ungruen ? "rot" : "geprueft",
      ...(ungruen ? { rotesKommando: ungruen.cmd, rotesErgebnis: ungruen.ergebnis } : {}),
      laufen,
      ausgelassen: daten.ausgelassen ?? [],
      ...umfangFelder,
      ...guete,
      roh: daten,
    };
  } catch (err) {
    // Eine unlesbare Datei ist keine Pruefung. Sie bekommt aber ihren eigenen Grund:
    // "kaputt" sagt etwas anderes als "gar nicht gelaufen".
    return { id: String(issueId), zustand: "unlesbar", fehler: err.message };
  }
}

// --- Salvage (Issue #167) ---

// Zeitlimit der Salvage-Session: sie fuehrt keinen Build mehr aus, sondern prueft
// nur den Diff gegen das Issue, committet und bewegt das Board. Bewusst unabhaengig
// von --timeout-min (das bemisst eine volle Implementierungsrunde).
export const SALVAGE_TIMEOUT_MS = 10 * 60 * 1000;

// Liest den env-Block aus .claude/settings.json (falls vorhanden). Dort stehen
// projektspezifische Variablen (z.B. DOCKER_HOST/TESTCONTAINERS_DOCKER_SOCKET_
// OVERRIDE fuer Testcontainers unter Colima), die Claude Code seinen eigenen
// Bash-Tool-Aufrufen automatisch mitgibt. night.mjs ist aber ein eigener
// Node-Prozess ausserhalb von Claude Code und bekommt diese Variablen sonst
// nicht — ohne sie liefert runBuildChecksSync ein falsches Rot (beobachtet bei
// kanban-kit #445: mvn verify schlug ohne die beiden Variablen mit Mockito-
// MockMaker-Fehlern fehl, mit ihnen lief er sauber durch).
export function settingsEnv() {
  // Precedence wie in Claude Code: settings.json zuerst, settings.local.json
  // gewinnt. Die local-Datei ist gitignored und damit der uebliche Ort fuer
  // maschinenspezifische Werte — genau die, die hier fehlen wuerden (Issue #168).
  const merged = {};
  for (const name of ["settings.json", "settings.local.json"]) {
    const path = join(process.cwd(), ".claude", name);
    if (!existsSync(path)) continue;
    try {
      const settings = JSON.parse(readFileSync(path, "utf-8"));
      if (settings.env && typeof settings.env === "object") Object.assign(merged, settings.env);
    } catch {
      // Kaputtes JSON blockiert die Vorpruefung nicht — nur diese eine Quelle faellt aus.
    }
  }
  return merged;
}

// Fuehrt die buildChecks der Config sequenziell aus und bricht beim ersten roten
// Check ab. mutationCommand bleibt bewusst aussen vor: ein nachgelagerter Check,
// kein Blocker fuer die Salvage-Entscheidung. Die Kindprozess-Umgebung bekommt
// zusaetzlich den env-Block aus .claude/settings.json gemergt (siehe settingsEnv).
// Umgebung fuer die eigenen Kindprozesse (Vorpruefung und Format-Fix): process.env
// plus der gemergte settings-env-Block.
function checkEnv() {
  return { ...process.env, ...settingsEnv() };
}

/**
 * Die Eintraege aus `buildChecks`, die der ABSCHLUSS eines Arbeitspakets faehrt
 * (Plan #753, E13/E14; Plan #944, E14).
 *
 * Erste Bedingung, die Paketstufe: Ein Eintrag ohne `stufe` gehoert dazu — die
 * String-Form, das Objekt ohne `stufe` und `stufe: "paket"` bedeuten dasselbe. Das ist
 * derselbe Default wie in checks.mjs, und er haelt jede bestehende Config bei ihrem
 * Verhalten. Eintraege der Stufe `push` oder `merge` sind erst beim Veroeffentlichen
 * faellig.
 *
 * Zweite Bedingung, die beiden Gruppen, die ein Abschlusslauf auslaesst (Issue #946,
 * Plan #944, E3/E4): jeder Eintrag mit `nichtBeimAbschluss` und jeder mit `guete`-Block.
 * Der eine traegt den Abschluss einer einzelnen Karte nicht, der andere gewinnt seinen
 * Anteil aus der vollstaendigen Testmenge — aus einem verkuerzten Lauf waere es nicht
 * dieselbe Zahl, sondern eine andere Groesse mit demselben Namen.
 *
 * Der Nacht-Runner liest daraus an drei Stellen, und alle drei meinen denselben Umfang:
 *   - die NACHPRUEFUNG (`nachpruefLaufen` / `bewertePruefung`) und die
 *     SALVAGE-VORPRUEFUNG (`runBuildChecksSync`) vollziehen einen Abschluss nach, den
 *     sie nicht glauben koennen. Faehren sie MEHR als er, waere das ein zweiter Weg ueber
 *     denselben Vorgang — und er kostete nachts gerade die teuerste Gruppe, also dort,
 *     wo die Zeit am knappsten ist (PO-Antwort 3 des Fachplans #938).
 *   - der START-GUARD fragt, ob die naechtliche Umsetzung ueberhaupt ein Gate hat.
 *     Zaehlte er Eintraege mit, die der Abschluss nie faehrt, liesse er eine Config
 *     durch, in der sie keines hat.
 */
// SYNC: derselbe Default steht in kit/checks.mjs (normalisiere) und wird in
// kit/einstellungen.mjs geprueft. Dieselbe Auslassung trifft kit/checks.mjs
// (`verteilen` im Abschlusslauf) und dieselbe Bedingung `pruefeAbschlussGate`.
export function paketstufenChecks(cfg) {
  return (cfg.buildChecks || []).filter((eintrag) => {
    if (typeof eintrag === "string") return true;
    if ((eintrag.stufe ?? "paket") !== "paket") return false;
    return !eintrag.nichtBeimAbschluss && !eintrag.guete;
  });
}

// Eine Shell ist hier zwingend — anders als in board.mjs, wo Issue #196 sie gerade
// abgeschafft hat. Der Unterschied: Dort stehen die Kommandos fest im Code und lassen
// sich als Argument-Array uebergeben. Hier ist `cmd` eine frei konfigurierte
// Kommandozeile aus der workflow.config.json ("mvn verify", "npm --prefix frontend
// run build"), die Operatoren und Umleitungen enthalten darf. Ohne Shell gaebe es das
// Feature nicht.
//
// Die Shell ist /bin/sh auf POSIX und unter Windows die Git Bash (Issue #1176, vorher die
// ComSpec-Shell, Issue #199) — siehe `konfigKommandoStart`. Damit gilt fuer die
// buildChecks auf jeder Plattform dieselbe POSIX-Syntax.
//
// PATH-Aufloesung bewusst (S4036, Issue #183).
//
// KEINE bereichsbezogene Auswahl, absichtlich (Entscheidung A6 des Plans #421,
// Issue #428). Wer das spaeter als Luecke liest, dreht die Frage um, die diese
// Pruefung beantwortet: Sie wird gestellt, wenn ein Nachweis nicht zum Commit
// gehoert — dann ist unklar, welchen Stand er gemessen hat, und ein Anker fuer die
// beruehrten Bereiche ist es erst recht nicht.
//
// Fuer die SALVAGE-VORPRUEFUNG gilt das seit Issue #919 nicht mehr: Sie geht ueber
// `checks.mjs run` (siehe `runChecksCliSync`) und damit ueber dessen Auswahl. Der
// Grund steht dort — sie muss denselben Nachweis hinterlassen, den das Commit-Gate
// liest, und zwei Wege zu "gruen" sind genau das, was den Vorfall ausgeloest hat.
//
// Die STUFENauswahl beantwortet eine andere Frage und greift deshalb sehr wohl
// (Plan #753, E13): "ist dieser Zwischenstand brauchbar?" ist die Frage der
// Paketstufe. Eintraege mit `stufe` push oder merge sind erst beim Veroeffentlichen
// faellig; liefen sie hier mit, wartete jede Nachpruefung auf Pruefungen, die sie
// nichts angehen. Beide Auswahlen sind unabhaengig: Bereich aus, Stufe an.
//
// Aus demselben Grund bleiben `nichtBeimAbschluss` und die Guetemessung aussen vor
// (Plan #944, E14): Die Nachpruefung vollzieht den Abschluss nach, den die Session nicht
// belegt hat. Faehre sie mehr als er, waere sie STRENGER als das Gate, das sie ersetzt —
// und sie kostete gerade die Gruppe, die wegen ihrer Laufzeit vom Abschluss
// ausgenommen wurde. Die Marke ist damit nicht aufgegeben, sondern verschoben: Vor dem
// Veroeffentlichen laeuft die Messung immer.
//
// Die Eintragsformen aus Issue #422 (String, { cmd, areas }, { cmd, always })
// meinen hier alle dasselbe — nur Kommando, Stufe und Guetemessung zaehlen.
// `areas` wird nicht gelesen.

/**
 * Die Wertung der Guetemessung, wie sie checks.mjs fuehrt (Issue #817).
 *
 * Der Runner braucht sie, weil ein Kommando mit Guetemessung gruen endet und
 * trotzdem rot ist: Exit 0 heisst "gelaufen", nicht "Marke erreicht". Bis #817
 * las die Vorpruefung nur den Exit-Code, und ein Mutationstest mit 84 Prozent
 * gegen Marke 90 galt ihr als gruen — die Salvage-Session bekam "Checks extern
 * verifiziert gruen" zu hoeren und schob das Paket nach In review, waehrend
 * `checks.mjs` denselben Stand rot faerbt.
 *
 * Die Wertung ist eine Kopie, kein Import: Die Kit-Werkzeuge sind
 * eigenstaendige Single-File-Tools, die einzeln ausgeliefert werden, und
 * night.mjs kennt checks.mjs bisher nur als Kindprozess.
 */
// SYNC: Original ist kit/checks.mjs (gueteAuswerten); gleich gehalten von
// test/guete-wertung-sync.test.mjs an derselben Fallliste.
export function gueteAuswerten(guete, ausgabe) {
  let regex;
  try {
    regex = new RegExp(guete.muster);
  } catch (err) {
    return { anteil: null, erfuellt: false, grund: `Muster '${guete.muster}' ist kein regulaerer Ausdruck: ${err.message}` };
  }
  const treffer = regex.exec(ausgabe);
  if (treffer === null) {
    return { anteil: null, erfuellt: false, grund: `Muster '${guete.muster}' trifft die Ausgabe nicht` };
  }
  if (treffer[1] === undefined) {
    return { anteil: null, erfuellt: false, grund: `Muster '${guete.muster}' hat keine Gruppe` };
  }
  if (treffer[1].trim() === "") {
    return { anteil: null, erfuellt: false, grund: `Gruppe '${treffer[1]}' ist leer` };
  }
  const anteil = Number(treffer[1]);
  if (!Number.isFinite(anteil)) {
    return { anteil: null, erfuellt: false, grund: `Gruppe '${treffer[1]}' ist keine Zahl` };
  }
  if (anteil < 0 || anteil > 100) {
    return { anteil: null, erfuellt: false, grund: `Anteil ${anteil} liegt ausserhalb von 0 bis 100 Prozent` };
  }
  const erfuellt = anteil >= guete.marke;
  return { anteil, erfuellt, grund: erfuellt ? "genuegt" : "unter der Marke" };
}

/**
 * Die Merkmal-Pruefung, wie sie checks.mjs fuehrt (Issue #859).
 *
 * Derselbe Grund wie bei `gueteAuswerten` darueber, nur eine Stufe frueher: Ein
 * Kommando kann mit Rueckgabewert 0 enden und trotzdem gescheitert sein — eine
 * Maven-Kette, deren letztes Glied den Rueckgabewert verschluckt, weist ihr
 * Scheitern nur in der Ausgabe aus. Las die Vorpruefung nur den Exit-Code, galt
 * ihr genau dieser Stand als gruen, waehrend `checks.mjs` ihn rot faerbt: Die
 * Salvage-Session bekaeme "Checks extern verifiziert gruen" zu hoeren und schoebe
 * das Paket nach In review, wo `/push-main` es wieder anhaelt.
 *
 * Liste und Funktion sind eine Kopie, kein Import: Die Kit-Werkzeuge sind
 * eigenstaendige Single-File-Tools, und night.mjs kennt checks.mjs nur als
 * Kindprozess.
 */
// SYNC: Original ist kit/checks.mjs (FEHLERMERKMALE, fehlermerkmal); gleich
// gehalten von test/guete-wertung-sync.test.mjs an derselben Fallliste.
const FEHLERMERKMALE = ["[ERROR]", "BUILD FAILURE"];

export function fehlermerkmal(ausgabe) {
  return FEHLERMERKMALE.find((merkmal) => ausgabe.includes(merkmal)) ?? null;
}

/**
 * Das Urteil ueber ein gelaufenes Kommando samt der Zeilen, die zum Befund gehoeren —
 * aus denselben drei Quellen und in derselben Reihenfolge wie `bewerten` in
 * kit/checks.mjs: Rueckgabewert, Fehlermerkmal, Guetemessung.
 *
 * Eigene Funktion und nicht in der Schleife von `runBuildChecksSync`, damit die
 * Schleife ihren Ablauf zeigt (ausfuehren, bewerten, festhalten) und nicht drei
 * Urteile in einer Verzweigungskette traegt — auch das wie in checks.mjs.
 */
function bewerteLaufSync(eintrag, gruen, ausgabe) {
  if (!gruen) return { bestanden: false, zeilen: "" };

  // Das Fehlermerkmal steht VOR dem guete-Zweig, wie in checks.mjs (Plan #810,
  // E4): Eine Ausgabe, die ihr Scheitern selbst ausweist, ist kein Messstand —
  // ein darin gefundener Anteil bescheinigte eine Messung, die es nicht gab.
  // Die Meldung nennt das Merkmal, denn die letzten Zeilen der Ausgabe sind
  // alles, was Protokoll und Sichtung am Morgen vom Befund zu sehen bekommen.
  const merkmal = fehlermerkmal(ausgabe);
  if (merkmal !== null) {
    return { bestanden: false, zeilen: `Fehlermerkmal in der Ausgabe: '${merkmal}' — der Lauf gilt als rot\n` };
  }

  // Die Guetemessung wird nur nach einem gruenen Kommando gewertet, aus demselben
  // Grund wie in checks.mjs: Die Ausgabe eines Abbruchs ist der Stand eines Abbruchs,
  // und ein darin zufaellig gefundener Anteil bescheinigte eine Messung, die es nicht
  // gab. Die verfehlte Marke steht in der Ausgabe, denn die letzten Zeilen sind alles,
  // was Protokoll und Salvage-Prompt vom Befund zu sehen bekommen.
  //
  // Seit Plan #944, E14 erreicht `runBuildChecksSync` kein Eintrag mit `guete` mehr:
  // `paketstufenChecks` laesst ihn als Teil des Abschlussumfangs aus. Der Zweig bleibt,
  // weil er die einzige Stelle ist, die `gueteAuswerten` hier ueberhaupt anwendet — und
  // `gueteAuswerten` bleibt, weil test/guete-wertung-sync.test.mjs sie an die Fassung in
  // checks.mjs bindet. Wer den Umfang je wieder weitet, hat die Wertung schon.
  const guete = typeof eintrag === "string" ? undefined : eintrag.guete;
  if (!guete) return { bestanden: true, zeilen: "" };

  const auswertung = gueteAuswerten(guete, ausgabe);
  const zeilen = auswertung.anteil === null
    ? `Guete: kein auswertbares Ergebnis (${auswertung.grund})\n`
    : `Guete: ${auswertung.anteil} % erreicht, Marke ${guete.marke} % — ${auswertung.grund}\n`;
  return { bestanden: auswertung.erfuellt, zeilen };
}

export function runBuildChecksSync(cfg) {
  const env = checkEnv();
  let output = "";
  for (const eintrag of paketstufenChecks(cfg)) {
    const cmd = typeof eintrag === "string" ? eintrag : eintrag.cmd;
    pulsSchreiben();
    const res = konfigKommandoSync(cmd, env);
    pulsSchreiben();
    const ausgabe = `${res.stdout || ""}${res.stderr || ""}`;
    output += `$ ${cmd}\n${ausgabe}`;

    const { bestanden, zeilen } = bewerteLaufSync(eintrag, res.status === 0, ausgabe);
    output += zeilen;
    // Das rote Kommando namentlich (Issue #668): Ohne es nennt die Stopp-Meldung nur,
    // DASS die Checks rot waren. Im Protokoll zu #900 fehlte deshalb jede Spur davon,
    // welcher der vier Checks versagt hat — und die Ursache liess sich nicht pruefen.
    if (!bestanden) return { ok: false, output, rotesKommando: cmd };
  }
  return { ok: true, output, rotesKommando: null };
}

// Die Ausgabe eines Pruefkommandos kann sehr lang werden (ein `mvn verify` mit
// Testausgaben), und hier faellt die aller faelligen Kommandos in EINEM Kindprozess an.
// Laeuft der Puffer ueber, toetet Node den Prozess mit ENOBUFS — die Vorpruefung saehe
// rot, wo nichts rot war, und die Rettung fiele aus. Derselbe grosszuegige Wert wie
// beim Board (BOARD_MAX_BUFFER) und aus demselben Grund.
const CHECKS_MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Die Pflicht-Pruefungen ueber `checks.mjs run` des Zielprojekts (Issue #919).
 *
 * WARUM nicht mehr direkt (`runBuildChecksSync`), obwohl derselbe Umfang herauskaeme:
 * Der Runner mass gruen an einer Stelle, die das Commit-Gate nicht liest. Beobachtet in
 * kanban-kit am 2026-09-24: Die Session lief rot, der Runner fuhr die buildChecks danach
 * selbst und fand sie gruen, und die Salvage-Session konnte trotzdem nicht committen —
 * in `.claude/checks-summary.json` stand noch das rote Ergebnis der Session, die
 * Blob-Hashes darin passten exakt zum Baum. In dieser Lage kann die Rettung nie
 * gelingen. `checks.mjs run` schreibt denselben Nachweis, den `.githooks/gate.mjs`
 * liest; damit gibt es eine Wahrheit ueber "gruen" statt zweier.
 *
 * `--frisch` ist Pflicht und keine Bequemlichkeit: Ohne den Schalter uebernaehme das
 * Kommando das Ergebnis der Session, wenn sich seither nichts geaendert hat — also
 * genau ihr rotes, das der Runner gerade anzweifelt.
 *
 * `--abschluss <karte>` haelt den Umfang, den die Vorpruefung immer hatte: die
 * Paketstufe ohne `nichtBeimAbschluss` und ohne Guetemessung (Plan #944, E14). Der
 * Salvage IST der Abschluss dieser Karte — ohne die Nummer koennte die Wirksamkeit
 * ihre Kennzahl je Karte nicht rechnen (Issue #951).
 *
 * Das rote Kommando kommt aus dem Nachweis und nicht aus der Ausgabe: Die Datei sagt
 * es als Feld, ein Textmuster ueber der Ausgabe waere ein zweiter Rechenweg.
 */
function runChecksCliSync(karte) {
  if (!existsSync(CHECKS_PATH)) {
    return { ok: false, output: `${CHECKS_PATH} liegt nicht vor — die Pflicht-Pruefungen lassen sich nicht fahren.\n`, rotesKommando: null };
  }
  const cliArgs = [CHECKS_PATH, "run", "--abschluss", String(karte), "--frisch"];
  // Der Puls davor und danach (Issue #1084, E6): Der volle Pruefumfang blockiert den Takt.
  pulsSchreiben();
  const res = spawnSync(process.execPath, cliArgs, {
    cwd: process.cwd(), encoding: "utf-8", env: checkEnv(), maxBuffer: CHECKS_MAX_BUFFER,
  });
  pulsSchreiben();
  const output = `$ node ${cliArgs.join(" ")}\n${res.stdout || ""}${res.stderr || ""}`;
  if (res.status === 0) return { ok: true, output, rotesKommando: null };
  const nachweis = lesePruefung(karte);
  return { ok: false, output, rotesKommando: nachweis.rotesKommando ?? null };
}

// Vorpruefung fuer den Salvage inklusive einmaligem Format-Fix (Issue #169).
//
// Ein reiner Formatverstoss ist mechanisch und deterministisch behebbar und sagt
// nichts ueber die fachliche Qualitaet der Arbeit — er darf keinen Lauf beenden,
// in dem noch zwanzig Issues warten (beobachtet bei kanban-kit#463: ein einzelner
// Javadoc-Zeilenumbruch). Ist formatFixCommand gesetzt und sind die Checks rot,
// laeuft das Kommando genau einmal und die Checks werden genau einmal wiederholt.
// Bleiben sie rot, war das Format nicht die Ursache -> harter Stopp wie bisher.
// Ohne formatFixCommand ist das Verhalten exakt wie vor #169.
//
// Beide Durchgaenge gehen ueber `checks.mjs run --frisch` (Issue #919): Der zweite ist
// der, dessen Nachweis am Ende liegenbleibt — er muss den Stand NACH dem Format-Fix
// bezeugen, sonst wiese das Gate die Rettung wegen der geaenderten Blobs ab.
export function verifyChecksForSalvage(cfg, karte) {
  const first = runChecksCliSync(karte);
  if (first.ok) return { ok: true, output: first.output, formatFixCmd: null, rotesKommando: null };

  const fixCmd = (cfg.formatFixCommand || "").trim();
  if (!fixCmd) return { ok: false, output: first.output, formatFixCmd: null, rotesKommando: first.rotesKommando };

  log(`  buildChecks rot — einmaliger Format-Fix wird angewendet: ${fixCmd}`);
  // fixCmd kommt aus der Config und braucht deshalb eine Shell (Issue #199), unter Windows
  // die Git Bash (Issue #1176). Startet sie nicht, steht das im Log, und der zweite
  // Durchgang bleibt rot.
  const fix = konfigKommandoSync(fixCmd, checkEnv());
  if (fix.status === null && fix.stderr) log(`  Format-Fix nicht gestartet: ${fix.stderr.trim()}`);

  const second = runChecksCliSync(karte);
  if (!second.ok) return { ok: false, output: second.output, formatFixCmd: null, rotesKommando: second.rotesKommando };
  log(`  FORMAT-FIX angewendet, buildChecks jetzt gruen — der Lauf geht weiter.`);
  return { ok: true, output: second.output, formatFixCmd: fixCmd, rotesKommando: null };
}

// Baut den Prompt der Salvage-Session. Kernpunkt: die Checks sind bereits extern
// gruen — die Session darf sie NICHT erneut starten, sonst laeuft sie in genau
// den Hintergrund-Check, der die Runde ueberhaupt erst gekostet hat.
//
// Zweiter Kernpunkt seit Issue #672: Der Board-Zug steht HINTER der Sauberkeits-
// pruefung, nicht daneben. Bis dahin liess Schritt 3 committen, verschieben und
// kommentieren in einem Zug — und im Nachtlauf vom 2026-08-05 (kanban-kit) stand die
// Karte danach in In review, waehrend Arbeit im Baum lag. Das Board meldete Erfolg,
// der Lauf meldete Fehlschlag, und auf main lag ein roter Stand. Wer nicht committen
// kann, soll die Karte gar nicht erst bewegen.
export function salvagePrompt(issueId, checksOutput, formatFixCmd) {
  const tail = (checksOutput || "").trim().split("\n").slice(-15).join("\n");
  return [
    `Die Pflicht-Checks (buildChecks) dieses Projekts wurden soeben EXTERN ausgefuehrt und sind GRUEN.`,
    `Gefahren wurden sie mit "node .claude/kit/checks.mjs run --abschluss ${issueId} --frisch"; der Nachweis`,
    `liegt in .claude/checks-summary.json, und das Commit-Gate liest genau ihn.`,
    `Fuehre sie NICHT erneut aus und starte keine langen Builds.`,
    ``,
    `Im Working Tree liegen unkommittete Aenderungen zu Issue #${issueId}. Deine einzige Aufgabe:`,
    `1. Lies das Issue: node .claude/kit/board.mjs issue get ${issueId}`,
    `2. Sieh dir den Stand an: git status und git diff`,
    `3. Passt der Stand zum Issue, arbeite GENAU DIESE REIHENFOLGE ab:`,
    `   a) Committe ihn (Betreff mit "(Issue #${issueId})", im Body "Refs #${issueId}"`,
    `      — niemals Closes/Fixes/Resolves).`,
    `   b) Pruefe danach den Arbeitsbaum mit GENAU diesem Kommando — es laesst dieselben`,
    `      Laufzeit-Dateien aus, die auch der Runner nicht als Rest wertet (ein nacktes`,
    `      git status --porcelain urteilte strenger als er und verhinderte die Rettung):`,
    `      ${salvageSauberkeitsKommando()}`,
    `   c) NUR wenn diese Ausgabe leer ist, bewege das Board und kommentiere:`,
    `      node .claude/kit/board.mjs issue move ${issueId} in_review`,
    `      node .claude/kit/board.mjs issue comment ${issueId} --text "..."`,
    `   d) Ist die Ausgabe NICHT leer, bleibt das Board unberuehrt: nicht verschieben,`,
    `      nicht kommentieren, sondern die liegengebliebenen Pfade in deiner Ausgabe benennen.`,
    `4. Passt der Stand nicht zum Issue oder wirkt unvollstaendig: NICHT committen,`,
    `   nichts am Board bewegen, und klar benennen was fehlt.`,
    // Ohne diesen Hinweis blieben die Formatierungsaenderungen unkommittiert liegen
    // und der Rest-Guard (#152) wertete die geglueckte Runde doch noch als Fehlschlag.
    ...(formatFixCmd ? [
      ``,
      `WICHTIG: Die Checks waren zunaechst rot; danach lief automatisch das Format-Kommando`,
      `"${formatFixCmd}" und erst dann wurden sie gruen. Die dadurch entstandenen`,
      `Formatierungsaenderungen gehoeren MIT in denselben Commit und in den Abschlussbericht.`,
    ] : []),
    ``,
    // Woher die Zeilen stammen, steht dabei (Issue #919): Im Vorfall vom 2026-09-24
    // zitierte der Prompt die Ausgabe eines EINZELNEN Kommandos, das der Abschluss des
    // Pakets gar nicht faehrt — die Session hielt die Gruen-Annahme darum zu Recht fuer
    // falsch und verweigerte den Commit. Jetzt ist es die Ausgabe desselben Laufs, der
    // den Nachweis geschrieben hat, samt seiner Auslassungen.
    `Nicht pushen. Letzte Zeilen der externen Check-Ausgabe (checks.mjs run --abschluss ${issueId} --frisch):`,
    tail,
  ].join("\n");
}

// --- Das Modell des Laufs (Issue #994) ---

/**
 * Bestimmt das Modell des Laufs: `--model` vor `night.modell` vor `DEFAULT_MODEL`.
 *
 * Es gilt fuer jede Session ohne eigenes Modell — die Stufen Plan, Review und Abdeckung
 * der Kette, die Korrekturrunden und jedes Paket ohne `Aufgabenstufe:`. Frueher stand es
 * fest im Code, und ein Projekt, das ueberall `claude-opus-5-5` eingetragen hatte, fuhr
 * diese Sessions trotzdem mit der Vorgabe.
 *
 * `night.modell` muss in `night.modelle` stehen wie jede Modellangabe der Config. Sonst
 * kommt ein Fehler zurueck statt eines stillen Rueckfalls auf die Vorgabe: Dann liefe
 * wieder ein Modell, das niemand gewaehlt hat. `--model` bleibt ungeprueft wie bisher —
 * der Aufruf von Hand ist eine bewusste Wahl des Menschen.
 *
 * `config` ist die gemischte Config; `night` steht nicht in der Allowlist, ein lokaler
 * Wert ist hier also schon verworfen und gemeldet.
 */
export function laufModell(args, config) {
  if (args.modelGesetzt) return { modell: args.model, herkunft: "--model", fehler: null };
  const wert = config?.night?.modell;
  if (wert === undefined || wert === null || wert === "") return { modell: DEFAULT_MODEL, herkunft: "Vorgabe", fehler: null };
  const erlaubt = Array.isArray(config.night.modelle) ? config.night.modelle : [];
  if (!erlaubt.includes(wert)) {
    return { modell: null, herkunft: "night.modell", fehler: `night.modell '${wert}' steht nicht in night.modelle — bitte dort eintragen oder night.modell aendern.` };
  }
  return { modell: wert, herkunft: "night.modell", fehler: null };
}

// --- Budgets der Nacht-Kette (Plan #638, A6; night.kette) ---

// Startwerte aus Fachplan #635, Kriterium 6. Alle Zeiten in Minuten, Kosten in US-Dollar.
export const KETTE_BUDGET_DEFAULTS = Object.freeze({
  label: "kit:night",
  varianteBLabel: "kit:durchziehen",
  planMin: 20,
  paketeMin: 15,
  reviewMin: 15,
  abdeckungMin: 10,
  umsetzungMin: 120,
  kostenUsd: 50,
  kostenUsdB: 150,
  korrekturrunden: 2,
});

/**
 * Liest `night.kette` aus der Config und prueft jede Zahl.
 *
 * Wirft einen Error mit dem Feldnamen statt `fail` zu rufen: Die Funktion ist rein und
 * an Fixtures pruefbar; die Kette macht aus dem Wurf den Abbruch vor der ersten Session.
 * Eine Zahl muss endlich und groesser 0 sein, `korrekturrunden` dazu ganzzahlig — ein
 * Budget von 0 waere eine Kette, die nie startet, und niemand saehe morgens, warum.
 */
export function ladeKetteBudget(config) {
  const block = config?.night?.kette ?? {};
  const budget = { ...KETTE_BUDGET_DEFAULTS };
  if (block.label !== undefined) {
    if (typeof block.label !== "string" || block.label.trim() === "") throw new Error("night.kette.label muss ein nicht leerer Text sein");
    budget.label = block.label.trim();
  }
  if (block.varianteBLabel !== undefined) {
    if (typeof block.varianteBLabel !== "string" || block.varianteBLabel.trim() === "") throw new Error("night.kette.varianteBLabel muss ein nicht leerer Text sein");
    budget.varianteBLabel = block.varianteBLabel.trim();
  }
  for (const feld of ["planMin", "paketeMin", "reviewMin", "abdeckungMin", "umsetzungMin", "kostenUsd", "kostenUsdB", "korrekturrunden"]) {
    if (block[feld] === undefined) continue;
    const wert = block[feld];
    if (typeof wert !== "number" || !Number.isFinite(wert) || wert <= 0) {
      throw new Error(`night.kette.${feld} muss eine Zahl groesser 0 sein, ist ${JSON.stringify(wert)}`);
    }
    if (feld === "korrekturrunden" && !Number.isInteger(wert)) {
      throw new Error(`night.kette.korrekturrunden muss ganzzahlig sein, ist ${wert}`);
    }
    budget[feld] = wert;
  }
  return budget;
}

// Welche Uebergaenge der Kette automatisch folgen (Plan #1079, E12; Issue #1087). Die
// ersten drei folgen nach Vorgabe. Der in die Umsetzung hat keine: `null` heisst „nicht
// gesetzt“ und gilt wie vor #1087 — Variante A endet nach der Abdeckung, Variante B setzt
// um (Issue #1105). Erst ein gesetzter Wert wirkt, und auch freigegeben nur zusammen mit
// dem Variante-B-Label an der Karte.
export const KETTE_UEBERGAENGE_DEFAULTS = Object.freeze({
  planReview: true,
  reviewPakete: true,
  paketeAbdeckung: true,
  abdeckungUmsetzung: null,
});

/**
 * Liest `night.kette.uebergaenge` — vier Wahrheitswerte, fehlende aus der Vorgabe
 * (`abdeckungUmsetzung` fehlend: `null`).
 *
 * Wirft wie `ladeKetteBudget` mit dem Feldnamen; ein unbekannter Schalter ist ebenso ein
 * Fehler, weil ein vertippter Name sonst still die Vorgabe liesse.
 */
export function ladeKetteUebergaenge(config) {
  const block = config?.night?.kette?.uebergaenge;
  const uebergaenge = { ...KETTE_UEBERGAENGE_DEFAULTS };
  if (block === undefined) return uebergaenge;
  if (block === null || typeof block !== "object" || Array.isArray(block)) throw new Error("night.kette.uebergaenge muss ein Objekt mit Wahrheitswerten sein");
  for (const [feld, wert] of Object.entries(block)) {
    if (!Object.hasOwn(KETTE_UEBERGAENGE_DEFAULTS, feld)) throw new Error(`night.kette.uebergaenge.${feld} ist kein Uebergang der Kette (bekannt: ${Object.keys(KETTE_UEBERGAENGE_DEFAULTS).join(", ")})`);
    if (typeof wert !== "boolean") throw new Error(`night.kette.uebergaenge.${feld} muss true oder false sein, ist ${JSON.stringify(wert)}`);
    uebergaenge[feld] = wert;
  }
  return uebergaenge;
}

/**
 * Die Budget-Felder, die nicht in `night.kette` stehen und deshalb aus den Defaults
 * kommen (Issue #659), in der Reihenfolge von `ladeKetteBudget`.
 *
 * Eigene Funktion statt einer zweiten Rueckgabe von `ladeKetteBudget`: Deren Ergebnis ist
 * exportiert und an Fixtures getestet, die Herkunft ist eine andere Frage.
 */
export function ketteBudgetDefaults(config) {
  const block = config?.night?.kette ?? {};
  return Object.keys(KETTE_BUDGET_DEFAULTS).filter((feld) => block[feld] === undefined);
}

// --- Budgets des Prueflaufs (Plan #904, E12; Wurzelblock pruefLauf, Issue #905) ---

// Startwerte aus Plan #904. Der Block steht in der WURZEL der Config und nicht unter
// `night`: Der Lauf gehoert dem Tag, und unter `night` behauptete der Name das Gegenteil.
export const PRUEFLAUF_BUDGET_DEFAULTS = Object.freeze({
  label: "kit:pruefen",
  pruefungMin: 25,
  kostenUsd: 25,
});

/**
 * Liest `pruefLauf` aus der Config und prueft jede Zahl.
 *
 * Zwillingsfunktion zu `ladeKetteBudget` und mit derselben Begruendung fuer den Wurf statt
 * `fail`: Die Funktion ist rein und an Fixtures pruefbar; der Lauf macht aus dem Wurf den
 * Abbruch vor der ersten Session. Ein Zeitbudget von 0 liesse jede Session sofort ablaufen,
 * ein Kostenbudget von 0 keinen Lauf beginnen — beides ohne erkennbaren Grund am Morgen.
 */
export function ladePruefLaufBudget(config) {
  const block = config?.pruefLauf ?? {};
  const budget = { ...PRUEFLAUF_BUDGET_DEFAULTS };
  if (block.label !== undefined) {
    if (typeof block.label !== "string" || block.label.trim() === "") throw new Error("pruefLauf.label muss ein nicht leerer Text sein");
    budget.label = block.label.trim();
  }
  for (const feld of ["pruefungMin", "kostenUsd"]) {
    if (block[feld] === undefined) continue;
    const wert = block[feld];
    if (typeof wert !== "number" || !Number.isFinite(wert) || wert <= 0) {
      throw new Error(`pruefLauf.${feld} muss eine Zahl groesser 0 sein, ist ${JSON.stringify(wert)}`);
    }
    budget[feld] = wert;
  }
  return budget;
}

/**
 * Die Budget-Felder, die nicht in `pruefLauf` stehen und deshalb aus den Defaults kommen,
 * in der Reihenfolge von `ladePruefLaufBudget` — wie `ketteBudgetDefaults`.
 */
export function pruefLaufBudgetDefaults(config) {
  const block = config?.pruefLauf ?? {};
  return Object.keys(PRUEFLAUF_BUDGET_DEFAULTS).filter((feld) => block[feld] === undefined);
}

/**
 * Die Variante einer Kette fuer eine Karte (Plan #691, E2/E3): "B", wenn die Karte
 * das Label aus `budget.varianteBLabel` traegt, sonst "A". Reine Funktion, nie ein
 * Wurf — die Variante ist eine Einordnung, kein Vorflug: eine Karte ohne `labels`,
 * ein leeres Label-Array und ein fehlendes `budget` ergeben alle "A".
 */
export function varianteVon(issue, budget) {
  const label = budget?.varianteBLabel;
  if (!label) return "A";
  return (issue?.labels || []).includes(label) ? "B" : "A";
}

// --- Reviewer-Vorflug in einer Session (Issue #269) ---
//
// Warum nicht `board.mjs issue-review check`: Dieser Probelauf laeuft im Runner-Prozess
// und beweist damit nur, dass der RUNNER das Werkzeug starten darf. Gebraucht wird es
// aber in den Review-Sessions — eigene Kindprozesse mit eigener Sandbox, eigener
// Netzwerk-Allowlist und eigenen Freigaben. In der Nacht vom 2026-08-08 lief der Vorflug
// sauber durch, waehrend `codex exec` in der Session an "Run outside of the sandbox"
// scheiterte und `board.mjs issue get` an der leeren Netzwerk-Allowlist: ein Lauf, der
// vollbesetzt startete und mit einem Reviewer arbeitete — genau der Zustand, den der
// harte Stopp aus Issue #233 verhindern soll.
//
// Und warum die Vorflug-Session `board.mjs issue-review check` nicht einfach erneut
// aufrufen darf: In `.claude/settings.json` steht `node .claude/kit/board.mjs*` in
// `sandbox.excludedCommands`. Jeder Aufruf von board.mjs ist damit von der Sandbox
// ausgenommen — gleich von wo. Eine Session, die darueber probt, meldete zuverlaessig
// `verfuegbar: true` und saegte damit denselben Ast an, nur eine Ebene tiefer und
// schwerer zu erkennen. Die Session startet das Reviewer-Kommando deshalb selbst,
// direkt und mit dem Prompt ueber stdin — so, wie es die Review-Rolle spaeter auch tut.
//
// Eine Ausnahme davon (Issue #986): Den Probe-Prompt bekommt das Kommando als Argument,
// nicht ueber stdin. Seit Claude Code 2.1.277 nimmt `sandbox.excludedCommands` einen
// zusammengesetzten Befehl nur noch aus der Sandbox, wenn JEDER Teil zu einem Eintrag
// passt. `codex *` steht dort, `printf` nicht: Die fruehere Pipe `printf … | <command>` lief
// ganz in der Sandbox, codex scheiterte, und der Vorflug meldete Reviewer als fehlend,
// deren echte Reviews laengst liefen. Eine Umleitung `<command> < <datei>` hebt die
// Ausnahme ebenso auf (gemessen unter 2.1.283). Nur die Zeile ohne Pipe und ohne
// Umleitung laesst den Eintrag des Reviewers allein greifen.

// Modell und Zeitlimit der Vorflug-Session sind bewusst unabhaengig von --model und
// --timeout-min. Wuerde der Vorflug beides erben, kostete jedes `--review --dry-run` eine
// volle Session im Modell des Laufs, nur um "alles steht" zu melden — und der Trockenlauf
// verlore genau die Eigenschaft, wegen der man ihn faehrt: billig und schnell zu sein.
export const VORFLUG_MODEL = "haiku";
const VORFLUG_TIMEOUT_MS = 5 * 60 * 1000;

// Marker um den Befund. Ein Modell schreibt neben dem Befund immer auch Prosa; die Marker
// trennen die eine maschinenlesbare Stelle davon ab, statt raten zu muessen, welches
// JSON-Fragment im Fliesstext gemeint war.
const VORFLUG_START = "<<<VORFLUG";
const VORFLUG_ENDE = "VORFLUG>>>";

// Ein Prompt, der nichts verlangt (wie in board.mjs): Die Probe soll feststellen, ob der
// Reviewer laeuft — nicht, was er kann. Er steht als letztes Argument an der Zeile.
const VORFLUG_PROBE_PROMPT = "Antworte nur mit dem Wort OK.";

// Der Stempel, an dem der Gate-Code erkennt, dass ein Befund aus der richtigen Umgebung
// stammt. board.mjs stempelt seine Befunde mit "runner"; ein dort gestarteter Prozess kann
// diesen Wert nie erzeugen.
const UMGEBUNG_SESSION = "review-session";

/**
 * Waehlt das Issue der Tracker-Probe — deterministisch, nicht "irgendeines".
 *
 * Erste Wahl ist der erste Kandidat des Laufs: genau das Issue, an dem die erste
 * Review-Session scheitern wuerde. Ohne Kandidaten faellt die Wahl auf das erste Issue der
 * Gesamtliste. Liefert der Tracker gar keines, gibt es nichts zu holen (null) — die Probe
 * beschraenkt sich dann auf `issue list`.
 */
export function trackerProbeId(kandidaten, alleIssues) {
  const erstes = (kandidaten || [])[0] || (alleIssues || [])[0];
  return erstes ? String(erstes.id) : null;
}

/** Baut den Auftrag der Vorflug-Session. */
export function vorflugPrompt(kommandoReviewers, trackerId) {
  // Die zulaessigen Werte fuer "name" stehen zur Bauzeit des Prompts fest — das Modell
  // soll sie nicht aus dem Kommandostring ableiten muessen (Issue #409).
  const erlaubteNamen = kommandoReviewers.map((r) => JSON.stringify(String(r.name))).join(", ");
  const zeilen = [
    `Du bist der technische Vorflug eines Nacht-Reviews. Fuehre genau die Schritte unten aus`,
    `und gib zum Schluss genau einen Befund-Block aus.`,
    `Aendere dabei NICHTS: kein Commit, kein Board-Zug, keine neue Datei, keine Aenderung an`,
    `vorhandenen Dateien.`,
    ``,
    `SCHRITT 1 — Reviewer-Kommandos`,
  ];
  if (kommandoReviewers.length === 0) {
    zeilen.push(
      `Es ist kein Reviewer vom Typ "command" konfiguriert. Schritt 1 entfaellt; "reviewers"`,
      `bleibt im Befund eine leere Liste.`,
    );
  } else {
    zeilen.push(
      `Starte jedes dieser Kommandos GENAU EINMAL ueber das Bash-Tool, genau so wie es dasteht,`,
      `mit dem Prompt als letztem Argument. Baue die Zeile nicht um — keine Pipe, keine Umleitung:`,
      ``,
      ...kommandoReviewers.map((r) => `  ${r.command} '${VORFLUG_PROBE_PROMPT}'   # Reviewer-Name fuer den Befund: ${r.name}`),
      ``,
      `Rufe dafuer AUF KEINEN FALL "board.mjs issue-review check" auf. Dieser Pfad ist von der`,
      `Sandbox ausgenommen und wuerde eine andere Umgebung messen als die, um die es hier geht.`,
      // Woran die Session den Exit-Code erkennt, steht ausdruecklich da (Issue #1107): Ohne
      // diese Angabe riet eine Vorflug-Session aus Warnzeilen auf "nicht verfuegbar".
      `Einen Exit-Code ungleich 0 meldet das Bash-Tool als Zeile \`Exit code N\` am Kopf des`,
      `Ergebnisses. Fehlt diese Zeile, war der Exit-Code 0.`,
      `Warnzeilen, Hinweise und Meldungen in eckigen Klammern (etwa \`[claude-code:unrecognized_model]\`)`,
      `sind kein Fehler und kippen das Urteil nicht.`,
      `Verfuegbar ist ein Reviewer bei Exit-Code 0, wenn seine Ausgabe eine Zeile \`OK\` enthaelt.`,
      `Startfehler, Abbruch, Zeitueberschreitung, Exit-Code ungleich 0 oder eine fehlende \`OK\`-Zeile ergeben "verfuegbar": false;`,
      `als "grund" die letzte Fehlerzeile, bei fehlender \`OK\`-Zeile "keine Antwort OK".`,
    );
  }
  zeilen.push(
    ``,
    `SCHRITT 2 — Erreichbarkeit des Trackers`,
    `Fuehre aus:`,
    `  node .claude/kit/board.mjs issue list`,
    ...(trackerId ? [`  node .claude/kit/board.mjs issue get ${trackerId}`] : []),
    trackerId
      ? `Beide muessen mit Exit-Code 0 und auswertbarem JSON enden, sonst ist der Tracker nicht erreichbar.`
      : `Der Tracker fuehrt derzeit kein Issue. Setze "geprueft" auf "issue list" und zusaetzlich`
        + ` "uebersprungen" auf "kein Issue vorhanden"; "erreichbar" ist true, sofern "issue list" mit Exit-Code 0 endete.`,
    `Exit-Code 0 heisst wie in Schritt 1: keine \`Exit code\`-Zeile am Kopf des Ergebnisses. Warnzeilen sind kein Fehler.`,
    `Dieser Befund ist eigenstaendig — vermische ihn nicht mit der Reviewer-Verfuegbarkeit.`,
    ``,
    `SCHRITT 3 — Befund`,
    // Der Name entscheidet, ob der Befund ankommt: Der Runner gleicht ueber den
    // Reviewer-Namen aus der Config ab. Wird stattdessen der Modellname aus der
    // Kommandozeile gemeldet, findet er keinen Treffer und traegt fuer einen
    // verfuegbaren Reviewer "nichts gemeldet" ein — der Lauf bricht ab, obwohl
    // nichts fehlt (Issue #409).
    ...(kommandoReviewers.length === 0
      ? []
      : [
        `"name" ist WOERTLICH der Reviewer-Name aus dem Kommentar "# Reviewer-Name fuer den Befund:"`,
        `am Ende der jeweiligen Zeile in Schritt 1 — gib dort AUF KEINEN FALL den Modellnamen aus der Kommandozeile zurueck.`,
        `Zulaessig sind genau diese Werte: ${erlaubteNamen}.`,
        ``,
      ]),
    `Gib als ALLERLETZTE Ausgabe genau diesen Block aus, ohne Code-Fence und ohne Text danach:`,
    ``,
    VORFLUG_START,
    `{"reviewers": [{"name": "<name>", "verfuegbar": true, "grund": ""}], "tracker": {"erreichbar": true, "geprueft": "<kommando>", "grund": ""}}`,
    VORFLUG_ENDE,
  );
  return zeilen.join("\n");
}

/** Schneidet den Befund-Block aus der Session-Ausgabe. null = nichts Auswertbares. */
export function parseVorflugBefund(stdout = "") {
  const text = stdout;
  // lastIndexOf: Erklaert das Modell seinen Befund erst und gibt ihn dann aus, gilt der
  // letzte Block — der Auftrag lautet, ihn als allerletzte Ausgabe zu schreiben.
  const start = text.lastIndexOf(VORFLUG_START);
  if (start < 0) return null;
  const ende = text.indexOf(VORFLUG_ENDE, start);
  if (ende < 0) return null;
  try {
    const roh = JSON.parse(text.slice(start + VORFLUG_START.length, ende));
    return roh && typeof roh === "object" ? roh : null;
  } catch {
    return null;
  }
}

/**
 * Bringt den gemeldeten Befund in die Form, gegen die das Gate prueft.
 *
 * Der Stempel `umgebung` kommt vom Runner, nicht aus der Meldung: Er sagt aus, WO geprueft
 * wurde, und das weiss der Runner sicher — er hat die Session selbst gestartet. Aus der
 * Meldung uebernommen waere er eine Behauptung des Geprueften ueber sich selbst.
 *
 * Streng in beide Richtungen: Nur ein ausdrueckliches `verfuegbar: true` zaehlt, und ein
 * Reviewer, zu dem die Session nichts gemeldet hat, gilt als nicht verfuegbar. Ein
 * Schweigen als Zustimmung zu lesen waere genau der Fehlschluss, den dieses Issue behebt.
 */
export function normalisiereVorflug(roh, reviewers) {
  const gemeldet = new Map(
    (roh?.reviewers || []).filter((r) => r?.name).map((r) => [String(r.name), r]),
  );
  const befunde = (reviewers || []).map((r) => {
    const basis = { name: r.name, kind: r.kind, umgebung: UMGEBUNG_SESSION };
    // claude-Reviewer laufen als Unterauftrag derselben Session-Art — dass eine
    // Vorflug-Session ueberhaupt geantwortet hat, ist ihr Verfuegbarkeitsnachweis.
    if (r.kind !== "command") return { ...basis, verfuegbar: true };
    const meldung = gemeldet.get(r.name);
    if (!meldung) {
      return { ...basis, verfuegbar: false, grund: "die Vorflug-Session hat zu diesem Reviewer nichts gemeldet" };
    }
    if (meldung.verfuegbar === true) return { ...basis, verfuegbar: true };
    return { ...basis, verfuegbar: false, grund: String(meldung.grund || "").trim() || "ohne Grund als nicht verfuegbar gemeldet" };
  });

  const t = roh?.tracker || {};
  const erreichbar = t.erreichbar === true;
  const tracker = {
    erreichbar,
    umgebung: UMGEBUNG_SESSION,
    geprueft: t.geprueft ? String(t.geprueft) : null,
    ...(t.uebersprungen ? { uebersprungen: String(t.uebersprungen) } : {}),
    ...(erreichbar ? {} : { grund: String(t.grund || "").trim() || "die Vorflug-Session hat keinen Tracker-Befund gemeldet" }),
  };
  return { reviewers: befunde, tracker };
}

/** Startet die Vorflug-Session — dieselbe Bauart wie eine Review-Session (runProcess). */
async function runVorflugSession(args, prompt) {
  const testCmd = process.env.NIGHT_VORFLUG_CMD;
  let cmd, cmdArgs, umgebung, gitBash, startfehler;
  if (testCmd) {
    // Wie bei NIGHT_CLAUDE_CMD ueber `posixShell()`: Dieser Zweig ist ausschliesslich der
    // Test-Hook, und die Fake-Skripte der Testsuite sind POSIX-Shell — unter Windows startet
    // sie die Git Bash (Issue #1131).
    const shell = posixShell();
    ({ pfad: cmd, umgebung, gitBash, fehler: startfehler } = shell);
    cmdArgs = ["-c", testCmd];
  } else {
    const permArgs = permissionArgs(args.yolo);
    // Der Start von `claude` folgt derselben Regel wie in der Runde (Issue #1131, E8).
    const start = startbefehlFuer("claude");
    ({ befehl: cmd, umgebung, gitBash, fehler: startfehler } = start);
    // stream-json seit Issue #669: Nur so meldet die Vorflug-Session ihren Verbrauch, und
    // sie ist die Session ohne Karte, deren Mengen den Rest des Laufs ausmachen. Der
    // Befund-Block steht dann im Text des result-Ereignisses (siehe reviewerVorflug).
    cmdArgs = [...start.vorArgs, "-p", prompt, "--model", VORFLUG_MODEL, "--output-format", "stream-json", "--verbose", ...permArgs];
  }
  const timeoutMs = process.env.NIGHT_VORFLUG_TIMEOUT_MS
    ? Number(process.env.NIGHT_VORFLUG_TIMEOUT_MS)
    : VORFLUG_TIMEOUT_MS;
  const gestartet = Date.now();
  const res = startfehler ? keinStart(startfehler) : await runProcess(cmd, cmdArgs, {
    issueId: "vorflug", timeoutMs, useStream: false, gitBash,
    extraEnv: { ...umgebung, NIGHT_PROMPT: prompt, KIT_AGENT_MODEL: VORFLUG_MODEL, NIGHT_VORFLUG: "1", ...laufKennungUmgebung() },
  });
  if (ZUSTAND.LOG_FILE) {
    appendFileSync(ZUSTAND.LOG_FILE, `--- Vorflug-Session ---\n${res.stdout || ""}${res.stderr || ""}\n`, "utf-8");
  }
  const kennzahlen = leseKennzahlen(res.stdout);
  verbrauchErfassen(null, kennzahlen);
  // issueId null: die Vorflug-Session gehoert zu keiner Karte, zeitenErfassen schreibt
  // darum nichts (derselbe Aufruf wie verbrauchErfassen, Issue #749).
  zeitenErfassen(null, Date.now() - gestartet, kennzahlen, res.werkzeugzeit);
  return { res, timeoutMs };
}

/**
 * Faehrt den Vorflug und liefert `{ sessionStartbar, grund, reviewers, tracker }`.
 *
 * Der Fehlerpfad der Session selbst ist ein eigener Befund und kein stiller Ausfall: Kann
 * der Runner die Vorflug-Session gar nicht erzeugen oder endet sie ohne auswertbaren Block,
 * steht das als `sessionStartbar: false` da. Ohne diesen Fall haette der Vorflug bei einem
 * kaputten Session-Start gar nichts zu sagen — und Schweigen liest sich am Ende wie ein OK.
 */
export async function reviewerVorflug(args, reviewers, trackerId) {
  const kommandos = reviewers.filter((r) => r.kind === "command");
  const { res, timeoutMs } = await runVorflugSession(args, vorflugPrompt(kommandos, trackerId));

  const gescheitert = (grund) => ({
    sessionStartbar: false,
    grund,
    reviewers: reviewers.map((r) => ({ name: r.name, kind: r.kind, umgebung: UMGEBUNG_SESSION, verfuegbar: false, grund })),
    tracker: { erreichbar: false, umgebung: UMGEBUNG_SESSION, geprueft: null, grund },
  });

  if (res.error?.code === "ETIMEDOUT") return gescheitert(`Zeitlimit von ${timeoutMs} ms ueberschritten`);
  if (res.error?.code === "ENOENT") {
    // Ein Startfehler vor dem Spawn traegt seinen eigenen Grund (Issue #1131): fehlende Git
    // Bash oder eine claude.cmd ohne sh-Huelle.
    return gescheitert(res.error.vorStart ? res.error.message : "claude-CLI nicht gefunden. Ist Claude Code installiert und im PATH?");
  }
  if (res.error) return gescheitert(res.error.message);

  // Im Strom steht der Befund im Text des result-Ereignisses; ohne Strom (Test-Fakes, eine
  // CLI, die das Format ignoriert) ist stdout selbst der Text.
  const roh = parseVorflugBefund(leseErgebnisText(res.stdout) ?? res.stdout);
  if (!roh) {
    return gescheitert(res.status === 0
      ? "die Vorflug-Session endete ohne auswertbaren Befund-Block"
      : `die Vorflug-Session endete mit Exit ${res.status} und ohne auswertbaren Befund-Block`);
  }
  return { sessionStartbar: true, grund: null, ...normalisiereVorflug(roh, reviewers) };
}

// --- Kommentare einer Session (Issue #310) ---

// Wie der lokale Tracker einen Kommentar an den Body anhaengt (board.mjs,
// commentIssue). Die Kopplung ist bewusst und eng begrenzt: Nur mit ihr laesst sich
// der neu angehaengte Abschnitt wieder in einzelne Kommentare zerlegen, und nur
// einzelne Kommentare haben eine "erste Zeile".
export const LOKALER_KOMMENTARKOPF = /\n\n---\n\*\*Kommentar\*\* \([^\n)]*\)\n\n/;

/**
 * Die Kommentare, die WAEHREND dieser Session hinzugekommen sind (Issue #310).
 *
 * Zwei Speicherformen, ein Ergebnis: GitHub, GitLab und Toolbox liefern ein
 * `comments`-Array, der lokale Tracker haengt Kommentare an den Body. Dieselbe
 * Zweiteilung, die `issueSpur` schon beruecksichtigt.
 *
 * Gewertet wird nur das Neue. Ein Body-Vorschlag aus einem frueheren Lauf ist kein
 * Ergebnis dieser Session — er wuerde das Gate sonst dauerhaft offen halten, gerade
 * bei den Issues, die schon einmal durch einen Review gegangen sind.
 */
export function neueKommentare(vorher, nachher) {
  if (Array.isArray(nachher?.comments) || Array.isArray(vorher?.comments)) {
    const alt = (vorher?.comments || []).length;
    return (nachher?.comments || []).slice(alt).map((k) => String(k?.body ?? ""));
  }

  const altBody = vorher?.body || "";
  const neuBody = nachher?.body || "";
  // Kein Praefix heisst: Der Body selbst wurde geaendert. Dann ist der Anhang nicht
  // mehr sauber abzugrenzen — und der Marker-Zweig hat ohnehin schon entschieden.
  if (!neuBody.startsWith(altBody) || neuBody.length === altBody.length) return [];
  return neuBody
    .slice(altBody.length)
    .split(LOKALER_KOMMENTARKOPF)
    .map((t) => t.trim())
    .filter(Boolean);
}

