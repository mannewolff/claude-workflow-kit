/**
 * board/config-namen.mjs — Namenspaare der Einstellungen (Issue #1434, Plan #1420 E9 bis E11):
 * je Schluessel des Schemas und je Wert einer festen Aufzaehlung ein deutscher und ein
 * englischer Name, dazu der Normalisierer, der eine Config beim Einlesen auf die deutschen
 * Namen abbildet, und die Umbenennung in eine Sprache.
 *
 * Intern bleiben die deutschen Schluessel massgeblich (E9): `normalisiereConfig` liefert eine
 * Config, wie der Bestand sie liest, gleich in welcher Sprache die Datei geschrieben ist. Die
 * Tabelle nennt jeden Pfad des Schemas, auch die schon englischen Namen (E10); das haelt
 * test/board-config-namen.test.mjs gegen templates/workflow.config.schema.json fest. Frei
 * gewaehlte Namen und Werte — Bereichsnamen in checkAreas, Autoren in issueReview.pairs,
 * Kommandos, Labels — stehen nicht in der Tabelle und bleiben unveraendert (E11).
 *
 * Schreibweise der Pfade: deutsche Namen, durch Punkte getrennt; ein Listeneintrag ist `[]`.
 *
 * Dieses Modul importiert nur Node-Bordmittel, damit tools/sync-blobs.mjs es in
 * kit/settings.mjs einbetten kann (E10).
 *
 * QUELLE DER WAHRHEIT: Diese Datei wird im Kit-Repo (claude-workflow-kit) gepflegt.
 * Aenderungen ausschliesslich hier vornehmen, danach `node tools/sync-blobs.mjs`.
 */

