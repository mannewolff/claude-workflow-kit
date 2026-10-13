/**
 * texte/board-vertraege.mjs — die Texttabelle von board/vertraege.mjs (Issue #1612, Plan #1611).
 * Eigener Teil, damit `sonar.cpd.exclusions` die gleich gebauten Haelften de und en ausnehmen
 * kann, ohne die Logik des Moduls aus der Duplikatsmessung zu nehmen. Das Modul importiert die
 * Tabelle und exportiert sie unter demselben Namen weiter.
 */

// ============================================================
// Texte an den Menschen (Plan #1420 E13/E14)
// ============================================================

/**
 * Die Meldungen von Gate P14 je Sprache. Die festen Woerter der Form (Zeilenanfaenge, Werte,
 * Leerform) setzt das Modul aus der Tabelle VERTRAG in kit/board/namen.mjs ein.
 */
export const TEXTE = Object.freeze({
  de: Object.freeze({
    fehlt: "Die Config nennt in `vertragsRepos` ein Partnerrepo ({repos}), aber am Ende von „## {entscheidungen}“ steht kein Unterabschnitt `### {ueberschrift}`. Je Festlegung, die das andere Repo liest oder schreibt, steht dort ein Eintrag `- V<n>:`; legt der Plan keine fest, die Zeile `{leer}`.",
    leer: "Der Unterabschnitt `### {ueberschrift}` trägt weder einen Eintrag `- V<n>:` noch die Zeile `{leer}`.",
    kopf: "Vertrag V{nummer}: Der Kopf endet nicht auf „— <Repo>, {liest} | {schreibt}“.",
    repoUnbekannt: "Vertrag V{nummer} nennt das Repo „{repo}“, das nicht in `vertragsRepos` steht (bekannt: {repos}).",
    zeileFehlt: "Vertrag V{nummer} trägt keine Zeile `{zeile}`.",
    wertUnbekannt: "Vertrag V{nummer}: `{zeile}` hat den unbekannten Wert „{wert}“ (bekannt: {werte}).",
    vorgelegtStand: "Vertrag V{nummer} ist „{vorgelegt}“, aber `{stand}` beginnt nicht mit „{standFehlt}“ — vorlegen darf das Projekt nur, was im anderen Repo nachweislich fehlt.",
    vorgelegtZeilen: "Vertrag V{nummer} ist „{vorgelegt}“ und braucht die Zeilen `{wortlaut}` und `{zitat}`.",
    offen: "Offene Verträge ohne Zeile `{entschieden}`: {nummern}. Unter „## {fragen}“ steht eine Frage an den Menschen, die {nummern} aufzählt; die erste Zeile dort ist nicht `- Keine.`. Dabei wird `{abgleich}` nicht geändert und keine Zeile `{entschieden}` eingetragen — die schreibt nur, wer die Antwort des Menschen hat.",
  }),
  en: Object.freeze({
    fehlt: "The config names a partner repo in `vertragsRepos` ({repos}), but there is no subsection `### {ueberschrift}` at the end of \"## {entscheidungen}\". It holds one entry `- V<n>:` per definition the other repo reads or writes; if the plan defines none, the line `{leer}`.",
    leer: "The subsection `### {ueberschrift}` holds neither an entry `- V<n>:` nor the line `{leer}`.",
    kopf: "Contract V{nummer}: the head does not end in \"— <repo>, {liest} | {schreibt}\".",
    repoUnbekannt: "Contract V{nummer} names the repo \"{repo}\", which is not in `vertragsRepos` (known: {repos}).",
    zeileFehlt: "Contract V{nummer} has no line `{zeile}`.",
    wertUnbekannt: "Contract V{nummer}: `{zeile}` has the unknown value \"{wert}\" (known: {werte}).",
    vorgelegtStand: "Contract V{nummer} is \"{vorgelegt}\", but `{stand}` does not start with \"{standFehlt}\" — the project may only propose what is shown to be missing in the other repo.",
    vorgelegtZeilen: "Contract V{nummer} is \"{vorgelegt}\" and needs the lines `{wortlaut}` and `{zitat}`.",
    offen: "Open contracts without a line `{entschieden}`: {nummern}. Under \"## {fragen}\" there is a question to the human that lists {nummern}; the first line there is not `- Keine.`. `{abgleich}` is not changed for this, and no line `{entschieden}` is added — only someone who has the human's answer writes it.",
  }),
});
