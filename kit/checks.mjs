#!/usr/bin/env node
/**
 * claude-workflow-kit Pruef-Auswahl und -Ausfuehrung (Issues #423, #424)
 *
 * `plan` entscheidet, welche Pruefungen nach einem Arbeitspaket laufen muessen —
 * und gibt die Entscheidung als Daten zurueck, ohne sie auszufuehren. `run` fuehrt
 * genau diese Auswahl aus und hinterlaesst das Ergebnis als Zusammenfassung, aus
 * der der Nacht-Runner liest.
 *
 * Die Zusammenfassung BEGLEITET den Lauf (Issue #857): geschrieben vor dem ersten
 * Kommando, erneut vor jedem weiteren, ein letztes Mal am Ende — und nur diese
 * letzte Fassung traegt `abgeschlossen: true`. Daraus folgt, was ein Abbruch
 * hinterlaesst: einen Stand, in dem das Kommando, waehrend dessen der Lauf starb,
 * noch `nicht gestartet` ist. Der Lauf ist dann nie ganz gruen, und das ist dieselbe
 * sichere Richtung wie ueberall hier — ein gestorbener Pruefer gilt als
 * beanstandend, nicht als ungemessen.
 *
 * Warum ein Kommando und keine Regel im Skilltext: Die Sessions dieses Projekts
 * haben dreimal belegt, dass eine Regel im Prompt nicht wirkt, wenn sie unter
 * Druck steht (Issue #267, 2026-08-12, Issue #410). Eine Auswahl, die falsch
 * ausfaellt, nimmt Pruefung weg — der Fehler geht in die unsichere Richtung und
 * faellt niemandem auf.
 *
 * Deshalb irrt dieses Kommando nur in eine Richtung: mehr pruefen. Drei Ausgaenge
 * setzen das durch:
 *   - Eine geaenderte Datei, die kein Muster trifft -> `vollerUmfang: true`,
 *     alles laeuft. Nicht abschaltbar.
 *   - Ein Anker, der sich nicht aufloesen laesst -> ebenso voller Umfang. Ein
 *     LEERER `--since`-Wert zaehlt dabei wie ein nicht aufloesbarer, nie wie ein
 *     fehlender: Er entsteht, wenn im /local-check-Skill die
 *     merge-base-Substitution fehlschlaegt. Als "nicht angegeben" gelesen griffe
 *     der Default HEAD, und auf sauberem Tree liefe keine einzige Pruefung.
 *   - Eine fehlende Config -> Abbruch mit Exit ungleich 0. Ein Kommando, das
 *     ohne Config stillschweigend "nichts zu pruefen" meldet, zeigt genau dorthin,
 *     wo der Fehler niemandem auffaellt.
 *
 * EIN Prueflauf je Maschine (Issue #958): `run` nimmt vor dem ersten Kommando eine
 * maschinenweite Sperre und gibt sie nach dem letzten frei — auf jedem Weg heraus,
 * auch dem der Ausnahme. Zwei Runner auf einem Rechner fahren damit nacheinander
 * statt gleichzeitig. Sie ist Vorsorge gegen Last und kein Gate: Nach Ablauf einer
 * Obergrenze laeuft der Prueflauf trotzdem. Alles dazu bei `mitSperre`.
 *
 * `run` UEBERNIMMT sein eigenes Ergebnis, wenn sich der Stand seit dem letzten Lauf
 * nicht geaendert hat (Issue #863): gleicher Anker, gleiche Stufe, dieselbe
 * Dateiliste mit denselben Blob-Hashes, dieselbe Config — und eine abgeschlossene
 * Zusammenfassung. Dann laeuft kein Kommando, und `run` schreibt denselben Befund
 * mit frischem Zeitpunkt erneut, damit das Commit-Gate seinen Nachweis behaelt.
 * `--frisch` erzwingt den echten Lauf. Das ist keine Bequemlichkeit, sondern
 * dieselbe Erfahrung wie oben: Die Regel „Ausgabe einmal in eine Datei, daraus
 * lesen" (Issue #835) steht seit Langem im Skilltext, und die Sessions starteten
 * denselben gruenen Lauf trotzdem drei- bis neunmal je Paket. Ein Ergebnis
 * wiederzuverwenden nimmt dabei keine Pruefung weg: Derselbe Inhalt liefert
 * dasselbe Urteil, und schon ein einziges abweichendes Byte faellt zurueck in den
 * vollen Weg.
 *
 * In dieselbe Richtung irrt die MERKMAL-PRUEFUNG von `run` (Issue #858): Es liest
 * nicht nur den Rueckgabewert, sondern prueft die Ausgabe jedes Kommandos auf eine
 * feste Liste allgemeiner Fehlermerkmale (`FEHLERMERKMALE`). Ein
 * Treffer laesst die Pruefung fehlschlagen, auch bei Rueckgabewert 0 — und ein
 * falsches Rot ist hier die sichere Richtung: Es kostet eine Nachfrage, waehrend
 * ein falsches Gruen ein gescheitertes Paket nach In review traegt.
 *
 * Neben den Bereichen waehlt das Kommando nach einer STUFE aus (Issue #758):
 * `--stufe paket|push|merge` sagt, welcher Zeitpunkt gefahren wird. Die Stufen
 * sind kumulativ — `push` faehrt `paket` mit —, ein Eintrag
 * ohne `stufe` gilt als Paketstufe, und damit bleibt jede bestehende Config
 * unveraendert. Die beiden Achsen beantworten Verschiedenes: `areas`/`always`
 * sagen, OB eine Pruefung betroffen ist, `stufe` sagt, WANN sie an der Reihe ist.
 *
 * An der PUSH-STUFE faellt die erste Achse weg: Dort laeuft jede faellige Pruefung,
 * auch bei leerem Paket und unberuehrten Bereichen (Plan #843, E9). Gemessen wird der
 * Stand, der hinausgeht — und der besteht aus mehr als dem letzten Arbeitspaket.
 *
 * Die FREIGABESTUFE `merge` prueft nur, was `push main` nicht geprueft hat (Issue
 * #1000): `merge production` gibt es nie ohne vorheriges `push main`. Es laufen die
 * Pruefungen der Stufe `merge` und die der Paketstufe nach Bereichen ueber die Dateien
 * seit dem Anker; die Stufe `push` bleibt mit Grund aus.
 *
 * `--bereich <name>` faehrt die Pruefgruppen genau eines `checkAreas`-Bereichs
 * (Issue #922, Plan #917, E3). Es ist der vorgesehene Weg, wenn fuer die
 * geaenderte Datei nur die vollstaendige Gruppe existiert — dann ist der
 * Gruppenlauf kein Verstoss gegen die Zehn-Minuten-Marke, sondern der Fall, fuer
 * den das Flag da ist. Ohne es waere derselbe Lauf von Hand am Kommando vorbei
 * gefahren, und aus den Daten liesse sich Notwendigkeit nicht von Umgehung
 * trennen.
 *
 * Die vierte Achse ist `nichtBeimAbschluss` (Issue #946, Plan #944): Sie sagt, dass
 * eine Pruefung den Abschluss eines einzelnen Arbeitspakets nicht tragen muss, weil
 * sie nur das Zusammenspiel prueft (`zusammenspiel`) oder ihren Befund aus der
 * vollstaendigen Testmenge gewinnt (`volleTestmenge`). Gewirkt wird sie allein durch
 * `--abschluss [n]`, den Schalter, den der Abschluss genau einer Karte setzt — dort
 * bleibt sie aus, samt Guetemessung, und vor dem Veroeffentlichen laeuft beides wieder.
 *
 * Haelt der Lauf an der PUSH-STUFE an, nennt er zu jeder roten Pruefung die Karten, die
 * sie beruehrt haben (Issue #947, AK 4 des Fachplans #938) — gelesen aus den Commits
 * `<basis>..HEAD`, mit der Kartennummer aus der Commit-Botschaft und ohne Board und ohne
 * Netz (E6). Der Anker ist der `--since`-Wert des Laufs, den `/push-main` schon heute als
 * `git merge-base HEAD origin/<mainBranch>` uebergibt (E5). Nur an dieser Stufe: An der
 * Freigabe ist die Basis `HEAD` selbst, und `<basis>..HEAD` waere leer. Die Suche ist
 * Buchhaltung ueber einen bereits gefallenen Befund — ihr eigenes Scheitern steht als
 * Grund an der Stelle der Karten und aendert am Ausgang des Laufs nichts.
 *
 * Auch hier ist die Richtung einseitig: Wer `--abschluss` VERGISST, prueft mehr. Darum
 * bleibt jeder Commit von Hand und jeder Aufruf aus `/local-check` unveraendert, und
 * darum haengt das Gate des Abschlusses (mindestens ein Paketstufen-Eintrag, der weder
 * `nichtBeimAbschluss` noch `guete` traegt) am Schalter statt an jedem Aufruf.
 *
 * Aufruf im Projekt-Root:  node .claude/kit/checks.mjs plan [--since <ref>] [--stufe <s>] [--bereich <name>] [--abschluss [n]]
 *                          node .claude/kit/checks.mjs run  [--since <ref>] [--stufe <s>] [--bereich <name>] [--abschluss [n]] [--frisch]
 *                          node .claude/kit/checks.mjs bereiche
 *
 * `bereiche` (Issue #1004, Plan #1001) rechnet keine Auswahl, sondern den Zuschnitt: je
 * Bereich, in wie vielen Pruefkommandos er steht, und das Inventar der versionierten
 * Dateien ohne Bereich — ueber dieselbe Zuordnung, die jede Auswahl trifft.
 *
 * Die Ausgabe von `plan` ist immer JSON, es gibt kein --json-Flag: `board.mjs
 * issue get` liefert ebenfalls JSON ohne Flag, und eine zweite Ausgabeform waere
 * zweite Pflege. `run` schreibt fuer Menschen und legt seine maschinenlesbare
 * Fassung in der Zusammenfassung ab.
 *
 * Keine Laufzeitabhaengigkeit ausserhalb der Node-Standardbibliothek — das Kit
 * liefert seine Werkzeuge als eigenstaendig portable Einzeldateien aus. Deshalb
 * traegt die Datei auch ihre eigene Minimal-Glob-Fassung statt eines Pakets.
 */

