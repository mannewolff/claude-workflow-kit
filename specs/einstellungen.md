# einstellungen

- einstellungen-1 — `einstellungen.mjs` prüft eine Konfiguration gegen das eingebettete Schema und die Regeln über mehrere Felder (Rollenzahl je Stufe, Namen in `pairs`, kein Autor prüft sich selbst, `areas` in `checkAreas`) am gemischten Wert aus Team- und persönlicher Datei; ein unbekanntes Feld ist eine Warnung mit Pfad, kein Fehler, und ein bereits gespeicherter ungültiger Wert trägt denselben Grund wie eine Änderung auf ihn.
- einstellungen-2 — Der Schreiber von `einstellungen.mjs` lässt eine unveränderte Datei bytegleich, ersetzt bei einem einfachen Wert nur dessen Wertebereich, bei einer Liste oder einem Objekt den ganzen Wertebereich mit erkannter Einrückung, und erhält unbekannte Felder.
- einstellungen-3 — `einstellungen.mjs` zeigt je Einstellung Teamwert, persönliche Abweichung und geltenden Wert, speichert persönlich nur Felder der Allowlist und lässt nach dem Entfernen einer persönlichen Abweichung wieder den Teamwert gelten.
- einstellungen-4 — Der Server von `einstellungen.mjs` lauscht nur auf 127.0.0.1, erzeugt beim Start ein Zufallstoken und weist jede API-Anfrage ohne dieses Token, mit fremdem `Host` oder mit fremdem `Origin` ab; er sendet keine CORS-Header und führt nichts aus.
- einstellungen-5 — `einstellungen.mjs` findet als Projekte den Startordner und seine direkten Unterverzeichnisse mit `.claude/workflow.config.json`, liest den Kit-Stand aus dem Projekt oder aus `~/.claude/kit` und lässt ein Projekt nur bearbeiten, wenn dessen Stand nicht neuer ist als der eigene.
- einstellungen-6 — `einstellungen.mjs` speichert nicht, wenn sich eine Datei seit dem Laden geändert hat, wenn der Wert ungültig ist oder wenn die Änderung die wirksamen Pflichtprüfungen leert oder die Review-Pflicht vor Ready abschaltet und keine Bestätigung mitkommt; eine nicht lesbare Datei macht das Projekt nicht bearbeitbar.
- einstellungen-7 — Die Seite von `einstellungen.mjs` lädt nichts von fremden Servern: Schriften liegen eingebettet vor, die Antwort trägt eine Content-Security-Policy ohne fremde Hosts, und das Token kommt aus dem URL-Fragment.

## Entfallen
