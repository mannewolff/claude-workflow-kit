// Der Kettenlauf im selben Prozess (Issue #1233, Plan #1199, E6).
//
// `ketteImProzess` faehrt `laufeKette` aus dem Teil kit/night/kette.mjs mit injizierten
// Abhaengigkeiten `{ spawn, jetzt, schlaf, board, git }` statt des Nacht-Runners als Kindprozess:
// Das Board ist eine Attrappe ueber einer Kartenliste, git legt Worktrees als leere Ordner an,
// jede Session spielt ein Drehbuch ab, das der Test als Funktion der Stufe schreibt, und die
// Uhr steht, bis jemand sie stellt. Die Teile, die die Kette ruft (Laufstand, Abhaengigkeiten,
// Worktree, Bericht, Runde), bekommen dieselben Attrappen ueber ihre Setzer; danach gelten
// wieder die Vorgaben.
//
// Was der Einstieg vor der Kette tut, steht hier verkuerzt: Config, Lauf-Kopf und
// Ergebnisstand im Zustand, der Reviewer-Vorflug und der Abschluss des Laufs als Haken
// ueber `ketteAnbinden`. Was nur der Einstieg belegen kann — Argumente, Lock, Vorflug-Session,
// der echte Prozessbaum —, bleibt Sache der Ablauf-Pruefungen ueber `kette-ablauf.mjs`.
//
// Bewusst ohne Kindprozess und ohne Import aus `kette-ablauf.mjs`: Wer dieses Fixture laedt,
// bleibt fuer den Waechter (`test/checks-leichtigkeit.test.mjs`, Regel 1) ein leichter Test.

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ZUSTAND, parseArgs } from "../../kit/night/grundlagen.mjs";
import { laufstandAbhaengigkeiten } from "../../kit/night/laufstand.mjs";
import { abhaengigkeitenAbhaengigkeiten } from "../../kit/night/abhaengigkeiten.mjs";
import { kitstandAbhaengigkeiten } from "../../kit/night/kitstand.mjs";
import { berichtAbhaengigkeiten } from "../../kit/night/bericht.mjs";
import { wartendAbhaengigkeiten } from "../../kit/night/wartend.mjs";
import { verbrauchLeer } from "../../kit/night/session.mjs";
import { REVIEW_FERTIG_LABEL, ketteAnbinden, ketteBudgetSetzen, laufeKette } from "../../kit/night/kette.mjs";
import { boardAttrappe } from "./board-attrappe.mjs";
import { psLeer, spawnAttrappe, stdoutFangen, uhrAttrappe } from "./session-attrappe.mjs";
import { fachplanBody, planBody } from "./kette-texte.mjs";

export { fachplanBody, planBody };

/** Der Beginn der stehenden Uhr: eine Nacht im Herbst 2026, nicht 1970 — der Laufstand rechnet mit Datum. */
export const UHR_START = Date.UTC(2026, 9, 6, 2, 0, 0);

/** Das Kettenlabel der Vorgabe. */
export const KETTE_LABEL = "kit:night";

/** Die Laufstand-Labels der Vorgabe von `issue stand` (`STAND_LABEL_VORGABEN` im Board-Teil dokumente). */
const STAND_LABELS = { laeuft: "lauf:laeuft", abgebrochen: "lauf:abgebrochen", wartet: "lauf:wartet" };

/** Eine fachliche Anforderung als Karte der Attrappe: gekennzeichnet und geprueft, wenn nicht anders gesagt. */
export function fachplanKarte(id, { titel = "[Fachlich] Ein Anliegen", labels = [KETTE_LABEL, REVIEW_FERTIG_LABEL], body = fachplanBody(), status = "backlog" } = {}) {
  return { id: String(id), title: titel, body, status, labels: [...labels] };
}

/** Ein Plan als Karte der Attrappe, mit der Herkunftszeile auf `F`. */
export function planKarte(id, F, { titel = "[Plan] Ein fertiger Weg", labels = [], body = planBody(), status = "backlog" } = {}) {
  return { id: String(id), title: titel, body: body.replaceAll("__F__", String(F)), status, labels: [...labels] };
}

/** Der Wert einer Option `--name <wert>` in einer Argumentliste, sonst undefined. */
function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

