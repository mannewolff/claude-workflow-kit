// Rollen-Prompts der Plan-Pruefstufe (Issue #281, fachliche Quelle #272).
//
// Die mittlere Stufe ist die, an der sich der Bestandszugriff aus Issue #268 am
// meisten auszahlt: Ein Plan behauptet, WIE etwas gebaut wird — ob das mit dem
// vorhandenen Code zusammengeht, sieht nur ein Pruefer, der hineinschaut. Am
// 2026-08-08 wies ein Reviewer nach, dass ein im Plan referenziertes Kommando im
// Adapter gar nicht existiert. Das waere sonst in dreizehn Arbeitspakete gewandert.
//
// Wie beim fachlichen Pendant werden die Prompts EINZELN extrahiert: Ein Treffer
// im falschen Block waere gruen, obwohl der Pruefpunkt in seiner Rolle fehlt.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(repoRoot, "skills", "issue-review", "SKILL.md"), "utf-8");

/** Der Unterabschnitt der Plan-Stufe — die Prompts der anderen Stufen liegen ausserhalb. */
function planAbschnitt() {
  const idx = SKILL.indexOf("#### Stufe `plan`");
  assert.ok(idx >= 0, "Unterabschnitt '#### Stufe `plan`' fehlt");
  const rest = SKILL.slice(idx + 5);
  // Der Zuordnungs-Absatz gilt fuer ALLE Stufen und nennt deshalb auch die
  // fachlichen Rollennamen. Er ist die Untergrenze des Plan-Abschnitts.
  const marken = ["\n#### ", "\n### ", "\n**Zuordnung und Fehlerpfad:**"]
    .map((m) => rest.indexOf(m))
    .filter((x) => x >= 0);
  const grenze = marken.length ? Math.min(...marken) : -1;
  return grenze >= 0 ? rest.slice(0, grenze) : rest;
}

function promptBlock(rollenname) {
  const abschnitt = planAbschnitt();
  const idx = abschnitt.indexOf(rollenname);
  assert.ok(idx >= 0, `Rollenname '${rollenname}' fehlt im Plan-Abschnitt`);
  const treffer = /```\n([\s\S]*?)```/.exec(abschnitt.slice(idx));
  assert.ok(treffer, `kein Promptblock nach '${rollenname}'`);
  return treffer[1];
}

test("die Plan-Rollen stehen in einem eigenen Unterabschnitt", () => {
  const a = planAbschnitt();
  assert.match(a, /architektur-bestand/, "erste Rolle fehlt im Abschnitt");
  assert.match(a, /schnitt-abhaengigkeiten|schnitt-abhängigkeiten/, "zweite Rolle fehlt im Abschnitt");
  // Die Rollen der fachlichen Stufe duerfen nicht hineinragen.
  assert.ok(!a.includes("form-beobachtbarkeit"), "der Abschnitt greift in die fachliche Stufe hinueber");
});

test("architektur-bestand: prueft das Plan-Format vollstaendig", () => {
  const p = promptBlock("architektur-bestand");
  for (const ueberschrift of [
    "## Ziel",
    "## Betroffene Bereiche",
    "## Architektonische Entscheidungen",
    "## Geplante Änderungen",
    "## Offene Fragen",
    "## Verifizierung",
  ]) {
    // Der Prompt bricht die Ueberschriften ueber Zeilen um
    // ("## Architektonische\n   Entscheidungen") — ohne \s+ liefe der Test daran vorbei.
    const escaped = ueberschrift.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const muster = new RegExp(escaped.replaceAll(/\s+/g, String.raw`\s+`));
    assert.match(p, muster, `Pflichtabschnitt fehlt im Prompt: ${ueberschrift}`);
  }
  assert.match(p, /Reihenfolge/i, "die Reihenfolge wird nicht gefordert");
  assert.match(p, /- Keine\./, "der Umgang mit leeren Pflichtabschnitten fehlt");
});

