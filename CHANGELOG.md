# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Automatisch aus der Git-Historie generiert (`tools/changelog.mjs`) — nicht von Hand pflegen. Die Einträge sind die Commit-Betreffzeilen. Folgen mehrere Versions-Bumps unmittelbar aufeinander, stehen die Änderungen unter der höchsten davon — der Version, mit der sie veröffentlicht wurden; die internen Zwischenstände dazwischen erscheinen nicht. Was seit dem letzten Versions-Commit dazugekommen ist, steht unter `[Unreleased]`.

## [3.3.3] - 2026-09-26
- Die Verflechtung unterscheidet Geruest von Kopplung (#943)
- Die Invariante deckt wieder nur kit/ und tools/ (#937)
- Die Doku nennt neun Teile und kein kit/** mehr (#937)
- Die Bereiche werden Quell-Einheiten, die Invariante deckt alles (#936)
- Die Dateien ohne Zuordnung bekommen eine (#935)
- Die pruefungsfreie Zuordnung ohnePruefung (#934)
- Die Nacht-Sessions laufen im auto mode (#940)
- Kein Bereich beansprucht mehr das ganze Werkzeugverzeichnis (#933)
- Die Verflechtung von Test und Quelle wird erhoben (#931)
- push main und merge production laufen im eigenen Worktree (#929)
- Der Umsetzungspfad liest den Kartenzustand an der Karte (#927)
- Beantwortete PO-Fragen brauchen die Keine-Zeile (#921)

## [3.3.2] - 2026-09-25
- Die Befunde aus dem Code-Review des Batches sind eingearbeitet
- Beide Berichte weisen Prueflaeufe und Zielmarke aus (#926)
- Die Umsetzungs-Skills nennen den sanktionierten Gruppenlauf (#925)
- Der Runner zaehlt die Prueflaeufe einer Umsetzung (#924)
- Die Zielmarke fuer eine Umsetzung steht in der Konfiguration (#923)
- Die Pruefung sammelt alle Dateien ohne Zuordnung und kennt den Bereichslauf (#922)
- Eine Kette ohne ausgefuehrte Umsetzung heisst nicht gelungen (#862)

## [3.3.1] - 2026-09-25
- Die Kette nimmt keine Anforderung mit offenen Fragen auf (#916)
- Der Reviewer-Prompt nennt die Form der Gegenprobe (#915)
- Der Prueflauf bekommt sein Kapitel in Prozesstext und Dokumentation (#910)
- Der Prueflauf laeuft: node .claude/kit/night.mjs --pruefen (#909)
- Jeder Lauf raeumt nur Worktrees seines eigenen Praefixes ab (#908)
- Der Prueflauf erkennt sein Ergebnis am Unterschied der Board-Spuren (#907)
- Der Prueflauf waehlt seine Kandidaten (#906)
- Der Prueflauf bekommt den Einstellungsblock pruefLauf (#905)
- Das Bash-Limit der Nacht-Session bleibt unter dem Rundenzeitlimit (#902)
- Ein Akzeptanzkriterium verlangt keinen Mutationslauf (#901)
- Das Aufraeumen des Wegwerf-Repos kippt den Windows-Lauf nicht mehr (#892)
- Der CI-Guard laeuft nur noch am Tor main (#891)
- Die letzten zwei Sonar-Befunde verschwinden (#879)
- checks-8 raeumt unter Windows den Prozessbaum ab (#874)
- Prozessdoku und Skills nennen den Plan als zweite Auftragsart (#898)
- Die Leitstandsmeldung laesst die uebernommene Plan-Stufe aus (#897)
- Halt und Bericht der Kette gehen an die gekennzeichnete Karte (#896)
- Die Nacht-Kette nimmt einen gekennzeichneten Plan als Auftrag an (#895)
- Der Runner erkennt einen startbereiten Plan an zwei reinen Proben (#893)
- Die Doku nennt alle Faelle eines Laufs ohne Arbeit (#888)
- Die Umsetzungsnacht nennt ihren Fall statt zu schweigen (#887)
- Der Umsetzungs-Lock unterscheidet belegt von Schreibfehler (#886)
- Der Lauf bildet seine Gruende ohne Arbeit an einer Stelle (#885)
- Der Runner meldet seinen harten Stopp mit Grund (#881)

## [3.3.0] - 2026-09-24
- Die Kette laeuft neben einer unsauberen Hauptkopie (#878)
- ..

## [3.2.1] - 2026-09-24
- Die Regexe ohne Backtracking-Risiko (#877)
- Sonar-Stilpflege in night, board, befunde, aufwand und wirksamkeit (#876)
- Sonar-Stilpflege in kit/einstellungen.mjs (#875)

## [3.2.0] - 2026-09-23
- Der Windows-Job der CI wird wieder gruen (#873)
- Die drei String-Sortierungen tragen eine Vergleichsfunktion (#872)
- Salvage-Session faehrt auch bei --verbose no ueber den Strom (#871)

## [3.1.2] - 2026-09-23
- Live-Verlaufsprotokoll des Nacht-Runners ist der Normalfall (#867)
- ..
- ..
- Kleine Änderungen an der Konfiguration
- Kleine Änderungen an der Konfiguration
- claude 5.5 eingefügt

## [3.1.1] - 2026-09-22
- Pruefnachweis gilt nur zum Commit des Pakets (#865)
- Bytegleichheits-Test gegen .claude/CLAUDE-workflow.md entfaellt (#864)
- checks.mjs uebernimmt sein Ergebnis auf unveraendertem Stand (#863)
- Aufstellung docs/regeln-im-werkzeug.md: welche Regel von /local-check wohin wanderte (#861)
- Bedien-Regeln verlassen den Text von /local-check (#860)
- Salvage-Vorpruefung kennt die Fehlermerkmale wie checks.mjs (#859)
- checks.mjs prueft die Ausgabe selbst auf Fehlermerkmale (#858)
- checks.mjs: Die Pruef-Zusammenfassung begleitet den Lauf (#857)
- Massstab 'Regel im Text oder Regel im Werkzeug' in der Prozessvorlage (#856)
- Konfiguration, Aufwand für die Implementierung im Nachtbetrieb eingestellt

## [3.1.0] - 2026-09-22
- Blob von checks.mjs in install.mjs nachgezogen (#850)
- Eingrenzung im Kit: sechs Teile, drei Testaufrufe und ein Schutztest (#850)
- Die Push-Stufe faehrt wie die Merge-Stufe den vollen Umfang (#849)
- Aufwandsbericht je Aufgabenstufe und Gruendlichkeit (#848)
- Aufgabenstufen als Auswahl je Stufe statt JSON-Text (#847)
- Gruendlichkeit der Stufe als --effort an die Session (#846)
- Gruendlichkeit je Aufgabenstufe als Feld effort (#845)
- Die fuenf langsamsten Testdateien thematisch geteilt (#836)
- Kurzes Wiederholbudget fuer Prozess-Tests per KIT_TOOLBOX_BUDGET_MS (#842)
- Volle Testsuite nur einmal ueber checks.mjs run (#835)

## [3.0.1] - 2026-09-22
- Wiederholung, Idempotenz-Schluessel und drei Rueckmeldungen in board.mjs (#834)
- Installer erkennt das eigene Commit-Gate auch bei absolutem core.hooksPath (#833)
- befunde auswerten: Code-Zahlen auch je Art (#806)
- befunde auswerten und befund: Bericht, Lauf-Abschluss und dritter Block in /push-main (#806)
- Buchung verdrahten: /issue-review Schritt 6 und /push-main vor dem Commit (#805)
- befunde vorschlag: Idee am Board, Vorschlagsstand und Ablehnung (#804)
- Nacht-Kette: befundeZurueck als Rueckweg aus dem Worktree (#803)
- befunde buchen: Protokoll .claude/befunde.tsv und Vergleichsstand der Code-Stufe (#802)
- Fundblock in den Prompts von /issue-review und /review (#801)
- Einstellungen: optionaler Block befunde mit der Schwelle (#800)

## [3.0.0] - 2026-09-22
- Worktree-Spiegel ohne Pfadvergleich, damit er unter Windows filtert (#832)

## [2.0.7] - 2026-09-22
- SDD-Rueckbau 5: Doku und specs/ entfernen (#831)
- SDD-Rueckbau 3: Nacht-Runner ohne Vorhaben-Notizen, SYNC-Kommentare (#829)
- SDD-Rueckbau 4: Einstellungs-Oberflaeche und Schema ohne spec-Block (#830)
- SDD-Rueckbau 2: spec.mjs, Gate in board.mjs und Installer entfernen (#828)
- Regeltext und Skills ohne Spec-Driven Development (#827)
- Kleinkram aus dem Review: Spiegel-Filter, Zeitlimit, Schema-Grenzen, Doku-Abgleich (#824)
- Funde in Listen erkennen, leere Gegenprobe melden (#823)
- Ausfuehrungsprotokoll maskieren, Fenster ohne Stack-Grenze und mit Obergrenze (#822)
- Aufwands-Auswertung rechnet nur mit gemessenen Werten (#821)
- Zeiten je Einheit: offene Schuebe nicht als 0, Salvage summiert (#820)
- Warte-Erkennung: abgeschlossene Hintergrundarbeit und Go-Test richtig einordnen (#819)
- Salvage-Prompt prueft Sauberkeit mit den Ausnahmen von gitReste() (#818)
- Ungueltige Prozentwerte rot, Salvage wertet die Marke (#817)
- Umbenennen auf belegten Namen abweisen, Reviewer-Pflichtfelder pruefen (#816)
- Pruefstufen-Redaktor: fehlerhafter Bestand, Katalogrollen, Befunde an der Zeile (#815)
- Einstellungs-Oberflaeche haelt Entwuerfe, Vorschau-Timer und Eingabefelder je Teil (#814)
- Nacht-Runner meldet Budgets, Herkunft, Stufen, Modellzeit und Zuege ans Board (#808)

## [2.0.6] - 2026-09-21
- Spec-ID auf night-63 umgestellt, night-52 vergab v2.0.3 (#772)
- Kennzahlen einer Stufe mit Korrekturrunden summieren (#807)
- kit/befunde.mjs mit arten und pruefen, Spec-Bereich befunde, Verteilung durch den Installer (#799)
- Regeltext haelt die Form eines Befunds fest (#798)
- Der Halt-Ablauf bei einer Stopp-Frage gilt ohne Ausnahme (#770)
- Nacht-Sessions starten ohne das Auto-Memory des Menschen (#772)

## [2.0.5] - 2026-09-21
- Spec-IDs auf night-61 und board-19 umgestellt, night-59 und board-17 vergab v2.0.4 (#794)
- Kettenlauf meldet sich nach jeder Stufe (#794)
- docs.mwolff.org wieder baubar machen und v2.0.2/v2.0.3 nachdokumentieren (#792)

## [2.0.4] - 2026-09-21
- Nacht-Runner ruft die Wirksamkeits-Auswertung (#790)
- Config-Block wirksamkeit: Schema, Referenz und einstellungen.mjs (#789)
- Ruecklaeuferquote in kit/wirksamkeit.mjs (#788)
- kit/wirksamkeit.mjs: Auswertung und Befund der Pruefungs-Kennzahlen (#787)
- Bewegungsprotokoll und Verlaufs-Sammelabfrage in board.mjs (#786)
- Ausfuehrungsprotokoll: checks.mjs schreibt je Pruefung eine Zeile (#785)
- Rest-Guard, Worktree-Spiegel und .gitignore kennen die vier neuen Dateien (#784)
- Regeltext: Wirksamkeit der Pruefungen und der zweite Befund in /push-main (#783)

## [2.0.3] - 2026-09-21
- Auswertung zaehlt die wartend beendeten Sitzungen (#779)
- Wartende Sitzung in den Stufen der Nacht-Kette (#778)
- Wartende Sitzung bei unsauberem Arbeitsbaum: beide Salvage-Fehlschlaege tragen den neuen Ausgang (#777)
- Wartende Sitzung bei sauberem Arbeitsbaum: Grund, Vermerk und Feld (#776)
- Bausteine der wartenden Sitzung: Erkennung, Grund und Vermerk (#775)
- Nachtbetrieb-Regel: keine Session endet mit laufender eigener Arbeit (#774)

## [2.0.2] - 2026-09-21
- specs/night.md: die zwei falsch belegten Zeilen night-43 und night-44 entfernt (#766)
- Doppelte Spec-IDs night-43 und night-44 aufgeloest (#766)
- Abgrenzung zu mutationCommand und die Doku der Guetemessung (#765)
- Der Anteil wird sichtbar: Protokollzeile der Nacht und vier Pruefregeln (#764)
- checks.mjs: die Guetemessung auswerten und an der Marke messen (#763)
- Regeltext und Schema: der guete-Block mit Muster und Marke (#762)
- Abschluss Stufe A: Pruefregel fuer stufe und die Dokumentation (#761)
- night.mjs: Salvage-Vorpruefung und Start-Guard an der Paketstufe (#760)
- Die Skills nennen ihre Stufe: push-main, merge-production und die Paketstufe (#759)
- checks.mjs: --stufe, kumulative Rangfolge und die Ankuendigung (#758)
- Regeltext und Schema: die Stufenangabe stufe an buildChecks (#757)
- Auswahl der Modelle auf best möglich gestllt
- Auswahl der Modelle auf best möglich gestllt
- Der Befund wird sichtbar: Abschlussblock im Laufprotokoll und /push-main (#752)
- Der Config-Block aufwand: Schema, Prüfung, Oberfläche und Doku (#751)
- specs/aufwand.md und specs/installer.md: aufwand-1, aufwand-2, installer-11 nachgezogen (#750)
- kit/aufwand.mjs: Auswertung, Schwellen, Befund (#750)
- specs/night.md: night-44 bis night-46 nachgezogen (#749)
- Der Ergebnisstand traegt Zeiten, Cache-Teilung und den vollen Pruefstand (#749)
- specs/night.md: night-43 nachgezogen (#748)
- night.mjs misst die Werkzeugzeit am Session-Strom (#748)
- specs/checks.md: checks-4 nachgezogen (#747)
- checks.mjs misst die Dauer je Prüfkommando (#747)
- Regeltext und Spec-Bereich: der Rahmen fuer die Aufwands-Auswertung (#746)
- Lauf ohne Arbeit meldet seinen Grund am Lauf-Kopf (#744)
- Nachtlauf meldet seinen Beginn vor dem ersten Arbeitspaket (#743)
- Salvage bewegt das Board erst bei sauberem Arbeitsbaum und meldet drei Endzustaende (#672)
- qwen auch aus den Paarungen entfernt

## [2.0.1] - 2026-09-18
- Dokumentation der neuen Einstellungs-Oberflaeche und Abschluss der Spec-Wirkung (#732)
- M7 Einfache Gruppen: ein Feld je Eintrag und persoenliche Abweichung je Zeile (#731)
- M6 Nacht-Kette: Zahlenfelder mit Einheit, blasse Vorgabewerte und die Summe der Zeitbudgets (#730)
- M5 Spezifikation: Einschalten ohne Ausschalter, Testorte als Muster und Beispiel am Verweis-Muster (#729)
- M4 Pruefkommandos und Bereiche: drei Laufarten, Formtreue und Folgen einer Umbenennung (#728)
- M3 Pruefstufen: Zaehler, Rollenauswahl aus dem Katalog und Beispielbesetzung (#727)
- M1 Reviewer und M2 Paarungen samt Folgen als eine Aenderung (#726)
- Oberflaechen-Rahmen: Bausteine, Arbeitskopie je Teil, Fuss und Bedienelemente (#725)
- Stufen in workflow.config nachgezogen
- Vorschau-Endpunkt: Befunde, Aenderungsliste und abgeleitete Anzeigen ohne Schreiben (#724)
- Zuschnitt der Einstellungen in Teile samt Rueckfall auf die Dateischreibweise (#723)
- Pruefteil der Oberflaeche: Warnung, Rollenkatalog, Reviewer-Wahl, Vorgaben (#722)

## [2.0.0] - 2026-09-18
- Doppelte Spec-IDs des Batches auf night-33 bis night-42 aufgeloest (#736)
- Hook-Block und Installer melden die Sitzung von selbst (#735)
- Sitzungs-Melder fuer den interaktiven Verbrauch (#734)
- Wegmarken beim Verschieben einer Karte (#733)
- Nutzerdokumentation: review:fertig als Voraussetzung der Nacht-Kette (#720)
- Nacht-Kette: Kommentar am ungeprueften Fachplan und Hinweis auf fehlendes Kennzeichen (#719)
- Nacht-Kette: Fachplan ohne review:fertig wird uebersprungen (#718)
- Regeltext: review:fertig als Voraussetzung der Nacht-Kette (#717)
- Nutzerdokumentation zu Aufgabenstufen, lokalem Modell und Nacht-Kette (#715)
- Skills schneiden mit Stufe: /issues, /task, /implement-ready und /implement-next (#714)
- Nachtbericht unter Variante B: Stufe und Modell je umgesetztem Paket (#713)
- Vorschau und Vorflug: Stufe und Modell vor dem Lauf sichtbar (#712)
- Stufenweg in laufeRunde: Modellwahl je Paket, frische Einstellung, Felder im Ergebnisstand (#711)
- Session-Start ueber ein Programm der Stufe: Kommando-Zweig in runSession (#710)
- Stufenwahl im Nacht-Runner: Aufgabenstufe, Einstellung, Ausweichen nach oben (#709)
- night.stufen und night.stufenRegel: Schema und Konfigurationsprüfung (#708)
- Gui Entwürfe eingecheckt
- Nutzerdokumentation zu Variante B: beide Koernungen des GO und die fuenfte Stufe (#698)
- Nachtbericht und Ergebnisstand unter Variante B: Variante, Paketlisten, Entscheidungen (#697)
- Der Umsetzungs-Lock: Kette und Umsetzungsnacht bauen nicht gleichzeitig (#696)
- Die Stufe umsetzung: Pakete einzeln ziehen, umsetzen und zurueckstellen (#695)
- Variantenerkennung der Nacht-Kette: varianteVon und die Weiche in der Stufenfolge (#694)

## [1.53.5] - 2026-09-17
- Test zu skills-28: Ausnahme fuer Variante B in acht Skills (#700)

## [1.53.4] - 2026-09-17
- CLAUDE.md: Quelle unter kit/, installierte Kopie unter .claude/ wird nie bearbeitet
- Config-Felder fuer Variante B: varianteBLabel, umsetzungMin, kostenUsdB (#693)
- Bindende Quelle: Ausnahmesatz fuer Variante B in Regeltext und acht Skills (#692)
- Windows-CI: zwei Tests mit falscher Pfadannahme korrigiert (#689)

## [1.53.3] - 2026-09-17
- Nacht-Runner: Board-Ausgaben ueber 1 MB brechen die Kette nicht mehr ab (#699)
- qwen aus Konfiguration entfernt

## [1.53.2] - 2026-09-16
- /issues liest uebernommene Review-Funde gegen (#687)
- Schlussmeldung eines Vorhabens nennt zuerst Sichtbares und Fehlendes (#686)
- Stopp-Klasse: Abweichung vom fachlichen Anlass als Punkt 6 (#685)
- Plan-Review liest fachliche Quelle und Vorlage mit (#684)
- Vorlage als Spur durch Fachplan, Plan und Arbeitspakete (#683)
- /retro weist Pakete der Nacht ohne Einwand als fuenfte Kennzahl aus (#680)
- Einstellungs-Oberflaeche als Download ueber docs.mwolff.org (#679)
- Oberflaeche der Einstellungen in den Farben der Kupferwarte (#678)
- Lokaler Server der Einstellungs-Oberflaeche mit Absicherung (#677)
- Kern der Einstellungs-Oberflaeche: Pruefung, Ebenen, minimaler Schreiber (#676)
- Schema bereinigen, Einstellungs-Referenz der Doku daraus erzeugen (#675)
- Runner erfasst den Verbrauch je Einheit und liefert ihn ein (#669)
- Budgets der Kette aus den Defaults im Lauf sichtbar (#659)

## [1.53.1] - 2026-09-16
- Board-Adapter liest den Aktivitaetsverlauf ueber die Kanban-Route (#670)
- Fachartikel über Umbau workflow-kit
- implement-next und implement-ready nennen das empfohlene Modell (#667)
- /issues schreibt das empfohlene Modell in das Arbeitspaket (#666)
- Nacht-Runner startet jede Session mit dem Modell ihrer Karte (#665)
- night.modelle: Liste erlaubter Modellnamen (#664)
- Release-Weg: ein Lauf, ein Commit (#658)
- Wartende Session gilt dem Runner nicht mehr als gescheitert (#668)
- Neues Konzept für workflow-kit 2.0
- Qwen als zusätzlichen Reviewer einbinden
- version.mjs rechnet den Bump ab dem committeten Stand (#656)
- changelog.mjs bekommt die Option --marke mit lokalem Datum (#657)
- checks.mjs run stempelt den Zeitpunkt in die Zusammenfassung (#655)
- Abbruch der Review-Stufe hinterlaesst einen Vermerk am Plandokument (#654)
- Der Ueberholt-Kommentar der Kette wird zurueckgelesen (#653)
- /kontext blendet Vorhaben ohne Arbeitspakete aus (#651)
- Umbenennung: beschriebenes Verhalten wird Spec-Driven Development (#465)
- merge-production prueft den CI-Status vor dem Release-PR (#316)
- Zeiten für Reviews erhöht
- /kontext begrenzt die letzten Entscheidungen auf den juengsten Tag (#649)
- /kontext gibt vom Spec-Index nur noch die Hinweiszeile aus (#648)
- /kontext zeigt nur laufende Vorhaben und keine Arbeitspakete (#647)
- CI gruen: Doku-Test ohne Installer-Kopie, Worktree-Test ohne CRLF-Annahme (#650)

## [1.53.0] - 2026-09-14
- chore: Spec fortgeschrieben; Vorhaben-Notizen gesichert (#639 #640 #641 #642 #643 #644 #645 #646 #620 #618)
- Nacht-Runner stoppt vor der ersten Session bei ungueltiger settings.json (#618)
- Nacht-Runner startet Sessions mit geschlossenem stdin (#620)
- Doku und Prozessdatei: zwei Betriebsarten, Abschnitt Nacht-Kette, Skill-Hinweis auf --kette (#646)
- Nacht-Runner: Nachtbericht am Fachplan, wartende Berichte, Kette nicht gestartet (#645)
- Nacht-Runner: Kette bis zu den Paketen, Abdeckung gegen den Fachplan, ueberholte Plaene (#644)
- Nacht-Runner: Modus --kette bis zum geprueften Plan mit Budgets, Halt und Ergebnisstand (#643)
- Nacht-Runner: cwd-Durchreichung, Worktree-Funktionen, Strom je Session und Config-Block night.kette (#642)
- Board-Adapter: Synthese, label-sync, reviewZustand und Pruefvorgabe entfernen, rounds und statusLabels aus der Config (#641)
- Nacht-Runner: Review- und Erzeugungsmodus entfernen, alte Flags abweisen, Gate auf Marker kuerzen (#640)
- issue-review setzt review:fertig als sichtbare Spur am Board (#639)
- Änderungen der Prüfer
- Kurzanleitung und Startseite auf sechzehn Skills (#606)

## [1.52.3] - 2026-09-14
- chore: Spec fortgeschrieben (#625–#634)
- retro fragt nach den Zahlen: gekippte Nachtentscheidungen, Stopp-Fragen, Anforderung bis GO, GO bis Push (#634)
- CLAUDE-workflow.md halbiert: Pruefstufen, Pruefvorgabe, Zustandslabels und Config-Beispiel raus (#633)
- fachplan auf den Kern: Eingang aus dem Stopp-Klasse-Halt, check-form vor dem Anlegen, kein label-sync (#632)
- issues: Eingang ohne Marker, Entscheidungen im Kontext, check-form je Paket, kein Paket-Review (#631)
- techplan: Entscheidungen statt offener Fragen, Stopp-Klasse, check-form vor dem Anlegen (#630)
- issue-review auf den Kern: eine Runde, Befunde als Zuarbeit, Marker als Spur (#629)
- board.mjs: issue check-form prueft die maschinellen Formgates je Stufe (#628)
- implement-next/-ready: Halt nur fuer die Stopp-Klasse, sonst entscheiden und protokollieren (#627)
- Skill /task auf den Kern: ein Satz zur Bahn, entscheiden statt fragen, kein Review-Schritt (#626)
- Regelwerk: Abschnitt Entscheiden statt fragen mit Stopp-Klasse und Entscheidungsformat (#625)
- Doku: Umsetzungsplan Prozess-Umbau Stufe 1
- Config: Paket-Review kein Gate mehr, Zustandslabels aus, Plan-Review mit einem Reviewer
- Neuer Prozess

## [1.52.2] - 2026-09-11
- chore: Spec fortgeschrieben; Vorhaben-Notizen gesichert (#572, #573, #574)
- Einstieg Bahn 3: Skill /task, Bahn-Auswahl in techplan, Doku (#574)
- Halt bei Abwaegungsbedarf im [Task], Spur nach /fachplan (#573)
- Nacht-Runner: eigener Rundenausgang angehalten (#572)

## [1.52.1] - 2026-09-11
- chore: Spec fortgeschrieben; Vorhaben-Notizen gesichert (#592, #593, #594, #597, #598)
- issue-review: Rolle synthese, drei Ausgaenge, Einhaengung in Schritt 6 (#598)
- board.mjs: Ausschlussliste in pickReviewers, roles --rolle synthese (#597)
- Fixtures: Befundlisten je Karte ergaenzen (#596)
- night.mjs: fuenfter Ausgang syntheseOhneBeleg vor der Marker-Pruefung (#594)
- issue-review: Beleg-Form, Abgleich vor der Zustimmung, Abgleich-Kommentar (#593)
- board.mjs: Kommando issue-review synthese-check (#592)
- board.mjs: Synthese-Parser und Beleg-Abgleich (#591)
- Fixtures: echte Synthese/Vorschlag-Paare aus dem Board sichern (#590)
- Review des Prozesses

## [1.52.0] - 2026-09-10
- chore: Spec fortgeschrieben (561)
- Installer-Probe: abgelegte Vorlagen bytegleich zur Repo-Vorlage (#561)

## [1.51.1] - 2026-09-10
- chore: Spec fortgeschrieben; Vorhaben-Notizen gesichert (557, 558, 560, 583, 584, 585)
- Transport-Test auf alle zwoelf Stellen, Nachweis am Board gefuehrt (#585)
- Die uebrigen sieben Skills und die Adapter-Hinweise auf den Datei-Weg (#584)
- Transportregel im Register, /issue-review auf den Datei-Weg (#583)
- Doku: Abschnitt "Mitteilungen: glauben statt nachsehen" (#563)
- Mitteilungen des Menschen gelten ungeprueft (#560)
- Jeder harte Stopp hinterlegt seinen Grund als Text (#558)
- Ergebnisstand entsteht bei jedem Lauf, nicht nur mit --verbose (#557)

## [1.51.0] - 2026-09-09
- chore: Spec fortgeschrieben (#546, #547, #548)
- Ablageort umstellen: vorhaben schreibt wartend, push-main hebt auf (#548)
- spec.mjs vorhaben-sichern: Aufhebe-Kommando (#547)
- Ausschluesse fuer wartende Vorhaben-Notizen (#546)
- Vorhaben-Notiz plan-545 committen

## [1.50.0] - 2026-09-08
- chore: Spec fortgeschrieben (#518, #521, #522, #523, #526)
- board.mjs: Formpruefung der Spec-Wirkung beim Anlegen und Schreiben (#526)
- docs: die naechtliche Erzeugungskette dokumentieren (#525)
- issues: ein geprueftes Plandokument aus der Vornacht als Eingang (#524)
- techplan: Betriebsart-Schalter fuer den unbeaufsichtigten Lauf (#523)
- night.mjs: Ergebnisstand der Erzeugungsnacht (art erzeugung) (#522)
- night.mjs: Erzeugungsschleife Phase 2 — Pruefrunden und Label-Verbrauch (#521)
- night.mjs: Erzeugungsschleife Phase 1 — Session, Erfolgssignal, Fortsetzen (#520)
- night.mjs: Kandidatenauswahl mit Marker-Eintritt und Stopp-Fragen-Pruefung (#519)
- night.mjs: Geruest des Erzeugungsmodus mit Vorflug und ideaStored-Guard (#518)
- Vorhaben SPECNOTIZ einchecken
- Vorhaben-Notiz plan-510 committen
- night.mjs: Flags --erzeuge und --erzeuge-label (#517)
- reviewZustand: fuenfter Zustand grenze mit Label review:grenze (#516)
- Probelauf-Test plattformehrlich machen (#527)

## [1.49.0] - 2026-09-08
- Drei ungedeckte Fehlerpfade testen (#515)
- Fehler ist der Reviewzuordnung codex behoben
- GPT Astra eingefügt
- GPT Astra eingefügt

## [1.48.0] - 2026-09-07
- chore: Spec fortgeschrieben (#497, #498, #499)
- Spec von Nachtbahn 3 committet, weil umgesetzt
- Planungs-Skill heisst techplan, alter Name bleibt Wegweiser (#514)
- Duplications: SYNC-Marker nachziehen, CPD-Ausschluss je Paar (#507)
- Coverage-Abschluss: Restliste zusammenfuehren, Sonar-Kommentar nachziehen (#506)
- Coverage tools/: acht offene Zweige in vier Scripts schliessen (#505)
- Coverage kit/checks.mjs: 16 Zeilen und 17 Bedingungen schliessen (#504)
- Coverage install.mjs: neun Zeilen und neun Bedingungen schliessen (#503)
- Coverage kit/board.mjs: sechs erreichbare Zweige schliessen (#502)
- Coverage kit/night.mjs: alle erreichbaren Klasse-1-Zweige schliessen (#501)
- Coverage kit/spec.mjs: 27 Zeilen und 38 Bedingungen schliessen (#500)
- A9: Dateisystem-Fallback im Installer entfernen, Abbruch bleibt (#499)
- A7-Hook in kit/night.mjs: Nachbarpfad injizierbar, Stubs testbar (#498)
- A7-Hooks in install.mjs: Blob-Stoerung und TTY-Entscheidung injizierbar (#497)
- S8786 und S7747: vier Regexe entschaerft, REVIEW_MARKER_ZEILE revidiert (#496)
- S4036: Regelausschluss fuer den Kommandoaufruf ueber den PATH (#494)
- S2871 und S6959: benannte Vergleichsfunktion, reduce mit Startwert (#493)
- Neue installationsversion

## [1.47.0] - 2026-09-07
- chore: Spec fortgeschrieben (#480, #481, #486, #488, #489)
- Doku: der Nachtbetrieb-Abschnitt nennt den Ergebnisstand (#490)
- Nacht-Runner: der Review-Lauf schreibt denselben Ergebnisstand (#489)
- Nacht-Runner: der Ergebnisstand fuehrt Einheiten, Pruefstand und den abgeschlossenen harten Stopp (#488)
- Nacht-Runner: leseKennzahlen holt Kosten, API-Dauer und Zuege aus dem result-Ereignis (#487)
- Nacht-Runner: Ergebnisstand als JSON, und gitClean laesst ihn durch (#486)
- Doku: der Installer-Abschnitt zieht beide geaenderten Fragen nach (#482)
- Installer: die Spec-Frage nennt Spec-Driven Development beim Namen (#481)
- Installer: die Reviewer-Frage fuehrt aus dem Widerspruch heraus (#480)
- neue Specs
- skills-releaseweg: nur die Quelle pruefen, nicht die gitignorierte Kopie (#472)

## [1.46.0] - 2026-09-04
- chore: Spec fortgeschrieben (469, 470, 471, 472, 473, 474, 464)
- Register und Doku: Bahn 1 und Handcommits brauchen einen gruenen Lauf (#474)
- Auslieferung: Hook und Gate im Installer, core.hooksPath mit Vorpruefung (#473)
- Release-Weg: jeder Commit faehrt seinen eigenen Prueflauf (#472)
- night.mjs: fehlender und roter Pruefnachweis machen die Runde zum Fehlschlag (#471)
- Das Commit-Gate: .githooks/gate.mjs und pre-commit (#470)
- checks.mjs: Blob-Hashes der geprueften Dateien in die Zusammenfassung (#469)
- Spec-Wirkung-Leitplanke laesst Dokument-Praefixe durch (#464)
- Specs Verzeichnis angelegt

## [1.45.0] - 2026-09-02
- Doku: Beschriebenes Verhalten in dokumentation.md und README (#454)
- Ausbaustufe 5: Das Kit schaltet sich selbst ein (#453)
- spec.mjs: github und gitlab tragen das beschriebene Verhalten nicht (#461)
- spec.mjs: Anlagedatum aus dem Aktivitaetsverlauf (#460)
- push-main: Vorschau, apply und Gate in der richtigen Reihenfolge (#452)
- kit/spec.mjs: check --anker ist das Gate vor dem Push (#451)
- kit/spec.mjs: apply schreibt die Beschreibung fort (#450)
- implement-Skills: Aussage-ID in den Testnamen schreiben (#449)
- kontext-Skill: specs/INDEX.md mitladen und Veralten melden (#448)
- plan-Skill: Lueckenliste, Code-Ausweis, Vorhaben-Notiz (#447)
- kit/spec.mjs: vorhaben legt die Notiz zum Code-Lesen an (#446)
- kit/spec.mjs: luecken meldet, wozu die Beschreibung schweigt (#445)
- issues-Skill: fuenfter Abschnitt Spec-Wirkung und ID-Vergabe (#444)
- board.mjs: Leitplanke Spec-Wirkung in issueCreate (#443)
- kit/spec.mjs: check --paket prueft die Form der Spec-Wirkung (#442)
- Auslieferung: spec.mjs in install.mjs und sync-blobs (#441)
- spec: Installer-Frage mit Einbahnstrassen-Hinweis (#439)
- board.mjs: issue get liefert created bei allen vier Trackern (#457)
- kit/spec.mjs: Geruest, index und show (#440)
- spec: Config-Block als Schalter im Schema (#438)
- reviewCommand persoenlich ueberschreibbar (#435)
- skills/review: Kommando-Reviewer starten und Ausfallpfad benennen (#434)
- install.mjs: Oder-Regel fuer das Reviewer-Paar (#433)
- Alte Spezifikationen gelöscht
- Datei ins Vault verschoben (codes)
- Schema: reviewCommand aufnehmen und die Oder-Regel verankern (#432)
- Vorflug: Reviewer-Name statt Modellname im Befund verlangen (#409)

## [1.44.0] - 2026-09-01
- Doku: bereichsbezogene Pruefungen beschreiben (#429)
- night.mjs: Pruef-Zusammenfassungen einsammeln und im Lauf-Bericht zeigen (#428)
- local-check: Pruefung vor dem Push mit merge-base-Anker (#427)
- implement-Skills: Pruefung vor dem Commit (#426)
- Auslieferung: checks.mjs in install.mjs und sync-blobs (#425)
- checks: run fuehrt die Auswahl aus und hinterlaesst sie (#424)
- checks: die Auswahl als Kommando, ohne auszufuehren (#423)
- checks: Config-Form fuer bereichsbezogene Pruefungen (#422)
- night.mjs: der Review-Auftrag nennt die Betriebsart (#419)
- issue-review: geschuetzt sind die Inhalte, nicht die Stufen (#418)
- issue-review: Schritt 6 traegt beide Betriebsarten (#417)
- issue-review: der Marker ist eine Body-Zeile, kein eigener Schreibbefehl (#415)
- S8786: vier quadratische Ausdruecke formseitig aufloesen (#406)

## [1.43.3] - 2026-08-31
- sonar-project.properties: der Coverage-Kommentar stimmte nicht mehr (#405)
- night.mjs: Restpuffer, wortloser Adapter, fehlendes buildChecks-Feld (#405)
- night.mjs: die letzten erreichbaren Zweige (#405)
- board.mjs: die letzten erreichbaren Zweige (#405)
- night.mjs: der Verbose-Stream und die Vorflug-Fehlerarten (#405)
- night.mjs: die Fehlerwege im echten Lauf (#405)
- board.mjs: Toolbox, Vault-Pfade, Probelauf, Zustandslabels (#405)
- board.mjs: lueckenhafte Antworten von gh und glab (#405)
- board.mjs: der lokale Tracker und die CLI-Achse (#405)
- night.mjs: die Vorbedingungen und die Label-Warnung (#405)
- night.mjs: die Rueckfaelle der reinen Funktionen (#405)
- install.mjs und die reinen Funktionen aus board.mjs (#405)
- Die kleinen tools/-Dateien: Zweige geschlossen (#405)
- board.mjs und derived-from-report: die restlichen offenen Zeilen (#405)
- sync-blobs: die Skill-Kopien und ihr Schreibschutz (#405)
- night.mjs: --version, Overrides und die echte Vorflug-Kommandozeile (#405)
- migrate-issues: Fehler-, Validierungs- und Rueckfallpfade abgedeckt (#405)
- Codex reviewer hinzugefügt
- main() zerlegt: drei Programme statt einer Funktion (#404)
- selectReviewCandidates und runReviewLoop unter die Schwelle (#404)
- Messregel und die fuenf kleinen Faelle unter die Schwelle (#404)
- Testnetz vor dem main()-Umbau: der vierte hardStop-Ausgang (#404)

## [1.43.2] - 2026-08-31
- FENCE_ZEILE: negativer Lookahead macht die Fence-Laenge eindeutig (#403)

## [1.43.1] - 2026-08-31
- refactor: die neun super-linearen Regexe entschaerfen (#403)
- test: die Bedeutung der neun Regexe festhalten (#403)
- String.raw an vier Stellen, void-Operator raus (#402)
- test: die printf-Zeile des Vorflug-Prompts woertlich festhalten (#402)

## [1.43.0] - 2026-08-31
- package.json ohne version-Feld — die Kit-Version lebt in install.mjs
- ESLint-Leitplanke gegen die Stilfunde, 36 Fundstellen abgeraeumt (#399)
- Komplexitaet: drei Funktionen zerteilt, sechs begruendet stehen gelassen (#397)
- Regex-Laufzeit gemessen: der Aufrufvertrag schuetzt, nicht die Form (#396)
- Sonar-Workflow: bei rotem Quality Gate fehlschlagen (#395)
- night.mjs: der Fallback fuer parsePruefvorgabe traegt die echte Signatur (#394)

## [1.42.1] - 2026-08-30
- probelauf: der Exit-Status schlaegt den EPIPE-Fehler (#393)

## [1.42.0] - 2026-08-30
- issue-review: ein Fund ohne Klassenangabe gilt wie gate (#392)

## [1.41.0] - 2026-08-30
- Doku: Zustandstabelle, Klassifikation, Einrichtung, Opt-in (#388)
- Automatisches Anwenden der korrektur-Funde (#387)
- Klassifikation der Funde: gate, alternativen, korrektur (#386)
- Uebergaenge: label-sync an den Stellen der Skills aufrufen (#385)
- issue-review label-sync: Pruefzustand als Label ans Board (#384)
- kit:klaeren im Nacht-Runner nachbauen (#382)
- reviewZustand: Pruefzustand aus Body und Kommentaren ableiten (#381)
- Prozessweites Gate-Register in CLAUDE-workflow.md (#380)

## [1.40.2] - 2026-08-29
- Doku: Arbeitspakete und Vorhaben im Adapter-Abschnitt trennen (#379)
- kontext-Skill: Vorhaben laden und getrennt ausgeben (#378)
- board.mjs: Vorhaben sind keine Arbeitspakete mehr (#377)

## [1.40.1] - 2026-08-29
- toolbox-Adapter: labelIssue entsperren (#375)
- Windows-CI: den local-Ausgabetest ueber die geparste Ausgabe vergleichen (#374)

## [1.40.0] - 2026-08-28
- Doku: der Installer ist nach dem Klonen ein Pflichtschritt
- Was install.mjs schreibt, gehoert nicht ins Repo
- Die CLAUDE*.md-Dateien sind Installer-Ausgabe, nicht Repo-Inhalt
- Gate-Register: zwei Dateien, ausgeliefert wie CLAUDE-workflow.md

## [1.39.0] - 2026-08-27
- Doku: den Herkunfts-Trockenlauf beschreiben (#366)
- Herkunfts-Bericht: Bestandspruefung und CLI ueber stdin (#365)
- Herkunfts-Leser: naechster Vorfahr aus einem Karten-Body (#364)
- Doku: --derived-from beschreiben und die stille Luecke benennen (#358)
- Skills setzen --derived-from nach ihrer Stellung in der Kette (#357)
- board.mjs: --derived-from sendet die Herkunft beim Anlegen (#356)
- config: codex aus den Reviewer-Paaren genommen

## [1.38.1] - 2026-08-14
- Windows-CI: migrate-issues-Tests nehmen das Fake-gh, nicht das echte (#315)
- board.mjs: toolbox.ideaStored gilt ohne Angabe als false (#313)
- board.mjs: issue get liefert labels in allen vier Adaptern (#312)
- night.mjs: Review ohne Body-Vorschlag ist kein Erfolg (#310)
- night.mjs: parseDeps erkennt die Abhaengigkeits-Ueberschrift zuverlaessig (#308)
- Dokumentation: Lebenszyklus auch fuer Plandokumente (#299)
- kontext paths findet die Projektnotiz, statt sie zu konstruieren (#286)
- board.mjs: Labels setzen und entfernen (#249)
- Neue Spezifiskation zum spec driven development
- docs: Beispiel fuer ein Arbeitspaket mit Pruefung: Verzicht

## [1.38.0] - 2026-08-13
- Dokumentation: Pruefvorgabe, Verzicht und Verfall (#307)
- implement-Skills: Verzicht als dritter Zustand (#306)
- issue-review: Pruefvorgabe in Auswahl, Rundenzahl und Schritt 6 (#305)
- night.mjs: Verzicht als zweiter Freigabegrund, auch im Dry-Run (#304)
- issue update pflegt den Bezugsstand und sperrt maschinelle Verringerung (#303)
- roles liefert die effektive Pruefvorgabe (#302)

## [1.37.2] - 2026-08-12
- Pruefvorgabe parsen und Bezugsstand berechnen (#301)
- Marker-Beispiele, Nacht-Ausnahme und Ablageort stufengerecht (#314)

## [1.37.1] - 2026-08-12
- docs: welche Dokumente ein issue-review erfasst
- docs: einzelnes GitHub-Issue nachtraeglich nach kanban-kit ueberfuehren

## [1.37.0] - 2026-08-11
- issue-review: ein Kommando fuer drei Stufen sichtbar machen
- CLAUDE-workflow.md: Vorlage und Kopie wieder deckungsgleich
- issues: Rueckverweis auf das Plandokument (#277)
- Dokumentation: drei Pruefstufen und das Plandokument (#284)
- issue-review: Arbeitspaket auf eine Rolle (#282)

## [1.36.6] - 2026-08-11
- night.mjs: eine Pruefstufe pro Lauf ueber --stufe (#283)
- issue-review: die beiden Rollen der Plan-Stufe (#281)
- issue-review: die beiden Rollen der fachlichen Stufe (#280)
- issue-review: Stufe am Titel erkennen, drei getrennte Marker (#279)
- fachplan: Autor-Modell gehoert ins Story-Format (#273)

## [1.36.5] - 2026-08-11
- Tracker-Wechsel dokumentiert, GitHub als Archiv (#294)
- Tracker auf kanban-kit umgestellt (#293)
- Implementierungsplan für codex hinzugefügt
- migrate-issues.mjs: direct beim Import, Spalten-Abbildung im Gate (#291)

## [1.36.4] - 2026-08-11
- board.mjs: kanban-kit erwartet direct statt ideaStored (#295)
- migrate-issues.mjs: Export-Query und sechste Board-Spalte (#291)
- migrate-issues.mjs: verify-Lauf als Gate (#290)
- migrate-issues.mjs: import-Lauf mit Trockenlauf und Idempotenz (#289)
- migrate-issues.mjs: Geruest und export-Lauf (#288)
- plan: Plandokument als [Plan]-Issue anlegen (#275)
- .agents und .codex ins .gitignore übernommen wie auch .claude

## [1.36.3] - 2026-08-10
- reviewStufen-Config und issue-review roles --stufe (#278)
- Gate fuer Plandokumente: [Plan]-Titel werden nie implementiert (#276)
- Reviewer-Vorflug in einer Session statt im Runner (#269)
- config: codex-Reviewer mit festem Modell und hohem Reasoning-Aufwand
- plan: verbindliches Format fuer das Plandokument (#274)
- issue create: Body aus Datei oder stdin (#271)
- issue-review: der Reviewer darf den Bestand lesen (#268)
- Changelog: Ablauf umdrehen, unveroeffentlichte Commits als [Unreleased] (#265)

## [1.36.2] - 2026-08-08
- board.mjs: Text aus Datei oder stdin statt nur als Argument (#270)

## [1.36.1] - 2026-08-08
- issue-review: nachts nie fragen, auch bei Ausfall beim Start (#267)
- Autor-Modell erzwingen statt erbitten (#266)

## [1.36.0] - 2026-08-08
- reviewer für die review session hinzugefügt
- issue-review check: Probelauf statt reiner PATH-Suche (#262)
- Changelog: aufeinanderfolgende Bump-Marken zusammenfassen (#245)
- merge-production gibt das Tag-Kommando aus (#244)

## [1.35.0] - 2026-08-07
- issue-review: Synthese protokollieren (#242)
- Autor-Modell auf Reviewer-Kurznamen aufloesen (#241)

## [1.34.0] - 2026-08-07
- Doku: logPath gilt fuer jeden geteilten Vault, nicht nur fuer Microservices

## [1.33.0] - 2026-08-07
- Installer legt jeden Skill an, nicht nur die aus einer Liste
- Installer liefert eine Beispiel-Config aus, Vorflug gatet leere Reviewer

## [1.32.0] - 2026-08-07
- findeImPath: Pfad-Trenner folgt der Plattform, nicht dem Host (#231)

## [1.31.1] - 2026-08-07
- Doku: Nacht-Review, Backlog statt Ready, Allowlist (#236)
- night.mjs: Review-Schleife mit dreistufigem Erfolg (#235)
- night.mjs: --review-Modus mit Vorflug und Dry-Run (#233)
- issue-review: Nachtbetrieb-Zweig — Marker ja, Body nein (#234)
- night.mjs: main()-Umbau und selectReviewCandidates (#232)
- board.mjs: Kommando 'issue update' (#237)
- kommandoVerfuegbar: Dateisystem statt Prozessstart (#231)
- Windows-CI: Fake-Binary-Test ueberspringen (#230)

## [1.31.0] - 2026-08-06
- Doku: neun Schritte und Werkzeuge getrennt darstellen (#228)
- Prozesstabelle auf 1-9, acht Skills als Werkzeuge neben dem Prozess (#227)
- issue-review: Rueckfrage bei unbekanntem Autor, Konvention praezisiert (#226)
- issue-review: explizite pairs-Matrix und matrix-Kommando (#225)
- Doku: Issue-Review ueber mehrere Modelle — Referenz und Buchtext (#224)
- Nacht-Runner: ungepruefte Ready-Issues zurueckstellen (#223)
- Autor-Modell im Issue, Schema und Prozess-Doku fuer Schritt 3.5 (#222)
- Skill /issue-review: Schritt 3.5 zwischen /issues und dem GO (#221)
- board.mjs: Achse 'issue-review' fuer Reviewer-Auswahl und Vorflug (#220)

## [1.30.0] - 2026-08-06
- CLI-Grammatik gegen die echten gh/glab-Hilfetexte abgleichen (#218)
- Fake-CLIs gegen eine Kommando-Grammatik validieren (#217)
- issues-Skill: manuelle Akzeptanzkriterien vom Session-Abschluss trennen (#215)
- board.mjs: getRepoName liefert einheitlich owner/repo (#214)
- sync-blobs: Dogfooding-Kopien unter .claude/skills/ abgleichen und pruefen (#213)
- /local-check: formatFixCommand bei roten Checks einmal fahren (#212)
- Schema, Template und Doku: Zwei-Datei-Config beschreiben (#211)
- Skills: geteilte und lokale Config beschreiben, formatFixCommand nachtragen (#210)
- Kit-Repo: .gitignore auf den Block umstellen, 'git add -f'-Kruecke entfernen (#209)
- install.mjs: .gitignore-Block statt '.claude/', mit Migration (#208)
- Zwei-Datei-Config: geteilte Team-Werte, lokale Overrides mit Allowlist (#207)
- Doku: Multi-Repo-Setup und das Prinzip 'Eine Datei, ein Schreiber' (#206)
- /document: juengsten Log-Eintrag desselben Projekts als Anknuepfung (#205)
- board.mjs: 'glab issue note' statt 'issue note create' (#216)
- /kontext: Dach- und Service-Notiz laden statt nur einer Projektnotiz (#204)
- /document: Pfade aus 'kontext paths', Dach-Notiz nur mit Rueckfrage (#203)
- board.mjs: Kommando 'kontext paths' fuer die Vault-Pfad-Aufloesung (#202)

## [1.29.0] - 2026-08-05
- Installer-Tests: HOME und USERPROFILE umlenken (#187)

## [1.28.3] - 2026-08-05
- install.mjs: Frage-Antwort-Weg und Re-Install testen (#187)

## [1.28.2] - 2026-08-05
- .gitattributes: LF im Working Tree erzwingen (#197)

## [1.28.1] - 2026-08-05
- changelog.mjs: Import-Guard funktioniert unter Windows (#197)

## [1.28.0] - 2026-08-05
- night.mjs faehrt buildChecks in der Shell der Plattform (#199)
- install.mjs legt GitLab-Labels ohne Shell an (#198)
- CI: Windows in die Test-Matrix aufnehmen (#197)
- board.mjs setzt Kommandos ohne Shell ab (#196)

## [1.27.0] - 2026-07-31
- kit/night.mjs und tools/ auf 100 % Zeilenabdeckung (#189)
- kit/board.mjs auf 100 % Zeilenabdeckung (#188)

## [1.26.0] - 2026-07-30
- Modell-Selbstauskunft als X-Agent-Model-Header (#193)
- Hartes [Idee]-Gate im Nacht-Runner analog zu [Fachlich] (#192)
- Nacht-Runner uebergibt das Issue verbindlich an die Session (#191)
- KIT_ROOT-Test-Hook macht Subprozess-Coverage messbar (#186)
- PATH-Aufloesung bei git/sh begruenden statt verbiegen (#183)

## [1.25.0] - 2026-07-29
- Coverage-Report an SonarCloud anbinden (#185)
- Verbleibende acht Code Smells beseitigen (#184)
- Timeout killt die Prozessgruppe statt nur des Kindprozesses (#182)
- board-ui.mjs aus der SonarCloud-Analyse ausschliessen (#181)
- GitHub-Tracker liefert Labels (#180)
- Nacht-Runner warnt bei nirgends vorkommendem Routing-Label (#179)

## [1.24.0] - 2026-07-29
- Hauptnav der Doku-Site bekommt "Board-UI herunterladen" (#178)
- Kommentar in blob-sync-check.yml auf den tatsächlichen Stand bringen (#177)
- board-ui.mjs über docs.mwolff.org als Download ausliefern (#176)

## [1.23.0] - 2026-07-28
- Doku: Nachtbetrieb mit einem lokalen Modell (Ollama) neben Anthropic (#174)
- issue get liefert Kommentare (GitHub, GitLab, kanbancompat)
- sync-blobs.mjs frischt die .claude/kit-Kopie mit auf (#173)
- Nacht-Runner warnt bei abweichendem Versionsstempel von board.mjs (#172)
- sync-blobs.mjs stempelt die Kit-Version in board.mjs und night.mjs (#171)
- board.mjs und night.mjs tragen die Kit-Version (#170)
- Salvage: mechanisch behebbare Formatverstoesse kippen keinen Nachtlauf mehr (#169)
- Salvage-Vorpruefung liest auch .claude/settings.local.json (#168)
- Salvage-Vorpruefung mergt .claude/settings.json-env-Block
- Night-Runner-Salvage: Fehlschlag durch verifizierten Zwischenstand abfangen (#167)
- Leitplanke: im Hintergrund gestartete Pflichtchecks vor Abschluss abholen

## [1.22.0] - 2026-07-27
- Leitplanke: lang laufende Build-Checks mit explizitem Timeout (#165)

## [1.21.0] - 2026-07-27
- Changelog automatisch bei Release generieren (RELEASING.md einhaken + Doku) (#162)
- Changelog-Generator: tools/changelog.mjs + initiales CHANGELOG.md (ab v1.16) (#161)

## [1.20.0] - 2026-07-27
- night.mjs: Routing-Label statt separatem Nachtlauf-Board (--label, Default kit:nightrun) (#159)
- board.mjs: listIssues liefert labels (GitLab + Toolbox, GitHub-Platzhalter) (#158)
- Nacht-Runner: Default-Modell auf claude-opus-5 (#157)

## [1.19.0] - 2026-07-27
- fachplan-Sync: Grooming im Body statt in Kommentaren, plan/Doku-Konsistenz (#155)

## [1.18.1] - 2026-07-24
- Nacht-Runner: --verbose-Flag mit Live-Verlaufsprotokoll via stream-json (#154)
- Nachtbetrieb-Doku: Setup-Rezept in drei Schichten (Allowlist tool-weit, Sandbox, env) (#153)
- Nacht-Runner: harter Stopp bei unkommittetem Rest nach Erfolgsrunde (#152)

## [1.18.0] - 2026-07-23
- Nacht-Runner: --help-Flag fuer night.mjs (#151)
- Nachtbetrieb-Doku: Allowlist woertlich, read-only-Git, Ablehnungs-Verhalten korrigiert (#150)
- Nacht-Runner: Infrastruktur-Guard — harter Stopp bei Session-Exit ungleich 0 (#149)

## [1.17.0] - 2026-07-23
- Doku: PO-Schleife mit fachlichen Issues (#147)
- Leitplanke: fachliche Issues werden mechanisch uebersprungen (#146)
- plan- und issues-Skill: fachliches Issue als Quelle in der PO-Schleife (#145)
- fachplan-Skill: fachliche Issues im Story-Format (Schritt 1.5) (#144)