/** Text aus `--name` oder aus der Datei hinter `--name-file`. */
function textOderDatei(args, name) {
  const text = option(args, name);
  if (text !== undefined) return text;
  const datei = option(args, `${name}-file`);
  return datei === undefined ? undefined : readFileSync(datei, "utf-8");
}

/**
 * Das Board der Kette: die Board-Attrappe, ergaenzt um die Befehle, die Kette und Laufstand
 * brauchen — `issue create`, `update`, `comment` mit Text oder Datei, `stand`, `check-form` —
 * und `issue list` mit Body, wie der Tracker ihn liefert. `ablehnen(cliArgs)` laesst einen
 * Aufruf scheitern; `boardRoh` liefert dann `{ status: 1 }` statt zu werfen. `schlucken(cliArgs)`
 * nimmt einen Aufruf an und speichert nichts — das Board meldet Erfolg, die Karte bleibt, wie sie
 * war (wie an Plan #577, Issue #653).
 */
export function ketteBoard(anfang, { jetzt, formPruefung, ablehnen = () => false, schlucken = () => false }) {
  const basis = boardAttrappe(anfang, { jetzt });
  const { karten, aufrufe } = basis;
  const karte = (id) => {
    const treffer = karten.find((k) => k.id === String(id));
    if (!treffer) throw new Error(`Issue #${id} nicht gefunden`);
    return treffer;
  };
  const kommentieren = (ziel, text) => {
    ziel.comments.push({ author: "attrappe", body: text, createdAt: jetzt().toISOString(), id: String(ziel.comments.length + 1) });
  };
  const zusatz = {
    list: (args) => {
      const status = option(args, "status");
      return karten.filter((k) => !status || k.status === status)
        .map(({ id, title, status: s, labels, body }) => ({ id, title, status: s, labels: [...labels], body }));
    },
    create: (args) => {
      const id = String(Math.max(0, ...karten.map((k) => Number(k.id) || 0)) + 1);
      karten.push({ id, title: option(args, "title"), body: textOderDatei(args, "body") ?? "", status: "backlog", labels: [], comments: [] });
      return { ok: true, id };
    },
    update: ([id, ...args]) => {
      const body = textOderDatei(args, "body");
      if (body !== undefined) karte(id).body = body;
      return { ok: true, id: String(id) };
    },
    comment: ([id, ...args]) => {
      kommentieren(karte(id), textOderDatei(args, "text"));
      return { ok: true, id: String(id) };
    },
    // Wie `issueStand` im Board-Teil dokumente: Labels erst ab-, dann ansetzen, den juengsten
    // Laufstand ersetzen statt einen zweiten anzuhaengen.
    stand: ([id, ...args]) => {
      const ziel = karte(id);
      const zustand = option(args, "zustand");
      const rumpf = textOderDatei(args, "text").replaceAll("\r\n", "\n").trim();
      const neu = rumpf.startsWith("## Laufstand") ? rumpf : `## Laufstand\n\n${rumpf}`;
      ziel.labels = ziel.labels.filter((l) => !Object.values(STAND_LABELS).includes(l));
      if (STAND_LABELS[zustand]) ziel.labels.push(STAND_LABELS[zustand]);
      const alt = ziel.comments.findLast((c) => c.body.startsWith("## Laufstand"));
      if (alt) alt.body = neu;
      else kommentieren(ziel, neu);
      return { ok: true, id: String(id), zustand };
    },
    "check-form": ([id]) => formPruefung(structuredClone(karte(id))),
  };
  const board = (...cliArgs) => {
    const args = cliArgs.length > 0 && typeof cliArgs.at(-1) === "object" ? cliArgs.slice(0, -1) : cliArgs;
    if (ablehnen(args)) {
      aufrufe.push(args);
      throw new Error(`Board-Attrappe: ${args.slice(0, 3).join(" ")} abgewiesen`);
    }
    if (schlucken(args)) {
      aufrufe.push(args);
      return { ok: true, id: String(args[2]) };
    }
    const [achse, befehl, ...rest] = args;
    if (achse === "issue" && Object.hasOwn(zusatz, befehl)) {
      aufrufe.push(args);
      return zusatz[befehl](rest);
    }
    return basis.board(...args);
  };
  const boardRoh = (...cliArgs) => {
    try {
      const json = board(...cliArgs);
      const rot = cliArgs[1] === "check-form" && json?.ok === false;
      return { status: rot ? 1 : 0, json, text: JSON.stringify(json) };
    } catch (e) {
      return { status: 1, json: null, text: e.message };
    }
  };
  return { board, boardRoh, karten, aufrufe, karte };
}

