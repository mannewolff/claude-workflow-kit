# aufwand

- aufwand-1 — `aufwand.mjs auswerten` liest die jüngsten Ergebnisstände aus `.claude/`, höchstens so viele wie `aufwand.laeufe` nennt (Vorgabe zehn), aggregiert Zeit, Prüfungen, Umfang und Kosten über alle Einheiten, schreibt `.claude/aufwand.md` und `.claude/aufwand.json` und gibt immer JSON auf stdout aus — auch im Leerfall und auch bei einem abgewiesenen Aufruf; jede Kennzahl trägt die Zahl der Läufe, die sie getragen haben, ein fehlender Messwert bleibt `null` und erscheint als „nicht gemessen", und ein Lauf ohne Messwerte geht mit dem ein, was er trägt, und steht in der Liste der unvollständigen Läufe.
- aufwand-2 — `aufwand.mjs befund` liest `.claude/aufwand.json` und schreibt den Befundblock als Text nach stdout, dem als erste Zeile der Zeitpunkt der Auswertung und der Stempel des jüngsten einbezogenen Laufs vorangehen; liegt kein Befund vor, fehlt die Datei oder ist sie unlesbar, bleibt die Ausgabe leer, und der Exit-Code ist in jedem Fall 0.

## Entfallen
