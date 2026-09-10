## Plan-Review, Runde 1

Reviewer: fable (architektur-bestand), gpt-astra (schnitt-abhaengigkeiten) — Stufe `plan`, Runde 1 von 1, Besetzung vollstaendig (2 von 2), Paarung aus `pairs`, Autor `claude-opus-5` aufgeloest.
fable — Bestand: gelesen
gpt-astra — Bestand: gelesen

### fable — Architektur und Bestand

## Plan-Review #589 — Befundliste (Rolle: architektur-bestand)

Geprüft gegen `CLAUDE-workflow.md` (W1–W4) und `CLAUDE-Plan.md` (P1–P12). Bestand nachgeschlagen in `kit/board.mjs`, `kit/night.mjs`, `tools/sync-blobs.mjs`, `skills/issue-review/SKILL.md`, `.claude/skills/issue-review/SKILL.md`, `skills/techplan/SKILL.md`, `specs/*.md`, `test/`, `docs/dokumentation.md` und am Board (`issue get 587`).

### Format (Punkt 0)

Kein Fund. Die sechs Abschnitte stehen genau einmal in der richtigen Reihenfolge (P1), keine weitere `##`-Ebene (P2), `Plan-Modell:` und `Fachliche Quelle: Issue #587` vor `## Ziel` (P3/P4), `## Offene Fragen` mit `- Keine.` als erster Zeile (P6), keine `Issue-Review:`-Zeile (P12). Der Unterabschnitt `### Beschreibungs-Luecken` entspricht der Form aus `/techplan` (beide Quellen, `gelesen:`-Zeilen und `luecken`-Ausgabe). Die `Autor-Modell:`-Zeile im Kopf stammt vom Adapter (`--author-model`, `kit/board.mjs` Zeile 14–18) und ist kein Formverstoß.

### Befunde

