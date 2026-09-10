# skills

- skills-1 — Im Release-Weg — `push main` und `merge production` — geht jedem Commit (Spec-Fortschreibung, Versions-Bump, Changelog-Amend) ein eigener `checks.mjs run` ohne `--since` voraus; ein roter Lauf haelt Commit und Push auf.
- skills-2 — `/techplan` erkennt den unbeaufsichtigten Lauf an gesetztem `KIT_AGENT_MODEL` und fragt dann an keiner Stelle nach; an jeder Stelle mit Rueckfrage steht die unbeaufsichtigte Variante vor der interaktiven, und es entsteht immer ein Plan-Dokument.
- skills-3 — `/techplan` nennt die Zweistufigkeit der Vorhaben-Notiz, behandelt eine fehlgeschlagene Ablage nicht als gescheitertes Planen und meldet sie unbeaufsichtigt als Kommentar am Plandokument.
- skills-4 — `/push-main` zeigt in Schritt 3 Spec-Fortschreibung und wartende Vorhaben-Notizen in einer Vorschau, hebt die Notizen im selben Commit nach `specs/vorhaben/` auf und haelt bei ihrem Fehlschlag nicht an.
- skills-5 — `/push-main` und `/merge-production` behandeln eine Trigger-Phrase, die innerhalb einer Mitteilung des Menschen zitiert wird, als Text und nicht als Ausloeser.
- skills-9 — `/issue-review` schreibt Befunde, Synthese, Body-Vorschlag und den geschaerften Body ueber eine stueckweise per Shell erzeugte Datei ausserhalb des Projektverzeichnisses und uebertraegt sie mit `--text-file` bzw. `--body-file` in einem Aufruf; jedes Stueck ist ein eigener Werkzeugaufruf mit woertlichem Pfad, und wenn schon der Befunde-Kommentar nicht ankommt, bleibt die Ausfall-Form die einzige Mutation.
- skills-10 — Auch ausserhalb von `/issue-review` geht jeder Skill-Befehl, der einen Body oder einen Kommentar ans Board schreibt, ueber eine stueckweise per Shell erzeugte Datei ausserhalb des Projektverzeichnisses und uebertraegt sie mit `--text-file` bzw. `--body-file` in einem Aufruf; jedes Stueck ist ein eigener Werkzeugaufruf mit woertlichem Pfad, eine unvollstaendige Datei wird nie uebertragen, und der Adapter-Hinweis nennt denselben Weg.

## Entfallen