/** Je Pfad des Schemas der englische Name seines letzten Glieds. */
export const SCHLUESSEL = Object.freeze({
  version: "version",
  language: "language",
  codeHost: "codeHost",
  issueTracker: "issueTracker",
  provider: "provider",
  buildChecks: "buildChecks",
  "buildChecks[].cmd": "cmd",
  "buildChecks[].areas": "areas",
  "buildChecks[].always": "always",
  "buildChecks[].stufe": "stage",
  "buildChecks[].nichtBeimAbschluss": "notAtCompletion",
  "buildChecks[].abschlussBereiche": "completionAreas",
  "buildChecks[].guete": "quality",
  "buildChecks[].guete.muster": "pattern",
  "buildChecks[].guete.marke": "marker",
  "buildChecks[].gleichzeitig": "concurrent",
  "buildChecks[].vorab": "upfront",
  "buildChecks[].art": "kind",
  checkAreas: "checkAreas",
  ohnePruefung: "noCheck",
  "ohnePruefung[].muster": "pattern",
  "ohnePruefung[].grund": "reason",
  gekoppelteBereiche: "coupledAreas",
  "gekoppelteBereiche[].bereich": "area",
  "gekoppelteBereiche[].grund": "reason",
  testAblagen: "testLocations",
  "testAblagen[].quelle": "source",
  "testAblagen[].test": "test",
  "testAblagen[].vorgaben": "defaults",
  nurGeruest: "scaffoldOnly",
  "nurGeruest[].muster": "pattern",
  "nurGeruest[].grund": "reason",
  mutationCommand: "mutationCommand",
  guetekommandos: "qualityCommands",
  formatFixCommand: "formatFixCommand",
  installCommand: "installCommand",
  mainBranch: "mainBranch",
  productionBranch: "productionBranch",
  pushPruefung: "pushCheck",
  "pushPruefung.ort": "location",
  "pushPruefung.zweig": "branch",
  reviewScope: "reviewScope",
  reviewModel: "reviewModel",
  reviewCommand: "reviewCommand",
  reviewLesegrenze: "reviewReadLimit",
  triggers: "triggers",
  "triggers.go": "go",
  "triggers.push": "push",
  "triggers.merge": "merge",
  local: "local",
  "local.issuesDir": "issuesDir",
  columns: "columns",
  "columns.backlog": "backlog",
  "columns.ready": "ready",
  "columns.in_progress": "in_progress",
  "columns.in_review": "in_review",
  "columns.done": "done",
  github: "github",
  "github.projectNumber": "projectNumber",
  toolbox: "toolbox",
  "toolbox.host": "host",
  "toolbox.tokenFile": "tokenFile",
  "toolbox.ideaStored": "ideaStored",
  issueReview: "issueReview",
  "issueReview.requiredBeforeReady": "requiredBeforeReady",
  "issueReview.reviewers": "reviewers",
  "issueReview.reviewers[].name": "name",
  "issueReview.reviewers[].kind": "kind",
  "issueReview.reviewers[].model": "model",
  "issueReview.reviewers[].command": "command",
  "issueReview.reviewers[].lesegrenze": "readLimit",
  "issueReview.pairs": "pairs",
  reviewStufen: "reviewStages",
  "reviewStufen.fachlich": "requirement",
  "reviewStufen.fachlich.reviewer": "reviewer",
  "reviewStufen.fachlich.rollen": "roles",
  "reviewStufen.plan": "plan",
  "reviewStufen.plan.reviewer": "reviewer",
  "reviewStufen.plan.rollen": "roles",
  "reviewStufen.issue": "issue",
  "reviewStufen.issue.reviewer": "reviewer",
  "reviewStufen.issue.rollen": "roles",
  night: "night",
  "night.kette": "chain",
  "night.kette.label": "label",
  "night.kette.varianteBLabel": "variantBLabel",
  "night.kette.planMin": "planMin",
  "night.kette.paketeMin": "packagesMin",
  "night.kette.reviewMin": "reviewMin",
  "night.kette.abdeckungMin": "coverageMin",
  "night.kette.umsetzungMin": "implementationMin",
  "night.kette.vorbereitungMin": "preparationMin",
  "night.kette.kostenUsd": "costUsd",
  "night.kette.kostenUsdB": "costUsdB",
  "night.kette.korrekturrunden": "correctionRounds",
  "night.kette.uebergaenge": "transitions",
  "night.kette.uebergaenge.planReview": "planReview",
  "night.kette.uebergaenge.reviewPakete": "reviewPackages",
  "night.kette.uebergaenge.paketeAbdeckung": "packagesCoverage",
  "night.kette.uebergaenge.abdeckungUmsetzung": "coverageImplementation",
  "night.kette.uebergaenge.umsetzungVorbereitung": "implementationPreparation",
  "night.stand": "status",
  "night.stand.labels": "labels",
  "night.stand.labels.laeuft": "running",
  "night.stand.labels.abgebrochen": "aborted",
  "night.stand.labels.wartet": "waiting",
  "night.stand.fristMin": "deadlineMin",
  "night.stand.pauseMin": "pauseMin",
  "night.modell": "model",
  "night.modelle": "models",
  "night.stufen": "tiers",
  "night.stufen.schwer": "hard",
  "night.stufen.schwer.modell": "model",
  "night.stufen.schwer.effort": "effort",
  "night.stufen.schwer.kommando": "command",
  "night.stufen.schwer.name": "name",
  "night.stufen.mittel": "medium",
  "night.stufen.mittel.modell": "model",
  "night.stufen.mittel.effort": "effort",
  "night.stufen.mittel.kommando": "command",
  "night.stufen.mittel.name": "name",
  "night.stufen.leicht": "easy",
  "night.stufen.leicht.modell": "model",
  "night.stufen.leicht.effort": "effort",
  "night.stufen.leicht.kommando": "command",
  "night.stufen.leicht.name": "name",
  "night.stufenRegel": "tierRule",
  "night.festgefahrenNach": "stuckAfter",
  "night.zielUmsetzungMin": "goalImplementationMin",
  pruefLauf: "checkRun",
  "pruefLauf.label": "label",
  "pruefLauf.pruefungMin": "checkMin",
  "pruefLauf.kostenUsd": "costUsd",
  aufwand: "workload",
  "aufwand.laeufe": "runs",
  "aufwand.schwellen": "thresholds",
  "aufwand.schwellen.pruefungAnteil": "checkShare",
  "aufwand.schwellen.eingrenzungOhneWirkung": "narrowingWithoutEffect",
  "aufwand.schwellen.werkzeugAnteil": "toolShare",
  "aufwand.schwellen.schreibkostenAnteil": "writeCostShare",
  wirksamkeit: "effectiveness",
  "wirksamkeit.fensterTage": "windowDays",
  "wirksamkeit.nieBeanstandetAbAusfuehrungen": "neverFlaggedFromRuns",
  "wirksamkeit.quoteSchwelle": "rateThreshold",
  "wirksamkeit.quoteAbPaketen": "rateFromPackages",
  "wirksamkeit.kandidatenMax": "candidatesMax",
  befunde: "findings",
  "befunde.schwelle": "threshold",
  vorgeschichte: "history",
  szenarienAb: "scenariosFrom",
});

