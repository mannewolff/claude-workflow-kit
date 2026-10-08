# Ideen aus dem Marktvergleich Kit 4.0.0

Stand: 08.10.2026. Grundlage: `future/marktvergleich-kit-4.0.md`.

Die Spalte **Quelle** nennt die Kennung aus dem Marktvergleich, „neu“ heißt: nicht aus dem Dokument. **Weg** sagt, ob die Idee als `/task` oder über `/fachplan` realisiert werden soll. Was Gates, Rechte oder den Prozess ändert (Stopp-Klasse 5), geht über einen Fachplan.

Am Board liegt jede Idee als `[Idee] Task: …` oder `[Idee] Fachlich: …` mit dem Label der Priorität (`PRIO I`, `PRIO II`, `PRIO III`, `Nice-To-Have`). Die Karten tragen fortlaufend die Nummern 1291 bis 1335: Nr. 1 ist Karte 1291, Nr. 45 ist Karte 1335.

## PRIO I: Grundversprechen, Messung, sofort machbar

| Nr. | Idee | Nutzen | Quelle | Weg |
|---|---|---|---|---|
| 1 | Sidebar und Beschreibung der Doku-Seite korrigieren | kein toter Anker, keine falsche Skillzahl | H-1 | Task |
| 2 | Doku-Test für Skillzahl und Sidebar-Anker auf die Doku-Seite ausdehnen | die Fehlerklasse aus Nr. 1 kommt nicht wieder | H-2 | Task |
| 3 | Modell-IDs der Vorlage vereinheitlichen, Test gegen `preise.mjs` | keine veralteten Modelle in neuen Projekten | H-4 | Task |
| 4 | Konzeptdokumente einsortieren, historische Texte mit Datum und Version markieren | Wurzelverzeichnis aufgeräumt, nichts Veraltetes wirkt aktuell | H-5 | Task |
| 5 | Aufwandsbericht über die letzten N Läufe je Stufe und Aufgabenstufe | klärt, wohin die 20 Minuten je Paket gehen; Nr. 13, 18, 28, 29, 30 hängen daran | P-1 | Task |
| 6 | Reviewer-Rollen als Agentendateien unter `.claude/agents/`, nur lesend | „Reviewer ändert nichts“ wird Grenze statt Bitte, weniger Kontext | P-5, L-1 | Fachlich |
| 7 | Wiederholungsbremse: dreimal rot mit demselben Merkmal beendet das Paket | spart bis zu 60 Minuten je festgefahrenem Paket | P-7 | Fachlich |
| 12 | Installer schlägt `pushPruefung: buildDienst` und Branch Protection vor (am 08.10. von PRIO II hochgestuft) | serverseitiges Gate wird Normalfall; einziger Schutz gegen `git push` an `/push-main` vorbei | F-3.1/2 | Fachlich |
| 9 | Wackelnde Prüfungen erkennen und in der Wirksamkeit zählen | so etwas wie der Windows-Timing-Test fällt beim ersten Mal auf | neu | Fachlich |

## PRIO II: Härte, Durchsatz, Kosten

| Nr. | Idee | Nutzen | Quelle | Weg |
|---|---|---|---|---|
| 11 | Werkzeuggrenzen je Kettenstufe (Positivliste plus PreToolUse-Hook für Kit- und geschützte Dateien) | B3 gilt auch für Nacht-Sessions | F-1 | Fachlich |
| 13 | Parallele Umsetzung unabhängiger Pakete mit gemeinsamer Prüfwarteschlange | größter Hebel für den Durchsatz; erst nach Nr. 5, Q-4, Q-6 | P-2, L-4 | Fachlich |
| 14 | Abnahmetests aus dem Fachplan als Holdout, geschrieben von einem fremden Modell | Verhalten gegen die Anforderung statt gegen die eigenen Tests; Q-7 zuerst | F-4, L-3 | Fachlich |
| 15 | Kontextdiät: Regeltext in Kern und Kapitel je Bahn | weniger Token, Regeln gehen nicht im Rauschen unter | P-4, L-5, R-5 | Fachlich |
| 16 | Größenbudget für Kern und Skills als Pflicht-Check | Regelgewicht kippt nicht ein drittes Mal; nach Nr. 15 | neu, R-5 | Task |
| 17 | Eindeutige Regelkennungen mit Test | Voraussetzung für Nr. 15 ohne Regelverlust | P-4.1/5 | Task |
| 18 | Prüfprofile je Projekttyp im Installer | weniger Werkzeugzeit in den Zielprojekten | P-3 | Fachlich |
| 19 | Langsamste Testdateien in den Nachtbericht bei überschrittener Zielmarke | Ursache steht morgens gleich dabei | P-3.2 | Task |
| 20 | Kosten je Karte in Nachtläufen | Kosten je Paket statt nur je Vorhaben | F-6.1, L-8 | Fachlich |
| 21 | Kostenbudget je Paket zusätzlich zum Budget je Lauf | ein Paket kann nicht die Nacht aufbrauchen | neu, R-2 | Fachlich |
| 22 | Qualitätskennzahlen im Leitstand | aus der Messung wird eine Sicht | F-5 | Fachlich |
| 23 | Upgrade-Befehl | Projekte bleiben ohne Handarbeit aktuell | F-9.1, L-6 | Fachlich |
| 24 | Versionsregel schriftlich festhalten | Release-Takt wird vorhersagbar | F-9.2 | Task |
| 25 | Gate-Feuerprobe: Selbsttest, dass die Leitplanken bei einem Verstoß anschlagen | B3 belegt statt behauptet | neu, B3 | Fachlich |
| 26 | Eigene Bahn für Fehler: Reproduktionstest zuerst, dann Korrektur | schlanker Weg für Fehler | neu | Fachlich |
| 27 | Native Bausteine von Claude Code einordnen, Inventur ersetzbaren Kit-Codes | eigener Aufwand nur für das, was nur das Kit kann | F-14, R-1 | Fachlich |