**1. BLOCKER · `gate` (P10) — Die Vorlage liegt nicht unter `templates/.claude/skills/`.**
Fundstelle: Betroffene Bereiche, `templates/.claude/skills/issue-review/SKILL.md | Synthese-Format um den Beleg …`.
Nachgesehen: `ls templates` → nur `CLAUDE-*.md`, `kontext.config.json`, `workflow.config*.json`; kein `.claude/`-Unterordner. Die Vorlage der Skills ist `skills/issue-review/SKILL.md` — `tools/sync-blobs.mjs` bäckt `SKILLS_B64` aus `sourceDir: join(root, "skills")` und kopiert nach `.claude/skills/` (Abschnitt „Dogfooding-Kopien unter .claude/skills/", Issue #213). Der Plan widerspricht sich selbst: Die Luecken-Zeile nennt `skills/issue-review/SKILL.md`. Ein Arbeitspaket mit dem Tabellenpfad legt eine Datei an, die weder Installer noch Sync je lesen.
Vorschlag: Tabellenzeile auf `skills/issue-review/SKILL.md` ändern; die Zeile `.claude/skills/issue-review/SKILL.md | Dogfooding-Kopie (über tools/sync-blobs.mjs)` bleibt.

**2. BLOCKER · `alternativen` — Interaktiv kann das Kommando am Board nichts finden, bevor gefragt wird.**
Fundstelle: Geplante Änderungen, SKILL.md: „`synthese-check` als Schreibbefehl 4b, zwischen Synthese-Kommentar und dem zweiten `issue update`" und „Interaktiv: Der Befund wird gezeigt, **bevor** nach der Zustimmung gefragt wird".
Nachgesehen: `.claude/skills/issue-review/SKILL.md`, Schritt 6, „Reihenfolge der Schreibbefehle": 1 Body-Vorschlag-Kommentar, 2 `issue update` (Body geschrieben), 3 `label add`, 4 Synthese-Kommentar, 5 zweites `issue update`. Und: „**Interaktiv wird nichts ohne Zustimmung geschrieben.** Zeige einen Vorschlag … und frage einmal." Die Zustimmung liegt also *vor* Schreibbefehl 1. Zu diesem Zeitpunkt gibt es am Board weder Synthese- noch Vorschlags-Kommentar — das Kommando `synthese-check &lt;id&gt;`, das laut Plan „aus dem jüngsten `## Synthese, Runde &lt;n&gt;`-Kommentar" liest, hat nichts zu lesen. Position 4b erfüllt Kriterium 3 nur nachts; interaktiv liegt der Body dann schon geschrieben vor (Schreibbefehl 2) — genau das, was Kriterium 3 ausschließt.
Zwei Wege: (a) Das Kommando nimmt seine Eingaben auch aus Dateien (`synthese-check --synthese-file &lt;pfad&gt; --vorschlag-file &lt;pfad&gt;`), läuft interaktiv vor der Frage und nachts vor Schreibbefehl 1; die Board-Variante `&lt;id&gt;` bleibt für den Nacht-Runner als unabhängige Nachprüfung. (b) Die Schreibreihenfolge wird geändert, sodass Vorschlag und Synthese interaktiv vor der Zustimmung als Kommentare ans Board gehen — das kollidiert mit „nichts ohne Zustimmung geschrieben" und mit `test/skills-issue-review-reihenfolge.test.mjs`. Der Plan muss einen wählen und die Ablauf-Zeile entsprechend fassen.

**3. BLOCKER · `korrektur` — Die Verifizierung verlangt zwei Ergebnisse, die sich ausschließen.**
Fundstelle: Verifizierung, „Negativnachweis … gegen die echten Synthese/Vorschlag-Paare aus dem Board-Bestand (#579, #580, #583–#585, #587) und meldet dort `ok: true`" gegen „Beleg-fehlt-Pfad: Eine echte Synthese ohne Beleg-Syntax ergibt `beleg-fehlt` je Zeile, nicht `ok: true`" und A3.
Nachgesehen: Synthese-Kommentar an #587 (`issue get 587`, Kommentar 3): Zeilen wie `- fable, "…" (BLOCKER, \`gate\` F10) — **übernommen**, aber auf einem dritten Weg. …` — kein `→ &lt;Abschnitt&gt;: "&lt;Zitat&gt;"`, keine der Bestandssynthesen trägt das Format, weil es erst mit diesem Plan entsteht. Nach A3 ergibt jede dieser `übernommen`-Zeilen `beleg-fehlt`, also `ok: false`. Der Negativnachweis kann so nie grün werden; wird er grün, ist A3 nicht umgesetzt.
Vorschlag: „Negativnachweis: Aus den echten Paaren (#579 …) werden die `übernommen`-Zeilen **nachträglich um Belege aus dem tatsächlichen Vorschlagstext ergänzt** (Zitate kopiert, nichts erfunden); darauf meldet das Kommando `ok: true`. Die unveränderten Bestandssynthesen sind der Beleg-fehlt-Pfad." Zusätzlich muss der Parser die gewachsene Form tragen: `**übernommen**` in Fettschrift, Klasse in der Klammer, umgebrochene Listenpunkte, Prosa nach dem Ausgang — sonst Fehlalarm auf genau den Texten, die der Plan als Maßstab nennt.

**4. WICHTIG · `alternativen` — Im Erzeugungsmodus ist `kit:klaeren` heute ein Endzustand; der Plan behauptet das Gegenteil.**
Fundstelle: Geplante Änderungen, night.mjs: „Im Erzeugungsmodus (`night-8`) zählt ein Dokument mit diesem Ausgang nicht als Endzustand — das Routing-Label bleibt liegen." Zugleich SKILL.md: „Bei `ok: false` bleibt der Marker aus, `kit:klaeren` wird gesetzt".
Nachgesehen: `kit/night.mjs`, `pruefEnde()` (ab ca. Zeile 3018): `const klaeren = hatKlaerenLabel(stand); … if (klaeren) return ende(true, "traegt kit:klaeren — …")` — `endzustand: true`, geprüft **vor** allem anderen; `pruefeErzeugtes()` entfernt danach das Routing-Label. Mit dem Label, das der Plan selbst setzt, fällt das Routing-Label also — es sei denn, `pruefEnde` wird geändert, was der Plan nicht nennt. Bliebe das Label trotz `kit:klaeren` stehen, liefe die nächste Nacht ohne Session sofort in `klaeren → Endzustand` und entfernte es dann — ein Aufschub, kein Verhalten. Kriterium 6 („nicht automatisch wiederholt") erfüllt der bestehende Pfad bereits.
Zwei Wege: (a) Satz streichen und schreiben: „`kit:klaeren` wirkt wie bei `gate`-Funden: `pruefEnde` meldet Endzustand `klaeren`, das Routing-Label fällt, der Mensch entscheidet." (b) `pruefEnde` unterscheidet einen neuen Grund (z. B. Label oder Kommentar-Anker `syntheseOhneBeleg`) und liefert `endzustand: false` — dann gehört die Änderung an `pruefEnde`, `ENDZUSTAENDE` und `test/night-erzeugung-pruefschleife.test.mjs` in den Plan.

**5. WICHTIG · `korrektur` — Der fünfte Ausgang hat keinen Platz in der Reihenfolge von `werteReviewSession`, und der Runner weiß nicht, woher er ihn nimmt.**
Fundstelle: Geplante Änderungen, night.mjs: „Fünfter Ausgang `syntheseOhneBeleg` neben `ohneBefund`, `mitBefund`, `schaerfungFehlt`, `ohneErgebnis`."
Nachgesehen: `kit/night.mjs`, `werteReviewSession()` (ca. Zeile 2340–2370): Reihenfolge Marker → `ohneBefund`; Spur unverändert → `ohneErgebnis`; `bodyVorschlagVorhanden` → `mitBefund`; sonst `schaerfungFehlt`. Der Plan sagt nicht, ob der Runner `board("issue-review","synthese-check", id)` **selbst** aufruft (A1 sagt, ein Skill-Satz sei nicht verlässlich — dann muss er) oder ein Label/Kommentar der Session liest, und nicht, an welcher Stelle: Setzt eine Session entgegen der Regel den Marker trotz `ok: false`, liefert die heutige Reihenfolge `ohneBefund`, und der Befund ist unsichtbar.
Vorschlag: „Der Runner ruft `issue-review synthese-check &lt;id&gt;` nach der Session selbst auf, **vor** der Marker-Prüfung; `ok: false` ergibt `syntheseOhneBeleg` unabhängig vom Marker. Zähler, Abschlusszeile (`Nacht-Review beendet …`) und Ergebnisstand tragen den fünften Wert." Betroffen und im Plan zu nennen: `test/night-review-loop.test.mjs`, `test/night-body-vorschlag.test.mjs`, `test/night-ergebnisstand-review.test.mjs` (feste Ausgangswerte, Zeile 157 ff.), Spec `night-5`.

**6. WICHTIG · `alternativen` — Schritt 2 (A6/A7) steht als Entscheidung, aber nirgends als Änderung, und die Bestandsbehauptung trägt nicht.**
Fundstelle: A6 „`issue-review roles` kennt Rollen je Stufe, und `pairs` schließt den Autor bereits aus" und A7 „Schritt 2 (A6) kommt danach"; unter `## Geplante Änderungen` und `## Verifizierung` kommt Schritt 2 nicht vor.
Nachgesehen: `kit/board.mjs`, `pickReviewers()` (ca. Zeile 3125–3145): Ausschluss ist `r.name !== schluessel` — **nur der Autor**. Kriterium 7 aus #587 verlangt ein Modell, das „weder das Dokument geschrieben noch eine der Befundlisten erstellt" hat — auf der Stufe `plan` sind das drei auszuschließende Namen; `pairs` kann „nicht diese beiden Reviewer" nicht ausdrücken. Die vorhandene Mechanik reicht also gerade nicht. `/issues` erzeugt aus diesem Plan kein Paket für Schritt 2, obwohl #587 beide Schritte als Lieferumfang festlegt.
Zwei Wege: (a) Schritt 2 ausdrücklich aus diesem Plan nehmen (eigener `/techplan` gegen #587, Satz im Ziel), A6 streichen, A7 auf einen Satz kürzen. (b) Schritt 2 planen: `roles --stufe &lt;s&gt; --rolle synthese` bekommt zusätzlich die gelaufenen Reviewer als Ausschluss (`--ausschluss &lt;name,…&gt;`), Promptblock `synthese` im Skill (Schritt 5c), eigener Ausgang, Verifizierung. Als Entscheidung ohne Änderung ist A6 heute nur eine Absicht.

**7. WICHTIG · `korrektur` — Welcher Body-Vorschlag zu welcher Synthese gehört, ist nicht festgelegt; der Fall „Vorschlag fehlt ganz" hat keinen Grund.**
Fundstelle: Geplante Änderungen, board.mjs: „`syntheseBelegt(synthese, vorschlag)` — hält jedes Zitat gegen den Vorschlagstext"; `ohneBeleg` kennt nur `beleg-fehlt` und `zitat-nicht-gefunden`.
Nachgesehen: `kit/board.mjs`, Kommentar zu `reviewZustand` Regel 4: „`/issue-review` nummeriert je Session ab 1, drei Naechte hinterlassen dreimal `Runde 1`" — die Rundennummer allein identifiziert das Paar nicht. `kit/night.mjs`, `VORSCHLAG_KOPF` = `/^##\s*Body-Vorschlag,\s*Runde\s*(\d+)\s*$/` ist nicht exportiert; `board.mjs` kann es nicht importieren (Abhängigkeitsrichtung ist night → board). Die neun Fälle vom 2026-08-12 sind laut #587 (Kriterium 11) gerade der Fall „Vorschlagstext fehlt ganz" — dafür liefert das Kommando weder `ok: false` noch einen Grund.
Vorschlag: „Paarung: der jüngste `## Synthese, Runde n`-Kommentar und der jüngste **davor** liegende `## Body-Vorschlag, Runde n`-Kommentar mit gleichem n. Fehlt er: dritter Grund `vorschlag-fehlt`, `ok: false`. Der Kopf-Regex wandert als Export nach `board.mjs`; `night.mjs` importiert ihn wie `GRENZE_RUNDEN`, statt ihn ein zweites Mal zu führen."

**8. WICHTIG · `korrektur` — Wer schreibt den Befund ans Dokument (Kriterium 5), und in welcher Betriebsart?**
Fundstelle: night.mjs: „Der Board-Kommentar nennt die nicht belegten Funde einzeln (Kriterium 5)"; SKILL.md: „Bei `ok: false` bleibt der Marker aus, `kit:klaeren` wird gesetzt"; interaktiv nur „Der Befund wird gezeigt".
Nachgesehen: Kriterium 5 in #587: „Am Dokument selbst ist erkennbar, **dass** ein Befund vorliegt und **woran** es liegt … ohne Rekonstruktion aus einem Verlauf." Der Plan lässt offen, ob der Kommentar aus der Session kommt (dann nachts doppelt, wenn der Runner ihn auch schreibt) oder nur vom Runner (dann interaktiv keiner — Kriterium 5 gilt aber für beide Betriebsarten, Kriterium 3). Ein Chat-Hinweis ist kein „am Dokument".
Vorschlag: „Der Skill schreibt in beiden Betriebsarten den Abgleich als eigenen Kommentar (`## Synthese-Abgleich, Runde n`, je Zeile Reviewer, Fund, Grund); der Runner schreibt keinen zweiten, sondern nennt den Ausgang nur im Ergebnisstand und Protokoll." Anmerkung: Ein Kopf der Form `## …, Runde n` zählt in `RUNDEN_KOPF` (night.mjs) für `hoechsteRunde` mit — gleiche n wie die Synthese, dann bleibt `bodyVorschlagVorhanden` unberührt; `reviewZustand` liest nur `## &lt;Marker&gt;, Runde` und ist nicht betroffen, wie A-Text „`GRENZE_RUNDEN` bleibt unberührt" richtig sagt.

**9. WICHTIG · `gate` (P10) — `test/night-review.test.mjs` gibt es nicht.**
Fundstelle: Betroffene Bereiche, „`test/board-synthese-check.test.mjs`, `test/night-review.test.mjs` | neu bzw. erweitert".
Nachgesehen: `ls test | grep night` — vorhanden sind u. a. `night-review-loop.test.mjs`, `night-review-mode.test.mjs`, `night-body-vorschlag.test.mjs`, `night-ergebnisstand-review.test.mjs`, `night-erzeugung-pruefschleife.test.mjs`; keine `night-review.test.mjs`. „Erweitert" trifft eine Datei, die es nicht gibt.
Vorschlag: „`test/night-review-loop.test.mjs`, `test/night-body-vorschlag.test.mjs`, `test/night-ergebnisstand-review.test.mjs` erweitert; `test/skills-issue-review-reihenfolge.test.mjs` angepasst (Schreibbefehl 4b)."

**10. HINWEIS · `korrektur` — Leerfälle des Kommandos sind nicht definiert.**
Fundstelle: „Annahme: … geprüft wird nur die Synthese der laufenden Runde" und das JSON `{ ok, gepruefte, ohneBeleg }`.
Nachgesehen: SKILL.md Schritt 6: „Bei befundfreiem Lauf entfallen die Schritte 1 bis 3" — ob dann ein Synthese-Kommentar existiert, ist im Skill nicht eindeutig; ein Dokument ohne jeden Synthese-Kommentar (erster Review, Verzicht, Ausfall) ist der Regelfall am Board. Das Kommando kennt keine „laufende Runde", nur den jüngsten Kommentar.
Vorschlag: „Ohne Synthese-Kommentar oder ohne `übernommen`-Zeile: `{ ok: true, gepruefte: 0, ohneBeleg: [] }` — nichts behauptet, nichts zu belegen. Der Runner wertet `gepruefte: 0` nicht als Ausgang."

**11. HINWEIS · `alternativen` — „Wörtlich" ist bei Markdown zweideutig.**
Fundstelle: A2 „Vergleich über eine Normalisierung (Zeilenumbrüche und Mehrfach-Leerraum auf ein Leerzeichen)".
Nachgesehen: Bestandssynthesen (#587) verwenden `**…**`, `` `…` ``, typografische Anführungszeichen „…" neben `"…"`; die Kurzbezeichnung steht ebenfalls in Anführungszeichen — die Zeile trägt dann zwei Zitate, und der Parser muss das nach `→` nehmen. Ein Zitat ohne die Sternchen des Vorschlags meldet `zitat-nicht-gefunden`, obwohl der Satz dasteht.
Wege: (a) Normalisierung zusätzlich über Markdown-Auszeichnung (`*`, `_`, Backticks) und Anführungszeichen-Varianten; (b) Regel „Zitat samt Auszeichnung kopieren" im Skill, Normalisierung bleibt wie geplant. (a) nimmt Fehlalarme, (b) hält den Vergleich streng — der Plan sollte es entscheiden, weil der Negativnachweis daran hängt.

**12. HINWEIS · `korrektur` — Specs werden nicht direkt geschrieben; Docs-Stand ist schon heute veraltet.**
Fundstelle: Betroffene Bereiche, „`specs/board.md`, `specs/night.md`, `specs/skills.md` | je eine neue Aussage".
Nachgesehen: `CLAUDE-workflow.md`, „Spec-Fortschreibung beim Push": `spec.mjs apply` trägt nach, „was die Arbeitspakete … im Abschnitt `## Spec-Wirkung` angekündigt haben". `docs/dokumentation.md` Zeile 683 nennt „**Drei Ausgänge pro Issue**" — der vierte (`schaerfungFehlt`) fehlt dort bereits.
Vorschlag: „je eine neue Aussage über `## Spec-Wirkung` der Arbeitspakete" und im Docs-Abschnitt „Tabelle der Ausgänge auf fünf Zeilen bringen". Ferner: `night-8` ist eine Spec-Kennung, kein Modusname — „Erzeugungsmodus (`--erzeuge`, Spec `night-8`)".

### Was RAUS kann

- A7 trägt ohne Fund 6 nichts: „zwei Lieferungen" ist eine Prozessaussage, keine Architekturentscheidung. Wird Weg (a) aus Fund 6 gewählt, entfallen A6 und A7 zusammen; wird (b) gewählt, bleibt A6 und A7 wird ein Halbsatz darin.
- Die Luecken-Zeilen „`kit/board.mjs` wird von keiner gueltigen Aussage beruehrt" sind Kommandoausgabe und korrekt; sie bleiben.

### Bestätigt (kein Fund)

`reviewZustand`, `GRENZE_RUNDEN` (exportiert, `kit/board.mjs` 2516/2561), `ZUSTAND_ZU_LABEL` (3511), `label-sync` und `roles` als `issue-review`-Unterkommandos (3594 f.); `bodyVorschlagVorhanden` und `VORSCHLAG_KOPF` in `kit/night.mjs` (2270/2294); night.mjs importiert `reviewZustand`/`GRENZE_RUNDEN` als Nachbardatei mit Fallback (238–286) — A1 stimmt. Die vier Ausgänge heißen so (`werteReviewSession`, `zaehler` 2422). `tools/sync-blobs.mjs`, `.claude/kit/night.mjs`, `.claude/skills/issue-review/SKILL.md` existieren; Vorlage und Kopie des Skills sind heute bytegleich. A4 „Schreibbefehl 5" stimmt mit Schritt 6 überein. A5 deckt sich mit Kriterium 1 in #587. Die Streichung der neun Fälle vom 2026-08-12 ist als Entscheidung des Menschen vom 2026-09-10 ausgewiesen — nicht nachgeprüft, wie es die Mitteilungsregel verlangt.

Bestand: gelesen

---

### gpt-astra — Schnitt und Abhaengigkeiten

Der Plan lässt sich zerlegen, aber noch nicht zuverlässig in einzeln abschließbare Pakete. Die größten Lücken liegen im gemeinsamen Prüfvertrag, im interaktiven Ablauf und in der zweiten Lieferung.

**1. BLOCKER · Klasse: `alternativen` — Lieferung 2 hat noch keinen ausführbaren Zuschnitt**

Fundstelle, A6/A7:
> „Schritt 2 nutzt die vorhandene Reviewer-Mechanik mit eigenem Rollennamen `synthese`.“
> „Schritt 2 (A6) kommt danach.“

Unter „Geplante Änderungen“ und „Verifizierung“ fehlt diese Lieferung vollständig. Ein Rollenname klärt weder Prüfauftrag und Eingaben noch Auswahl, Aufrufzeitpunkt, Ergebnisformat und Ausfallverhalten. Im Bestand liefert `roles` die konfigurierte Besetzung einer Dokumentstufe; daraus entsteht noch kein zusätzlicher Synthese-Prüflauf.

Gangbare Wege: Lieferung 2 hier vollständig planen oder in einen eigenen Folgeplan auslagern. Für den beschriebenen ersten Nutzen ist sie keine Voraussetzung.

Formulierungsvorschlag:
> „Dieser Plan umfasst ausschließlich den mechanischen Beleg-Abgleich nach A1–A5. Die zusätzliche Modellprüfung erhält einen eigenen Folgeplan, der auf dem hier festgelegten Eingabe- und Ergebnisformat aufbaut. A6 entfällt aus diesem Plan.“

**2. BLOCKER · Klasse: `alternativen` — Die Auswahl des zu prüfenden Paares ist ungeklärt**

Fundstelle, geplante Änderungen an `board.mjs`:
> „aus dem jüngsten `## Synthese, Runde <n>`-Kommentar“
> „geprüft wird nur die Synthese der laufenden Runde.“

Das Kommando erhält nur eine Issue-ID. Wie erkennt es die laufende Session und den zugehörigen Vorschlag? Laut Bestand beginnt die Rundennummer je Session wieder bei 1; ältere und neue Kommentare können dieselbe Nummer tragen. `night.mjs` grenzt deshalb bereits über den Vorher-/Nachher-Stand ab. Ein falsches Paar kann einen fehlenden Beleg verdecken.

Gangbare Wege: explizite Kommentar-IDs beziehungsweise eine Session-Grenze übergeben oder eine eindeutige zeitliche Zuordnungsregel festlegen. Diesen Vertrag brauchen CLI, Skill und Runner **vor** ihrer getrennten Umsetzung.

Formulierungsvorschlag:
> „Vor der Integration wird die Paarzuordnung festgelegt: Der Aufrufer übergibt die beiden aktuellen Artefakte oder ihre eindeutigen Referenzen. Rundennummern allein identifizieren keine Session. Frühere Vorschläge dürfen keinen Beleg der aktuellen Prüfung liefern. Fehlende Synthese, fehlender Vorschlag und eine gültige Synthese ohne Übernahmen erhalten ausdrücklich definierte Ergebnisse.“

**3. BLOCKER · Klasse: `alternativen` — Vor der interaktiven Zustimmung fehlen dem Kommando seine Eingaben**

Fundstelle, Skill-Änderungen:
> „`synthese-check` als Schreibbefehl 4b, zwischen Synthese-Kommentar und dem zweiten `issue update`“
> „Der Befund wird gezeigt, **bevor** nach der Zustimmung gefragt wird.“

Der Bestand verlangt interaktiv Zustimmung vor dem Schreiben. Das geplante Kommando liest jedoch Board-Kommentare, die zu diesem Zeitpunkt noch nicht vorliegen müssen. Die nächtliche Schreibfolge lässt sich daher nicht unverändert als interaktiver Prüfablauf verwenden.

Gangbare Wege: lokale Entwürfe prüfen oder einen ausdrücklich geregelten Ablauf zum vorzeitigen Speichern der Vorschläge einführen. Die lokale Prüfung ist der kleinere Schnitt.

Formulierungsvorschlag:
> „`synthese-check` unterstützt zusätzlich `--synthese-file` und `--vorschlag-file`. Interaktiv werden beide Entwürfe lokal erstellt und geprüft; anschließend werden Vorschlag und Prüfergebnis zur Zustimmung gezeigt. Änderungen durch eine Teilauswahl erfordern einen erneuten Abgleich. Der Board-Modus verwendet denselben Prüfkern.“

**4. WICHTIG · Klasse: `korrektur` — Der neue Ausgang braucht Vorrang vor bestehenden Erfolgszweigen**

Fundstelle, geplante Änderungen:
> „Bei `ok: false` bleibt der Marker aus, `kit:klaeren` wird gesetzt“
> „zählt ein Dokument mit diesem Ausgang nicht als Endzustand“

Im Bestand entscheidet [`werteReviewSession`](/Users/manfredwolff/ki-projects/claude-workflow-kit/kit/night.mjs:2342) zuerst anhand des Markers auf `ohneBefund`. [`pruefEnde`](/Users/manfredwolff/ki-projects/claude-workflow-kit/kit/night.mjs:3018) wertet `kit:klaeren` ausdrücklich als Endzustand. Ein zusätzlicher Ausgang im Review-Zweig allein erfüllt die Erzeugungsanforderung deshalb nicht. Auch der erneute Runner-Aufruf muss den besonderen Fehlergrund erkennen können.

Formulierungsvorschlag:
> „Review-Auswertung und Erzeugungs-Endprüfung verwenden denselben Beleg-Abgleich. Für die aktuelle Prüfung hat ein negatives Ergebnis Vorrang vor Marker, `kit:klaeren` und erreichtem Rundenlimit: Es beendet die automatische Bearbeitung dieses Dokuments ohne Endzustand und hält das Routing-Label. Diese Entscheidung wird bei erneutem Aufruf aus den Prüfartefakten reproduziert.“

**5. WICHTIG · Klasse: `gate` — Falscher Quellpfad und unvollständiger Synchronisationsweg**

Regel: **P10 aus `CLAUDE-Plan.md` — Jede Behauptung über den Bestand stimmt.**

Fundstelle, betroffene Bereiche:
> „`templates/.claude/skills/issue-review/SKILL.md`“

Dieser Pfad existiert nicht. Die Quelle ist [`skills/issue-review/SKILL.md`](/Users/manfredwolff/ki-projects/claude-workflow-kit/skills/issue-review/SKILL.md). `sync-blobs.mjs` verarbeitet sie für `install.mjs`, aktualisiert als lokale Dogfooding-Kopien aber nur die aufgeführten Kit-Skripte. Die abschließende Zusage zur Byte-Identität über dieses Werkzeug deckt die Skill-Kopie nicht ab.

Formulierungsvorschlag:
> „Skill-Quelle: `skills/issue-review/SKILL.md`; lokale Kopie: `.claude/skills/issue-review/SKILL.md`. `tools/sync-blobs.mjs` aktualisiert die Installer-Blobs in `install.mjs` und die Kit-Kopien. Die Skill-Kopie wird zusätzlich übernommen und per Byte-Vergleich geprüft. `install.mjs` gehört als generiertes Ergebnis zu den betroffenen Dateien.“

**6. WICHTIG · Klasse: `korrektur` — Die Verifizierung braucht reproduzierbare Eingaben und getrennte Ablaufnachweise**

Fundstelle, Verifizierung:
> „gegen die echten Synthese/Vorschlag-Paare aus dem Board-Bestand […] `ok: true`“
> „Eine echte Synthese ohne Beleg-Syntax ergibt `beleg-fehlt`“
> „Nachtpfad […] nachgewiesen im Testlauf, nicht behauptet.“

Die ersten Aussagen sind nur vereinbar, wenn die erfolgreichen Bestandsbeispiele bereits Belege tragen oder deren Ergänzung ausdrücklich Teil der Testvorbereitung ist. Das bleibt offen. Veränderliche Board-Karten sind außerdem keine stabilen Testeingaben. Ob die genannten Karten passende Belege enthalten, konnte ich nicht prüfen: Der Board-Zugriff scheiterte.

Der Nacht-Nachweis unterscheidet die beiden vorhandenen Runner-Pfade nicht; für den interaktiven Ablauf fehlt ein Nachweis vollständig. Das ist eine Lücke der Abdeckung, **kein P9-Verstoß**: Konkrete Prüfungen sind durchaus beschrieben.

Formulierungsvorschlag:
> „Die ausgewählten Board-Paare werden mit Herkunft und Abrufstand als lokale Fixtures gesichert. Originale ohne Beleg ergeben `beleg-fehlt`; ergänzte Belege werden als Testaufbereitung kenntlich gemacht. Aus einem gültigen Paar wird eine ausschließlich dort vorkommende Belegstelle entfernt; erwartet wird genau ein `zitat-nicht-gefunden`. Separate Ablaufprüfungen decken interaktive Prüfung vor Zustimmung, Review-Modus und Erzeugungsmodus ab, einschließlich Marker, `kit:klaeren`, Rundengrenze und erneutem Runner-Aufruf.“

Ein tragfähiger Paketschnitt wäre: **Prüfvertrag und CLI → Skill-Integration → Runner-Integration**. Die Runner-Integration setzt für neue Prüfungen die eingeführte Beleg-Syntax voraus; diese Abhängigkeit muss ausdrücklich stehen. Tests, Spec-Wirkung und Auslieferung gehören jeweils zum betreffenden Paket.

**RAUS:** Die Modellprüfung aus Lieferung 1 auslagern. Historische Begründungen lassen sich kürzen und referenzieren; sie müssen nicht in jedes Arbeitspaket wandern. Unter „Offene Fragen“ steht derzeit nichts Überflüssiges. Es fehlen vielmehr die zuschnittsrelevanten Entscheidungen aus Fund 1–3; deren Fehlen ist nach dem Register ausdrücklich kein P7-Verstoß.

Bestand: gelesen