const gleich = (...werte) => Object.fromEntries(werte.map((w) => [w, w]));
const AUFWAND_STUFEN = gleich("low", "medium", "high", "xhigh", "max");

/** Je Pfad mit fester Aufzaehlung: deutscher Wert → englischer Wert (E11). */
export const WERTE = Object.freeze({
  language: Object.freeze(gleich("de", "en")),
  codeHost: Object.freeze(gleich("github", "gitlab", "local")),
  issueTracker: Object.freeze(gleich("github", "gitlab", "local", "toolbox")),
  provider: Object.freeze(gleich("github", "gitlab", "local")),
  "buildChecks[].stufe": Object.freeze({ paket: "package", push: "push", merge: "merge" }),
  "buildChecks[].nichtBeimAbschluss": Object.freeze({ zusammenspiel: "interplay", volleTestmenge: "fullTestSet" }),
  "buildChecks[].art": Object.freeze({ hinweis: "hint" }),
  pushPruefung: Object.freeze({ lokal: "local" }),
  "pushPruefung.ort": Object.freeze({ buildDienst: "buildService" }),
  reviewScope: Object.freeze(gleich("diff", "full")),
  "issueReview.reviewers[].kind": Object.freeze(gleich("claude", "command")),
  "night.stufen.schwer.effort": Object.freeze(AUFWAND_STUFEN),
  "night.stufen.mittel.effort": Object.freeze(AUFWAND_STUFEN),
  "night.stufen.leicht.effort": Object.freeze(AUFWAND_STUFEN),
});

// Je Elternpfad die Kinder: Name in jeder Sprache → { de, en }.
const KINDER = new Map();
for (const [pfad, en] of Object.entries(SCHLUESSEL)) {
  const trenner = pfad.lastIndexOf(".");
  const eltern = trenner < 0 ? "" : pfad.slice(0, trenner);
  const paar = Object.freeze({ de: trenner < 0 ? pfad : pfad.slice(trenner + 1), en });
  const kinder = KINDER.get(eltern) ?? new Map();
  kinder.set(paar.de, paar);
  kinder.set(paar.en, paar);
  KINDER.set(eltern, kinder);
}

// Je Aufzaehlungspfad: Wert in jeder Sprache → { de, en }.
const AUFZAEHLUNG = new Map(
  Object.entries(WERTE).map(([pfad, werte]) => [
    pfad,
    new Map(Object.entries(werte).flatMap(([de, en]) => [[de, { de, en }], [en, { de, en }]])),
  ])
);

// SYNC: wie projektSprache in kit/board/namen.mjs — dieses Modul importiert nur
// Node-Bordmittel und liest die Sprache darum selbst: `language`, sonst `sprache`, sonst `de`.
function spracheDer(roh) {
  const wert = roh?.language ?? roh?.sprache;
  return wert === "en" ? "en" : "de";
}

const istObjekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);

/**
 * Bildet `wert` am Tabellenpfad `pfad` in die Zielsprache ab. `anzeige` ist derselbe Pfad mit
 * Listenposition (`buildChecks[0].stufe`) fuer Hinweise und Umbenennungen. Der Lauf `lauf`
 * traegt Zielsprache `ziel`, die Sprache `vorrang`, deren Name bei einer Doppelung gilt, und
 * die Listen `hinweise` und `umbenannt`.
 */
