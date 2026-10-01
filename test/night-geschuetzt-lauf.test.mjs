// Der Halt an einer geschuetzten Datei ueber beide Wege des Nacht-Runners (Issue #1048,
// Plan #987, Verifizierung 7 und 8, E9, E14; fachliche Quelle #868).
//
// Der erste belegte Fall (Kette zu Plan #797) lief ueber die Umsetzungsstufe der Kette,
// nicht ueber den Einzellauf. Dort gab `umsetzePaket` einen Gate-Treffer nur an den
// Bericht weiter: kein Label, kein Kommentar — weder am angehaltenen noch an den
// abhaengigen Paketen. Hier wird festgehalten, dass beide Wege am Board dasselbe
// hinterlassen: Label und Halt-Kommentar an der Karte mit geschuetzter Datei, der
// Abhaengigkeits-Kommentar an jedem Paket, das auf sie wartet, und die uebrigen laufen.
//
// Wie in den uebrigen Ketten-Tests laeuft das ECHTE kit/night.mjs gegen ein Temp-Repo
// mit lokalem Tracker; die Sessions sind Shell-Fakes ueber NIGHT_CLAUDE_CMD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  NUR_POSIX, run, board, mitProjekt, umgebung, repoRoot, UMSETZUNG_ERFOLG,
} from "./helpers/kette-fixture.mjs";
import { ERZEUGEN, fachplanB, umsetzung, keinRestInArbeit } from "./helpers/kette-umsetzung-fixture.mjs";

const boardModul = await import(pathToFileURL(join(repoRoot, "kit", "board.mjs")).href);

// Geschuetzte Pfade kommen aus der Vorgabeliste (E18), nicht als eigenes Literal.
const PFAD = boardModul.GESCHUETZTE_PFADE[0];

/** Die Umsetzungs-Session: vermerkt ihre Karte, dann das Erfolgs-Fake der Ketten-Tests. */
const UMSETZUNG_MIT_SPUR = `printf "%s\\n" "$NIGHT_ISSUE_ID" >> "$KETTE_LOG.ids"; ${UMSETZUNG_ERFOLG}`;

/** Die Karten, fuer die eine Umsetzungs-Session startete — in ihrer Reihenfolge. */
function gestartet(env) {
  try {
    return readFileSync(`${env.logPfad}.ids`, "utf-8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const paketBody = (datei, abhaengigkeit = "Keine.") => [
  "## Kontext", "", "Ein Paket fuer den Test.", "",
  "## Aufgabe", "", `In \`${datei}\` den Eintrag ergaenzen.`, "",
  "## Akzeptanzkriterium", "", "- Der Eintrag steht.", "",
  "## Abhängigkeiten", "", abhaengigkeit, "",
].join("\n");

function readyPaket(dir, titel, body) {
  const id = String(board(dir, "issue", "create", "--title", titel, "--body", body).id);
  board(dir, "issue", "move", id, "ready");
  return id;
}

const issueText = (dir, id) => readFileSync(join(dir, "issues", `${id}.md`), "utf-8");
const kommentare = (dir, id) => issueText(dir, id).split(/\n---\n\*\*Kommentar\*\* \([^)]*\)\n\n/).slice(1).map((k) => k.trim());

/** Der Halt-Kommentar, wie ihn der Runner bei gesetztem Label schreibt. */
function haltKommentar(dir, id) {
  const karte = board(dir, "issue", "get", id);
  const treffer = boardModul.geschuetzteTreffer(karte.body, karte.title, dir);
  assert.ok(treffer.length > 0, `Paket #${id} nennt keine geschuetzte Datei`);
  return `${boardModul.geschuetztKommentar(treffer)}\n\nLabel kit:geschuetzt gesetzt`;
}

/** Die Karte mit geschuetzter Datei: Backlog, Label, genau der eine Halt-Kommentar. */
function istAngehalten(dir, id) {
  const karte = board(dir, "issue", "get", id);
  assert.equal(karte.status, "backlog", `Paket #${id} steht in ${karte.status}`);
  assert.ok((karte.labels || []).includes("kit:geschuetzt"), `Paket #${id} traegt kit:geschuetzt nicht`);
  const halt = kommentare(dir, id).filter((k) => k.includes(boardModul.GESCHUETZT_ANKER));
  assert.deepEqual(halt, [haltKommentar(dir, id)], `Paket #${id} traegt nicht genau den einen Halt-Kommentar`);
}

/** Das abhaengige Paket: Backlog, Kommentar `Abhaengigkeit #N nicht erfuellt`, keine Session. */
function istZurueckgestellt(dir, id, an) {
  const karte = board(dir, "issue", "get", id);
  assert.equal(karte.status, "backlog", `Paket #${id} steht in ${karte.status}`);
  const nummer = Number(an);
  const treffer = kommentare(dir, id).filter((k) => k.includes(`Abhaengigkeit #${nummer} nicht erfuellt`));
  assert.equal(treffer.length, 1, `Paket #${id} traegt den Abhaengigkeits-Kommentar nicht genau einmal: ${JSON.stringify(kommentare(dir, id))}`);
}

// --- Einzellauf ---

test("Einzellauf: drei Ready-Karten, eine mit geschuetztem Pfad — sie haelt an, die beiden uebrigen laufen", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const geschuetzt = readyPaket(dir, "Paket mit geschuetzter Datei", paketBody(PFAD));
    const erstes = readyPaket(dir, "Erstes freies Paket", paketBody("src/eins.mjs"));
    const zweites = readyPaket(dir, "Zweites freies Paket", paketBody("src/zwei.mjs"));

    const env = umgebung(dir, { stufen: { umsetzung: UMSETZUNG_MIT_SPUR } });
    const res = run(dir, ["--label", "none"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(gestartet(env), [erstes, zweites], "fuer die Karte mit geschuetzter Datei startete eine Session");
    istAngehalten(dir, geschuetzt);
    for (const id of [erstes, zweites]) assert.equal(board(dir, "issue", "get", id).status, "in_review");
    keinRestInArbeit(dir);
  });
});