## PRIO III: wirkt erst, wenn die Basis steht

| Nr. | Idee | Nutzen | Quelle | Weg |
|---|---|---|---|---|
| 28 | Prompt-Cache gezielt ausnutzen | weniger Kosten je Session; nach Nr. 5 | P-6 | Fachlich |
| 29 | Modell- und Effort-Routing auswerten | Empfehlung mit Beleg; nach Nr. 5 | P-8 | Task |
| 30 | Nachtkapazität vorhersagen | weniger Zeitabbrüche; nach Nr. 5 | neu | Fachlich |
| 31 | Isolierte Nachtumgebung (Container-Profil) | Fehlgriff trifft den Container, nicht den Rechner | F-2 | Fachlich |
| 32 | Benachrichtigungen bei Halt und Störung, Morgenübersicht | Halt wird bemerkt, ohne nachzusehen | F-7 | Fachlich |
| 33 | Interaktive Sitzungen in Worktrees erfassen | schließt Befund Issue #1008 | F-6.2 | Fachlich |
| 34 | OpenTelemetry-Eingang im Leitstand | Leitstand zeigt auch fremde Läufer; hängt an Q-2 | F-6.3, R-4 | Fachlich |
| 35 | Codex als Implementierer der Stufe leicht belegen | Anbieterunabhängigkeit mit Beleg | F-10.3 | Task |
| 36 | Installer schreibt eine `AGENTS.md` | Anschluss an den Standard | F-10.1 | Task |
| 37 | Korrekturkarte bei roter CI nach `push main` | schließt den Kreis nach dem Push | neu | Fachlich |
| 38 | Sonar-Gate für agentische KI als Vorlage | härtestes Gate am Markt, fertig zum Einschalten | F-3.4 | Task |
| 39 | Wirksamkeit öffentlich belegen | Zahlen, die der Konkurrenz fehlen; nach Nr. 22 | F-12, L-10 | Fachlich |
| 10 | `--yolo` aus dem Nacht-Runner entfernen (am 08.10. umentschieden: statt „sichtbar machen“, PRIO I → PRIO III; der Schalter wurde nie genutzt) | eine Leitplanke wird hart statt weich | F-1 | Task |

## Nice-To-Have

| Nr. | Idee | Quelle | Weg |
|---|---|---|---|
| 8 | Nachweis je Commit als Trailer (am 08.10. von PRIO I herabgestuft: `/push-main` prüft den Inhalt des ganzen Batches schon vor dem Push; offen bleiben nur einzeln ungeprüfte Zwischenstände in der Historie) | F-3.3, L-2 | Fachlich |
| 40 | Kleinere Lücken im Leitstand schließen | F-13 | Task |
| 41 | Zugang für Dritte (englischer Quickstart, Beispielprojekt); hängt an Q-1 | F-11 | Fachlich |
| 42 | Fortgeschriebene Verhaltensbeschreibung im Repository; hängt an Q-3 | F-8 | Fachlich |
| 43 | Skills an das offene Agent-Skills-Format angleichen | F-10.2 | Fachlich |
| 44 | Stabile Release-Linie | F-9.3 | Fachlich |
| 45 | Doppelte Umsetzung mit zwei Modellen | neu | Fachlich |

## Abweichungen vom Marktvergleich

- **Nr. 14 (Abnahmetests) höher als im Dokument** (dort Welle 3): Sie schließen die einzige hohe Lücke, die das Verhalten selbst betrifft. Den Fachplan früh beginnen, weil Q-7 Zeit braucht.
- **Nr. 13 (Parallelität) PRIO II mit Sperre:** größter Gewinn, aber abhängig von Nr. 5, Q-4 und Q-6.
- **H-3 (Doku live bringen) fehlt:** Das ist ein Menschenschritt (`merge production` oder Deploy auslösen), keine Idee.
