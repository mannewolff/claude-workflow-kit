/**
 * texte/board-grooming.mjs — die Texttabelle von board/grooming.mjs (Issue #1511). Eigener Teil,
 * damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

/**
 * Die Meldungen des Einstiegs und die Gruende von `stoppKommentar` je Sprache. Vertragswerte
 * bleiben ausserhalb: die Werte von `grund` (`kein-fachplan`, `unbeaufsichtigt`, `ungeprueft`,
 * `nichts-offen`) und der Vermerk „Keine“, den die Nacht-Kette nur deutsch erkennt.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    keinFachplan: "#{id} ist kein Fachplan: /groom nimmt nur eine Karte mit dem Präfix {praefix}.",
    unbeaufsichtigt: "Unbeaufsichtigt (KIT_AGENT_MODEL gesetzt): Beim Grooming antwortet ein Mensch, /groom beginnt nicht.",
    ungeprueft: "#{id} ist noch nicht geprüft (weder {fertig} noch {klaeren}): zuerst prüfen lassen (`/issue-review #{id}`).",
    nichtsOffen: "#{id} trägt den Vermerk „Keine“ und kein {klaeren}: nichts zu groomen, der Fachplan bleibt unverändert.",
    vermerkWiderspruch: "Unter dem Vermerk „Keine“ steht {zahl} Frage(n) ohne Antwortzeile: {liste}",
    keinEinarbeitungsKommentar: "kein Kommentar mit „{anker} <n>“ als erster Zeile: Der Halt entstammt keiner Prüfung des Fachplans, sein Weg steht im Halt-Kommentar",
    ketteJuenger: "jünger als der Einarbeitungs-Kommentar steht „{anker}“: Der Halt kommt von der Nacht-Kette, die Antwort gehört in den Plan, sein Weg steht im Halt-Kommentar",
  }),
  en: Object.freeze({
    keinFachplan: "#{id} is not a requirement: /groom only takes a card with the prefix {praefix}.",
    unbeaufsichtigt: "Unattended (KIT_AGENT_MODEL set): grooming needs a human to answer, /groom does not start.",
    ungeprueft: "#{id} has not been checked yet (neither {fertig} nor {klaeren}): have it checked first (`/issue-review #{id}`).",
    nichtsOffen: "#{id} carries the note “Keine” and no {klaeren}: nothing to groom, the requirement stays unchanged.",
    vermerkWiderspruch: "Below the note “Keine” there are {zahl} question(s) without an answer line: {liste}",
    keinEinarbeitungsKommentar: "no comment with “{anker} <n>” as its first line: the halt does not come from a check of the requirement, its way forward is in the halt comment",
    ketteJuenger: "a “{anker}” is newer than the incorporation comment: the halt comes from the night chain, the answer belongs in the plan, its way forward is in the halt comment",
  }),
});