test("Einzellauf: das Paket, das die angehaltene Karte voraussetzt, wird mit Abhaengigkeits-Kommentar zurueckgestellt", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const geschuetzt = readyPaket(dir, "Paket mit geschuetzter Datei", paketBody(PFAD));
    const abhaengig = readyPaket(dir, "Abhaengiges Paket", paketBody("src/eins.mjs", `Issue #${Number(geschuetzt)}`));
    const frei = readyPaket(dir, "Freies Paket", paketBody("src/zwei.mjs"));

    const env = umgebung(dir, { stufen: { umsetzung: UMSETZUNG_MIT_SPUR } });
    const res = run(dir, ["--label", "none"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    assert.deepEqual(gestartet(env), [frei]);
    istAngehalten(dir, geschuetzt);
    istZurueckgestellt(dir, abhaengig, geschuetzt);
    assert.equal(board(dir, "issue", "get", frei).status, "in_review");
    keinRestInArbeit(dir);
  });
});

// --- Kette unter Variante B ---

/**
 * Die Fake-Zeile der Stufe pakete: drei Pakete mit `Plan: Issue #M`, das zweite haengt vom
 * ersten ab, das dritte ist frei. Die Nummer des ersten legt der Fake fuer die Abdeckung ab.
 */
const PAKETE_DREI = String.raw`m=$(printf "%s" "$NIGHT_PROMPT" | sed -n "s|^/issues #\([0-9]*\).*|\1|p"); erste=""; for n in 1 2 3; do if [ "$n" = 2 ]; then dep="Issue #$erste"; else dep="Keine."; fi; printf "## Kontext\n\nPlan: Issue #%s\nFachliche Quelle: Issue #%s\n\n## Aufgabe\n\nIn \`src/paket%s.mjs\` den Eintrag ergaenzen.\n\n## Akzeptanzkriterium\n\n- node --test\n\n## Abhängigkeiten\n\n%s\n" "$m" "$NIGHT_ISSUE_ID" "$n" "$dep" > "$KETTE_LOG.p$n.md"; id=$(node .claude/kit/board.mjs issue create --title "Paket $n" --body-file "$KETTE_LOG.p$n.md" | node -e 'const i=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(i.id))'); if [ "$n" = 1 ]; then erste="$id"; printf "%s" "$id" > "$KETTE_LOG.erste"; fi; done`;

/**
 * Die Fake-Zeile der Stufe abdeckung: Sie schreibt die geschuetzte Datei aus
 * `$KETTE_GESCHUETZT` in die Aufgabe des ersten Pakets.
 *
 * Die Formstufe weist ein solches Paket heute mit I8 ab, bevor die Umsetzung es sieht.
 * Den Weg zur Umsetzungsstufe oeffnet erst Issue #1049; bis dahin kommt der Pfad nach der
 * Formpruefung ins Paket — der Fall, den die Umsetzungsstufe ohnehin auffangen muss.
 */
const ABDECKUNG_SCHUETZT_ERSTES = String.raw`id=$(cat "$KETTE_LOG.erste"); sed "s|src/paket1.mjs|$KETTE_GESCHUETZT|" "$KETTE_LOG.p1.md" > "$KETTE_LOG.p1g.md"; node .claude/kit/board.mjs issue update "$id" --body-file "$KETTE_LOG.p1g.md" >/dev/null`;

test("Kette: die Umsetzungsstufe vermerkt die angehaltene Karte und das abhaengige Paket am Board, das freie laeuft", NUR_POSIX, () => {
  mitProjekt((dir) => {
    const F = fachplanB(dir);
    const stufen = { ...ERZEUGEN, pakete: PAKETE_DREI, abdeckung: ABDECKUNG_SCHUETZT_ERSTES, umsetzung: UMSETZUNG_MIT_SPUR };
    const env = { ...umgebung(dir, { stufen }), KETTE_GESCHUETZT: PFAD };
    const res = run(dir, ["--kette"], env);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const { einheit, stufe } = umsetzung(dir, F);
    const [geschuetzt, abhaengig, frei] = einheit.stufen.pakete.ids;
    assert.ok(frei, `die Stufe pakete legte keine drei Pakete an: ${JSON.stringify(einheit.stufen.pakete)}`);

    assert.deepEqual(gestartet(env), [frei], "fuer ein angehaltenes oder abhaengiges Paket startete eine Session");
    assert.deepEqual(stufe.umgesetzt.map((e) => e.id), [frei]);
    // Der Bericht fuehrt beide weiterhin (E14) — zusaetzlich zum Vermerk am Board.
    assert.deepEqual(stufe.nichtBegonnen.map((p) => p.id), [geschuetzt, abhaengig]);

    istAngehalten(dir, geschuetzt);
    istZurueckgestellt(dir, abhaengig, geschuetzt);
    keinRestInArbeit(dir);
  });
});