/**
 * git ohne Prozess: `worktree add` legt den Ordner an, `worktree remove` entfernt ihn, alles
 * andere gelingt ohne Ausgabe. Jeder Aufruf steht in `aufrufe` als `{ repoRoot, args }`.
 */
export function gitAttrappe() {
  const aufrufe = [];
  const git = (repoRoot, args) => {
    aufrufe.push({ repoRoot, args });
    if (args[0] === "worktree" && args[1] === "add") mkdirSync(args.at(-2), { recursive: true });
    if (args[0] === "worktree" && args[1] === "remove") rmSync(args.at(-1), { recursive: true, force: true });
    return { status: 0, stdout: "", stderr: "" };
  };
  return { git, aufrufe };
}

/** Das result-Ereignis einer Session mit Kosten und Schlusstext. */
export function resultZeile({ kosten = 1, ergebnis = "" } = {}) {
  return JSON.stringify({
    type: "result", total_cost_usd: kosten, duration_api_ms: 5, num_turns: 1, stop_reason: null, is_error: null,
    usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 },
    result: ergebnis,
  });
}

/** Die Stufe einer Session aus ihrer Umgebung — die Umsetzung bekommt keine genannt (Plan #691, E11). */
function stufeVon(env) {
  if (env.NIGHT_KETTE_STUFE) return env.NIGHT_KETTE_STUFE;
  return env.NIGHT_SALVAGE ? "salvage" : "umsetzung";
}

/** Die Zeilen des Journals unter `.claude/lauf/`, als Objekte. */
function journalLesen(dir) {
  const ordner = join(dir, ".claude", "lauf");
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner).filter((n) => n.endsWith(".jsonl"))
    .flatMap((n) => readFileSync(join(ordner, n), "utf-8").split("\n").filter(Boolean).map((z) => JSON.parse(z)));
}

/** Der harte Stopp des Vorflugs: Der Einstieg beendete den Prozess, hier endet der Lauf mit Exit 1. */
class HarterStopp extends Error {}

/**
 * Faehrt `laufeKette` im selben Prozess.
 *
 * - `karten`: das Board zu Beginn (Reihenfolge = Board-Reihenfolge)
 * - `argv`: Argumente hinter `--kette`, etwa `["--dry-run"]` oder `["--max", "2"]`
 * - `kette`, `config`: der Block `night.kette` und weitere Felder der Config
 * - `sitzung(s)`: das Drehbuch je Session; `s` traegt `stufe`, `issue`, `prompt`, `cwd`, `modell`, `planReviewer` und das
 *   Board der Attrappe. Rueckgabe `{ zeilen, kosten, ergebnis, ohneResult, ende }`, alles
 *   wahlweise; ohne `ohneResult` folgt den Zeilen das result-Ereignis.
 * - `formPruefung(karte)`: die Antwort von `issue check-form`, Vorgabe `formNachAbschnitten()`
 * - `ablehnen(cliArgs)`: laesst einen Board-Aufruf scheitern; `schlucken(cliArgs)` nimmt ihn an, ohne zu speichern
 * - `vorflug`: `null` fuer einen gruenen Reviewer-Vorflug, sonst der Grund seines Scheiterns
 * - `vorher({ dir, board })`: laeuft nach dem Aufbau und vor der Kette
 *
 * Liefert `{ code, ausgabe, karten, karte(id), aufrufe, sitzungen, lauf, journal, vorflug,
 * abschluss, gitAufrufe, worktreePraefix }`; das Temp-Verzeichnis ist danach geraeumt.
 */