function bilde(wert, pfad, anzeige, lauf) {
  if (Array.isArray(wert)) return wert.map((e, i) => bilde(e, `${pfad}[]`, `${anzeige}[${i}]`, lauf));
  if (typeof wert === "string") return bildeWert(wert, pfad, anzeige, lauf);
  if (!istObjekt(wert)) return wert;
  const kinder = KINDER.get(pfad);
  // Ein Objekt ohne Tabelleneintraege (checkAreas, issueReview.pairs) traegt frei gewaehlte Namen.
  return kinder ? bildeObjekt(wert, pfad, anzeige, kinder, lauf) : structuredClone(wert);
}

function bildeWert(wert, pfad, anzeige, { ziel, umbenannt }) {
  const paar = AUFZAEHLUNG.get(pfad)?.get(wert);
  if (!paar || paar[ziel] === wert) return wert;
  umbenannt.push({ art: "wert", pfad: anzeige, von: wert, nach: paar[ziel] });
  return paar[ziel];
}

const pfadUnter = (eltern, name) => (eltern ? `${eltern}.${name}` : name);

/** Je Einstellung des Objekts der geltende Name; jede Doppelung landet in `hinweise`. */
function geltendeNamen(wert, anzeige, kinder, { vorrang, hinweise }) {
  const gilt = new Map();
  for (const name of Object.keys(wert)) {
    const paar = kinder.get(name);
    if (!paar) continue;
    const vorher = gilt.get(paar.de);
    const gewinner = vorher === undefined || paar[vorrang] === name ? name : vorher;
    gilt.set(paar.de, gewinner);
    if (vorher === undefined) continue;
    hinweise.push(
      `Doppelung: "${pfadUnter(anzeige, vorher)}" und "${pfadUnter(anzeige, name)}" nennen dieselbe ` +
        `Einstellung; es gilt "${pfadUnter(anzeige, gewinner)}", der Name der Projektsprache (${vorrang}).`
    );
  }
  return gilt;
}

function bildeObjekt(wert, pfad, anzeige, kinder, lauf) {
  const gilt = geltendeNamen(wert, anzeige, kinder, lauf);
  const ergebnis = {};
  for (const [name, inhalt] of Object.entries(wert)) {
    const paar = kinder.get(name);
    if (!paar) {
      ergebnis[name] = structuredClone(inhalt);
    } else if (gilt.get(paar.de) === name) {
      const neu = paar[lauf.ziel];
      const kindAnzeige = pfadUnter(anzeige, paar.de);
      if (neu !== name) lauf.umbenannt.push({ art: "schluessel", pfad: kindAnzeige, von: name, nach: neu });
      ergebnis[neu] = bilde(inhalt, pfadUnter(pfad, paar.de), kindAnzeige, lauf);
    }
  }
  return ergebnis;
}

/**
 * Bildet eine eingelesene Config auf die deutschen Schluessel und Werte ab (E9). Stehen beide
 * Namen derselben Einstellung darin, gilt der Name der Projektsprache, und `hinweise` nennt die
 * Doppelung. Unbekannte Schluessel und frei gewaehlte Werte bleiben unveraendert; die Eingabe
 * wird nicht veraendert.
 *
 * `sprache` nennt die Projektsprache, wenn sie nicht in `roh` selbst steht — bei der
 * persoenlichen Override-Datei, die sie aus der geteilten Config erbt (Issue #1435).
 */
export function normalisiereConfig(roh, { sprache } = {}) {
  const hinweise = [];
  if (!istObjekt(roh)) return { config: roh, hinweise };
  const vorrang = sprache === "en" || sprache === "de" ? sprache : spracheDer(roh);
  const config = bilde(roh, "", "", { ziel: "de", vorrang, hinweise, umbenannt: [] });
  return { config, hinweise };
}

