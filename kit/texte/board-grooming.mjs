/**
 * texte/board-grooming.mjs — die Texttabelle von board/grooming.mjs (Issue #1511). Eigener Teil,
 * damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen kann, ohne die
 * Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die Tabelle und
 * exportiert sie unter demselben Namen weiter.
 */

/**
 * Die Meldungen des Einstiegs, die Gruende von `stoppKommentar` und die Meldungen von
 * `koerperPruefen` (Issue #1512) je Sprache. Vertragswerte bleiben ausserhalb: die Werte von
 * `grund` (`kein-fachplan`, `unbeaufsichtigt`, `ungeprueft`, `nichts-offen`), die Regeln von
 * `koerperPruefen` und der Vermerk „Keine“, den die Nacht-Kette nur deutsch erkennt.
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
    kennzeichnung: "Die Zeile „{zeile}“ fehlt im neuen Body oder ist geändert; Kennzeichnungszeilen bleiben unverändert stehen.",
    antwortOffen: "Frage „{frage}“ war entschieden und ist im neuen Body offen; die Antwortzeile „{antwort}“ bleibt stehen.",
    antwortAnders: "Frage „{frage}“ trägt im neuen Body eine andere Antwortzeile: vorher „{vorher}“, jetzt „{nachher}“.",
    fragenzahl: "Der neue Body hat {neu} Frage(n) statt {alt}; Fragen werden entschieden oder zurückgestellt, nie gestrichen.",
    vermerkOffen: "Der Vermerk „Keine“ steht, aber {zahl} Frage(n) sind offen; er steht erst, wenn alle entschieden sind.",
    vermerkStelle: "Der Vermerk „Keine“ steht nicht als erste nichtleere Zeile unter den offenen Fragen: „{zeile}“.",
    vermerkZahl: "Der Vermerk „Keine“ nennt {genannt} statt {zahl} Frage(n); er zählt alle Fragen des Abschnitts.",
    pflichtabschnitt: "Der Pflichtabschnitt „{abschnitt}“ fehlt im neuen Body.",
  }),
  en: Object.freeze({
    keinFachplan: "#{id} is not a requirement: /groom only takes a card with the prefix {praefix}.",
    unbeaufsichtigt: "Unattended (KIT_AGENT_MODEL set): grooming needs a human to answer, /groom does not start.",
    ungeprueft: "#{id} has not been checked yet (neither {fertig} nor {klaeren}): have it checked first (`/issue-review #{id}`).",
    nichtsOffen: "#{id} carries the note “Keine” and no {klaeren}: nothing to groom, the requirement stays unchanged.",
    vermerkWiderspruch: "Below the note “Keine” there are {zahl} question(s) without an answer line: {liste}",
    keinEinarbeitungsKommentar: "no comment with “{anker} <n>” as its first line: the halt does not come from a check of the requirement, its way forward is in the halt comment",
    ketteJuenger: "a “{anker}” is newer than the incorporation comment: the halt comes from the night chain, the answer belongs in the plan, its way forward is in the halt comment",
    kennzeichnung: "The line “{zeile}” is missing from the new body or has changed; marker lines stay unchanged.",
    antwortOffen: "Question “{frage}” was decided and is open in the new body; the answer line “{antwort}” stays.",
    antwortAnders: "Question “{frage}” carries a different answer line in the new body: before “{vorher}”, now “{nachher}”.",
    fragenzahl: "The new body has {neu} question(s) instead of {alt}; questions are decided or deferred, never removed.",
    vermerkOffen: "The note “Keine” is set, but {zahl} question(s) are open; it is set only once all are decided.",
    vermerkStelle: "The note “Keine” is not the first non-empty line below the open questions: “{zeile}”.",
    vermerkZahl: "The note “Keine” names {genannt} instead of {zahl} question(s); it counts all questions of the section.",
    pflichtabschnitt: "The required section “{abschnitt}” is missing from the new body.",
  }),
});