// Der Bestandszugriff ist der Kern dieser Stufe. Ohne die Pflicht, die geprüfte
// Stelle zu nennen, ist ein Befund über den Bestand nicht nachvollziehbar.
test("architektur-bestand: verlangt Nachschlagen samt Angabe der geprueften Stelle", () => {
  const p = promptBlock("architektur-bestand");
  assert.match(p, /Repository nach|im Repository/i, "das Nachschlagen im Bestand wird nicht verlangt");
  assert.match(p, /nenne\s+die\s+Datei/i, "die Angabe der geprueften Stelle fehlt");
});

test("architektur-bestand: prueft die Begruendungspflicht der Entscheidungen", () => {
  const p = promptBlock("architektur-bestand");
  const absatz = p.split(/\n\s*\d\./).find((a) => /Begründung|Begruendung/.test(a));
  assert.ok(absatz, "kein Pruefpunkt zur Begruendungspflicht");
  assert.match(absatz, /nicht überprüfbar|nicht ueberpruefbar/i,
    "es fehlt der Grund: eine Entscheidung ohne Begruendung ist nicht pruefbar");
});

test("schnitt-abhaengigkeiten: prueft Zerlegbarkeit und Reihenfolge", () => {
  const p = promptBlock("schnitt-abhaengigkeiten");
  assert.match(p, /zerlegen|Arbeitspakete/i, "die Zerlegbarkeit wird nicht geprueft");
  assert.match(p, /Reihenfolge/i, "die erzwungene Reihenfolge wird nicht geprueft");
  assert.match(p, /unsichtbare[nr]?\s+Abhängigkeit/i,
    "der Fall der unsichtbaren Abhaengigkeit fehlt");
});

// Ohne diese Abgrenzung wandert jede beantwortbare Detailfrage in den Plan und
// blockiert ihn — die Stopp-Frage ist per Definition die, die den Zuschnitt aendert.
test("schnitt-abhaengigkeiten: grenzt Stopp-Fragen von Detailfragen ab", () => {
  const p = promptBlock("schnitt-abhaengigkeiten");
  assert.match(p, /Stopp-Fragen|Stopp-Frage/i, "der Begriff fehlt");
  assert.match(p, /Zuschnitt ändert|Zuschnitt aendert/i,
    "das Kriterium (aendert den Zuschnitt) fehlt");
});

test("beide Plan-Prompts tragen die Streich-Frage und genau einen Body-Platzhalter", () => {
  for (const rolle of ["architektur-bestand", "schnitt-abhaengigkeiten"]) {
    const p = promptBlock(rolle);
    assert.match(p, /Was kann RAUS/i, `Streich-Frage fehlt in ${rolle}`);
    const platzhalter = [...p.matchAll(/\{\{ISSUE_BODY\}\}/g)];
    assert.equal(platzhalter.length, 1, `${rolle}: genau ein {{ISSUE_BODY}} erwartet, gefunden ${platzhalter.length}`);
    assert.match(p, /BLOCKER \/ WICHTIG \/ HINWEIS/, `Ausgabeformat fehlt in ${rolle}`);
  }
});

test("beide Rollennamen zeigen auf verschiedene Bloecke", () => {
  assert.notEqual(
    promptBlock("architektur-bestand"),
    promptBlock("schnitt-abhaengigkeiten"),
    "beide Rollen zeigen auf denselben Block"
  );
});

test("Stop-Punkt: kein Schreiben in ein Plandokument im unbeaufsichtigten Lauf", () => {
  const stop = SKILL.split(/##\s*Stop-Punkte/)[1];
  assert.ok(stop, "kein Stop-Punkte-Abschnitt");
  const zeile = stop.split("\n").find((z) => /Plandokument|Plan-Dokument/i.test(z) && /unbeaufsichtigt/i.test(z));
  assert.ok(zeile, "der Stop-Punkt fuer die Plan-Stufe fehlt");
});
