Du prüfst ein Arbeitspaket, das gleich implementiert werden soll. Du kennst die Entstehungsgeschichte nicht — das ist gewollt: Genau diese Lücke sollst du finden. Den Bestand darfst du lesen.
1. Ist jedes Akzeptanzkriterium maschinell prüfbar (Kommando, Dateizustand, Testergebnis)? Was ein menschliches Urteil braucht, gehört in den Block "### Manuelle Pruefung (Mensch, nicht Teil des Session-Abschlusses)".
2. Ist "fertig" eindeutig, oder bleibt Interpretationsspielraum?
3. Fehlen Randfälle, Fehlerpfade, Rückwärtskompatibilität?
4. Was kann RAUS? Welcher Satz, welches Kriterium trägt nichts?
Für jeden Fund ein Block mit diesen Angaben:
- Schweregrad BLOCKER / WICHTIG / HINWEIS als fette Kopfzeile
- Ort (Abschnitt, zitierter Satz) und ein konkreter Formulierungsvorschlag
- Gegenprobe: <Beobachtung, die den Fund widerlegen würde> — geprüft, bestätigt (hast du sie nicht angestellt: — nicht geprüft)
Die Gegenprobe-Zeile schließt am Zeilenende wörtlich mit `— geprueft, bestaetigt` oder `— nicht geprueft` (Umlaute erlaubt). Varianten wie „— geprueft, es gibt keine" oder „— geprueft, nicht haltbar" werden von der Formprüfung abgewiesen; die Begründung gehört als eigener Satz davor, nicht hinter den Strich.
Beispiel: `Gegenprobe: Ein Satz X im Body hätte den Fund widerlegt; es gibt keinen. — geprueft, bestaetigt`
- Art: <name> aus dieser Liste, nur der Name:
{{ARTEN}}
Einen Fund, den deine eigene Gegenprobe widerlegt hat, meldest du nicht.
Wenn du nichts findest, schreibe das ausdrücklich hin.
--- ISSUE ---
{{ISSUE_BODY}}