export async function ketteImProzess({
  karten = [], argv = [], kette = {}, config = {}, sitzung = () => ({}),
  formPruefung = formNachAbschnitten(), ablehnen, schlucken, vorflug = null, vorher = null,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "night-kette-prozess-"));
  const cwdVorher = process.cwd();
  const zustandVorher = { ...ZUSTAND };
  const uhr = uhrAttrappe(UHR_START);
  const jetzt = () => new Date(uhr.jetzt());
  const schlaf = (ms) => { uhr.vor(ms); };
  const kb = ketteBoard(karten, { jetzt, formPruefung, ablehnen, schlucken });
  const { git, aufrufe: gitAufrufe } = gitAttrappe();
  const sitzungen = [];
  const { spawn } = spawnAttrappe((aufruf) => {
    const s = { stufe: stufeVon(aufruf.env), issue: aufruf.env.NIGHT_ISSUE_ID, prompt: aufruf.env.NIGHT_PROMPT, cwd: aufruf.cwd, modell: aufruf.env.KIT_AGENT_MODEL, planReviewer: aufruf.env.KIT_PLAN_REVIEWER };
    sitzungen.push(s);
    const antwort = sitzung({ ...s, board: kb.board }) ?? {};
    return [
      ...(antwort.zeilen ?? []),
      ...(antwort.ohneResult ? [] : [resultZeile(antwort)]),
      ...(antwort.ende === undefined ? [] : [{ ende: antwort.ende }]),
    ];
  }, { uhr });
  const vorflugStand = { aufgerufen: false, kandidaten: null, journal: null };
  const abschluss = [];

  const cfg = {
    codeHost: "local", issueTracker: "local", buildChecks: ["true"], local: { issuesDir: "issues" },
    ...config, night: { ...config.night, kette },
  };
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "workflow.config.json"), JSON.stringify(cfg, null, 2));
  const args = parseArgs(["--kette", ...argv]);
  const stempel = "2026-10-06-020000";

  try {
    process.chdir(dir);
    Object.assign(ZUSTAND, {
      config: cfg, CONFIG_PATH: join(dir, ".claude", "workflow.config.json"), STOPP_GRUND: "", LOG_KENNUNG: null,
      LOG_FILE: join(dir, ".claude", "night-run-2026-10-06.log"),
      LAUF_STEMPEL: args.dryRun ? null : stempel,
      ERGEBNIS_FILE: args.dryRun ? null : join(dir, ".claude", `night-run-${stempel}.json`),
      LAUF: args.dryRun ? null : {
        schemaFassung: 1, start: jetzt().toISOString(), art: "kette", modell: args.model, max: args.max,
        einheiten: [], abschluss: null, complete: false, verbrauch: verbrauchLeer(), verbrauchOhneEinheit: verbrauchLeer(),
      },
    });
    ketteBudgetSetzen(cfg);
    laufstandAbhaengigkeiten({ board: kb.boardRoh, jetzt, schlaf });
    abhaengigkeitenAbhaengigkeiten({ board: kb.board, boardRoh: kb.boardRoh });
    wartendAbhaengigkeiten({ board: kb.board, boardRoh: kb.boardRoh });
    berichtAbhaengigkeiten({ boardRoh: kb.boardRoh, git: (gitArgs) => git(dir, gitArgs) });
    kitstandAbhaengigkeiten({ git, jetzt, schlaf, spawnSync: psLeer });
    ketteAnbinden({
      fuehreVorflug: async (_args, kandidaten, _flags, nichtGestartet) => {
        Object.assign(vorflugStand, { aufgerufen: true, kandidaten: kandidaten.map((k) => String(k.id)), journal: journalLesen(dir) });
        if (vorflug === null) return;
        nichtGestartet(vorflug);
        throw new HarterStopp(vorflug);
      },
      laufAbschliessen: (art) => { abschluss.push(art); },
    });
    if (vorher) vorher({ dir, board: kb.board });

    let code;
    const { text: ausgabe } = await stdoutFangen(async () => {
      try {
        code = await laufeKette(args, {
          spawn, spawnSync: psLeer, jetzt, schlaf, board: kb.board, boardRoh: kb.boardRoh,
          gitClean: () => true, gitReste: () => [], beenden: (c) => c,
        });
      } catch (e) {
        if (!(e instanceof HarterStopp)) throw e;
        code = 1;
      }
    });
    return {
      code, ausgabe, karten: kb.karten, karte: kb.karte, aufrufe: kb.aufrufe, sitzungen,
      lauf: ZUSTAND.LAUF, journal: journalLesen(dir), vorflug: vorflugStand, abschluss, gitAufrufe,
      worktreePraefix: `kette-${dir.split(/[\\/]/).at(-1)}-`,
    };
  } finally {
    process.chdir(cwdVorher);
    Object.assign(ZUSTAND, zustandVorher);
    for (const zuruecksetzen of [laufstandAbhaengigkeiten, abhaengigkeitenAbhaengigkeiten, wartendAbhaengigkeiten,
      berichtAbhaengigkeiten, kitstandAbhaengigkeiten]) zuruecksetzen();
    const nichtAngebunden = (name) => () => { throw new Error(`${name} ist nicht angebunden`); };
    ketteAnbinden({ fuehreVorflug: nichtAngebunden("fuehreVorflug"), laufAbschliessen: nichtAngebunden("laufAbschliessen") });
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Bausteine der Sessions je Stufe ---
//
// Was die Shell-Fakes in `kette-ablauf.mjs` am Board hinterlassen, hier als Funktion der
// Session `s` (`stufe`, `issue`, `prompt`, `board`). `issue` ist die Nummer der Wurzel, wie
// NIGHT_ISSUE_ID im Prozess; das Dokument der Stufe steht im Prompt.

/** Die Nummer hinter `muster` im Prompt der Session. */
function nummerAusPrompt(s, muster) {
  const treffer = muster.exec(s.prompt);
  if (!treffer) throw new Error(`Prompt ohne Nummer (${muster}): ${s.prompt}`);
  return treffer[1];
}

const reviewZiel = (s) => nummerAusPrompt(s, /^\/issue-review #(\d+)/);
const paketeZiel = (s) => nummerAusPrompt(s, /^\/issues #(\d+)/);
const formZiel = (s) => nummerAusPrompt(s, /^Das Dokument #(\d+)/);

/** Verzweigt nach der Stufe der Session; eine nicht genannte Stufe tut nichts. */
export function jeStufe(stufen) {
  return (s) => stufen[s.stufe]?.(s) ?? {};
}

/** Stufe plan: legt den Plan mit der Herkunftszeile auf die Wurzel an. */
export function planAnlegen(body = planBody()) {
  return (s) => { s.board("issue", "create", "--title", "[Plan] Ein Weg", "--body", body.replaceAll("__F__", s.issue)); };
}

/** Stufe form: schreibt den Body an das Dokument aus dem Korrekturprompt. */
export function formReparieren(body = planBody()) {
  return (s) => { s.board("issue", "update", formZiel(s), "--body", body.replaceAll("__F__", s.issue)); };
}

/** Der Einarbeitungs-Kommentar, den der Review-Baustein an den Plan haengt — ein Fund uebernommen, einer abgelehnt (#645). */
export const EINARBEITUNG_ZEILE_ABGELEHNT = "- Fund 2 (opus, WICHTIG): abgelehnt — der Bestand deckt den Fall schon.";
const EINARBEITUNG_KOMMENTAR = `## Einarbeitung, Runde 1\n\n- Fund 1 (opus, HINWEIS): übernommen.\n${EINARBEITUNG_ZEILE_ABGELEHNT}\n`;

/** Stufe review: setzt den Marker im Kopf des Plans und haengt den Einarbeitungs-Kommentar an. */
export function reviewMarker(s) {
  const id = reviewZiel(s);
  const body = s.board("issue", "get", id).body;
  s.board("issue", "update", id, "--body", body.replace("Plan-Modell: fixture-modell", "Plan-Modell: fixture-modell\nPlan-Review: opus (2026-09-14, Nachtlauf)"));
  s.board("issue", "comment", id, "--text", EINARBEITUNG_KOMMENTAR);
}

/** Stufe review: zeichnet den Plan mit kit:klaeren und einer Frage. */
export function reviewHalt(s) {
  const id = reviewZiel(s);
  s.board("issue", "comment", id, "--text", "Einarbeitung: Frage der Stopp-Klasse — ist das eine Schnittstelle nach aussen?");
  s.board("issue", "label", "add", id, "kit:klaeren");
}

/** Die Entscheidung, die das erste Paket von `paketeAnlegen` traegt. */
export const PAKET_ENTSCHEIDUNG = "Entscheidung: Wie heisst die Datei? Gewählt: kurz. Verworfen: lang. Grund: Bestand. Rückbau: trivial.";

/** Der Body eines Pakets mit Herkunftszeilen; `ohneAbhaengigkeiten` laesst den Pflichtabschnitt weg. */
export function paketBody(planId, F, { n = 1, aufgabe = `Paket ${n} in \`src/paket.mjs\`.`, kontext = "Keine Entscheidung.", abhaengigkeiten = "Keine.", ohneAbhaengigkeiten = false } = {}) {
  const teile = [`## Kontext\n\nPlan: Issue #${planId}\nFachliche Quelle: Issue #${F}\n\n${kontext}\n`, `## Aufgabe\n\n${aufgabe}\n`, "## Akzeptanzkriterium\n\n- node --test\n"];
  if (!ohneAbhaengigkeiten) teile.push(`## Abhängigkeiten\n\n${abhaengigkeiten}\n`);
  return teile.join("\n");
}

/** Stufe pakete: zwei Pakete mit `Plan: Issue #M` und eine fremde Karte ohne Herkunftszeile. */
export function paketeAnlegen(s) {
  const m = paketeZiel(s);
  for (const n of [1, 2]) {
    s.board("issue", "create", "--title", `Paket ${n}`, "--body", paketBody(m, s.issue, { n, kontext: n === 1 ? PAKET_ENTSCHEIDUNG : "Keine Entscheidung." }));
  }
  s.board("issue", "create", "--title", "Fremde Karte", "--body", "## Kontext\n\nOhne Herkunft.\n\n## Aufgabe\n\nx\n\n## Akzeptanzkriterium\n\n- y\n\n## Abhängigkeiten\n\nKeine.\n");
}

/** Stufe pakete: ein Paket ohne den Abschnitt Abhaengigkeiten (rote Form). */
export function paketOhneAbhaengigkeiten(s) {
  s.board("issue", "create", "--title", "Paket ohne Abhaengigkeiten", "--body", paketBody(paketeZiel(s), s.issue, { ohneAbhaengigkeiten: true }));
}

/** Stufe form fuer ein Paket: haengt den Abschnitt Abhaengigkeiten an. */
export function paketReparieren(s) {
  const id = formZiel(s);
  const body = s.board("issue", "get", id).body;
  s.board("issue", "update", id, "--body", `${body.trimEnd()}\n\n## Abhängigkeiten\n\nKeine.\n`);
}

/** Stufe pakete: kein Paket, dafuer der Halt-Kommentar von /issues am Plan. */
export function paketeHalt(s) {
  s.board("issue", "comment", paketeZiel(s), "--text", "Kein Eingang für /issues: offene Stopp-Frage — Ist der Endpunkt ein Vertrag nach aussen?");
}

/** Stufe abdeckung, die verbotenerweise an der Wurzel schreibt. */
export function abdeckungSchreibt(s) {
  s.board("issue", "comment", s.issue, "--text", "Abdeckung als Kommentar — verboten");
}

/**
 * Eine Formpruefung nach den Pflichtabschnitten, die die Bausteine weglassen koennen: ein
 * Plan ohne `## Verifizierung`, ein Paket ohne `## Abhängigkeiten`. Die volle Pruefung
 * belegen die Tests des Board-Werkzeugs; hier zaehlt, was die Kette mit ihrem Ergebnis tut.
 * `hinweise(karte)` gibt einer gruenen Pruefung Hinweise bei.
 */
export function formNachAbschnitten({ hinweise = () => [] } = {}) {
  return (karte) => {
    const plan = /^\[Plan\]/.test(karte.title);
    const pflicht = plan ? /^## Verifizierung$/m : /^## Abhängigkeiten$/m;
    if (pflicht.test(karte.body)) return { ok: true, verstoesse: [], hinweise: hinweise(karte) };
    const meldung = plan ? "Abschnitt '## Verifizierung' fehlt" : "Abschnitt '## Abhängigkeiten' fehlt";
    return { ok: false, verstoesse: [{ gate: plan ? "P5" : "I4", meldung }], hinweise: [] };
  };
}

/** Die Stufen einer glatten Kette unter Variante A. */
export const GLATT = jeStufe({ plan: planAnlegen(), review: reviewMarker, pakete: paketeAnlegen });
