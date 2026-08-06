# Drei Modelle für ein Issue

## Der Befund

Ich schreibe ein Issue. Es ist gut. Ich habe es sorgfältig geschnitten, die Akzeptanzkriterien sind konkret, die Abhängigkeiten stehen drin. Dann gebe ich es einem anderen Modell zu lesen, und das findet Fehler.

Nicht gelegentlich. Verlässlich.

Das ist zunächst ärgerlich und dann interessant. Ärgerlich, weil ich glaubte, fertig zu sein. Interessant, weil es sich wiederholt — und was sich wiederholt, ist kein Zufall, sondern eine Eigenschaft des Verfahrens.

## Warum das passiert

Wer ein Issue schreibt, hat den Kontext im Kopf, aus dem es entstanden ist. Das Gespräch, das vorausging. Die Datei, die er dabei offen hatte. Die Entscheidung, die vor drei Tagen gefallen ist. Nichts davon steht im Issue, und das muss es auch nicht — es steht ja im Kopf.

Beim Wiederlesen ergänzt der Autor diesen Kontext unbewusst. Er liest nicht, was dasteht, sondern was er gemeint hat. Die Lücke zwischen beidem ist unsichtbar, solange derselbe Kopf liest.

Ein fremdes Modell hat diesen Kopf nicht. Es hat nur den Text. Es liest, was dasteht — und stolpert genau dort, wo später auch die Implementierung stolpern wird.

Das ist derselbe Grund, aus dem Code-Review funktioniert. Nur eine Stufe früher und mit höherem Einsatz: Ein Fehler im Code kostet den Code. Ein Fehler im Issue pflanzt sich in alles fort, was daraus entsteht.

## Ein Beleg, der mir nicht gefällt

Am 6. August 2026 habe ich siebzehn Issues geschrieben. Sie waren von einem starken Modell formuliert, im etablierten Vier-Abschnitt-Format, mit sorgfältig ausformulierten Akzeptanzkriterien.

Drei davon trugen ein Kriterium der Form:

> Manueller Durchlauf gegen ein Wegwerf-Verzeichnis: …

Nachts lief der Runner los. Ein Runner startet eine Session ohne Menschen daneben. Ein Kriterium mit dem Wort *manuell* kann er prinzipiell nie abhaken — niemand ist da, der es tut.

Die Sessions standen damit vor einer Wahl, die sie nicht gewinnen konnten. Eine hielt an und meldete, sie könne nicht abschließen; für den Runner sah das aus wie ein Fehlschlag. Die zweite schloss ab und vermerkte das offene Kriterium im Bericht; für das Board sah das aus wie ein Erfolg. Sie galt wochenlang als fertig, obwohl sie es nicht war.

Beides an einem Abend. Beides aus derselben Ursache: ein Wort im Issue, das der Autor für harmlos hielt.

**Der Punkt ist nicht, dass ein schwaches Modell die Issues geschrieben hätte.** Es war das stärkste verfügbare. Der Punkt ist, dass Stärke hier nichts hilft. Wer den Kontext hat, sieht die Lücke nicht — unabhängig davon, wie gut er sonst ist.

## Warum drei und nicht zwei

Ein Autor und ein Prüfer sind besser als ein Autor allein. Aber ein Prüfer sieht eine Sorte Fehler, nämlich die, nach der er sucht.

Deshalb zwei Prüfer mit **verschiedenen Aufträgen**. Der eine fragt nach Vollständigkeit: Ist jedes Kriterium prüfbar? Ist „fertig" eindeutig? Fehlen Randfälle? Der andere fragt nach Zuschnitt: Ist das zu groß für eine Arbeitseinheit? Fehlen Abhängigkeiten? Was bricht, das hier nicht steht?

Zwei Modelle mit demselben Auftrag sind kein zweiter Blick. Sie sind derselbe Blick zweimal, und der Zugewinn ist entsprechend klein. Die Rollen zu trennen kostet nichts und ändert alles.