import { lstatSync, existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, realpathSync, unlinkSync, linkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Kit-Stand, aus dem diese Datei stammt (Issue #170). Bewusst KEINE eigene
// Versionsachse: der Wert ist die Kit-Version aus install.mjs und wird von
// tools/sync-blobs.mjs eingestempelt. Nicht von Hand aendern.
const KIT_VERSION = "3.5.1";

// Ort der Zusammenfassung, die `run` hinterlaesst (Issue #424, Entscheidung A4 des
// Plans #421): derselbe Ort wie das Nachtprotokoll (`LOG_FILE` in night.mjs) — im
// Projekt, aber hinter der Ignore-Regel `.claude/*`. Damit bleibt der Working Tree
// sauber und der harte Stopp auf dirty (Issue #152) greift nicht.
//
// Fester Dateiname, kein Zeitstempel: Der Nacht-Runner loescht die Datei vor jeder
// Session (Issue #428), es zaehlt also immer nur der Lauf der laufenden Session —
// und innerhalb einer Session der letzte. Eine Session darf `run` mehrfach fahren
// (rot, Fix, erneut), daraus entsteht bewusst keine Historie.
const SUMMARY_DATEI = ".claude/checks-summary.json";

// Das Ausfuehrungsprotokoll (Issue #785, Plan #782, E17) — die Zaehleinheit, die der
// Zusammenfassung daneben fehlt.
//
// Die Zusammenfassung traegt bewusst keine Historie (Kommentar zu SUMMARY_DATEI): Der
// Nacht-Runner loescht sie vor jeder Session, und innerhalb einer Session ueberschreibt
// jeder `run` den vorigen. Die Wirksamkeits-Auswertung fragt aber, wie oft eine Pruefung
// lief und wie oft sie beanstandet hat — und genau diese Zahl verliert die
// Zusammenfassung: Eine Pruefung, die rot anschlaegt, worauf die Session den Mangel
// behebt und erneut prueft, hinterliesse dort einen gruenen Endstand. Sie erschiene als
// "nie beanstandet" und loeste damit genau den Befund aus, der zu ihrer Abschaffung
// einlaedt — die Kennzahl truege systematisch das falsche Vorzeichen.
//
// Deshalb eine eigene Datei, angehaengt und nie geleert, nach dem Muster der Wegmarken
// (board-9). Derselbe Ort wie die Zusammenfassung: im Projekt, aber hinter der
// Ignore-Regel `.claude/*`.
//
// MESSGRENZE (E17): Die Salvage-Pruefungen des Nacht-Runners rufen die Kommandos roh
// ueber spawnSync auf und laufen an checks.mjs vorbei; ihre Ausfuehrungen stehen hier
// nicht. Der Salvage ist ein Rettungsversuch am Rand eines gescheiterten Pakets, keine
// Pruefung eines Arbeitspakets — ihn mitzuzaehlen mischte zwei Zaehleinheiten.
//
// SYNC: kit/night.mjs nimmt denselben Pfad im Rest-Guard aus (`:(exclude)` in gitReste,
// dazu der Worktree-Spiegel), kit/wirksamkeit.mjs liest die Datei. Die Kit-Werkzeuge sind
// bewusst eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440), geteilte
// Konstanten werden dupliziert und hier markiert.
const AUSFUEHRUNGEN_DATEI = ".claude/ausfuehrungen.tsv";

// Altlast aus SDD, Rueckbau mit dem uebernaechsten Major (Plan #825, A5): Bis zum
// Rueckbau von Spec-Driven Development legte `/techplan` wartende Vorhaben-Notizen hier
// ab. Heute entsteht keine mehr, aber in Zielprojekten kann noch eine liegen — kein
// Code-Zustand, also keine geaenderte Datei eines Arbeitspakets.
//
// Der Ausschluss steht ausdruecklich im Code, obwohl `.gitignore` den Pfad meist
// schon deckt: Der Installer laesst eine vorhandene eigene `.claude`-Regel
// unangetastet, also gibt es Projekte ohne den Block. Dort waere die Notiz sonst
// sichtbar und wuerde eine Pruefung ausloesen, zu der sie nicht gehoert.
//
// Praefix, kein Teilstring: Genau diese Menge nimmt `:(exclude).claude/vorhaben-wartend-*`
// in `gitClean()` von night.mjs aus. Ein Teilstring-Match traefe zusaetzlich
// `sub/.claude/vorhaben-wartend-x.md` in einem Unterprojekt — die Datei waere hier
// unsichtbar und im Rest-Guard ein Rest.
const WARTEND_PRAEFIX = ".claude/vorhaben-wartend-";

/**
 * Der Pfad der Zusammenfassung. Exportiert, damit night.mjs ihn importieren kann,
 * statt ihn ein zweites Mal auszurechnen (Issue #428) — derselbe Grund, aus dem
 * `run` seine Auswahl von `plan` bezieht und nicht neu berechnet.
 */
export function zusammenfassungPfad(root = process.cwd()) {
  return join(root, ...SUMMARY_DATEI.split("/"));
}

/**
 * Der Vergleich fuer Textlisten: derselbe, den `sort` ohne Argument nimmt.
 *
 * Ausgeschrieben statt weggelassen, damit an jeder Fundstelle steht, dass die
 * Reihenfolge Absicht ist (S2871). Bewusst **nicht** `localeCompare`: Dessen
 * Reihenfolge haengt an der Locale der Maschine, und zwei Laeufe muessen
 * ueberall dieselbe Liste ergeben — Dateiliste und Bereichsnamen stehen im
 * Bericht und in der Zusammenfassung.
 *
 * SYNC: dieselbe Funktion steckt in kit/befunde.mjs, kit/night.mjs und
 * kit/wirksamkeit.mjs — Aenderungen dort nachziehen. Die Kit-Werkzeuge sind bewusst eigenstaendige
 * Single-File-Tools ohne gemeinsames Modul (#440); geteilte Logik wird dupliziert
 * und hier markiert.
 *
 * Exportiert, damit der Locale-Test sie direkt pruefen kann (Issue #493).
 */
export function vergleicheText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Rangfolge der Pruefzeitpunkte (Issue #758). Die Reihenfolge IST die Regel: Eine
// Pruefung ist faellig, sobald der Index ihrer Stufe den der gefahrenen nicht
// uebersteigt — daraus folgt die Kumulation, ohne sie zweitens aufzuschreiben.
const STUFEN = ["paket", "push", "merge"];

// Die Werte der vierten Achse `nichtBeimAbschluss` (Issue #946, Plan #944). Sie ist
// keine zweite Stufe: Die Stufe sagt, WANN eine Pruefung faellig ist, diese Achse sagt,
// WARUM sie den Abschluss eines einzelnen Arbeitspakets nicht tragen muss — weil sie nur
// das Zusammenspiel prueft oder ihren Befund aus der vollstaendigen Testmenge gewinnt.
// Eine geschlossene Werteliste und kein Freitext: Der Wert steht im Auslassungsgrund und
// wird damit gelesen; ein Freitext waere an jeder Stelle anders formuliert, und die
// Auswertung koennte die Gruppen nicht zaehlen.
const NICHT_BEIM_ABSCHLUSS = ["zusammenspiel", "volleTestmenge"];

/**
 * Die allgemeinen Fehlermerkmale (Issue #858, Fachplan #769, AK 2): Merkmale, an
 * denen eine Ausgabe ihr Scheitern selbst ausweist, auch wenn der Rueckgabewert 0
 * ist. Genau der Fall kommt vor — eine Maven-Kette, deren letztes Glied den
 * Rueckgabewert verschluckt, meldet `BUILD FAILURE` in der Ausgabe und endet mit 0.
 *
 * Die Liste ist FEST und hat kein Config-Feld (Plan #810, E3). Ein Feld waere die
 * Einladung, sie in dem Projekt zu leeren, in dem sie gerade stoert — also an genau
 * der Stelle, an der sie gebraucht wird. Ein Projekt, dessen gruene Ausgabe legitim
 * eines der Merkmale traegt, filtert es in seinem `cmd` selbst heraus (die Doku
 * nennt den Weg): eine Entscheidung, die im Projekt sichtbar bleibt, statt die
 * Pruefung fuer alle abzuschalten.
 *
 * Steht hier oben und nicht bei `fehlermerkmal`, weil `HELP` die Liste nennt — ein
 * `const` weiter unten waere dort noch nicht initialisiert.
 */
const FEHLERMERKMALE = ["[ERROR]", "BUILD FAILURE"];

// Die Namen und Vorgaben der maschinenweiten Sperre (Issue #958). Der Mechanismus
// selbst steht unten bei `mitSperre`; hier oben stehen nur diese Werte, und zwar aus
// demselben Grund wie FEHLERMERKMALE: `HELP` nennt sie, und ein `const` weiter unten
// waere dort noch nicht initialisiert.

/** Der Name der Umgebungsvariablen fuer den Sperrpfad. */
export const SPERRE_ENV = "KIT_CHECKS_LOCK";

/** Der Name der Umgebungsvariablen fuer die Obergrenze der Wartezeit. */
export const SPERRE_GRENZE_ENV = "KIT_CHECKS_LOCK_TIMEOUT_MS";

const SPERRE_DATEI = "kit-checks-run.lock";

// Zwanzig Minuten. Die Zehn-Minuten-Marke dieses Projekts gilt fuer den Prueflauf
// EINES Arbeitspakets; zwei Laeufe nacheinander sind damit die Groessenordnung, auf
// die zu warten sich lohnt. Darueber ist die Annahme "der andere Lauf ist bald
// fertig" nicht mehr tragfaehig, und Weiterlaufen kostet weniger als Weiterwarten.
const SPERRE_GRENZE_VORGABE_MS = 20 * 60 * 1000;

// Halbe Sekunde zwischen zwei Blicken auf die Sperre. Kurz genug, dass die Wartezeit
// gegenueber einem Prueflauf nicht ins Gewicht faellt, lang genug, dass das Warten
// selbst keine Last erzeugt — was der ganze Zweck ist.
const SPERRE_ABSTAND_MS = 500;

// Die Obergrenze der Dauer EINER Pruefung (Issue #1003, Plan #1001, E3, E4). Bewusst
// kein Config-Feld: Die Grenze ist eine Aussage des Kits darueber, wie lange eine
// Pruefung im Abschluss eines Pakets dauern darf, und keine Vorliebe des Projekts. Sie
// vermerkt nur und faerbt nie rot — eine langsame, aber gruene Pruefung ist ein
// Zuschnittsproblem der Konfiguration und kein Fehler der Karte.
export const PRUEFDAUER_OBERGRENZE_MS = 30_000;

// Allein fuer Tests: Ein Test, der dreissig Sekunden schlaeft, um die Grenze zu
// reissen, verlaengerte die Suite, deren Laufzeit die Grenze gerade begrenzen soll.
export const OBERGRENZE_ENV = "KIT_CHECKS_PRUEFDAUER_OBERGRENZE_MS";

// Wie viele gekennzeichnete Pruefungen hoechstens gleichzeitig laufen (Issue #1071, Plan
// #1066, A5, E3). Kein Config-Feld aus demselben Grund wie die Obergrenze: Die Zahl sagt
// etwas ueber die Maschine, nicht ueber das Projekt. Die Umgebungsvariable uebersteuert
// sie — `1` faehrt die gekennzeichneten nacheinander.
export const GLEICHZEITIG_ENV = "KIT_CHECKS_GLEICHZEITIG";
const GLEICHZEITIG_VORGABE = 4;

// Der Vermerk hinter der Dauer einer gleichzeitig gelaufenen Pruefung (Issue #1071). Hier
// oben, weil `HELP` ihn nennt.
export const NEBEN_MARKE = "neben anderen gemessen";

// Ab wie vielen bereichsgebundenen Kommandos die Hervorhebung eines Bereichs greift
// (Issue #1004, Plan #1001, E8). Bei zwei Kommandos waere jeder Bereich "in allen bis
// auf eines" — die Regel sagte dann nichts mehr. Hier oben, weil `HELP` sie nennt.
const HERVORHEBUNG_AB_KOMMANDOS = 3;

const HELP = `checks.mjs (claude-workflow-kit v${KIT_VERSION}) — faellige Pruefungen

  node checks.mjs plan [--since <ref>] [--stufe <stufe>] [--bereich <name>] [--abschluss [n]]
  node checks.mjs run  [--since <ref>] [--stufe <stufe>] [--bereich <name>] [--abschluss [n]] [--frisch]
  node checks.mjs bereiche

plan  Gibt als JSON aus, welche buildChecks nach dem aktuellen Arbeitspaket
      laufen muessen und welche ausgelassen werden koennen — jede Entscheidung
      mit Grund. Ausgefuehrt wird nichts.
run   Fuehrt genau diese Auswahl in zwei Phasen aus und schreibt die
      Zusammenfassung nach ${SUMMARY_DATEI}. Zuerst laufen die mit
      'gleichzeitig' gekennzeichneten Pruefungen gleichzeitig, hoechstens
      ${GLEICHZEITIG_ENV} auf einmal (Vorgabe ${GLEICHZEITIG_VORGABE}; 1 faehrt sie
      nacheinander). Diese Phase laeuft vollstaendig durch, damit alle roten
      bekannt sind; ihre Ausgabe steht je Pruefung als geschlossener Block in
      Config-Reihenfolge, und die Berichtszeile vermerkt bei der Dauer
      '(${NEBEN_MARKE})'. Danach laufen die uebrigen nacheinander in
      Config-Reihenfolge und brechen beim ersten roten Check ab; nach einem Rot
      der ersten Phase starten sie nicht. Ein roter Lauf endet mit Exit
      ungleich 0.
      Neben dem Rueckgabewert prueft 'run' die Ausgabe jedes Kommandos auf eine
      feste Liste allgemeiner Fehlermerkmale (${FEHLERMERKMALE.join(", ")}). Ein
      Treffer faerbt die Pruefung rot, auch bei Rueckgabewert 0 — kein
      Config-Feld schaltet das ab. Ein falsches Rot ist die sichere Richtung:
      Das Kommando irrt nur in eine Richtung, mehr pruefen.
      Die Zusammenfassung BEGLEITET den Lauf: Sie entsteht vor dem ersten
      Kommando und wird vor jedem weiteren und nach jedem gleichzeitig
      gelaufenen ueberschrieben; ein laufendes Kommando steht darin noch auf
      'nicht gestartet'. Erst die letzte Fassung
      traegt 'abgeschlossen': true. Ein Lauf, der an der Uhr oder mit seiner
      Session stirbt, hinterlaesst damit einen Stand, der nie ganz gruen ist.
      Hat sich der Stand seit dem letzten Lauf nicht geaendert — gleicher Anker,
      gleiche Stufe, dieselben Dateien mit denselben Blob-Hashes, dieselbe
      Config —, laeuft kein Kommando: 'run' uebernimmt das Ergebnis des
      vorigen Laufs (auch ein rotes) samt Exitcode und schreibt den Nachweis
      mit frischem Zeitpunkt neu. '--frisch' erzwingt den echten Lauf.
      War der vorige Lauf ROT und hat sich seither nur der Stand geaendert,
      nicht die Auswahl — gleicher Anker, gleiche Stufe, dieselbe Config,
      dieselben ausgewaehlten Kommandos in derselben Reihenfolge, aber andere
      Dateien oder Blob-Hashes —, faehrt 'run' zuerst einen TEILLAUF mit nur
      den zuletzt roten Kommandos, nach denselben Achsen wie der volle Lauf.
      Werden sie gruen, folgt im selben Aufruf genau einmal der volle Lauf als
      Nachweis; bleiben sie rot, endet der Aufruf rot, die uebrigen stehen auf
      'nicht gestartet', die Zusammenfassung traegt 'teillauf': true und der
      Berichtsblock vor den Zeilen 'Teillauf: nur die zuletzt roten
      Pruefungen'. Nach einer Korrektur genuegt darum derselbe Aufruf wie
      zuvor. '--frisch' ueberspringt den Teillauf und faehrt sofort alles.
      Als rotes Kommando nennt jede Meldung das erste mit Ergebnis 'rot', erst
      ohne ein solches das erste ungruene.
      Am Ende steht der Block 'Fuer den Abschlussbericht:' mit fertigen Zeilen
      ('gelaufen: <Kommando> → <Ergebnis>, <Dauer> — <Grund>' und
      'ausgelassen: <Kommando> → <Grund>'), auch beim uebernommenen Lauf; das
      Feld 'berichtszeilen' der Zusammenfassung traegt dasselbe. Eroeffnet
      wird der Block von der Zeile 'Wartezeit: <s> s, zusammen <s> s in <n>
      Laeufen fuer Karte #<n>', ohne Kartennummer nur 'Wartezeit: <s> s'. Die
      erste Zahl ist die Wanduhr dieses Laufs vom Aufruf bis zum Ergebnis,
      samt Warten auf die Sperre (Feld 'wartezeitMs'; 'dauerGesamtMs' bleibt
      die Summe der Einzeldauern). Die zweite zaehlt mit --abschluss <n> alle
      Laeufe derselben Karte zusammen (Feld 'wartezeitKarte'); ein
      uebernommener Lauf zaehlt als Lauf ohne Zeit. Nachts beginnt die Summe
      mit jeder Session neu, weil der Runner die Zusammenfassung vor jeder
      Runde verwirft; die Summe ueber Sessions liefert der Nachtbericht. Dauert eine
      Pruefung laenger als ${PRUEFDAUER_OBERGRENZE_MS} ms, vermerkt ihre Zeile
      die Ueberschreitung (Feld 'ueberObergrenzeMs'); rot wird der Lauf davon
      nicht.
      An der Stufe 'push' nennt ein roter Lauf die VERURSACHER: die Karten, deren
      Commits seit dem Anker einen Bereich der roten Pruefung beruehrt haben,
      gelesen aus '(Issue #<n>)' im Betreff und 'Refs #<n>' im Rumpf. Ein Commit
      ohne erkennbare Nummer erscheint mit seiner Kurz-SHA, eine Pruefung ohne
      Bereichszuordnung gilt als von jeder Karte beruehrt. Beruehrt keine Karte
      die Pruefung, steht das als Satz da und nicht als leere Liste; laesst sich
      der Anker nicht aufloesen oder scheitert ein git-Aufruf, steht der Grund an
      derselben Stelle. Die Suche erklaert einen gefallenen Befund und aendert am
      Ausgang des Laufs nichts.
      EIN Prueflauf je Maschine: Vor dem ersten Kommando nimmt 'run' eine
      maschinenweite SPERRE (${sperrPfad()}) und gibt sie nach dem
      letzten wieder frei, auch bei rotem Ergebnis und bei einem Abbruch.
      Haelt sie ein laufender Prozess, wird gewartet; ist ihr Halter tot, wird
      sie abgeraeumt — beides mit Protokollzeile. Sie ist Vorsorge gegen Last
      und kein Gate: Nach ${SPERRE_GRENZE_VORGABE_MS} ms laeuft der Prueflauf
      trotzdem und sagt es. Ein uebernommenes Ergebnis wartet nie, es faehrt
      kein Kommando. Beides ist ueber die Umgebung zu setzen:
      ${SPERRE_ENV} den Pfad (leer = Vorgabe),
      ${SPERRE_GRENZE_ENV} die Obergrenze in Millisekunden. Die eigene
      Testsuite braucht den Pfad, damit ihre parallelen Dateien sich nicht
      gegenseitig serialisieren.
      Jede Ausfuehrung haengt eine Zeile an ${AUSFUEHRUNGEN_DATEI}; hinten
      stehen ihr Ausloeser (bereiche | ohne-bereich | ohne-zuordnung |
      veroeffentlichung | anker), die ausloesenden Bereiche und beim vollen
      Umfang die Dateien ohne Muster, als letztes 'gleichzeitig', wenn die
      Dauer neben anderen Pruefungen gemessen wurde.
bereiche
      Gibt als JSON aus, wie die Bereiche zugeschnitten sind: je Bereich
      seine Muster, in wie vielen der bereichsgebundenen Kommandos der
      Paketstufe er steht ('nennend' von 'von'), ob er hervorgehoben ist
      (in allen oder allen bis auf eines, ab ${HERVORHEBUNG_AB_KOMMANDOS} Kommandos) und
      den Grund aus 'gekoppelteBereiche'. Dazu das Inventar: alle von git
      versionierten Dateien ohne checkAreas-Treffer, getrennt in
      freigestellt (ohnePruefung, mit Grund) und ohne jede Zuordnung.

  --since <ref>   Anker, gegen den die Aenderungen ermittelt werden (Default HEAD).
                  Laesst sich der Anker nicht aufloesen — auch bei leerem Wert —,
                  laufen alle Pruefungen.
  --stufe <s>     Gefahrener Zeitpunkt: ${STUFEN.join(" | ")} (Default ${STUFEN[0]}).
                  push faehrt paket mit. Pruefungen spaeterer Stufen erscheinen
                  mit Grund als ausgelassen. push faehrt jede faellige Pruefung,
                  auch bei leerem Paket und unberuehrten Bereichen. merge prueft
                  nur, was push main nicht geprueft hat: die Stufe merge immer,
                  die Paketstufe nach Bereichen ueber die Dateien seit --since,
                  die Stufe push nicht.
  --bereich <n>   Faehrt die Pruefgruppen genau eines checkAreas-Bereichs, statt
                  die beruehrten aus den geaenderten Dateien zu bestimmen. Der
                  vorgesehene Weg, wenn fuer die geaenderte Datei nur die
                  vollstaendige Gruppe existiert — ein so begruendeter
                  Gruppenlauf ist kein Verstoss gegen die Zehn-Minuten-Marke,
                  sondern sein sanktionierter Fall. Ein unbekannter Name bricht
                  ab und nennt die konfigurierten Bereiche. Kombinierbar mit
                  --since, --stufe und --frisch: '--bereich' sagt, OB eine
                  Pruefung betroffen ist, '--stufe' weiter, WANN sie dran ist.
  --abschluss [n] Dieser Lauf schliesst genau ein Arbeitspaket ab. Dann bleibt
                  jede Pruefung mit 'nichtBeimAbschluss' aus und die
                  Guetemessung ebenso — beide mit Grund in der Liste der
                  Auslassungen, und beide laufen vor dem Veroeffentlichen
                  wieder mit. Die Kartennummer ist optional und dient der
                  Auswertung je Karte; ein Wert, der keine Nummer ist, bricht
                  ab. Nicht zusammen mit --stufe push|merge (dort laeuft
                  gerade, was der Abschluss auslaesst) und nicht zusammen mit
                  --bereich (zwei Eingrenzungen in einem Lauf). Gesetzt wird
                  der Schalter allein vom Abschluss einer Karte: Wer ihn
                  vergisst, prueft mehr.
  --frisch        Nur fuer 'run': kein Ergebnis uebernehmen und keinen Teillauf
                  mit den zuletzt roten fahren, sondern alle faelligen
                  Kommandos wirklich fahren — etwa beim Verdacht auf einen
                  wackligen Test.
  --help, -h      Diese Uebersicht (laeuft als einziger Aufruf ohne Config).

Gelesen wird .claude/workflow.config.json im Arbeitsverzeichnis: 'buildChecks'
(Kommandostring oder { cmd } mit den Achsen 'areas'/'always', 'stufe', 'guete'
und 'nichtBeimAbschluss': ${NICHT_BEIM_ABSCHLUSS.join(" | ")} — die Pruefung
zaehlt erst beim Veroeffentlichen und bleibt im Abschlusslauf aus, sowie
'gleichzeitig': true — die Pruefung laeuft in der ersten Phase neben anderen) und
'checkAreas' (Bereichsname -> Pfadmuster). Muster kennen '*' innerhalb eines
Pfadsegments und '**' ueber Segmentgrenzen; ein Verzeichnis erfasst man als
'frontend/**'.
`;

class ChecksError extends Error {}

function fail(nachricht) {
  throw new ChecksError(nachricht);
}

function git(...args) {
  return spawnSync("git", args, { cwd: process.cwd(), encoding: "utf-8" });
}

// --- Config ----------------------------------------------------------------

function ladeConfig() {
  const pfad = join(process.cwd(), ".claude", "workflow.config.json");
  if (!existsSync(pfad)) {
    fail(`Keine .claude/workflow.config.json unter ${process.cwd()} — bitte im Projekt-Root starten.`);
  }
  try {
    return JSON.parse(readFileSync(pfad, "utf-8"));
  } catch (err) {
    return fail(`.claude/workflow.config.json ist kein gueltiges JSON: ${err.message}`);
  }
}

/**
 * Die String-Form und das Objekt nur mit `cmd` bedeuten dasselbe.
 *
 * Die fehlende `stufe` wird hier auf `paket` gesetzt und nicht erst bei der
 * Auswahl (Issue #758): So laufen die String-Form, das Objekt ohne `stufe` und
 * das Objekt mit `stufe: "paket"` durch dieselbe Bahn, und jede bestehende
 * Config behaelt ihr Verhalten. Ein Default, der an jeder Lesestelle einzeln
 * nachgezogen wuerde, waere die naechste Stelle, an der er einmal fehlt.
 */
function normalisiere(check) {
  const objekt = typeof check === "string" ? { cmd: check } : check;
  // Ein unbekannter Wert bricht ab wie eine unbekannte Stufe (Issue #946): Er bliebe
  // sonst wirkungslos, die Pruefung liefe beim Abschluss weiter mit, und der Autor der
  // Config haette den Gegenteil-Effekt bestellt, ohne es zu merken. Hier und nicht in
  // einer eigenen Regel darunter, weil der Wert genau hier durch die eine Bahn geht,
  // durch die auch die fehlende Stufe geht.
  const nichtBeimAbschluss = objekt.nichtBeimAbschluss ?? null;
  if (nichtBeimAbschluss !== null && !NICHT_BEIM_ABSCHLUSS.includes(nichtBeimAbschluss)) {
    const genannt = typeof nichtBeimAbschluss === "string" ? `'${nichtBeimAbschluss}'` : JSON.stringify(nichtBeimAbschluss);
    fail(`Unbekannter Wert ${genannt} fuer nichtBeimAbschluss bei Pruefung '${objekt.cmd}'. Erwartet: ${NICHT_BEIM_ABSCHLUSS.join(", ")}.`);
  }
  return { ...objekt, stufe: objekt.stufe ?? STUFEN[0], nichtBeimAbschluss, gleichzeitig: objekt.gleichzeitig === true };
}

/**
 * Ein vertippter Bereichsname wuerde eine Pruefung still nie laufen lassen —
 * genau der Fehler, den dieses Kommando verhindern soll. Also Abbruch.
 *
 * Ein LEERES `areas`-Array und die Kombination `areas` + `always` sind hier
 * nicht zu pruefen: Das Schema schliesst beide aus (minItems 1, not). Was das
 * Schema verhindert, muss die Laufzeit nicht erklaeren (Issue #422).
 */
// SYNC: dieselbe Regel prueft kit/einstellungen.mjs (regelBereiche) vor dem Speichern.
function pruefeBereichsnamen(checks, checkAreas) {
  const bekannt = new Set(Object.keys(checkAreas));
  for (const check of checks) {
    for (const name of check.areas ?? []) {
      if (!bekannt.has(name)) {
        const liste = bekannt.size > 0 ? [...bekannt].join(", ") : "keine";
        fail(`Unbekannter Bereich '${name}' bei Pruefung '${check.cmd}'. Bekannt aus checkAreas: ${liste}.`);
      }
    }
  }
}

/**
 * Die Grenzen der Guetemessung (Issue #763, Plan #753): hoechstens ein Eintrag
 * traegt `guete`, und nie mit `stufe: "merge"` — eine Messung erst vor der
 * Freigabe kaeme zu spaet, um noch etwas zu aendern. Beides prueft das Schema
 * nicht: Es sind Aussagen ueber die Liste bzw. ueber zwei Felder zusammen.
 * Derselbe Weg wie beim unbekannten Bereichsnamen: Abbruch statt stiller Wahl.
 */
// SYNC: dieselbe Regel prueft kit/einstellungen.mjs vor dem Speichern (Issue #764).
function pruefeGuete(checks) {
  const traeger = checks.filter((check) => check.guete);
  if (traeger.length > 1) {
    const liste = traeger.map((check) => `'${check.cmd}'`).join(", ");
    fail(`Mehr als eine Guetemessung: ${liste} tragen alle 'guete' — hoechstens ein Eintrag darf messen.`);
  }
  if (traeger[0]?.stufe === "merge") {
    fail(`Die Guetemessung '${traeger[0].cmd}' traegt stufe 'merge' — eine Messung erst vor der Freigabe kaeme zu spaet. Zulaessig: paket oder push.`);
  }
}

/**
 * Die Achse `nichtBeimAbschluss` gehoert an die Paketstufe (Issue #946, Plan #944).
 *
 * An einem Eintrag der Stufe `push` oder `merge` sagt sie nichts: Dort laeuft die
 * Pruefung beim Abschluss ohnehin nicht, die Stufe hat es schon entschieden. Ein Feld,
 * das nichts bewirkt, ist entweder ein Irrtum ueber die Achse oder ein Rest — beides
 * faellt hier auf und nicht erst dem naechsten Leser der Config. Derselbe Weg wie beim
 * unbekannten Bereichsnamen: Abbruch statt stiller Wirkungslosigkeit.
 *
 * Diese Regel gilt UNBEDINGT, weil sie eine Aussage ueber die Config selbst ist — anders
 * als `pruefeAbschlussGate`, das eine Aussage ueber den Abschlusslauf trifft.
 */
// SYNC: dieselbe Regel prueft kit/einstellungen.mjs vor dem Speichern (Issue #949).
function pruefeNichtBeimAbschlussStufe(checks) {
  for (const check of checks) {
    if (!check.nichtBeimAbschluss) continue;
    if (check.stufe === STUFEN[0]) continue;
    fail(`Die Pruefung '${check.cmd}' traegt nichtBeimAbschluss und stufe '${check.stufe}' — dort laeuft sie beim Abschluss ohnehin nicht. Die Achse gilt fuer die Stufe '${STUFEN[0]}'.`);
  }
}

/**
 * Das Gate des Abschlusses (Issue #946, Plan #944, E4): Ein Abschlusslauf laesst die
 * Guetemessung und jede Pruefung mit `nichtBeimAbschluss` aus. Traegt JEDER Eintrag der
 * Paketstufe eines von beiden, bleibt nichts uebrig — der Lauf waere gruen, weil er nichts
 * gefahren hat, und ein leeres Gate faellt an nichts auf.
 *
 * Geprueft wird NUR im Abschlusslauf, nicht bei jedem Aufruf. Dieselbe Config bleibt fuer
 * jeden anderen Lauf gueltig, und sie ist es auch: Ohne den Schalter laufen beide
 * Pruefungen. Ein unbedingter Abbruch naehme dagegen einem `/local-check` oder einem Commit
 * von Hand die Pruefung weg, obwohl dort nie etwas ausgelassen wurde — und genau das
 * schliesst die einseitige Richtung des Plans aus: Wer den Schalter nicht setzt, prueft mehr.
 *
 * Eine Config OHNE Paketstufen-Eintrag faellt hier nicht durch: Sie hatte nie ein Gate,
 * die neue Achse aendert daran nichts, und der Zustand hat seine eigene Meldung im
 * Start-Guard des Nacht-Runners.
 */
// SYNC: als Warnung vor dem Speichern in kit/einstellungen.mjs (Issue #949), als Halt im
// Start-Guard von kit/night.mjs (Issue #950).
function pruefeAbschlussGate(checks) {
  const paketstufe = checks.filter((check) => check.stufe === STUFEN[0]);
  if (paketstufe.length === 0) return;
  if (paketstufe.some((check) => !check.nichtBeimAbschluss && !check.guete)) return;
  fail(`Kein Eintrag der Stufe '${STUFEN[0]}' laeuft beim Abschluss: jeder traegt nichtBeimAbschluss oder einen guete-Block. Damit hat der Abschluss eines Arbeitspakets kein Gate.`);
}

// --- Muster ----------------------------------------------------------------

const REGEX_SONDERZEICHEN = /[.+?^${}()|[\]\\]/;

/**
 * Minimal-Glob: '*' innerhalb eines Pfadsegments, '**' ueber Segmentgrenzen,
 * '/' als Trenner. Ein '**' samt folgendem Trenner darf ganz verschwinden, damit
 * ein Muster wie "doppelstern, Trenner, *.md" auch eine Datei im
 * Wurzelverzeichnis trifft und nicht erst eine in einem Unterverzeichnis.
 *
 * Exportiert, damit test/config-teile.test.mjs die Teile dieses Repos gegen
 * `git ls-files` prueft, ohne die Aufloesung ein zweites Mal zu schreiben
 * (Issue #850) — derselbe Grund wie bei `blobHashes` fuer befunde.mjs: Ab der
 * ersten Abweichung bescheinigte die zweite Fassung eine Abdeckung, die das
 * ausfuehrende Kommando nicht sieht.
 */
export function globZuRegex(muster) {
  let quelle = "";
  let i = 0;
  while (i < muster.length) {
    const zeichen = muster[i];
    if (zeichen !== "*") {
      quelle += REGEX_SONDERZEICHEN.test(zeichen) ? `\\${zeichen}` : zeichen;
      i += 1;
    } else if (muster[i + 1] === "*") {
      const mitTrenner = muster[i + 2] === "/";
      quelle += mitTrenner ? "(?:.*/)?" : ".*";
      i += mitTrenner ? 3 : 2;
    } else {
      quelle += "[^/]*";
      i += 1;
    }
  }
  return new RegExp(`^${quelle}$`);
}

/** Die Teile aus der Config als fertige Regexe. Exportiert aus demselben Grund wie `globZuRegex`. */
export function bereicheVorbereiten(checkAreas) {
  return Object.entries(checkAreas).map(([name, muster]) => ({
    name,
    regexe: (muster ?? []).map((m) => globZuRegex(m)),
  }));
}

/**
 * Ordnet jede geaenderte Datei ihren Bereichen zu. Die erste Datei, die kein
 * einziges Muster trifft, wird als `ohneMuster` gemeldet — sie loest den vollen
 * Umfang aus. Der Grund nennt seit Issue #1003 alle solchen Dateien
 * (`ohneMusterGrund`), sonst weiss niemand, welche Muster fehlen.
 *
 * Daneben steht `ohneZuordnung` mit ALLEN solchen Dateien (Issue #922, Plan
 * #917, E8): Der Beobachter fragt, welche Dateien kein Muster finden — nicht,
 * welche es als erste tat. Beides nebeneinander und nicht das eine aus dem
 * anderen: Der Grund-Text ist Text fuer Menschen und wird woertlich gelesen, die
 * Liste sind Daten. Wer die Liste aus dem Satz parsen muesste, haette beim ersten
 * Umformulieren des Satzes eine stille Fehlmessung.
 *
 * Die dritte Antwort ist `ohnePruefung` (Issue #934, Plan #930, E1): eine Datei,
 * zu der es ausdruecklich nichts zu pruefen gibt. Sie zaehlt weder als beruehrt
 * noch als unzugeordnet und traegt ihren Grund mit sich — die Ausnahme von der
 * Regel „im Zweifel laeuft alles" ist nur ertraeglich, wenn sie sich begruendet.
 */
function zuordnen(dateien, bereichsdefinition, freistellungen = []) {
  const beruehrt = new Set();
  const ohneZuordnung = [];
  const ohnePruefung = [];
  for (const pfad of dateien) {
    const treffer = bereichsdefinition.filter((b) => b.regexe.some((r) => r.test(pfad)));
    // HIER wirkt der Vorrang aus Plan #930, E3: Trifft eine Datei beide Musterarten,
    // gewinnt `checkAreas`, und die Freistellung bleibt fuer sie wirkungslos. Die
    // Auswahl darf nur in eine Richtung irren, naemlich zu mehr Pruefung. Andersherum
    // machte ein zu weit geratenes `ohnePruefung`-Muster einen ganzen Bereich still ab
    // — und ein Bereich, der nicht mehr laeuft, faellt an nichts auf ausser an der Zeit.
    if (treffer.length > 0) {
      for (const bereich of treffer) beruehrt.add(bereich.name);
      continue;
    }
    const frei = freistellungen.find((f) => f.regex.test(pfad));
    if (frei) {
      ohnePruefung.push({ pfad, grund: frei.grund });
      continue;
    }
    ohneZuordnung.push(pfad);
  }
  return { beruehrt, ohneMuster: ohneZuordnung[0] ?? null, ohneZuordnung, ohnePruefung };
}

/** Wie viele unzugeordnete Dateien der Grund des vollen Umfangs hoechstens beim Namen nennt. */
const GRUND_DATEIEN_HOECHSTENS = 10;

/**
 * Der Grund des vollen Umfangs wegen unzugeordneter Dateien (Issue #1003, Plan #1001,
 * E2). Er nennt ALLE solchen Dateien, nicht nur die erste: Wer den Bericht liest, soll
 * jedes fehlende Muster sehen und nicht eines nach dem anderen ueber mehrere Laeufe
 * entdecken. Ab der elften Datei steht nur noch die Zahl — ein Grund, der ueber den
 * Bildschirm laeuft, liest niemand; die volle Liste steht in `ohneZuordnung`.
 */
function ohneMusterGrund(ohneZuordnung) {
  const genannt = ohneZuordnung.slice(0, GRUND_DATEIEN_HOECHSTENS).map((pfad) => `'${pfad}'`).join(", ");
  const weitere = ohneZuordnung.length - GRUND_DATEIEN_HOECHSTENS;
  const liste = weitere > 0 ? `${genannt} und ${weitere} weitere` : genannt;
  return `voller Umfang: ${liste} ${ohneZuordnung.length === 1 ? "trifft" : "treffen"} kein Muster`;
}

/** Die pruefungsfreien Eintraege aus der Config als fertige Regexe samt Grund (Issue #934). */
function freistellungenVorbereiten(ohnePruefung) {
  return (ohnePruefung ?? []).map((e) => ({ regex: globZuRegex(e.muster), grund: e.grund }));
}

// --- Aenderungen -----------------------------------------------------------

function ankerAufloesen(refText) {
  // Der leere Wert wird gar nicht erst gefragt: Er ist die Spur einer
  // fehlgeschlagenen merge-base-Substitution und gilt als nicht aufloesbar.
  if (refText === "") return null;
  const res = git("rev-parse", "--verify", "--short", `${refText}^{commit}`);
  const basis = res.stdout.trim();
  return res.status === 0 && basis ? basis : null;
}

/**
 * Zerlegt die NUL-getrennte Ausgabe von `git diff --name-status -z`. Eine
 * Umbenennung (R) und eine Kopie (C) tragen zwei Pfade — beide zaehlen, denn eine
 * verschobene Datei aendert an beiden Enden etwas.
 */
function* diffPfade(roh) {
  const felder = roh.split("\0");
  let i = 0;
  while (i < felder.length) {
    const status = felder[i];
    i += 1;
    if (!status) continue;
    const anzahl = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (let n = 0; n < anzahl && i < felder.length; n += 1, i += 1) {
      if (felder[i]) yield felder[i];
    }
  }
}

function* untracktePfade(roh) {
  for (const eintrag of roh.split("\0")) {
    if (eintrag.startsWith("?? ")) yield eintrag.slice(3);
  }
}

/**
 * Alles, was das Arbeitspaket beruehrt hat: getrackte Aenderungen gegen den
 * Anker (angelegt, geaendert, geloescht, umbenannt) plus Ungetracktes.
 * `--untracked-files=all` ist Pflicht — sonst meldet git ein neues Verzeichnis
 * als einen einzigen Eintrag, und die Datei darin faende nie ihr Muster.
 *
 * Wartende Vorhaben-Notizen fallen hier heraus und nicht erst in `blobHashes`
 * (Issue #546): So beruehrt eine Notiz auch keine `checkAreas` und loest keinen
 * Bereichs-Check aus, zu dem sie nicht gehoert. Der Filter greift damit zugleich
 * fuer `hashes`, die Bereichszuordnung und die Zusammenfassung — alle leiten sich
 * aus `geaendert` ab. Bleibt danach nichts uebrig, ist das Paket leer: Was nicht
 * gestagt werden darf, muss auch nicht geprueft werden.
 */
function geaenderteDateien(basis) {
  const dateien = new Set();

  const diff = git("diff", "--name-status", "-z", basis);
  if (diff.status !== 0) fail(`git diff gegen '${basis}' schlug fehl: ${diff.stderr.trim()}`);
  for (const pfad of diffPfade(diff.stdout)) dateien.add(pfad);

  const status = git("status", "--porcelain", "-z", "--untracked-files=all");
  if (status.status !== 0) fail(`git status schlug fehl: ${status.stderr.trim()}`);
  for (const pfad of untracktePfade(status.stdout)) dateien.add(pfad);

  // Nach dem Trenner-Normalisieren gefiltert: Unter Windows kaeme der Pfad sonst
  // mit Backslash und der Praefix-Vergleich ginge daneben.
  return [...dateien]
    .map((p) => p.replaceAll("\\", "/"))
    .filter((p) => !p.startsWith(WARTEND_PRAEFIX))
    .sort(vergleicheText);
}

// --- Auswahl ---------------------------------------------------------------

function bereichsText(namen) {
  return `${namen.length === 1 ? "Bereich" : "Bereiche"} ${namen.join(", ")}`;
}

/**
 * String und `always: true` laufen beide immer, meinen aber Verschiedenes —
 * vergessen gegen entschieden. Nur der Grund haelt das auseinander.
 */
function entscheidung(check, beruehrt) {
  if (check.always) return { laeuft: true, grund: "als immer laufend festgelegt" };
  if (!check.areas) return { laeuft: true, grund: "nicht zugeordnet" };
  const treffer = check.areas.filter((name) => beruehrt.has(name));
  return treffer.length > 0
    ? { laeuft: true, grund: `${bereichsText(treffer)} beruehrt` }
    : { laeuft: false, grund: `${bereichsText(check.areas)} unberuehrt` };
}

/**
 * Verteilt jede Pruefung auf `laufen` oder `ausgelassen` — in der Reihenfolge der
 * Config, damit beide Listen so lesbar bleiben wie die Datei.
 *
 * Die STUFENAUSWAHL GREIFT VOR der Bereichsauswahl (Issue #758): Wer nicht dran
 * ist, wird gar nicht erst gefragt, ob er betroffen waere. Andersherum stuende im
 * Grund einer ausgelassenen Push-Pruefung „Bereich unberuehrt", obwohl sie auch
 * im beruehrten Bereich nicht gelaufen waere — ein Grund, der auf die falsche
 * Ursache zeigt, kostet beim naechsten Lesen mehr, als er erklaert.
 *
 * `entscheiden` bekommt nur die faelligen Pruefungen und beantwortet die zweite
 * Frage: die des jeweiligen Auswahlfalls (Anker, leeres Paket, Bereiche).
 *
 * Die GUETEMESSUNG laeuft an der Push-Stufe IMMER (Issue #763, E11): AK 8
 * des Fachplans (#738) macht ihr Ergebnis fuer den Stand massgeblich, der
 * veroeffentlicht werden soll — eine wegen leeren Pakets oder unberuehrten
 * Bereichs ausgelassene Messung liesse den Halt ins Leere laufen, und das faellt
 * niemandem auf. An der Paketstufe gilt die normale Auswahl: Dort wird ein
 * Arbeitspaket gemessen, kein Veroeffentlichungsstand. Der Eintrag behaelt
 * seinen `guete`-Block, damit `ausfuehren` die Auswertung nicht ein zweites Mal
 * aus der Config lesen muss. An der Freigabestufe hat sie diese Sonderrolle nicht
 * mehr (Issue #1000): Beim `push main` lief sie fuer denselben Stand, und dort folgt
 * sie der Auswahl der Freigabe wie jede andere Pruefung (siehe `freigabeAuswahl`).
 *
 * Der ABSCHLUSSLAUF (Issue #946, Plan #944) laesst zwei Gruppen aus, und beide stehen an
 * genau bemessener Stelle:
 *   - Die GUETEMESSUNG (E3) faellt unbedingt weg, auch wenn keine Testpruefung wegfiel:
 *     Ihr Anteil entsteht aus der vollstaendigen Testmenge, und ein Anteil aus einem
 *     verkuerzten Lauf waere nicht dieselbe Zahl, sondern eine andere Groesse mit
 *     demselben Namen. Der Zweig steht UNTER dem Zweig fuer die Veroeffentlichungsstufen:
 *     Dort laeuft sie weiter immer, und `--abschluss` kommt dort ohnehin nicht vor.
 *   - `nichtBeimAbschluss` faellt weg, und zwar VOR der Bereichsauswahl: Sonst stuende im
 *     Grund "Bereich unberuehrt", obwohl die Pruefung auch im beruehrten Bereich nicht
 *     gelaufen waere — dieselbe Falle, die schon die Stufenauswahl nach oben gezogen hat.
 *     Unter der Stufenauswahl dagegen bleibt er: Wer ohnehin nicht dran ist, braucht keinen
 *     zweiten Grund.
 */
function verteilen(checks, stufe, entscheiden, abschluss = false) {
  const laufen = [];
  const ausgelassen = [];
  const gefahren = STUFEN.indexOf(stufe);
  for (const check of checks) {
    let ergebnis;
    if (check.guete && stufe === "push") {
      ergebnis = { laeuft: true, grund: "Guetemessung: laeuft vor dem Veroeffentlichen immer" };
    } else if (check.guete && abschluss) {
      ergebnis = { laeuft: false, grund: "Abschlusslauf: Guetemessung braucht die vollstaendige Testmenge" };
    } else if (STUFEN.indexOf(check.stufe) > gefahren) {
      ergebnis = { laeuft: false, grund: `Stufe ${check.stufe}, gefahren wird ${stufe}` };
    } else if (check.nichtBeimAbschluss && abschluss) {
      ergebnis = { laeuft: false, grund: `Abschlusslauf: ${check.nichtBeimAbschluss}, laeuft beim Veroeffentlichen` };
    } else {
      ergebnis = entscheiden(check);
    }
    const eintrag = { cmd: check.cmd, stufe: check.stufe, grund: ergebnis.grund };
    if (check.guete) eintrag.guete = check.guete;
    (ergebnis.laeuft ? laufen : ausgelassen).push(eintrag);
  }
  return { laufen, ausgelassen };
}

/**
 * `ohneZuordnung` hat die Vorgabe `[]` und wird nie aus etwas anderem erschlossen
 * (Issue #922): Ein voller Umfang wegen eines nicht aufloesbaren Ankers kennt gar
 * keine Dateiliste — dort stuende sonst ein erfundener Eintrag, und der Beobachter
 * zaehlte eine Luecke, die es nicht gibt. `ohnePruefung` steht aus demselben Grund
 * mit derselben Vorgabe daneben (Issue #934).
 */
function bauen({ basis, stufe, geaendert = [], bereiche = [], ohneZuordnung = [], ohnePruefung = [],
  laufen = [], ausgelassen = [], vollerUmfang = false, leeresPaket = false, bereichWahl = null,
  abschluss = false }) {
  // `bereichWahl` traegt den Namen des Bereichs, auf den `--bereich` die Auswahl
  // eingegrenzt hat, sonst null. Das Feld ist kein Schmuck, sondern die Marke eines
  // TEILNACHWEISES: Ein Bereichslauf bestimmt `geaendert` und `hashes` weiterhin aus
  // dem Anker und saehe darum aus wie ein vollstaendiger Lauf. Zwei Leser brauchen den
  // Unterschied — die Wiederverwendung darf ein eingegrenztes Ergebnis nicht fuer einen
  // vollen Lauf ausgeben (frueheresErgebnis), und das Commit-Gate darf auf ihm nicht
  // committen lassen (.githooks/gate.mjs).
  //
  // `abschluss` steht aus demselben Grund daneben (Issue #946): Ein Abschlusslauf laesst
  // Pruefungen aus und saehe ohne das Feld aus wie ein vollstaendiger. Zwei Leser brauchen
  // es — die Wiederverwendung (`frueheresErgebnis`) und die Auswertung, die je Karte
  // rechnet.
  return { basis, stufe, geaendert, bereiche, ohneZuordnung, ohnePruefung, laufen, ausgelassen, vollerUmfang, leeresPaket, bereichWahl, abschluss };
}

function planen(args) {
  const config = ladeConfig();
  const checks = (config.buildChecks ?? []).map((c) => normalisiere(c));
  const checkAreas = config.checkAreas ?? {};
  pruefeBereichsnamen(checks, checkAreas);
  pruefeGuete(checks);
  pruefeNichtBeimAbschlussStufe(checks);

  // Der Abschlusslauf (Issue #946): Er schliesst genau ein Arbeitspaket ab und ist der
  // einzige Lauf, der die Zusammenspiel-Pruefungen auslassen darf. Sein Gate wird hier
  // geprueft und nur hier — die Begruendung steht an `pruefeAbschlussGate`.
  const abschluss = args.abschluss === true;
  if (abschluss) pruefeAbschlussGate(checks);

  // Derselbe Weg wie beim vertippten Bereichsnamen einer Pruefung: Abbruch statt
  // stiller Wahl. Ein Tippfehler im Flag liefe sonst auf einen Bereich, den keine
  // Pruefung kennt — es liefe nichts ausser `always`, und der Aufrufer hielte die
  // Gruppe fuer gefahren.
  const bereichWahl = args.bereich ?? null;
  if (bereichWahl !== null && !Object.hasOwn(checkAreas, bereichWahl)) {
    const namen = Object.keys(checkAreas);
    fail(`Unbekannter Bereich '${bereichWahl}'. Konfiguriert in checkAreas: ${namen.length > 0 ? namen.join(", ") : "keiner"}.`);
  }

  const stufe = args.stufe ?? STUFEN[0];
  const refText = args.since ?? "HEAD";
  const basis = ankerAufloesen(refText);
  if (basis === null) {
    // Der Zweifelsfall behaelt seinen eigenen Grund, auch an der Freigabestufe:
    // Dort laeuft ohnehin alles, aber WARUM ist verschieden — entschieden gegen
    // nicht gewusst.
    const grund = `voller Umfang: Anker '${refText}' laesst sich nicht aufloesen`;
    return bauen({
      basis: refText, stufe, vollerUmfang: true, abschluss,
      ...verteilen(checks, stufe, () => ({ laeuft: true, grund }), abschluss),
    });
  }

  const geaendert = geaenderteDateien(basis);
  const { beruehrt, ohneMuster, ohneZuordnung, ohnePruefung } = zuordnen(
    geaendert,
    bereicheVorbereiten(checkAreas),
    freistellungenVorbereiten(config.ohnePruefung),
  );
  const bereiche = [...beruehrt].sort(vergleicheText);

  // Der BEREICHSLAUF (Issue #922, Plan #917, E3): Nicht der Diff sagt, welche
  // Bereiche beruehrt sind, sondern der Aufrufer. Das ist der sanktionierte Weg
  // fuer den Fall, dass fuer die geaenderte Datei nur die vollstaendige Gruppe
  // existiert — ohne ihn liefe dieselbe Gruppe von Hand am Kommando vorbei, und
  // niemand koennte Verstoss und Notwendigkeit auseinanderhalten.
  //
  // Die Wahl steht VOR den Sonderwegen darunter (Veroeffentlichungsstufe, leeres
  // Paket, Datei ohne Muster): Jeder von ihnen wuerde die Eingrenzung wieder
  // aufheben, um die es beim Aufruf gerade ging. Nicht davor steht der
  // Zweifelsfall des nicht aufloesbaren Ankers — dort ist gar nichts bekannt, und
  // dieses Kommando irrt in diese Richtung nie.
  //
  // Die STUFENACHSE bleibt unberuehrt: `--bereich` beantwortet, OB eine Pruefung
  // betroffen ist, `--stufe` weiter, WANN sie an der Reihe ist. Der Grund traegt
  // das Praefix, damit im Bericht steht, warum die Auswahl so ausfiel.
  if (bereichWahl !== null) {
    const gewaehlt = new Set([bereichWahl]);
    return bauen({
      basis, stufe, geaendert, bereiche, ohneZuordnung, ohnePruefung, bereichWahl, abschluss,
      ...verteilen(checks, stufe, (check) => {
        const ergebnis = entscheidung(check, gewaehlt);
        return { laeuft: ergebnis.laeuft, grund: `Bereichslauf ${bereichWahl}: ${ergebnis.grund}` };
      }, abschluss),
    });
  }

  if (stufe === "merge") {
    return freigabeAuswahl({ checks, basis, geaendert, bereiche, ohneZuordnung, ohnePruefung, ohneMuster, beruehrt, abschluss });
  }

  // Die Push-Stufe faehrt jede faellige Pruefung (Plan #753, E12;
  // Plan #843, E9 nach Fachplan #837, AK 11): Ihr Ergebnis
  // gilt fuer den Stand, der hinausgeht, und der besteht aus mehr als dem letzten
  // Arbeitspaket. Eine Auslassung wegen leeren Pakets oder unberuehrten Bereichs
  // zeigte hier auf den falschen Vergleich — deshalb greift keine von beiden.
  // `basis`, `geaendert`, `bereiche` und (in `run`) `hashes` bleiben trotzdem aus
  // dem Anker bestimmt: Sie sind der Nachweis, gegen den das Commit-Gate den Index
  // prueft (gate-1), und nicht Teil der Auswahl.
  //
  // Die Kumulation bleibt davon unberuehrt: Was spaeter dran ist, bleibt aus. Die
  // Stufe sagt weiter, WANN eine Pruefung laeuft — nur die Eingrenzung unter den
  // faelligen entfaellt.
  //
  // `vollerUmfang` bleibt dabei false — das Feld markiert den Zweifelsfall
  // („wir wissen es nicht, also alles"), und diese Stufe ist das Gegenteil
  // davon: eine Entscheidung. Denselben Unterschied halten String-Form und
  // `always: true` auseinander.
  if (stufe === "push") {
    const grund = "Veroeffentlichungsstufe: voller Umfang";
    return bauen({
      basis, stufe, geaendert, bereiche, ohneZuordnung, ohnePruefung, abschluss,
      ...verteilen(checks, stufe, () => ({ laeuft: true, grund }), abschluss),
    });
  }

  if (geaendert.length === 0) {
    const grund = `leeres Paket: keine Aenderung seit ${basis}`;
    return bauen({
      basis, stufe, leeresPaket: true, abschluss,
      ...verteilen(checks, stufe, () => ({ laeuft: false, grund }), abschluss),
    });
  }

  if (ohneMuster !== null) {
    const grund = ohneMusterGrund(ohneZuordnung);
    return bauen({
      basis, stufe, geaendert, bereiche, ohneZuordnung, ohnePruefung, vollerUmfang: true, abschluss,
      ...verteilen(checks, stufe, () => ({ laeuft: true, grund }), abschluss),
    });
  }

  return bauen({
    basis, stufe, geaendert, bereiche, ohneZuordnung, ohnePruefung, abschluss,
    ...verteilen(checks, stufe, (check) => entscheidung(check, beruehrt), abschluss),
  });
}

/**
 * Die Auswahl der FREIGABESTUFE (Issue #1000): Sie prueft nur, was `push main` nicht
 * geprueft hat. `merge production` gibt es nie ohne vorheriges `push main` — der Skill
 * haelt vorher an, wenn `<mainBranch>` Unveroeffentlichtes traegt. Der Stand bis zum
 * Anker (`git merge-base HEAD origin/<mainBranch>`) ist darum vollstaendig geprueft,
 * und die Dateien seit dem Anker sind die Release-Dateien des Merge-Wegs.
 *
 *   - Stufe `merge` laeuft immer: Sie ist genau das, was nur hier laeuft.
 *   - Stufe `push` laeuft nicht und sagt, wo sie lief.
 *   - Die Paketstufe waehlt nach Bereichen ueber die Dateien seit dem Anker, mit
 *     denselben Regeln wie beim Abschluss einer Karte: leeres Paket laesst sie aus, eine
 *     Datei ohne Muster faehrt sie ganz (`vollerUmfang`).
 *
 * `leeresPaket` bleibt false, auch ohne Aenderung: Die Merge-Pruefungen laufen, und
 * ein Bericht "keine Pruefung, weil nichts veraendert wurde" waere falsch.
 */
function freigabeAuswahl({ checks, basis, geaendert, bereiche, ohneZuordnung, ohnePruefung, ohneMuster, beruehrt, abschluss }) {
  const leer = geaendert.length === 0;
  const zweifel = !leer && ohneMuster !== null;
  const paketstufe = (check) => {
    if (leer) return { laeuft: false, grund: `leeres Paket: keine Aenderung seit ${basis}` };
    if (zweifel) return { laeuft: true, grund: ohneMusterGrund(ohneZuordnung) };
    return entscheidung(check, beruehrt);
  };
  return bauen({
    basis, stufe: "merge", geaendert, bereiche, ohneZuordnung, ohnePruefung, vollerUmfang: zweifel, abschluss,
    ...verteilen(checks, "merge", (check) => {
      if (check.stufe === "merge") return { laeuft: true, grund: "Freigabestufe: laeuft vor jeder Freigabe" };
      if (check.stufe === "push") return { laeuft: false, grund: "Stufe push, geprueft beim push main" };
      return paketstufe(check);
    }, abschluss),
  });
}

// --- Bereiche (Issue #1004) ------------------------------------------------

/**
 * Anteil je Bereich und Inventar der versionierten Dateien (Issue #1004, Plan #1001, E7,
 * E8, E14) — die Rohdaten der Wirksamkeits-Auswertung.
 *
 * Gezaehlt werden die BEREICHSGEBUNDENEN Kommandos der PAKETSTUFE (`m`): Nur sie waehlt die
 * Auswahl eines Arbeitspakets nach Bereichen aus. Ein Kommando ohne `areas` laeuft ohnehin
 * immer, und eines der Stufe `push` oder `merge` laeuft nach Zeitpunkt — beide sagen ueber
 * den Zuschnitt der Bereiche nichts. Ein Bereich ist HERVORGEHOBEN, wenn er in allen oder
 * allen bis auf eines steht (`n ≥ m−1`) und `m` mindestens drei ist: Dann loest eine
 * Aenderung darin (fast) jeden Prueflauf aus, und der Bereich schneidet nichts mehr heraus.
 *
 * Ein Eintrag in `gekoppelteBereiche` (E14) aendert an der Hervorhebung NICHTS, er traegt
 * nur ihren Grund: Eine gemessene Kopplung, die den Bereich in fast alle Kommandos zwingt,
 * ist eine begruendete Ausnahme und kein Ausschalter — sie bleibt sichtbar.
 *
 * Das INVENTAR geht durch `zuordnen`, dieselbe Funktion, die jede Auswahl trifft (E7): Eine
 * zweite Glob-Logik bescheinigte ab der ersten Abweichung eine Deckung, die die Auswahl
 * nicht sieht — derselbe Grund wie bei `globZuRegex` fuer test/config-teile.test.mjs.
 * Versioniert heisst `git ls-files`: Ungetracktes gehoert zu keinem Stand des Projekts.
 */
function bereicheAuswerten() {
  const config = ladeConfig();
  const checks = (config.buildChecks ?? []).map((c) => normalisiere(c));
  const checkAreas = config.checkAreas ?? {};
  pruefeBereichsnamen(checks, checkAreas);

  const gebunden = checks.filter((check) => check.stufe === STUFEN[0] && check.areas);
  const m = gebunden.length;
  const kopplung = new Map((config.gekoppelteBereiche ?? []).map((e) => [e.bereich, e.grund]));
  const bereiche = Object.entries(checkAreas).map(([name, muster]) => {
    const n = gebunden.filter((check) => check.areas.includes(name)).length;
    return {
      name,
      muster: muster ?? [],
      nennend: n,
      von: m,
      hervorgehoben: m >= HERVORHEBUNG_AB_KOMMANDOS && n >= m - 1,
      kopplungsgrund: kopplung.get(name) ?? null,
    };
  });

  const ls = git("ls-files", "-z");
  if (ls.status !== 0) fail(`git ls-files schlug fehl: ${gitGrund(ls)}`);
  const dateien = ls.stdout
    .split("\0")
    .filter((pfad) => pfad !== "")
    .map((pfad) => pfad.replaceAll("\\", "/"))
    .sort(vergleicheText);
  const { ohneZuordnung, ohnePruefung } = zuordnen(
    dateien,
    bereicheVorbereiten(checkAreas),
    freistellungenVorbereiten(config.ohnePruefung),
  );

  return {
    kommandos: m,
    bereiche,
    inventar: {
      dateien: dateien.length,
      ohneTreffer: ohneZuordnung.length + ohnePruefung.length,
      freigestellt: ohnePruefung,
      ohneZuordnung,
    },
  };
}

// --- Ausfuehrung (Issue #424) ----------------------------------------------

/**
 * Liest den env-Block aus .claude/settings.json (falls vorhanden) — uebernommen
 * aus `settingsEnv` in night.mjs, nicht neu erfunden.
 *
 * Dort stehen projektspezifische Variablen (z.B. DOCKER_HOST /
 * TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE fuer Testcontainers unter Colima), die
 * Claude Code seinen eigenen Bash-Aufrufen automatisch mitgibt. checks.mjs ist
 * aber ein eigener Node-Prozess ausserhalb von Claude Code und bekommt sie sonst
 * nicht — ohne sie ein falsches Rot (beobachtet bei kanban-kit #445: mvn verify
 * schlug ohne die beiden Variablen mit Mockito-MockMaker-Fehlern fehl).
 *
 * Precedence wie in Claude Code: settings.json zuerst, settings.local.json
 * gewinnt. Die local-Datei ist gitignored und damit der uebliche Ort fuer
 * maschinenspezifische Werte — genau die, die hier fehlen wuerden (Issue #168).
 */
function settingsEnv() {
  const merged = {};
  for (const name of ["settings.json", "settings.local.json"]) {
    const pfad = join(process.cwd(), ".claude", name);
    if (!existsSync(pfad)) continue;
    try {
      const settings = JSON.parse(readFileSync(pfad, "utf-8"));
      if (settings.env && typeof settings.env === "object") Object.assign(merged, settings.env);
    } catch {
      // Kaputtes JSON blockiert den Lauf nicht — nur diese eine Quelle faellt aus.
    }
  }
  return merged;
}

/**
 * Fuehrt ein konfiguriertes Kommando aus.
 *
 * Eine Shell ist hier zwingend — anders als in board.mjs, wo Issue #196 sie gerade
 * abgeschafft hat. Der Unterschied: Dort stehen die Kommandos fest im Code und
 * lassen sich als Argument-Array uebergeben. Hier ist `cmd` eine frei konfigurierte
 * Kommandozeile aus der workflow.config.json ("mvn verify", "npm --prefix frontend
 * run build"), die Operatoren und Umleitungen enthalten darf. Ohne Shell gaebe es
 * das Feature nicht.
 *
 * Statt fest "sh" zu starten (das es unter Windows nicht gibt, Issue #199) waehlt
 * Node mit shell:true die Shell der Plattform: /bin/sh auf POSIX, die ComSpec-Shell
 * (im Regelfall cmd.exe) unter Windows. Bewusst nicht PowerShell: Der Wert ist eine
 * Nutzer-Konfiguration, und cmd.exe ist das, was ein Windows-Nutzer beim Eintragen
 * eines Build-Kommandos erwartet; PowerShell haette zudem eine eigene
 * Operator-Syntax (kein && vor Version 7).
 *
 * PATH-Aufloesung bewusst (S4036, Issue #183).
 *
 * Die Ausgabe wird eingesammelt und von uns geschrieben statt via stdio:"inherit"
 * durchgereicht: nur so steht sie garantiert zwischen der eigenen Kopf- und
 * Fusszeile und nicht irgendwo dazwischen.
 */
function kommandoAusfuehren(cmd, env) {
  // Asynchron seit Issue #1070 (Plan #1066): Gleichzeitige Kindprozesse gehen mit
  // `spawnSync` nicht. Die Ausgabe bleibt, wie sie war — erst stdout, dann stderr —,
  // und wird als Ganzes dekodiert, damit kein Zeichen an einer Stueckgrenze zerfaellt.
  return new Promise((aufloesen) => {
    const stdout = [];
    const stderr = [];
    let erledigt = false;
    const fertig = (code) => {
      if (erledigt) return;
      erledigt = true;
      // code ist null, wenn der Prozess durch ein Signal endete oder gar nicht erst
      // startete — beides ist rot, nie gruen.
      const ausgabe = `${Buffer.concat(stdout).toString("utf-8")}${Buffer.concat(stderr).toString("utf-8")}`;
      aufloesen({ gruen: code === 0, ausgabe });
    };
    const kind = spawn(cmd, { cwd: process.cwd(), env, shell: true });
    kind.stdout.on("data", (stueck) => stdout.push(stueck));
    kind.stderr.on("data", (stueck) => stderr.push(stueck));
    kind.on("error", () => fertig(null));
    kind.on("close", (code) => fertig(code));
  });
}

/**
 * Das erste getroffene Merkmal der festen Liste oder `null`.
 *
 * Exportiert, damit die Gegenprobe an echten Maven-Logs
 * (`test/checks-fehlermerkmal.test.mjs`, Fixtures unter `test/fixtures/`) DIESE
 * Funktion trifft und keine Kopie: Eine zweite Fassung im Test bescheinigte ab der
 * ersten Abweichung eine Pruefung, die das ausfuehrende Kommando nicht macht —
 * derselbe Grund wie bei `globZuRegex` und `blobHashes`.
 *
 * Erst getroffen heisst: erstes Merkmal der LISTE, nicht der Ausgabe. Welches von
 * zwei Merkmalen weiter oben in einem Log steht, sagt ueber die Ursache nichts.
 */
// SYNC: dieselbe Pruefung traegt kit/night.mjs (fehlermerkmal samt FEHLERMERKMALE)
// fuer die Salvage-Vorpruefung des Runners; test/guete-wertung-sync.test.mjs haelt
// beide an derselben Fallliste gegeneinander.
export function fehlermerkmal(ausgabe) {
  return FEHLERMERKMALE.find((merkmal) => ausgabe.includes(merkmal)) ?? null;
}

/**
 * Blob-Hash je Pfad — der Nachweis, gegen den das Commit-Gate den Index prueft.
 *
 * Zwei Entscheidungen stecken hier drin, beide aus Issue #469:
 *
 * `null` haengt an der NICHTEXISTENZ (`lstat` -> ENOENT), nicht am Exit-Code von
 * `git hash-object`. Waere es der Exit-Code, bekaeme eine vorhandene, nur
 * unlesbare Datei denselben Tombstone wie eine geloeschte — und das Gate liest
 * ihn als "geprufte Loeschung". `lstat` statt `stat`, damit ein toter Symlink als
 * vorhanden gilt und nicht stillschweigend zum Tombstone wird.
 *
 * Gehasht wird ueber `git hash-object --stdin-paths`, also EIN Prozess statt einer
 * je Datei: Bei vollem Umfang stehen leicht hundert Pfade in `geaendert`, und die
 * CI faehrt eine Windows-Matrix, wo Prozessstarts teuer sind. Der Aufruf traegt
 * die Pfade und nicht den Inhalt, damit gits Filterkette (`autocrlf`, `clean`)
 * greift — sonst passte der Hash nicht zu dem Blob, den `git ls-files --stage`
 * dem Gate zeigt.
 *
 * Exportiert, damit befunde.mjs denselben Blob-Hash ermitteln kann, statt die
 * Frage ein zweites Mal zu implementieren (Issue #802) — derselbe Grund, aus dem
 * `zusammenfassungPfad` fuer night.mjs exportiert ist (Issue #428).
 */
export function blobHashes(pfade) {
  const hashes = {};
  const vorhanden = [];
  for (const pfad of pfade) {
    try {
      lstatSync(join(process.cwd(), pfad));
      vorhanden.push(pfad);
    } catch (err) {
      if (err.code !== "ENOENT") {
        fail(`Der Stand von '${pfad}' liess sich nicht lesen: ${err.message}`);
      }
      hashes[pfad] = null;
    }
  }
  if (vorhanden.length === 0) return hashes;

  const res = spawnSync("git", ["hash-object", "--stdin-paths"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    input: `${vorhanden.join("\n")}\n`,
  });
  if (res.status !== 0) {
    fail(`git hash-object schlug fehl: ${(res.stderr || "").trim()}`);
  }
  const zeilen = res.stdout.split("\n").filter((z) => z.length > 0);
  if (zeilen.length !== vorhanden.length) {
    fail(`git hash-object lieferte ${zeilen.length} Hashes fuer ${vorhanden.length} Pfade.`);
  }
  vorhanden.forEach((pfad, i) => {
    hashes[pfad] = zeilen[i];
  });
  return hashes;
}

/**
 * Liest den Anteil aus der Ausgabe der Guetemessung (Issue #763, Plan #753).
 *
 * Das Muster ist Pflicht, weil die Werkzeuge Verschiedenes melden — PIT
 * schreibt `Killed 42 (84%)`, Stryker `Mutation score: 84.21`. Die erste
 * Gruppe gilt als Prozentwert, wie die Marke: eine Einheit, keine zwei.
 *
 * Jeder Weg ohne Zahl endet mit `erfuellt: false` und einem Grund (E10):
 * "Ein fehlendes Ergebnis gilt nie als bestandene Pruefung" (AK 11, #738) —
 * dieselbe Richtung, in die dieses Kommando ueberall irrt: mehr pruefen, nie
 * weniger. Das gilt auch fuer ein Muster, das sich nicht uebersetzen laesst:
 * Die Konfigurationspruefung faengt es frueher (Issue #764), aber hier darf es
 * trotzdem nicht als bestanden durchrutschen.
 *
 * Zwei dieser Wege sahen bis Issue #817 nach einer Zahl aus, ohne eine zu sein:
 * `Number("")` und `Number("   ")` sind 0, und 0 genuegt der Marke 0 — eine
 * leere Gruppe bescheinigte so eine Messung, die es nie gab. Und ein Anteil
 * ausserhalb von 0 bis 100 ist keiner: Kein Werkzeug meldet 184 Prozent, der
 * Wert entsteht aus einem verbogenen Muster und sagt ueber die Guete nichts.
 * Beides ist ein nicht auswertbares Ergebnis und damit rot.
 */
// SYNC: dieselbe Wertung traegt kit/night.mjs (gueteAuswerten) fuer die
// Salvage-Vorpruefung des Runners; test/guete-wertung-sync.test.mjs haelt beide
// an derselben Fallliste gegeneinander.
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
 * Das Ergebnisfeld der Zusammenfassung fuer einen gelaufenen Guete-Eintrag.
 * Ein rotes Kommando wird nicht ausgewertet: Seine Ausgabe ist der Stand eines
 * Abbruchs, und ein darin zufaellig gefundener Anteil bescheinigte eine
 * Messung, die es nicht gab.
 *
 * WARUM der Lauf rot war, weiss der Aufrufer und nicht diese Funktion — der
 * Rueckgabewert oder ein Fehlermerkmal in der Ausgabe (Issue #858). Deshalb kommt
 * `grund` von dort: Ein hier festverdrahteter Satz behauptete bei einem Kommando
 * mit Rueckgabewert 0 das Falsche, und der Grund steht in der Zusammenfassung,
 * aus der der Nacht-Runner liest.
 */
function gueteErgebnis(eintrag, gruen, ausgabe, grund) {
  const auswertung = gruen
    ? gueteAuswerten(eintrag.guete, ausgabe)
    : { anteil: null, erfuellt: false, grund };
  return {
    cmd: eintrag.cmd,
    anteil: auswertung.anteil,
    marke: eintrag.guete.marke,
    erfuellt: auswertung.erfuellt,
    grund: auswertung.grund,
  };
}

function gueteZeile(ergebnis) {
  return ergebnis.anteil === null
    ? `Guete: kein auswertbares Ergebnis (${ergebnis.grund})`
    : `Guete: ${ergebnis.anteil} % erreicht, Marke ${ergebnis.marke} % — ${ergebnis.grund}`;
}

/**
 * Das Ergebnisfeld, wenn die Messung nicht lief — nicht gestartet (ein
 * frueheres Kommando war rot) oder an der Paketstufe ausgelassen. Auch das
 * steht in der Zusammenfassung: "kein Ergebnis" ist ein Ergebnis und nie ein
 * Bestehen, und wer die Datei liest, sieht, dass kein Anteil erhoben wurde.
 */
function gueteOhneLauf(laufen, ausgelassen) {
  const geplant = laufen.find((e) => e.guete);
  if (geplant) {
    return { cmd: geplant.cmd, anteil: null, marke: geplant.guete.marke, erfuellt: false, grund: "nicht gestartet: ein frueheres Kommando war rot" };
  }
  const eintrag = ausgelassen.find((e) => e.guete);
  if (eintrag) {
    return { cmd: eintrag.cmd, anteil: null, marke: eintrag.guete.marke, erfuellt: false, grund: `ausgelassen: ${eintrag.grund}` };
  }
  return null;
}

/**
 * Maskiert die Trennzeichen des Protokolls im Kommando (Issue #822).
 *
 * Eine Zeile des Protokolls ist zeilen- und tabgetrennt, und `cmd` steht frei
 * konfiguriert dazwischen: Ein Kommando mit Zeilenumbruch zerriss ohne Maskierung
 * seine eigene Zeile, und die Auswertung sah zwei fehlerhafte Zeilen statt einer
 * Ausfuehrung — die Pruefung stuende dort als "nicht gelaufen".
 *
 * Der Backslash wird ZUERST verdoppelt: sonst liesse sich ein echtes `\n` im Kommando
 * nach dem Lesen nicht mehr von einem maskierten Zeilenumbruch unterscheiden.
 *
 * SYNC: kit/wirksamkeit.mjs wandelt in `kommandoLesen` zurueck. Die Kit-Werkzeuge sind
 * eigenstaendige Single-File-Tools ohne gemeinsames Modul (#440); geteilte Logik wird
 * dupliziert und an beiden Enden markiert.
 */
function kommandoMaskieren(cmd) {
  return cmd
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("\t", String.raw`\t`)
    .replaceAll("\n", String.raw`\n`)
    .replaceAll("\r", String.raw`\r`);
}

/**
 * Eine Liste als EIN Protokollfeld (Issue #1004, E5): jeder Eintrag maskiert wie das
 * Kommando und zusaetzlich das Komma, dann kommagetrennt. Das Komma kommt NACH dem
 * Backslash dran — derselbe Grund wie in `kommandoMaskieren`: Nur so bleibt ein `\,`
 * im Pfad von einem maskierten Trenner unterscheidbar.
 *
 * SYNC: kit/wirksamkeit.mjs wandelt beim Lesen zurueck (Issue #1005).
 */
function listeMaskieren(eintraege) {
  return eintraege.map((e) => kommandoMaskieren(e).replaceAll(",", String.raw`\,`)).join(",");
}

/**
 * Warum ein Kommando lief — als Daten fuer die Auswertung je Bereich (Issue #1004, Plan
 * #1001, E5). Fuenf Arten, in dieser Reihenfolge entschieden:
 *
 *   - `ohne-bereich`: Das Kommando traegt kein `areas` (String-Form, `{ cmd }`, `always`).
 *     Es waere auf JEDEM Weg gelaufen, auch ohne fehlende Zuordnung und ohne
 *     Veroeffentlichung — seine Minuten gehoeren keinem Ausloeser, und darum steht diese
 *     Art vor allen anderen.
 *   - `anker`: Der Anker liess sich nicht aufloesen. Erkennbar am vollen Umfang OHNE
 *     Dateiliste: Nur dieser Zweig von `planen` kennt keine geaenderten Dateien, der volle
 *     Umfang wegen einer Luecke nennt immer mindestens eine.
 *   - `bereiche` beim Bereichslauf: genau der gewaehlte Bereich, nicht der beruehrte.
 *   - `veroeffentlichung`: jede Pruefung an der Push-Stufe und die Stufe `merge` an der
 *     Freigabe — beide laufen dort nach Zeitpunkt, nicht nach Bereich.
 *   - `ohne-zuordnung`: voller Umfang wegen unzugeordneter Dateien, mit diesen Dateien.
 *   - sonst `bereiche` mit den beruehrten Bereichen des Kommandos.
 *
 * `bereiche` und `dateien` stehen nur bei der Art, die sie erklaeren; sonst sind sie
 * leer. So zaehlt die Auswertung eine Ausfuehrung entweder bei ihren Bereichen oder in
 * einer Sonderzeile, nie in beiden.
 *
 * `check` ist der Eintrag aus der Config, `null`, wenn keiner zum Kommando passt — dann
 * zaehlt es als nicht zugeordnet, dieselbe Deutung wie in `verursacherKarten`.
 */
function ausloeserBestimmen(auswahl, check) {
  const art = (name, bereiche = [], dateien = []) => ({ art: name, bereiche, dateien });
  const areas = check?.areas;
  if (!areas) return art("ohne-bereich");
  if (auswahl.vollerUmfang && auswahl.ohneZuordnung.length === 0) return art("anker");
  if (auswahl.bereichWahl !== null) return art("bereiche", [auswahl.bereichWahl]);
  if (auswahl.stufe === "push" || check.stufe === "merge") return art("veroeffentlichung");
  if (auswahl.vollerUmfang) return art("ohne-zuordnung", [], auswahl.ohneZuordnung);
  return art("bereiche", auswahl.bereiche.filter((name) => areas.includes(name)));
}

/**
 * Haengt eine Ausfuehrung an `.claude/ausfuehrungen.tsv` an (Issue #785).
 *
 * Eine Zeile je BEENDETEM Kommando: Zeitpunkt, Kommando, Ergebnis, Dauer — und dahinter
 * Anlass, Laufkennung und Karte (Issue #948). Ein Kommando mit dem Ergebnis
 * `nicht gestartet` bekommt keine — es ist keine Ausfuehrung, und als Zeile gezaehlt
 * senkte es den Anteil der Beanstandungen einer Pruefung, die gar nicht lief.
 *
 * Angehaengt, nie geleert — sonst saehe die Auswertung nur die letzte Runde, und genau
 * die zweite Runde nach einem Fix ist der Fall, um den es geht.
 *
 * Die drei hinteren Spalten stehen HINTEN und nicht in einer zweiten Protokolldatei
 * (Issue #948, E9): Jedes bestehende Protokoll bleibt lesbar, weil die vier vorderen
 * Spalten Stellung und Bedeutung behalten und eine aeltere Zeile die hinteren einfach
 * nicht traegt. Beim Lesen sind darum alle drei optional.
 *
 * Warum sie ueberhaupt gebraucht werden: Ein Abschlusslauf schreibt mehrere Zeilen.
 * Ohne die Laufkennung — fuer alle Zeilen EINES `run`-Aufrufs dieselbe — liesse sich
 * "je Lauf" nicht von "je Kommando" trennen, und der Nenner jeder Kennzahl je Karte
 * waere falsch. Die leere `karte` ist kein Nullwert, sondern "nicht gemessen": Eine
 * Zeile ohne Nummer geht in keine Rechnung je Karte ein.
 *
 * Dahinter stehen seit Issue #1004 (Plan #1001, E5) drei weitere Spalten, auf demselben
 * Weg und aus demselben Grund: `ausloeser`, `bereiche` und `dateien` — siehe
 * `ausloeserBestimmen`. Seit Issue #1071 (Plan #1066) folgt als elfte die Spalte
 * `gleichzeitig`: der Text `gleichzeitig`, wenn die Dauer neben anderen Pruefungen gemessen
 * wurde, sonst leer. Eine Zeile hat damit elf Spalten, eine aeltere vier, sieben oder zehn.
 *
 * Scheitert das Schreiben, bleibt es bei einem Hinweis auf stderr: Das Protokoll ist
 * Buchhaltung, keine Bedingung — dieselbe Haltung wie bei der Wegmarke in board.mjs.
 * Ausgang und Ausgabe von `run` bleiben davon unberuehrt; anders als die Zusammenfassung,
 * deren Ausfall `fail` ausloest, weil der Nacht-Runner aus ihr seine Entscheidung liest.
 */
function ausfuehrungSchreiben(cmd, ergebnis, dauerMs, herkunft, ausloeser, { gleichzeitig = false, jetzt = new Date() } = {}) {
  const pfad = join(process.cwd(), ...AUSFUEHRUNGEN_DATEI.split("/"));
  const { anlass, lauf, karte } = herkunft;
  const hinten = [
    ausloeser.art, listeMaskieren(ausloeser.bereiche), listeMaskieren(ausloeser.dateien),
    gleichzeitig ? "gleichzeitig" : "",
  ].join("\t");
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    appendFileSync(
      pfad,
      `${jetzt.toISOString()}\t${kommandoMaskieren(cmd)}\t${ergebnis}\t${dauerMs}\t${anlass}\t${lauf}\t${karte}\t${hinten}\n`,
      "utf-8",
    );
  } catch (err) {
    process.stderr.write(`Hinweis: Ausfuehrung nicht protokolliert (${pfad}): ${err.message}\n`);
  }
}

/**
 * Die Summe der gemessenen Dauern — `null`, wenn nichts gemessen wurde.
 *
 * Steht als eigene Funktion, seit die Zusammenfassung mehrfach im Lauf geschrieben
 * wird (Issue #857): Jede Fassung traegt den Stand, den sie bezeugt, und "nichts
 * gemessen" ist kein Nullbetrag — weder beim leeren Paket noch vor dem ersten
 * Kommando.
 */
function dauerGesamt(laufen) {
  const gemessen = laufen.filter((e) => e.dauerMs !== null);
  return gemessen.length > 0 ? gemessen.reduce((summe, e) => summe + e.dauerMs, 0) : null;
}

/**
 * Die wirksame Obergrenze: die Konstante, im Test herabgesetzt ueber die
 * Umgebungsvariable. Alles, was keine positive Zahl ist, faellt auf die Konstante
 * zurueck — dieselbe Haltung wie bei `sperrGrenzeMs`.
 */
function pruefdauerObergrenzeMs(env = process.env) {
  const zahl = Number((env[OBERGRENZE_ENV] ?? "").trim());
  return Number.isFinite(zahl) && zahl > 0 ? zahl : PRUEFDAUER_OBERGRENZE_MS;
}

/**
 * Die wirksame Grenze gleichzeitiger Pruefungen (Issue #1071): die Vorgabe, ueber die
 * Umgebungsvariable uebersteuert. Alles, was keine positive ganze Zahl ist, faellt auf die
 * Vorgabe zurueck — dieselbe Haltung wie bei `pruefdauerObergrenzeMs`.
 */
function gleichzeitigGrenze(env = process.env) {
  const text = (env[GLEICHZEITIG_ENV] ?? "").trim();
  const zahl = Number(text);
  return /^\d+$/.test(text) && zahl > 0 ? zahl : GLEICHZEITIG_VORGABE;
}

/** Sekunden mit hoechstens einer Nachkommastelle, ohne abschliessende Null. */
function sekunden(ms) {
  return String(Math.round(ms / 100) / 10);
}

/** Die Dauer einer Berichtszeile (Issue #1003). "Nicht gemessen" ist kein Nullbetrag. */
export function dauerText(dauerMs) {
  return typeof dauerMs === "number" ? `${sekunden(dauerMs)} s` : "Dauer nicht gemessen";
}

/**
 * Der Zusatz einer Berichtszeile, deren Pruefung die Obergrenze gerissen hat — sonst
 * der leere Text (Issue #1003, E3). Genau an der Grenze ist nichts ueberschritten.
 */
export function obergrenzeZusatz(dauerMs, grenzeMs = PRUEFDAUER_OBERGRENZE_MS) {
  if (typeof dauerMs !== "number" || dauerMs <= grenzeMs) return "";
  return ` — Obergrenze ${sekunden(grenzeMs)} s um ${sekunden(dauerMs - grenzeMs)} s ueberschritten`;
}

/**
 * Die fertigen Zeilen fuer den Abschlussbericht (Issue #1003, Plan #1001, E1, E12).
 *
 * Das Kommando bildet sie selbst, damit die Skills sie WORTGETREU uebernehmen koennen:
 * Eine Zeile, die erst die Session aus Einzelfeldern zusammensetzt, verliert unter
 * Druck zuerst Dauer und Grund — genau das, was der Bericht bisher verlor.
 *
 * Ein nicht gestartetes Kommando (nach einem roten) steht als `gelaufen` mit seinem
 * Ergebnis: Es war ausgewaehlt, und ein Bericht, der es verschwiege, saehe aus wie
 * ein vollstaendiger Lauf. `uebernommen` haengt den Vermerk an die Dauer — sie ist die
 * des Ursprungslaufs und in diesem Aufruf nicht gemessen. Ein gleichzeitig gelaufenes
 * Kommando traegt `(neben anderen gemessen)` hinter der Dauer (Issue #1071): Seine Dauer
 * ist nicht die, die es allein braeuchte.
 */
function berichtszeilen(auswahl, laufen, { uebernommen = false, grenzeMs = PRUEFDAUER_OBERGRENZE_MS } = {}) {
  const zeilen = auswahl.leeresPaket ? ["keine Pruefung, weil nichts veraendert wurde"] : [];
  const vermerk = uebernommen ? ` (${UEBERNAHME_MARKE})` : "";
  for (const e of laufen) {
    const dauerMs = typeof e.dauerMs === "number" ? e.dauerMs : null;
    const neben = e.gleichzeitig ? ` (${NEBEN_MARKE})` : "";
    zeilen.push(
      `gelaufen: ${e.cmd} → ${e.ergebnis}, ${dauerText(dauerMs)}${neben}${vermerk} — ${e.grund}${obergrenzeZusatz(dauerMs, grenzeMs)}`,
    );
  }
  for (const e of auswahl.ausgelassen) zeilen.push(`ausgelassen: ${e.cmd} → ${e.grund}`);
  return zeilen;
}

/**
 * Die Zeile, die den Block `Fuer den Abschlussbericht:` eroeffnet (Issue #1069, Plan
 * #1066, A7, E4): die Wartezeit dieses Laufs und, mit Kartennummer, die Summe aller
 * Laeufe der Karte. Sie steht nur im Block und nicht in `berichtszeilen` — das Feld
 * bleibt, was es war, die Zeilen je Pruefung.
 */
export function wartezeitZeile(wartezeitMs, wartezeitKarte) {
  const lauf = `Wartezeit: ${dauerText(wartezeitMs)}`;
  if (!wartezeitKarte) return lauf;
  const { karte, summeMs, laeufe } = wartezeitKarte;
  return `${lauf}, zusammen ${dauerText(summeMs)} in ${laeufe} Laeufen fuer Karte #${karte}`;
}

function berichtsblockSchreiben(zeilen, wartezeit) {
  process.stdout.write(["", "Fuer den Abschlussbericht:", wartezeit, ...zeilen, ""].join("\n"));
}

/**
 * Die Summe der Wartezeit je Karte nach diesem Lauf (Issue #1069, Plan #1066, E4) —
 * oder `undefined` ohne Kartennummer, dann fehlt das Feld.
 *
 * Traegt die vorige Zusammenfassung dieselbe Karte, wird weitergezaehlt, sonst beginnt
 * die Summe neu. `zuschlagMs` ist die Wartezeit dieses Laufs, bei einem uebernommenen
 * 0: Er zaehlt als Lauf, aber seine Zeit ist keine Pruefzeit. Nachts beginnt die Summe
 * mit jeder Session neu, weil der Runner die Zusammenfassung vor jeder Runde verwirft.
 */
function wartezeitKarteNach(vorige, karte, zuschlagMs) {
  if (karte === undefined) return undefined;
  const alt = vorige?.wartezeitKarte;
  const weiter = alt && alt.karte === karte && Number.isFinite(alt.summeMs) && Number.isInteger(alt.laeufe);
  return weiter
    ? { karte, summeMs: alt.summeMs + zuschlagMs, laeufe: alt.laeufe + 1 }
    : { karte, summeMs: zuschlagMs, laeufe: 1 };
}

/**
 * Die vorige Zusammenfassung, wie sie liegt, oder `null` — anders als
 * `frueheresErgebnis` ohne Bedingung an den Stand: Die Summe je Karte laeuft ueber
 * geaenderte Staende hinweg weiter.
 */
function vorigeZusammenfassung() {
  try {
    const alt = JSON.parse(readFileSync(zusammenfassungPfad(), "utf-8"));
    return alt !== null && typeof alt === "object" ? alt : null;
  } catch {
    return null;
  }
}

/** Die Wanduhr seit `startNs` in ganzen Millisekunden. */
function msSeit(startNs) {
  return Math.round(Number(process.hrtime.bigint() - startNs) / 1e6);
}

function schreibeZusammenfassung(daten) {
  const pfad = zusammenfassungPfad();
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(pfad, JSON.stringify(daten, null, 2) + "\n", "utf-8");
  } catch (err) {
    // Die Datei ist die Datenquelle des Nacht-Runners; ihr Ausfall darf nicht
    // stillschweigend durchgehen, auch nicht bei gruenen Checks.
    fail(`Zusammenfassung konnte nicht geschrieben werden (${pfad}): ${err.message}`);
  }
  return pfad;
}

/**
 * Der Fingerabdruck der Pruefkonfiguration (Issue #863).
 *
 * Er steht in der Zusammenfassung, weil sich ohne ihn die Gleichheit der Config
 * nicht feststellen laesst: Eine Config aendert nicht zwangslaeufig den
 * Arbeitsbaum — im Kit-Repo ist sie versioniert, in anderen Projekten liegt sie
 * hinter der Ignore-Regel und erschiene dann in `geaendert` gar nicht. Ein
 * uebernommenes Ergebnis bezoege sich dort auf eine Auswahl, die es nicht mehr
 * gibt.
 *
 * Gehasht werden die NORMALISIERTEN Eintraege, die Bereiche und die pruefungsfreien
 * Muster (Issue #934), also genau das, woraus die Auswahl entsteht. Ueber die normalisierte Form, damit der Wechsel
 * von der String-Form zu `{ cmd }` — der nichts bedeutet — keinen Lauf erzwingt.
 * Alles uebrige in der Config (Trigger, Modelle, Pfade) bleibt draussen: Es
 * aendert an den Pruefungen nichts.
 */
function configFingerabdruck() {
  const config = ladeConfig();
  const inhalt = JSON.stringify({
    buildChecks: (config.buildChecks ?? []).map((c) => normalisiere(c)),
    checkAreas: config.checkAreas ?? {},
    ohnePruefung: config.ohnePruefung ?? [],
  });
  return createHash("sha256").update(inhalt).digest("hex");
}

function listenGleich(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((wert, i) => wert === b[i]);
}

function hashesGleich(a, b) {
  if (a === null || typeof a !== "object" || b === null || typeof b !== "object") return false;
  const alt = Object.keys(a);
  const neu = Object.keys(b);
  return alt.length === neu.length && neu.every((pfad) => Object.hasOwn(a, pfad) && a[pfad] === b[pfad]);
}

/**
 * Die Zusammenfassung des letzten Laufs (`alt`, aus `vorigeZusammenfassung`), WENN sie
 * denselben Stand bezeugt wie der jetzige — sonst `null` (Issue #863).
 *
 * Derselbe Stand heisst: derselbe Anker, dieselbe Stufe, dieselbe Dateiliste mit
 * denselben Blob-Hashes und dieselbe Config. Die Liste steht neben den Hashes,
 * obwohl deren Schluessel sie wiederholen — eine Datei, die ohne Aenderung aus
 * `geaendert` verschwindet, gibt es nicht, und ein Vergleich, der sich auf diese
 * Ableitung verlaesst, muesste sie bei jeder kuenftigen Aenderung an
 * `geaenderteDateien` neu belegen.
 *
 * Bewusst KEIN Zeitfenster („juenger als n Minuten"): Nur der Inhalt macht ein
 * Ergebnis gueltig, nicht die Uhr. Und bewusst nur eine ABGESCHLOSSENE
 * Zusammenfassung — die eines abgebrochenen Laufs bezeugt keinen fertigen Stand,
 * sie ist gerade der Nachweis, dass eine Pruefung ihr Ende nicht erreicht hat.
 *
 * Jeder Zweifel faellt auf `null` zurueck und damit in den vollen Weg: fehlende
 * Datei, kaputtes JSON, fehlendes Feld, ein Stand aus einer aelteren Fassung ohne
 * `configHash`. Das ist dieselbe Richtung, in die dieses Kommando ueberall irrt —
 * lieber einmal zu viel pruefen.
 */
function frueheresErgebnis(alt, auswahl, hashes, configHash) {
  if (!gleicheAuswahlBasis(alt, auswahl, configHash)) return null;
  if (!listenGleich(alt.geaendert, auswahl.geaendert)) return null;
  if (!hashesGleich(alt.hashes, hashes)) return null;
  return alt;
}

/**
 * Was ein frueherer Lauf mit dem jetzigen gemeinsam haben muss, damit sein Ergebnis etwas
 * ueber diesen sagt — alles ausser der Dateiliste und den Hashes. Geteilt von
 * `frueheresErgebnis` (derselbe Stand) und `zuletztRote` (dieselbe Auswahl, anderer
 * Stand, Issue #1072).
 */
function gleicheAuswahlBasis(alt, auswahl, configHash) {
  if (alt === null || typeof alt !== "object") return false;
  if (alt.abgeschlossen !== true || !Array.isArray(alt.laufen)) return false;
  if (alt.basis !== auswahl.basis || alt.stufe !== auswahl.stufe) return false;
  // Die Eingrenzung gehoert in den Vergleich (Issue #922, Code-Review): Ohne sie
  // uebernimmt ein uneingeschraenkter Lauf das Ergebnis eines vorangegangenen
  // `--bereich`-Laufs, weil Basis, Stufe, Dateien und Hashes identisch sind — die
  // faelligen Pruefungen der uebrigen Bereiche liefen dann nie. `?? null` liest eine
  // Zusammenfassung aus einer Fassung vor diesem Feld als uneingeschraenkt.
  if ((alt.bereichWahl ?? null) !== (auswahl.bereichWahl ?? null)) return false;
  // Aus demselben Grund die Abschlussmarke (Issue #946): Ein Abschlusslauf faehrt eine
  // kleinere Auswahl, bei gleicher Basis, gleicher Stufe, gleichen Dateien und gleichen
  // Hashes. Ohne diesen Vergleich uebernaehme er die Kommandoliste des vollen Laufs — und
  // umgekehrt liesse der volle Lauf die verschobenen Pruefungen fuer immer aus. `?? false`
  // liest eine Zusammenfassung aus einer Fassung vor diesem Feld als vollen Lauf.
  if ((alt.abschluss ?? false) !== (auswahl.abschluss ?? false)) return false;
  if (typeof alt.configHash !== "string" || alt.configHash !== configHash) return false;
  return typeof alt.zeitpunkt === "string";
}

/**
 * Die zuletzt roten Kommandos, WENN der vorige Lauf dieselbe Auswahl bei geaendertem
 * Stand bezeugt — sonst `null` (Issue #1072, Plan #1066, A3).
 *
 * Dieselbe Auswahl heisst: dieselben Vergleiche wie beim Uebernehmen ausser Dateiliste und
 * Hashes, dazu dieselben ausgewaehlten Kommandos in derselben Reihenfolge. Dann liegt
 * zwischen beiden Laeufen eine Korrektur, und es lohnt, zuerst nur die roten zu fahren —
 * der volle Lauf folgt ohnehin, sobald sie gruen sind. Aendert sich die Auswahl, sagt das
 * alte Rot nichts mehr ueber die neue, und es laeuft sofort alles.
 *
 * Bei unveraendertem Stand greift `frueheresErgebnis`, bei einem gruenen Vorlauf gibt es
 * nichts zuerst zu fahren. Ein `nicht gestartet` zaehlt nicht als rot: Es wurde nie
 * gemessen und laeuft im vollen Lauf mit.
 */
function zuletztRote(alt, auswahl, hashes, configHash) {
  if (!gleicheAuswahlBasis(alt, auswahl, configHash)) return null;
  if (!listenGleich(alt.laufen.map((e) => e?.cmd), auswahl.laufen.map((e) => e.cmd))) return null;
  if (listenGleich(alt.geaendert, auswahl.geaendert) && hashesGleich(alt.hashes, hashes)) return null;
  const rote = alt.laufen.filter((e) => e?.ergebnis === "rot").map((e) => e.cmd);
  return rote.length > 0 ? rote : null;
}

/**
 * Das Kommando, das ein Lauf als rot nennt (Issue #1072): das erste `rot`, erst ohne ein
 * solches das erste ungruene. Nach einem roten Teillauf stehen vor der roten Gruppe
 * nicht gestartete — die zu nennen, schickte den Leser zur falschen Pruefung.
 */
// SYNC: dieselbe Regel steht in .githooks/gate.mjs und in `lesePruefung` (kit/night.mjs);
// beide laden checks.mjs nicht als Bibliothek. Der Abgleich ist test/checks-rote-zuerst.test.mjs.
function rotesKommando(laufen) {
  return laufen.find((e) => e.ergebnis === "rot") ?? laufen.find((e) => e.ergebnis !== "gruen") ?? null;
}

/**
 * Der Satzteil, an dem eine Uebernahme in der Ausgabe erkennbar ist (Issue #926).
 *
 * Er steht als Konstante, weil ihn ein zweiter Leser braucht: Der Prueflauf-Zaehler des
 * Nacht-Runners sieht vom Abschlussversuch nur den Bash-Aufruf und seine Ausgabe, und ein
 * uebernommener Lauf soll dort als Versuch OHNE Dauer zaehlen — `uebernehmen` reicht die
 * Werte des frueheren Laufs weiter, eine Spanne waere geerbt und nicht gemessen.
 */
// SYNC: dieselbe Marke steht in kit/night.mjs als UEBERNAHME_MARKE; der Abgleich ist ein
// Test in test/night-prueflaeufe.test.mjs. Ein Import waere die bessere Kopplung, aber
// night.mjs laeuft in Projekten, die checks.mjs nicht mitinstalliert haben muessen.
export const UEBERNAHME_MARKE = "Ergebnis uebernommen";

/**
 * Die Zeile, mit der ein Teillauf beginnt und die im Berichtsblock eines roten Teillaufs
 * vor den Zeilen je Pruefung steht (Issue #1072). Ohne sie saehe ein Bericht mit lauter
 * `nicht gestartet` aus wie ein abgebrochener voller Lauf.
 */
const TEILLAUF_ZEILE = "Teillauf: nur die zuletzt roten Pruefungen";

/**
 * Schreibt das uebernommene Ergebnis als frischen Nachweis und gibt den Exit-Code
 * des Originals zurueck (Issue #863).
 *
 * Die Datei entsteht NEU, obwohl sie inhaltlich gleich bliebe: Das Commit-Gate
 * verlangt einen Nachweis fuer genau den Stand, der committet wird, und eine
 * liegengebliebene Datei waere kein Nachweis dieses Aufrufs. `uebernommen` traegt
 * dabei den Zeitpunkt des ECHTEN Laufs und wird ueber mehrere Uebernahmen hinweg
 * weitergereicht — er sagt, wann zuletzt wirklich geprueft wurde, und genau das
 * will lesen, wer der Datei misstraut.
 *
 * Rot wird ebenso uebernommen wie gruen: Derselbe Stand liefert dasselbe Rot, und
 * ein erneuter Lauf kostete dieselben Minuten fuer dieselbe Antwort. Ungruen zaehlt
 * dabei wie ueberall hier alles, was nicht `gruen` ist — auch ein `nicht
 * gestartet` nach rotem Abbruch.
 */
function uebernehmen(auswahl, frueher, { zeitpunkt, hashes, configHash, startNs, vorige, karte }) {
  const ungruen = rotesKommando(frueher.laufen);
  const original = typeof frueher.uebernommen === "string" ? frueher.uebernommen : frueher.zeitpunkt;
  // Die Zeilen tragen die Dauer des URSPRUNGSLAUFS aus der frueheren Zusammenfassung
  // (Issue #1003, E12): Auch ein uebernommener Lauf gehoert in den Bericht, und ohne
  // Block muesste die Session ihn aus Einzelfeldern nachbauen.
  const zeilen = [
    ...(frueher.teillauf === true ? [TEILLAUF_ZEILE] : []),
    ...berichtszeilen(auswahl, frueher.laufen, { uebernommen: true, grenzeMs: pruefdauerObergrenzeMs() }),
  ];
  // Ein uebernommener Lauf zaehlt als Lauf ohne Zeit (Issue #1069): Seine Wanduhr steht
  // in `wartezeitMs`, in die Summe der Karte geht sie nicht ein.
  const wartezeitMs = msSeit(startNs);
  const wartezeitKarte = wartezeitKarteNach(vorige, karte, 0);
  const pfad = schreibeZusammenfassung({
    ...auswahl,
    laufen: frueher.laufen,
    zeitpunkt,
    hashes,
    configHash,
    abgeschlossen: true,
    dauerGesamtMs: frueher.dauerGesamtMs ?? null,
    ...(frueher.guete ? { guete: frueher.guete } : {}),
    // Die Verursacher werden mitgereicht wie die Guete (Issue #947): Derselbe Stand hat
    // dieselben Karten hinter sich, und ein uebernommener roter Lauf ohne das Feld sahe
    // aus, als waere die Frage nie gestellt worden.
    ...(frueher.verursacher ? { verursacher: frueher.verursacher } : {}),
    // Ein uebernommener roter Teillauf bleibt ein Teillauf (Issue #1072): Die nicht
    // gestarteten Eintraege darin sind nie gemessen worden.
    ...(frueher.teillauf === true ? { teillauf: true } : {}),
    uebernommen: original,
    berichtszeilen: zeilen,
    wartezeitMs,
    ...(wartezeitKarte ? { wartezeitKarte } : {}),
  });
  const befund = ungruen === null ? "gruen" : `rot: ${ungruen.cmd}`;
  process.stdout.write(
    `Stand unveraendert seit ${original}: ${UEBERNAHME_MARKE} (${befund}). Neu pruefen mit --frisch.\n`,
  );
  berichtsblockSchreiben(zeilen, wartezeitZeile(wartezeitMs, wartezeitKarte));
  process.stdout.write(`\nZusammenfassung: ${pfad}\n`);
  return ungruen === null ? 0 : 1;
}

/**
 * Das Urteil ueber ein gelaufenes Kommando — aus drei Quellen, in dieser
 * Reihenfolge: Rueckgabewert, Fehlermerkmal in der Ausgabe (Issue #858) und, wo
 * das Projekt eine Messung benannt hat, die Guete. Die Zeilen, die zum Befund
 * gehoeren, schreibt die Funktion selbst — ueber `schreibe`, damit ein gleichzeitig
 * gelaufenes Kommando sie in seinen Block sammeln kann (Issue #1071).
 *
 * Die MERKMAL-PRUEFUNG steht VOR dem guete-Zweig (Plan #810, E4): Eine Ausgabe,
 * die ihr Scheitern selbst ausweist, ist kein Messstand — ein darin gefundener
 * Anteil bescheinigte eine Messung, die es nicht gab. Das Ergebnis bleibt `rot`,
 * es gibt keinen dritten Ergebniswert (E5): Gate und Runner lesen
 * `ergebnis !== "gruen"`, und ein neuer Wert brauchte an jeder dieser Stellen
 * eine zweite Bahn.
 *
 * Eigene Funktion und nicht in der Schleife von `ausfuehren`, damit die Schleife
 * ihren Ablauf zeigt (ausfuehren, bewerten, festhalten) und nicht drei Urteile in
 * einer Verzweigungskette traegt.
 */
function bewerten(eintrag, gruen, ausgabe, schreibe = (text) => process.stdout.write(text)) {
  const merkmal = fehlermerkmal(ausgabe);
  if (merkmal !== null) {
    eintrag.fehlermerkmal = merkmal;
    schreibe(`Fehlermerkmal in der Ausgabe: '${merkmal}' — der Lauf gilt als rot\n`);
  }
  const bestanden = gruen && merkmal === null;
  if (!eintrag.guete) return { bestanden, guete: null };

  // Die Guetemessung faerbt ihr eigenes Kommando: Ein Anteil unter der Marke oder
  // ein nicht auswertbares Ergebnis ist derselbe rote Lauf wie jeder rote
  // Pflichtcheck — kein eigener Stop-Punkt (Issue #763).
  const grund = merkmal === null
    ? "kein Anteil erhoben — das Kommando selbst war rot"
    : `kein Anteil erhoben — Fehlermerkmal '${merkmal}' in der Ausgabe`;
  const guete = gueteErgebnis(eintrag, bestanden, ausgabe, grund);
  schreibe(`${gueteZeile(guete)}\n`);
  return { bestanden: bestanden && guete.erfuellt, guete };
}

// --- Verursachersuche (Issue #947) -----------------------------------------

/**
 * Trennzeichen fuer die Ausgabe von `git log`. Zwei Steuerzeichen und kein Text:
 * Betreff und Rumpf einer Commit-Botschaft sind frei geschriebene Prosa, und jedes
 * druckbare Trennzeichen kaeme darin irgendwann selbst vor. Der Rumpf traegt eigene
 * Zeilenumbrueche — deshalb braucht es neben dem Feldtrenner einen Satztrenner.
 */
const LOG_FELD = "\x1f";
const LOG_SATZ = "\x1e";

/** Der Grund eines gescheiterten git-Aufrufs; ein stummes Scheitern nennt seinen Rueckgabewert. */
function gitGrund(res) {
  const text = (res.stderr || "").trim();
  return text !== "" ? text : `Rueckgabewert ${res.status}`;
}

/**
 * Die Kartennummer einer Commit-Botschaft oder `null` (Plan #944, E6).
 *
 * Zwei Muster, in dieser Reihenfolge: `(Issue #<n>)` im Betreff, wie der
 * implement-Skill ihn schreibt, und ergaenzend `Refs #<n>` im Rumpf. Der Betreff
 * gewinnt — er ist die Zeile, die den Commit benennt, waehrend ein `Refs` im Rumpf
 * auch auf ein Nachbar-Issue zeigen kann.
 *
 * Bewusst KEIN Blick aufs Board (E6): `checks.mjs` laeuft im Commit-Gate und in jeder
 * Session und kommt ohne Board und ohne Netz aus. Der Preis ist der Commit ohne
 * erkennbare Nummer — und der verschwindet nicht, sondern erscheint mit seiner Kurz-SHA.
 */
function kartennummerAusBotschaft(betreff, rumpf) {
  const imBetreff = /\(Issue #(\d+)\)/.exec(betreff);
  if (imBetreff !== null) return imBetreff[1];
  const imRumpf = /(?:^|\s)Refs #(\d+)/.exec(rumpf);
  return imRumpf === null ? null : imRumpf[1];
}

/** Die Commits des Fensters `<basis>..HEAD`, juengster zuerst — oder ein Grund, warum nicht. */
function commitsSeit(basis) {
  const res = git("log", `--format=%h${LOG_FELD}%s${LOG_FELD}%b${LOG_SATZ}`, `${basis}..HEAD`);
  if (res.status !== 0) return { fehler: `git log ${basis}..HEAD schlug fehl: ${gitGrund(res)}` };
  const commits = [];
  for (const satz of res.stdout.split(LOG_SATZ)) {
    if (satz.trim() === "") continue;
    const [sha, betreff, rumpf = ""] = satz.replace(/^\n+/, "").split(LOG_FELD);
    commits.push({ sha, karte: kartennummerAusBotschaft(betreff, rumpf) });
  }
  return { commits };
}

/**
 * Die Dateien eines Commits. `-z` statt der zitierten Vorgabeform, damit ein Pfad mit
 * Umlaut oder Leerzeichen roh ankommt und sein Muster findet.
 *
 * Ein Merge-Commit listet hier nichts (der Diff haette zwei Eltern) und beruehrt damit
 * keinen Bereich. Das ist hingenommen: Ein Merge traegt keine Kartennummer, und die
 * Aenderungen, die er zusammenfuehrt, stehen als eigene Commits im Fenster.
 */
function dateienDesCommits(sha) {
  const res = git("show", "--name-only", "--format=", "-z", sha);
  if (res.status !== 0) return { fehler: `git show ${sha} schlug fehl: ${gitGrund(res)}` };
  const dateien = res.stdout
    .split("\0")
    .filter((pfad) => pfad !== "")
    .map((pfad) => pfad.replaceAll("\\", "/"));
  return { dateien };
}

/**
 * Fasst die Commits des Fensters zu Karten zusammen: eine Gruppe je Kartennummer, und
 * ein Commit ohne Nummer bildet seine eigene. Die Reihenfolge ist die von `git log` —
 * juengster zuerst, weil der letzte Stand der naechstliegende Verdacht ist.
 */
function kartenGruppen(basis) {
  const log = commitsSeit(basis);
  if (log.fehler !== undefined) return { fehler: log.fehler };
  const gruppen = [];
  const nachKarte = new Map();
  for (const { sha, karte } of log.commits) {
    let gruppe = karte === null ? undefined : nachKarte.get(karte);
    if (gruppe === undefined) {
      gruppe = { karte, shas: [], dateien: new Set() };
      gruppen.push(gruppe);
      if (karte !== null) nachKarte.set(karte, gruppe);
    }
    gruppe.shas.push(sha);
    const stand = dateienDesCommits(sha);
    if (stand.fehler !== undefined) return { fehler: stand.fehler };
    for (const pfad of stand.dateien) gruppe.dateien.add(pfad);
  }
  return { gruppen };
}

/**
 * Ob eine Karte als Verursacherin der roten Pruefung gilt (Plan #944, E7).
 *
 * Grosszuegig, in derselben Richtung wie der Prueflauf selbst: Eine Pruefung ohne
 * Bereichszuordnung ist von jeder Aenderung betroffen — das ist die Bedeutung der Form —,
 * und eine Karte mit einer Datei ohne Muster loest im Prueflauf den vollen Umfang aus,
 * gilt hier also fuer jede rote Pruefung als beruehrt. Keine Karte zu nennen behauptete,
 * es gebe keinen Verdaechtigen; AK 4 verlangt bei Mehrdeutigkeit ausdruecklich alle.
 */
function gruppeTrifft(check, gruppe) {
  if (gruppe.ohneMuster !== null) return true;
  if (check.always || !check.areas) return true;
  return check.areas.some((name) => gruppe.beruehrt.has(name));
}

/**
 * Die Karten, die eine rote Pruefung des Push-Laufs beruehrt haben (Issue #947, AK 4
 * des Fachplans #938).
 *
 * Nur bei `--stufe push`, und nur zu einem roten Befund:
 *   - Der Anker ist der `--since`-Wert des Laufs, den `/push-main` schon heute als
 *     `git merge-base HEAD origin/<mainBranch>` uebergibt (E5). Eine eigene Marke im
 *     Projekt waere dieselbe Wahrheit an einem zweiten Ort und liefe auseinander.
 *   - Die Freigabestufe hat keinen solchen Anker (E5): `/merge-production` legt den
 *     Worktree auf `origin/<mainBranch>`, die Basis ist `HEAD` selbst, und
 *     `<basis>..HEAD` waere leer. Dort brauchte die Suche `origin/<productionBranch>`,
 *     und das ist eine andere Frage als diese.
 *   - Ohne roten Befund gibt es nichts zu erklaeren.
 *
 * Je roter Pruefung steht entweder eine nichtleere Kartenliste oder ein `hinweis` —
 * nie eine leere Liste: "keine gefunden" und "nicht bestimmbar" sind Verschiedenes, und
 * eine leere Liste liesse sich als beides lesen.
 *
 * Bei `vollerUmfang` laeuft die Suche nicht (E7): An der Push-Stufe entsteht das Feld
 * allein aus einem nicht aufloesbaren Anker, und dann hat `<basis>..HEAD` keinen linken
 * Rand — es gibt keine Menge "seit dem Anker", aus der alle genannt werden koennten.
 * `auswahl.basis` traegt in diesem Fall den `refText` des Aufrufs.
 *
 * Die Config wird hier erneut gelesen, weil die Eintraege der Zusammenfassung ihre
 * `areas` nicht tragen — derselbe Weg wie in `configFingerabdruck`. Findet sich zu einem
 * Kommando kein Eintrag, gilt es als nicht zugeordnet und damit als von jeder Karte
 * beruehrt: die sichere Richtung, mehr nennen.
 */
function verursacherKarten(auswahl, roteEintraege) {
  if (auswahl.stufe !== "push" || roteEintraege.length === 0) return null;
  const alle = (hinweis) => roteEintraege.map((e) => ({ cmd: e.cmd, hinweis }));
  if (auswahl.vollerUmfang) {
    return alle(`Verursacher nicht bestimmbar: Anker '${auswahl.basis}' laesst sich nicht aufloesen`);
  }

  const ermittelt = kartenGruppen(auswahl.basis);
  if (ermittelt.fehler !== undefined) return alle(`Verursacher nicht bestimmbar: ${ermittelt.fehler}`);

  const config = ladeConfig();
  const checks = (config.buildChecks ?? []).map((c) => normalisiere(c));
  const bereichsdefinition = bereicheVorbereiten(config.checkAreas ?? {});
  const freistellungen = freistellungenVorbereiten(config.ohnePruefung);
  const gruppen = ermittelt.gruppen.map((gruppe) => ({
    karte: gruppe.karte,
    shas: gruppe.shas,
    ...zuordnen([...gruppe.dateien], bereichsdefinition, freistellungen),
  }));

  return roteEintraege.map((e) => {
    const check = checks.find((c) => c.cmd === e.cmd) ?? {};
    const karten = gruppen
      .filter((gruppe) => gruppeTrifft(check, gruppe))
      .map((gruppe) => ({ karte: gruppe.karte, shas: gruppe.shas }));
    return karten.length > 0
      ? { cmd: e.cmd, karten }
      : { cmd: e.cmd, hinweis: `Keine abgeschlossene Karte seit ${auswahl.basis} beruehrt diese Pruefung.` };
  });
}

/** Die Verursacher einer roten Pruefung als eine Zeile fuer Menschen. */
function verursacherText(eintrag) {
  if (eintrag.hinweis !== undefined) return eintrag.hinweis;
  return eintrag.karten
    .map((k) => (k.karte === null ? `Commit ohne Karte ${k.shas.join(", ")}` : `Issue #${k.karte} (${k.shas.join(", ")})`))
    .join(", ");
}

/**
 * Fuehrt die Auswahl aus `planen` aus und gibt den Exit-Code zurueck.
 *
 * Der Rueckgabewert je gelaufenem Kommando steht in der Zusammenfassung: `gruen`,
 * `rot` oder `nicht gestartet`. Ohne dieses Feld koennte der Runner einen
 * Fehlschlag nicht dem ausloesenden Paket zuordnen (Kriterium 9 aus Issue #420).
 *
 * Die Dauer je Kommando entsteht hier und nicht aus der Werkzeugzeit des
 * Session-Stroms (Issue #747, Plan #745, E3): Der Strom kennt nur "ein
 * Bash-Aufruf dauerte n Sekunden", nicht welches konfigurierte Kommando darin
 * lief — die Zuordnung braeuchte genau die inhaltliche Deutung, die das
 * Nicht-Ziel "Keine inhaltliche Deutung der Aufrufe" ausschliesst. `checks.mjs`
 * kennt seine Kommandos dagegen beim Namen.
 */
// --- Die Sperre: ein Prueflauf je Maschine (Issue #958) ---
//
// Anlass (kanban-kit, 2026-09-24, Lauf `night-run-2026-09-24-125914`): Zwei Runner
// fuhren auf EINER Maschine ihre Pruefungen gleichzeitig. Die Testsuite des Kits
// startet Hunderte Kindprozesse; die Load Average stieg auf 348, und `test:coverage`
// des anderen Projekts riss mit wechselnden Tests sein Zeitlimit. Die Pruefungen
// wurden rot, ohne dass die Aenderung schuld war — kein Zeitlimit im Zielprojekt
// faengt das ab, weil die Ursache ausserhalb des Projekts liegt.
//
// Die Sperre liegt MASCHINENWEIT im Temp-Verzeichnis des Nutzers und ausdruecklich
// nicht im Repository: Der Anlass sind zwei PROJEKTE auf einer Maschine, und eine
// repo-lokale Datei saehe das andere Projekt nie.
//
// Sie ist VORSORGE GEGEN LAST und kein Korrektheitsgate. Daraus folgt jeder ihrer
// Ausgaenge — und vor allem der letzte: Nach Ablauf der Obergrenze laeuft der
// Prueflauf TROTZDEM, mit einer Protokollzeile, die das sagt. Unbegrenzt zu warten
// liefe in das Rundenzeitlimit des Nacht-Runners, und der Lauf zaehlte dann als
// Fehlschlag der Karte statt als Wartezeit; rot zu melden waere ein Fehlschlag, der
// nicht am Code liegt. Der Schaden einer Kollision ist ein roter Lauf, der Schaden
// eines verweigerten Laufs ein roter Lauf ohne Ergebnis. Aus demselben Grund laeuft
// der Lauf auch dann weiter, wenn sich die Sperre nicht SCHREIBEN laesst.
//
// `lockPid` und `prozessLaeuft` stehen hier als eigene Fassung, nach dem Vorbild von
// `kit/night.mjs` (Umsetzungs-Lock): checks.mjs importiert bewusst nichts aus dem Kit
// — es wird als CHECKS_MJS_B64 in install.mjs gebacken und muss als Einzeldatei
// laufen (#440).

/**
 * Der Sperrpfad: die Umgebungsvariable, sonst die Vorgabe im Temp-Verzeichnis.
 *
 * Ein leerer oder nur aus Leerraum bestehender Wert zaehlt wie nicht gesetzt — er
 * entsteht aus einer fehlgeschlagenen Substitution und schaltete die Sperre sonst
 * still ab. Dieselbe Haltung wie beim leeren `--since`: im Zweifel die Vorgabe.
 *
 * `env` ist ein Parameter und kein Zugriff auf `process.env`, damit der Test beide
 * Faelle ohne Eingriff in die Prozessumgebung pruefen kann.
 */
export function sperrPfad(env = process.env) {
  const wert = (env[SPERRE_ENV] ?? "").trim();
  return wert === "" ? join(tmpdir(), SPERRE_DATEI) : wert;
}

/**
 * Die Obergrenze der Wartezeit in Millisekunden. Alles, was keine positive Zahl ist
 * — Text, 0, negativ —, faellt auf die Vorgabe zurueck: Eine Null waere keine
 * Obergrenze, sondern eine abgeschaltete Sperre.
 */
export function sperrGrenzeMs(env = process.env) {
  const zahl = Number((env[SPERRE_GRENZE_ENV] ?? "").trim());
  return Number.isFinite(zahl) && zahl > 0 ? zahl : SPERRE_GRENZE_VORGABE_MS;
}

/**
 * Liest eine Sperrdatei. Vier Ausgaenge (Issue #999):
 * - `{ art: "fehlt" }` — es gibt sie nicht (`ENOENT`);
 * - `{ art: "pid", pid }` — sie traegt eine gueltige Prozess-Id;
 * - `{ art: "kaputt" }` — gelesen, aber ohne gueltige Id (leer, Text, 0, negativ);
 * - `{ art: "unklar", code }` — das Lesen scheiterte mit einem anderen Code.
 *
 * "unklar" ist NICHT kaputt: Unter Windows scheitert das Lesen einer frisch
 * verlinkten Datei manchmal kurz mit EBUSY oder EPERM. Raeumte der Lauf sie dann
 * ab, fuehren zwei Laeufe gleichzeitig. Eine dauerhaft unlesbare Sperre fuehrt ueber
 * die Obergrenze zu "faehrt ohne Sperre" — der vorhandene, protokollierte Ausweg.
 *
 * `0` ist ausdruecklich keine gueltige Id — `process.kill(0, 0)` zielte auf die
 * eigene Prozessgruppe und meldete damit fuer jede kaputte Datei einen lebenden
 * Halter.
 */
function lockPid(pfad, lies = readFileSync) {
  let inhalt;
  try {
    inhalt = lies(pfad, "utf-8");
  } catch (e) {
    return e.code === "ENOENT" ? { art: "fehlt" } : { art: "unklar", code: e.code ?? e.message };
  }
  const pid = Number(String(inhalt).trim());
  return Number.isInteger(pid) && pid > 0 ? { art: "pid", pid } : { art: "kaputt" };
}

/**
 * Laeuft der Prozess mit dieser Id noch? `ESRCH` heisst nein; `EPERM` heisst, es gibt
 * ihn und er gehoert einem anderen Nutzer — das ist keine verwaiste Sperre.
 */
function prozessLaeuft(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}

/**
 * Wartet synchron. `Atomics.wait` und kein `spawnSync("sleep")`: Der Zweck des
 * Wartens ist, die Maschine zu entlasten — ein Kindprozess je halbe Sekunde arbeitete
 * dagegen. Synchron auch seit Issue #1070: Solange auf die Sperre gewartet wird, laeuft
 * in diesem Prozess nichts, dem die blockierte Ereignisschleife fehlen koennte.
 */
function schlafeSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Nimmt die Sperre, fuehrt `fn` aus und gibt sie frei — die Freigabe im `finally`
 * und damit auf JEDEM Weg heraus: gruen, rot, Ausnahme. Eine Freigabe am Ende des
 * Erfolgspfads liesse die Datei bei jedem roten Lauf liegen, und danach haengt jeder
 * weitere Lauf auf dieser Maschine: der Runner, `/local-check` und `push main`.
 *
 * Gibt zurueck, was `fn` zurueckgibt. Die Sperre aendert am Ausgang des Laufs nichts.
 *
 * Liefert `fn` ein Promise, faellt die Freigabe in dessen `finally` (Issue #1070): Die
 * Sperre haelt, bis der asynchrone Lauf erledigt ist — gruen, rot oder verworfen —, und
 * nicht nur, bis `fn` zurueckkehrt. Ein Einstieg fuer beide Faelle statt einer zweiten
 * Funktion; die synchronen Aufrufer bleiben, wie sie sind.
 *
 * Freigegeben wird nur die EIGENE Sperre — die Datei muss beim Loslassen noch die
 * eigene pid tragen. Sonst loeschte ein Lauf, der nach Ablauf der Obergrenze ohne
 * Sperre weiterfuhr, die Sperre dessen, der sie inzwischen rechtmaessig haelt.
 *
 * `pfad`, `grenzeMs`, `melde`, `abstandMs`, `uhr`, `schlafe` und `lies` sind Parameter
 * allein der Pruefbarkeit; im Betrieb kommen alle aus der Umgebung. `lies` ersetzt
 * `readFileSync` beim Lesen der Sperrdatei und stellt so einen Lesefehler nach.
 */
export function mitSperre(fn, {
  pfad = sperrPfad(),
  grenzeMs = sperrGrenzeMs(),
  melde = (satz) => process.stdout.write(satz),
  abstandMs = SPERRE_ABSTAND_MS,
  uhr = Date.now,
  schlafe = schlafeSync,
  lies = readFileSync,
} = {}) {
  const gehalten = sperreNehmen({ pfad, grenzeMs, melde, abstandMs, uhr, schlafe, lies });
  const freigeben = () => {
    if (gehalten) sperreFreigeben(pfad, melde, lies);
  };
  let ergebnis;
  try {
    ergebnis = fn();
  } catch (e) {
    freigeben();
    throw e;
  }
  if (ergebnis instanceof Promise) return ergebnis.finally(freigeben);
  freigeben();
  return ergebnis;
}

/**
 * Wartet, bis die Sperre frei ist, und nimmt sie. Rueckgabe: ob sie gehalten wird —
 * `false` heisst, der Lauf faehrt ohne sie (Obergrenze abgelaufen oder Schreibfehler)
 * und darf sie darum hinterher nicht entfernen.
 */
function sperreNehmen({ pfad, grenzeMs, melde, abstandMs, uhr, schlafe, lies }) {
  const beginn = uhr();
  let gemeldet = false;
  for (;;) {
    const gelesen = lockPid(pfad, lies);
    const halter = belegtVon(gelesen);
    if (halter !== null) {
      const wartend = aufHalterWarten({ pfad, halter, grenzeMs, melde, abstandMs, uhr, schlafe, beginn, gemeldet });
      if (!wartend.weiter) return false;
      gemeldet = wartend.gemeldet;
      continue;
    }
    if (gelesen.art !== "fehlt" && !verwaisteSperreAbraeumen({ pfad, gelesen, melde })) return false;
    const ergebnis = sperreAnlegen({ pfad, melde });
    if (ergebnis !== "rennen-verloren") return ergebnis === "genommen";
  }
}

/**
 * Wer die Sperre belegt, als Text fuer das Protokoll — oder `null`, wenn sie frei,
 * verwaist oder kaputt ist. Ein Lesefehler ausser ENOENT zaehlt als belegt mit
 * unbekanntem Halter: Die naechste Runde sieht neu nach (Issue #999).
 */
function belegtVon(gelesen) {
  if (gelesen.art === "unklar") return `ein unbekannter Halter (Lesefehler ${gelesen.code})`;
  if (gelesen.art === "pid" && prozessLaeuft(gelesen.pid)) return `Prozess ${gelesen.pid}`;
  return null;
}

/**
 * Ein lebender oder unbekannter Halter liegt auf der Sperre. Rueckgabe `{ weiter, gemeldet }`:
 * `weiter: false` heisst, die Obergrenze ist abgelaufen und der Lauf faehrt ohne
 * Sperre; sonst wurde geschlafen und die naechste Runde ist dran.
 *
 * `gemeldet` wandert durch, weil nur die ERSTE Wartezeile ausgegeben wird: Eine Zeile
 * je halbe Sekunde ersaeufte die Ausgabe des Laufs, um die es dem Leser geht.
 */
function aufHalterWarten({ pfad, halter, grenzeMs, melde, abstandMs, uhr, schlafe, beginn, gemeldet }) {
  const gewartet = uhr() - beginn;
  if (gewartet >= grenzeMs) {
    melde(`Sperre ${pfad} nach ${gewartet} ms noch belegt (${halter}) — der Lauf faehrt ohne Sperre.\n`);
    return { weiter: false, gemeldet };
  }
  if (!gemeldet) {
    melde(`Sperre ${pfad} haelt ${halter} — es wird gewartet (Obergrenze ${grenzeMs} ms).\n`);
  }
  schlafe(abstandMs);
  return { weiter: true, gemeldet: true };
}

/**
 * Kein lebender Halter, und die Datei liess sich lesen: Sie ist verwaist oder kaputt —
 * beides wird abgeraeumt, und beides steht im Protokoll: Eine still entfernte Sperre
 * waere von einer nie vorhandenen nicht zu unterscheiden.
 *
 * Rueckgabe: ob der Weg frei ist. `false` heisst, die Datei liegt noch und liess sich
 * nicht entfernen — dann faehrt der Lauf ohne Sperre.
 */
function verwaisteSperreAbraeumen({ pfad, gelesen, melde }) {
  if (!existsSync(pfad)) return true;
  const grund = gelesen.art === "kaputt" ? "kaputt (keine gueltige Prozess-Id)" : `verwaist (Prozess ${gelesen.pid} laeuft nicht)`;
  try {
    unlinkSync(pfad);
    melde(`Sperre ${pfad} war ${grund} — abgeraeumt.\n`);
    return true;
  } catch (e) {
    // Weg ist weg: Hat ein anderer Lauf sie zwischen existsSync und unlinkSync
    // abgeraeumt, ist das Ziel erreicht und kein Fehler.
    if (!existsSync(pfad)) return true;
    melde(`Sperre ${pfad} war ${grund}, liess sich aber nicht abraeumen (${e.code ?? e.message}) — der Lauf faehrt ohne Sperre.\n`);
    return false;
  }
}

/**
 * Legt die Sperre an. Rueckgabe: `"genommen"`, `"rennen-verloren"` (ein anderer Lauf
 * war schneller, die naechste Runde sieht neu nach) oder `"fehler"` (der Lauf faehrt
 * ohne Sperre).
 *
 * Erst vollstaendig schreiben, dann atomar verlinken. Ein `writeFileSync(pfad, …,
 * { flag: "wx" })` waere EIN Schritt zu wenig: Zwischen dem Anlegen der Datei und dem
 * Schreiben ihres Inhalts ist sie LEER, und ein zweiter Lauf, der genau dann
 * hineinsieht, haelt sie fuer unlesbar und raeumt sie ab — beide fahren gleichzeitig
 * los. Genau dieses Rennen trat in den Tests dieses Pakets ein.
 *
 * `linkSync` legt den Namen mit dem Inhalt in einem Zug an und scheitert mit EEXIST,
 * wenn er schon belegt ist. Damit entscheidet das Dateisystem das Rennen zwischen zwei
 * Laeufen, die gleichzeitig eine freie Sperre vorfinden. Die Hilfsdatei traegt die
 * eigene pid im Namen, liegt im Verzeichnis der Sperre (Hardlinks gehen nicht ueber
 * Dateisystemgrenzen) und wird in jedem Fall entfernt — der verlinkte Name behaelt
 * den Inhalt.
 */
function sperreAnlegen({ pfad, melde }) {
  const hilfsdatei = `${pfad}.${process.pid}`;
  try {
    mkdirSync(dirname(pfad), { recursive: true });
    writeFileSync(hilfsdatei, `${process.pid}\n`, "utf-8");
    linkSync(hilfsdatei, pfad);
    return "genommen";
  } catch (e) {
    if (e.code === "EEXIST") return "rennen-verloren";
    melde(`Sperre ${pfad} liess sich nicht schreiben (${e.code ?? e.message}) — der Lauf faehrt ohne Sperre.\n`);
    return "fehler";
  } finally {
    try {
      unlinkSync(hilfsdatei);
    } catch { /* nie angelegt oder schon weg */ }
  }
}

/**
 * Gibt die eigene Sperre frei. Ein Fehler dabei bleibt eine Protokollzeile: Die
 * Freigabe steht im `finally` und darf das Ergebnis des Laufs nicht ueberschreiben.
 */
function sperreFreigeben(pfad, melde, lies) {
  try {
    if (lockPid(pfad, lies).pid !== process.pid) return;
    unlinkSync(pfad);
  } catch (e) {
    melde(`Sperre ${pfad} liess sich nicht freigeben (${e.code ?? e.message}) — der naechste Lauf raeumt sie als verwaist ab.\n`);
  }
}

/**
 * `run`. Rueckgabe: ein Promise auf den Exitcode (Issue #1070) — auch beim uebernommenen
 * Ergebnis, damit der Aufrufer nur einen Fall kennt.
 */
async function ausfuehren(args) {
  // Die Wartezeit laeuft ab dem Aufruf (Issue #1069, Plan #1066): Auch das Warten auf die
  // maschinenweite Sperre ist Warten des Pakets.
  const startNs = process.hrtime.bigint();
  // Gelesen, bevor dieser Lauf die Datei zum ersten Mal ueberschreibt — sie traegt die
  // bisherige Summe der Karte.
  const vorige = vorigeZusammenfassung();
  const auswahl = planen(args);
  const env = { ...process.env, ...settingsEnv() };

  // VOR dem ersten Kommando (Issue #469): Der Hash bezeugt den Inhalt, der in die
  // Pruefung ging. Danach gehasht, bescheinigte er einen Stand, den kein Check
  // gesehen hat, sobald ein Kommando eine Datei anfasst — ein Formatter mit
  // `--fix` genuegt. Veraendert ein Check die Datei, passt der Hash beim Commit
  // nicht mehr und das Gate weist ab: die sichere Richtung.
  //
  // Der Zeitstempel steht unmittelbar daneben und aus demselben Grund (Issue #655):
  // Er bezeugt denselben Moment wie die Hashes — den Stand, der in die Pruefung
  // ging, nicht den Zeitpunkt, zu dem sie endete. Die Nachweiszeile der
  // Release-Skills nennt Hash und Zeitpunkt gemeinsam; stammte der eine aus dem
  // Lauf und der andere aus der Sitzung, bezeugten sie Verschiedenes.
  const zeitpunkt = new Date().toISOString();
  const hashes = blobHashes(auswahl.geaendert);
  const configHash = configFingerabdruck();

  // Die Ankuendigung steht im Kommando und nicht in den Skills (Issue #758): Eine
  // Regel im Prompt wirkt nicht unter Druck — dieselbe Begruendung, aus der
  // checks.mjs ueberhaupt entstand. Das Kommando kennt die Liste ohnehin.
  //
  // Nur oberhalb der Paketstufe: Dort kommt nichts hinzu, und der haeufigste Lauf
  // bleibt still. Eine Zeile, die in jedem Lauf steht, liest bald niemand mehr.
  if (auswahl.stufe !== STUFEN[0]) {
    const hinzu = auswahl.laufen.filter((e) => e.stufe !== STUFEN[0]).map((e) => e.cmd);
    const liste = hinzu.length > 0 ? hinzu.join(", ") : "keine weitere Pruefung";
    process.stdout.write(`Stufe ${auswahl.stufe}: zusaetzlich zur Paketstufe laeuft ${liste}\n`);
  }

  // VOR den Auslassungen (Issue #934): Eine Datei, zu der ausdruecklich nichts
  // geprueft wird, ist die einzige Ausnahme von der Regel „im Zweifel laeuft alles".
  // Sie muss in jedem Lauf dastehen, samt Grund — eine stille Ausnahme waere genau
  // die Sorte Auslassung, die niemandem auffaellt.
  for (const e of auswahl.ohnePruefung) {
    process.stdout.write(`ohne Pruefung: ${e.pfad} — ${e.grund}\n`);
  }

  // Vorab in den Bericht: Was nicht laeuft, ist genauso ein Ergebnis wie was laeuft.
  for (const e of auswahl.ausgelassen) {
    process.stdout.write(`ausgelassen: ${e.cmd} — ${e.grund}\n`);
  }

  // Nach den Auslassungen und vor dem ersten Kommando (Issue #863): Was nicht
  // laeuft, steht auch im uebernommenen Bericht — sonst saehe ein uebernommener
  // Lauf aus wie ein verkuerzter. Hier und nicht vor `blobHashes`, weil der
  // Vergleich genau diese Hashes braucht.
  const frueher = args.frisch ? null : frueheresErgebnis(vorige, auswahl, hashes, configHash);
  if (frueher !== null) {
    return uebernehmen(auswahl, frueher, { zeitpunkt, hashes, configHash, startNs, vorige, karte: args.karte });
  }
  // Nach einer Korrektur zuerst die zuletzt roten (Issue #1072); `--frisch` faehrt sofort alles.
  const rote = args.frisch ? null : zuletztRote(vorige, auswahl, hashes, configHash);

  // Ab hier laufen Kommandos, und erst ab hier gilt die Sperre (Issue #958): Ein
  // uebernommenes Ergebnis fuehrt keines aus und erzeugt keine Last — es muss auf
  // nichts warten. Der Schnitt zwischen `ausfuehren` und `kommandosFahren` liegt
  // genau darum hier und nicht weiter oben.
  return mitSperre(() => kommandosFahren({ auswahl, args, env, zeitpunkt, hashes, configHash, startNs, vorige, rote }));
}

/**
 * Faehrt die ausgewaehlten Kommandos und hinterlaesst den Bericht. Rueckgabe: der
 * Exitcode des Laufs.
 *
 * Eigene Funktion allein, damit `mitSperre` sie als Ganzes umschliessen kann — die
 * Sperre muss auf jedem Weg heraus freigegeben werden, auch auf dem der Ausnahme.
 */
async function kommandosFahren({ auswahl, args, env, zeitpunkt, hashes, configHash, startNs, vorige, rote = null }) {
  const grenzeMs = pruefdauerObergrenzeMs();

  // Woher die Zeilen dieses Laufs im Protokoll stammen (Issue #948). Einmal gebildet und
  // an jede Zeile gegeben, damit alle Zeilen EINES `run`-Aufrufs dieselbe Laufkennung
  // tragen — daran haengt die Trennung von "je Lauf" und "je Kommando". Ein Teillauf und
  // der volle Lauf danach sind ein Aufruf und teilen sie (Issue #1072).
  //
  // Der Anlass kommt aus der Auswahl und nicht aus den rohen Argumenten: `--abschluss`
  // schlaegt die Stufe, weil ein Abschlusslauf genau der Lauf ist, der Pruefungen
  // auslaesst — und ohne den Schalter ist die Stufe der Anlass (`paket`, `push`, `merge`).
  // Die Laufkennung ist derselbe `zeitpunkt`, den die Zusammenfassung traegt; ein zweiter,
  // eigener Zeitstempel bezeugte einen anderen Moment als sie.
  const herkunft = {
    anlass: auswahl.abschluss ? "abschluss" : auswahl.stufe,
    lauf: zeitpunkt,
    karte: args.karte ?? "",
  };
  // Die Eintraege von `laufen` tragen ihre `areas` nicht; der Ausloeser braucht sie
  // (Issue #1004). Derselbe Weg wie in `verursacherKarten`: die Config erneut lesen.
  const konfiguriert = (ladeConfig().buildChecks ?? []).map((c) => normalisiere(c));
  const ausloeserVon = (cmd) => ausloeserBestimmen(auswahl, konfiguriert.find((c) => c.cmd === cmd) ?? null);
  const gekennzeichnet = new Set(konfiguriert.filter((c) => c.gleichzeitig).map((c) => c.cmd));
  const grenze = gleichzeitigGrenze(env);

  // Die Zusammenfassung BEGLEITET den Lauf (Issue #857, Plan #810, E1): Sie entsteht
  // vor dem ersten Kommando und wird vor jedem weiteren ueberschrieben, statt erst am
  // Ende zu entstehen.
  //
  // Der Grund ist der Abbruch. Ein Lauf, der an der Uhr, durch ein Signal oder mit der
  // Session endet, hinterliess vorher keine Datei — und eine fehlende Datei ist fuer
  // den Nacht-Runner "ungeprueft", also ungemessen statt beanstandet. Oder es blieb
  // eine aeltere liegen, die wie das Ergebnis dieses Laufs aussah. Jetzt liegt in jedem
  // Moment eine Fassung, und jede, die ein Abbruch hinterlassen kann, traegt mindestens
  // einen Eintrag `nicht gestartet` (Fachplan #769, AK 3 und 4).
  //
  // VOR dem Kommando und nicht danach, weil Gate (.githooks/gate.mjs) und Runner
  // (`lesePruefung` in night.mjs) allein `ergebnis !== "gruen"` auswerten und
  // `abgeschlossen` nicht sehen: Das laufende Kommando muss in der Datei noch
  // ungruen stehen, sonst saehe ein Abbruch mittendrin gruen aus.
  //
  // Die Wartezeit steht nur in der abgeschlossenen Fassung (Issue #1069) — vorher ist
  // der Lauf nicht zu Ende. Die Summe der Karte reicht jede fruehere Fassung unveraendert
  // weiter: Stirbt der Lauf, beginnt der naechste nicht bei null.
  //
  // Ein Teillauf (Issue #1072) fuehrt alle ausgewaehlten Kommandos in `laufen`, die nicht
  // gefahrenen auf `nicht gestartet` — darum steht er in keiner Fassung gruen, auch nicht
  // in der letzten. Die Marke `teillauf` und die Zeile davor sagen, warum.
  let wartezeit = {};
  if (args.karte !== undefined && vorige?.wartezeitKarte?.karte === args.karte) {
    wartezeit = { wartezeitKarte: vorige.wartezeitKarte };
  }
  const zeilenVon = (stand) => [
    ...(stand.teillauf ? [TEILLAUF_ZEILE] : []),
    ...berichtszeilen(auswahl, stand.laufen, { grenzeMs }),
  ];
  const schreibeStand = (stand, abgeschlossen) => schreibeZusammenfassung({
    ...auswahl, laufen: stand.laufen, zeitpunkt, hashes, configHash, abgeschlossen,
    dauerGesamtMs: dauerGesamt(stand.laufen), ...(stand.guete ? { guete: stand.guete } : {}),
    ...(stand.verursacher ? { verursacher: stand.verursacher } : {}),
    ...(stand.teillauf ? { teillauf: true } : {}),
    berichtszeilen: zeilenVon(stand),
    ...wartezeit,
  });

  // Ein Durchgang ueber die ausgewaehlten Kommandos — alle oder, beim Teillauf, nur die
  // in `nur`. Beide folgen denselben Achsen (Plan #1066, E5): Mehrere rote Testgruppen
  // sind der Normalfall eines roten Laufs, und nacheinander kosteten sie die Minuten, die
  // der Teillauf sparen soll.
  const durchgang = async (nur) => {
    // Die Verursacher stehen erst am Ende fest (Issue #947): Vor dem roten Befund gibt es
    // nichts zu erklaeren, und `schreibeStand` liest das Feld, statt es zu bekommen —
    // so traegt jede Fassung der Zusammenfassung den Stand, den sie bezeugt.
    const stand = {
      laufen: auswahl.laufen.map((e) => ({ ...e, ergebnis: "nicht gestartet", dauerMs: null })),
      rot: false, guete: null, verursacher: null, teillauf: nur !== null,
    };
    schreibeStand(stand, false);

    // Ein Kommando fahren, bewerten und festhalten — fuer beide Phasen dieselbe Bahn.
    // `schreibe` nimmt alles auf, was zum Kommando gehoert: in der nachfolgenden Phase
    // geht es sofort nach stdout, in der gleichzeitigen in den Block des Kommandos.
    const einKommando = async (eintrag, schreibe, nebenAnderen) => {
      const start = process.hrtime.bigint();
      const { gruen, ausgabe } = await kommandoAusfuehren(eintrag.cmd, env);
      eintrag.dauerMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      // Nur vermerkt, nie rot (Issue #1003, E4): Das Feld fehlt unter der Grenze ganz.
      if (eintrag.dauerMs > grenzeMs) eintrag.ueberObergrenzeMs = eintrag.dauerMs - grenzeMs;
      // Das Feld fehlt, wenn das Kommando allein lief (Issue #1071) — wie `ueberObergrenzeMs`.
      if (nebenAnderen) eintrag.gleichzeitig = true;
      schreibe(ausgabe);
      const bewertung = bewerten(eintrag, gruen, ausgabe, schreibe);
      stand.guete = bewertung.guete ?? stand.guete;
      eintrag.ergebnis = bewertung.bestanden ? "gruen" : "rot";
      schreibe(`-> ${eintrag.ergebnis}\n`);
      // Je beendetem Kommando und nicht am Ende (Issue #785): So traegt auch das rote
      // Kommando seine Zeile, das den Rest abbricht — es ist die Ausfuehrung, um die es der
      // Auswertung zu allererst geht.
      ausfuehrungSchreiben(eintrag.cmd, eintrag.ergebnis, eintrag.dauerMs, herkunft, ausloeserVon(eintrag.cmd),
        { gleichzeitig: nebenAnderen });
      if (!bewertung.bestanden) stand.rot = true;
    };

    // Zwei Phasen (Issue #1071, Plan #1066, A1, A2, A6): zuerst die mit `gleichzeitig`
    // gekennzeichneten, hoechstens `grenze` auf einmal, danach die uebrigen nacheinander.
    // Ohne gekennzeichnete bleibt die erste Phase leer, und der Ablauf ist der bisherige.
    const faellig = nur === null ? stand.laufen : stand.laufen.filter((e) => nur.has(e.cmd));
    const erste = faellig.filter((e) => gekennzeichnet.has(e.cmd));
    const danach = faellig.filter((e) => !gekennzeichnet.has(e.cmd));
    // "Neben anderen gemessen" nur, wenn wirklich mehrere zugleich laufen konnten: Mit der
    // Grenze 1 oder einer einzigen gekennzeichneten ist die Dauer eine allein gemessene.
    const nebenAnderen = grenze > 1 && erste.length > 1;

    // Die erste Phase laeuft VOLLSTAENDIG durch, auch nach einem Rot: Wer korrigiert, soll
    // alle roten auf einmal sehen und nicht eine nach der anderen. Die Ausgabe jedes
    // Kommandos wird gesammelt und als geschlossener Block geschrieben, sobald er und alle
    // davor fertig sind — so steht sie in Config-Reihenfolge, gleich wer zuerst endet.
    const bloecke = new Map();
    let naechsterBlock = 0;
    const warteschlange = [...erste];
    const arbeiter = async () => {
      for (let eintrag = warteschlange.shift(); eintrag; eintrag = warteschlange.shift()) {
        let block = `\n$ ${eintrag.cmd} — ${eintrag.grund}\n`;
        await einKommando(eintrag, (text) => { block += text; }, nebenAnderen);
        bloecke.set(eintrag, block);
        // Nach jedem Ende (Issue #857): Die noch laufenden stehen darin weiter auf
        // `nicht gestartet` — ein Abbruch mittendrin sieht damit nie gruen aus.
        schreibeStand(stand, false);
        while (naechsterBlock < erste.length && bloecke.has(erste[naechsterBlock])) {
          process.stdout.write(bloecke.get(erste[naechsterBlock]));
          naechsterBlock += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(grenze, erste.length) }, arbeiter));

    // Die nachfolgende Phase startet nach einem Rot der ersten nicht und bricht beim ersten
    // eigenen Rot ab; der Rest bleibt "nicht gestartet".
    for (const eintrag of danach) {
      if (stand.rot) break;
      schreibeStand(stand, false);
      process.stdout.write(`\n$ ${eintrag.cmd} — ${eintrag.grund}\n`);
      await einKommando(eintrag, (text) => process.stdout.write(text), false);
    }
    stand.guete ??= gueteOhneLauf(stand.laufen, auswahl.ausgelassen);
    return stand;
  };

  // Zuerst die zuletzt roten (Issue #1072, Plan #1066, A3): Bleiben sie rot, endet der
  // Aufruf damit — der volle Lauf braechte dasselbe Rot erst nach allen anderen. Werden
  // sie gruen, folgt im selben Aufruf genau einmal der volle Lauf als Nachweis.
  let stand = null;
  if (rote !== null) {
    process.stdout.write(`\n${TEILLAUF_ZEILE}: ${rote.join(", ")}\n`);
    stand = await durchgang(new Set(rote));
    if (!stand.rot) {
      process.stdout.write("\nTeillauf gruen — es folgt der volle Lauf als Nachweis\n");
      stand = null;
    }
  }
  stand ??= await durchgang(null);

  // Nach dem roten Befund und vor der letzten Fassung (Issue #947): Die Suche erklaert
  // einen Befund, der schon gefallen ist, und aendert am Ausgang des Laufs nichts — auch
  // dann nicht, wenn ein git-Aufruf dabei scheitert. Dieselbe Haltung wie beim
  // Ausfuehrungsprotokoll: Buchhaltung, keine Bedingung.
  stand.verursacher = verursacherKarten(auswahl, stand.laufen.filter((e) => e.ergebnis === "rot"));
  for (const e of stand.verursacher ?? []) {
    process.stdout.write(`Verursacher (${e.cmd}): ${verursacherText(e)}\n`);
  }

  // Die letzte Fassung, und die einzige mit `abgeschlossen: true`: Hier ist der Lauf
  // zu Ende gefahren. Auch bei rotem Abbruch geschrieben — und beim leeren Paket
  // ebenso: "keine Pruefung, weil nichts veraendert wurde" ist ein Ergebnis und kein
  // Loch. Rot und abgeschlossen sind Verschiedenes: Das eine sagt, wie die Pruefung
  // ausging, das andere, ob sie ihr Ende erreicht hat.
  //
  // Das guete-Feld steht nur da, wenn das Projekt eine Messung benannt hat — dann
  // aber immer, auch beim gruenen Lauf (Issue #763).
  //
  // Die Wartezeit laeuft ab dem Aufruf und umfasst damit Teillauf und vollen Lauf
  // (Issue #1072) — beide sind Warten desselben Pakets.
  const wartezeitMs = msSeit(startNs);
  const wartezeitKarte = wartezeitKarteNach(vorige, args.karte, wartezeitMs);
  wartezeit = { wartezeitMs, ...(wartezeitKarte ? { wartezeitKarte } : {}) };
  const pfad = schreibeStand(stand, true);
  berichtsblockSchreiben(zeilenVon(stand), wartezeitZeile(wartezeitMs, wartezeitKarte));
  process.stdout.write(`\nZusammenfassung: ${pfad}\n`);
  return stand.rot ? 1 : 0;
}

// --- CLI -------------------------------------------------------------------

/**
 * Die optionale Kartennummer hinter `--abschluss` oder `null` (Issue #946).
 *
 * Sie ist OPTIONAL: Der Schalter wirkt auch ohne sie, und ein Aufruf ohne Nummer soll
 * nicht daran scheitern, dass die Auswertung je Karte ihn nicht zuordnen kann. Ein Wert,
 * der keine Nummer ist, ist dagegen ein Fehler — er waere entweder ein vertipptes Flag
 * oder eine Nummer, die niemand je zuordnet. Ein folgendes `--…` ist das naechste Flag
 * und keine fehlende Nummer.
 */
function kartennummer(wert) {
  if (wert === undefined || wert.startsWith("--")) return null;
  if (!/^\d+$/.test(wert)) {
    fail(`'${wert}' ist keine Kartennummer fuer --abschluss. Erwartet: eine Nummer oder nichts.`);
  }
  return wert;
}

/**
 * Die Kombinationen, die `--abschluss` ausschliesst (Issue #946) — geprueft NACH der
 * Schleife, damit die Meldung nicht an der Stellung der Flags haengt. Beides ist ein
 * Fehler und keine stille Wahl:
 *   - `--abschluss` mit einer Veroeffentlichungsstufe waere zweierlei zugleich (AK 3).
 *     Der Abschluss misst ein Arbeitspaket, `push` und `merge` messen den Stand, der
 *     hinausgeht — und dort laeuft gerade das, was der Abschluss auslaesst.
 *   - `--abschluss` mit `--bereich` waere eine doppelte Eingrenzung (E13): Der
 *     Bereichslauf ist der begruendete Gruppenlauf mitten in der Arbeit, nicht der
 *     Abschluss einer Karte. Zusammen liesse sich aus dem Lauf nicht mehr ablesen,
 *     welche der beiden Verkuerzungen eine Pruefung weggelassen hat.
 */
function pruefeKombinationen(args) {
  if (args.abschluss !== true) return;
  if (args.stufe === "push" || args.stufe === "merge") {
    fail(`--abschluss und --stufe '${args.stufe}' zusammen: Der Abschluss einer Karte faehrt die Stufe '${STUFEN[0]}'. Vor dem Veroeffentlichen laeuft der volle Umfang ohne --abschluss.`);
  }
  if (args.bereich !== undefined) {
    fail("--abschluss und --bereich zusammen: zwei Eingrenzungen in einem Lauf. Der Bereichslauf gehoert in die Arbeit, --abschluss an ihr Ende.");
  }
}

function parseArgs(rest) {
  const args = {};
  let i = 0;
  while (i < rest.length) {
    if (rest[i] === "--since") {
      // Fehlt der Wert ganz, ist das derselbe Fall wie ein leerer: nicht
      // aufloesbar, also voller Umfang.
      args.since = rest[i + 1] ?? "";
      i += 1;
    } else if (rest[i] === "--stufe") {
      // Ein unbekannter Wert ist ein Fehler und nicht stillschweigend die
      // Paketstufe (Issue #758): Ein Tippfehler liesse sonst genau die
      // Pruefungen aus, um deren Zeitpunkt es beim Aufruf ging — weniger
      // pruefen, ohne dass es auffaellt. Der fehlende Wert zaehlt wie ein
      // falscher; anders als bei `--since` gibt es hier keine sichere Deutung.
      const wert = rest[i + 1] ?? "";
      if (!STUFEN.includes(wert)) {
        fail(`Unbekannte Stufe '${wert}'. Erwartet: ${STUFEN.join(", ")}.`);
      }
      args.stufe = wert;
      i += 1;
    } else if (rest[i] === "--bereich") {
      // Der fehlende Wert zaehlt wie ein falscher (wie bei `--stufe`): Die
      // Pruefung gegen `checkAreas` steht in `planen`, wo die Config liegt, und
      // der leere Name faellt dort mit derselben nennenden Meldung durch.
      args.bereich = rest[i + 1] ?? "";
      i += 1;
    } else if (rest[i] === "--abschluss") {
      // Dieser Lauf schliesst genau ein Arbeitspaket ab (Issue #946). Die Kartennummer
      // liest `kartennummer`, samt ihrer Begruendung.
      args.abschluss = true;
      const karte = kartennummer(rest[i + 1]);
      if (karte !== null) {
        args.karte = karte;
        i += 1;
      }
    } else if (rest[i] === "--frisch") {
      // Wirkt nur bei `run`; bei `plan` laeuft ohnehin nichts. Kein Fehler dort,
      // weil der Schalter nur in die sichere Richtung zeigt — mehr pruefen.
      args.frisch = true;
    } else {
      fail(`Unbekanntes Argument: '${rest[i]}'`);
    }
    i += 1;
  }
  pruefeKombinationen(args);
  return args;
}

/**
 * Rueckgabe: der Exitcode — fuer `run` als Promise (Issue #1070), fuer `plan` und
 * `bereiche` wie bisher als Zahl.
 */
function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const [command, ...rest] = argv;
  if (command === "plan") {
    process.stdout.write(JSON.stringify(planen(parseArgs(rest)), null, 2) + "\n");
    return 0;
  }
  if (command === "run") return ausfuehren(parseArgs(rest));
  if (command === "bereiche") {
    // Kein Argument: Anteil und Inventar gelten fuer die Config und den versionierten
    // Stand, nicht fuer einen Anker. Ein uebergebenes Argument ist ein Irrtum.
    if (rest.length > 0) fail(`Unbekanntes Argument: '${rest[0]}'`);
    process.stdout.write(JSON.stringify(bereicheAuswerten(), null, 2) + "\n");
    return 0;
  }

  process.stdout.write(HELP);
  return fail(`Unbekannter Befehl: '${command}'. Erwartet: plan, run oder bereiche`);
}

// Nur als CLI ausfuehren, nicht beim Import (z. B. durch die node:test-Suite, #135).
// realpathSync statt resolve: Node loest fuer import.meta.url Symlinks auf (macOS:
// /var -> /private/var), ein nur normalisierter argv[1] wuerde dann nie matchen (#146).
let runAsCli = false;
if (process.argv[1]) {
  try {
    runAsCli = realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { /* argv[1] nicht aufloesbar -> kein CLI-Start */ }
}
if (runAsCli) {
  try {
    // exitCode statt process.exit: `run` faerbt den Lauf rot, ohne ihn abzuschneiden.
    process.exitCode = await main();
  } catch (err) {
    const prefix = err instanceof ChecksError ? "Fehler" : "Unerwarteter Fehler";
    process.stderr.write(`${prefix}: ${err.message}\n`);
    process.exit(1);
  }
}