/**
 * Benennt eine Config in die Sprache `sprache` (`de` oder `en`) um: Schluessel und Werte fester
 * Aufzaehlungen, gleich in welcher Sprache sie stehen. `umbenannt` nennt je Umbenennung Art
 * (`schluessel` oder `wert`), Pfad in der deutschen Schreibweise, alten und neuen Namen; ein
 * Name, der in beiden Sprachen gleich heisst, ist keine Umbenennung. Andere Werte bleiben gleich.
 */
export function benenneUm(config, sprache) {
  if (sprache !== "de" && sprache !== "en") throw new Error(`config-namen: unbekannte Sprache "${sprache}"`);
  const umbenannt = [];
  if (!istObjekt(config)) return { config, umbenannt };
  const ergebnis = bilde(config, "", "", { ziel: sprache, vorrang: spracheDer(config), hinweise: [], umbenannt });
  return { config: ergebnis, umbenannt };
}

// Je Einstellung der Vorlage der Name, unter dem sie dort gilt — bei einer Doppelung der Name
// der Sprache `sprache`, wie in normalisiereConfig.
function namenDerVorlage(vorlage, kinder, sprache) {
  const namen = new Map();
  for (const name of Object.keys(vorlage)) {
    const paar = kinder.get(name);
    if (paar && (!namen.has(paar.de) || paar[sprache] === name)) namen.set(paar.de, name);
  }
  return namen;
}

function wieVorlage(wert, vorlage, pfad, sprache) {
  if (Array.isArray(wert)) {
    return wert.map((e, i) => wieVorlage(e, Array.isArray(vorlage) ? vorlage[i] : undefined, `${pfad}[]`, sprache));
  }
  if (typeof wert === "string") return wertWieVorlage(wert, vorlage, pfad, sprache);
  if (!istObjekt(wert)) return wert;
  const kinder = KINDER.get(pfad);
  if (!kinder) return structuredClone(wert);
  return objektWieVorlage(wert, istObjekt(vorlage) ? vorlage : {}, pfad, kinder, sprache);
}

function wertWieVorlage(wert, vorlage, pfad, sprache) {
  const paar = AUFZAEHLUNG.get(pfad)?.get(wert);
  if (!paar) return wert;
  return typeof vorlage === "string" && AUFZAEHLUNG.get(pfad).get(vorlage) === paar ? vorlage : paar[sprache];
}

function objektWieVorlage(wert, vorlage, pfad, kinder, sprache) {
  const vorhanden = namenDerVorlage(vorlage, kinder, sprache);
  const ergebnis = {};
  for (const [name, inhalt] of Object.entries(wert)) {
    const paar = kinder.get(name);
    if (!paar) {
      ergebnis[name] = structuredClone(inhalt);
      continue;
    }
    const ziel = vorhanden.get(paar.de) ?? paar[sprache];
    ergebnis[ziel] = wieVorlage(inhalt, vorlage[ziel], pfadUnter(pfad, paar.de), sprache);
  }
  // Der unterlegene Name einer Doppelung bleibt in der Datei stehen, solange die Einstellung
  // bleibt: Ihn zu streichen, waere eine Aenderung, die niemand verlangt hat.
  for (const [name, inhalt] of Object.entries(vorlage)) {
    const paar = kinder.get(name);
    if (paar && !(name in ergebnis) && vorhanden.get(paar.de) in ergebnis) ergebnis[name] = structuredClone(inhalt);
  }
  return ergebnis;
}

/**
 * Bringt eine Config mit deutschen Namen in die Schreibweise der Datei `vorlage` zurueck
 * (Issue #1441): Eine Einstellung oder ein Aufzaehlungswert, der dort schon steht, behaelt
 * seinen Namen, auch einen, den der Mensch in der anderen Sprache geschrieben hat; was neu
 * dazukommt, bekommt den Namen der Sprache `sprache`. Frei gewaehlte Namen bleiben.
 */
export function benenneWieVorlage(config, vorlage, sprache) {
  if (sprache !== "de" && sprache !== "en") throw new Error(`config-namen: unbekannte Sprache "${sprache}"`);
  return wieVorlage(config, vorlage, "", sprache);
}