## Warum fremde Modelle dazugehören

Modelle einer Familie teilen Trainingsdaten, Konventionen und Anschauungen darüber, wie ein gutes Issue aussieht. Sie teilen damit auch ihre blinden Flecken.

Ein Modell aus einem anderen Haus bringt eine andere Sorte Fehler zum Vorschein — nicht weil es besser wäre, sondern weil es anders daneben liegt. Wo zwei Verwandte übereinstimmend nichts sehen, sieht ein Fremder manchmal etwas.

Praktisch heißt das: Der Prüfer darf kein fest verdrahtetes Modell sein, sondern muss ein Adapter sein. Text hinein, Text heraus. Was dazwischen läuft, geht das Verfahren nichts an. Damit nimmt jedes Werkzeug teil, das man ansprechen kann, und die Liste veraltet nicht, wenn eine neue Modellgeneration erscheint.

## Die Gegenkraft, die man einbauen muss

Hier kommt die Erfahrung, die ich nicht erwartet hatte.

Prüfer schlagen Ergänzungen vor. Immer. Ein fehlender Randfall, ein zusätzliches Kriterium, ein Hinweis auf etwas Bedenkenswertes. Das ist ihre Aufgabe, und sie machen sie gut.

Nur: Ergänzen ist leichter als Streichen. Nach drei Modellen ist das Issue doppelt so lang — und ein doppelt so langes Issue ist nicht doppelt so gut implementierbar. Es ist oft schlechter, weil das Wesentliche im Zusätzlichen untergeht.

Deshalb steht in beiden Prüfaufträgen eine Frage, die sonst niemand stellt: **Was kann raus?**

Das ist kein Feinschliff. Es ist die Gegenkraft, ohne die das Verfahren in Aufblähung kippt. Wer den Roundtrip einführt und diese Frage weglässt, bekommt längere Issues statt besserer.

## Wo der Mensch bleibt

Die Befunde sind Vorschläge. Sie wandern nicht automatisch in das Issue.

Zwei Gründe. Der erste ist banal und trotzdem entscheidend: Zwei Modelle können sich einig und trotzdem falsch sein. Übereinstimmung ist kein Wahrheitskriterium — sie ist ein Hinweis darauf, dass beide dasselbe gelesen haben.

Der zweite wiegt schwerer. Wer entscheidet, was im Issue steht, entscheidet über die Anforderung. Und wer über die Anforderung entscheidet, entscheidet über das Produkt. Das ist keine Modellfrage. Es ist die Stelle, an der jemand verantworten muss, was gebaut wird.

Der Prozess, in dem dieses Verfahren steckt, hat drei solcher Stellen: die Freigabe zur Implementierung, den Push, den Merge. Der Issue-Review fügt keine vierte hinzu — er schärft die erste, indem er dafür sorgt, dass man weiß, was man freigibt.

## Was es nicht leistet

Es ersetzt kein fachliches Gespräch. Wenn unklar ist, *was* gebaut werden soll, hilft kein Modell der Welt beim Formulieren — dafür braucht es jemanden, der die Domäne kennt.

Und es macht aus einer falschen Anforderung keine richtige. Ein Issue, das präzise das Falsche verlangt, ist nach drei Modellen präzise falsch.

Das Verfahren macht eine Anforderung **präzise, nicht wahr**. Das ist weniger, als man sich wünscht, und mehr, als man vorher hatte.

## Der Preis

Zwei Prüfer je Issue sind zwei zusätzliche Läufe. Bei siebzehn Issues sind das vierunddreißig.

Das lohnt sich nicht bei jedem Einzeiler. Es lohnt sich bei Issues, die etwas kosten, wenn sie falsch sind — und die erkennt man meistens daran, dass man beim Schreiben gezögert hat.

Der Rest ist eine Frage der Gewohnheit. Ein Issue, das drei Modelle gesehen haben, sieht man an, dass es sie gesehen hat.
