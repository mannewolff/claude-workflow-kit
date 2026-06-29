# Das Werkzeug, das ich brauche, gibt es nicht

Alle reden von Agenten. Ein Agent plant. Ein Agent schreibt das Issue. Ein Agent codet. Ein Agent reviewt. Ein Agent prüft die Security. Jede Woche ein neues Tool, das einen Schritt mehr übernimmt.

Ich habe einen Prozess für die KI-gestützte Entwicklung. Neun Schritte, vom ersten Plan bis zum Release. Als ich nach einer Tool-Unterstützung dafür gesucht habe, ist mir etwas aufgefallen: Das Werkzeug, das ich brauche, baut gerade niemand.

Was alle bauen, ist mehr Autonomie. Was ich brauche, ist das Gegenteil, an drei genau definierten Stellen.

Mein Prozess hat KI-Schritte und menschliche Schritte. Die KI plant, schreibt Issues, implementiert, bereitet das Review vor. Das sind die Schritte, die ich gern abgebe. Drei Schritte trage ich selbst: das GO zur Implementierung, der Push auf main, der Merge nach production. Diese drei sind keine fehlende Funktion. Sie sind der Punkt, an dem ich die Verantwortung übernehme.

Ein Tool, das diese drei Schritte mit wegautomatisiert, ist für mich kein besseres Tool. Es ist ein gefährlicheres.

Das Werkzeug, das ich brauche, ist deshalb keine Plattform. Es ist dünn. Drei Bausteine.

Eine Bibliothek aus Slash-Commands in Claude Code, einer pro KI-Schritt. Plan, Issues, Implementieren, Review. Versioniert im Repo, nicht im Kopf. Jeder im Team ruft denselben Schritt mit demselben Wortlaut auf. Das ist die Prompt-Bibliothek, die nicht im Chat verloren geht, weil sie Teil des Codes ist.

Ein Block harter Prüfungen im Build. Coverage, Mutation, ArchUnit, plus die Security-Tools, die nichts gelernt haben und einfach prüfen. Ein roter Build blockiert den Push mechanisch. Kein Modell, das vielleicht hinschaut.

Ein Board, das den Status zeigt. Fünf Spalten. Die KI bewegt Issues nach In progress und In review. Die Schritte nach Ready und Done mache ich.

Der Unterschied zu den Agenten-Tools ist nicht die Technik. Es ist die Haltung. Die Agenten-Tools fragen: Was kann die KI noch übernehmen? Mein Werkzeug fragt: Wo muss der Mensch zwingend bleiben?

Das klingt nach weniger. Es ist mehr. Ein Tool, das an den richtigen drei Stellen nichts tut, ist schwerer zu bauen als eines, das überall etwas tut. Weil es die Stellen kennen muss.

Warum baut das niemand von der Stange? Weil sich Autonomie besser verkauft als ein Stop-Punkt. Ein Tool, das verspricht, nachts allein einen Pull Request zu öffnen, klingt nach Fortschritt. Ein Tool, das verspricht, an drei Stellen auf mich zu warten, klingt nach Bremse. Ist es aber nicht. Es ist Lenkung.

Also baue ich es selbst. Acht Skills, eine Config, ein Installer für Mac, Windows und Linux. An einem Vormittag im Repo. Nichts daran ist spektakulär. Das ist der Punkt.

Die KI verstärkt sowohl gute als auch schlechte Gewohnheiten. Ein Werkzeug, das den Prozess unterstützt, muss die guten Stellen verstärken und die gefährlichen sperren. Wer nur Autonomie addiert, verstärkt beides. Ich will das eine ohne das andere. Dafür gibt es noch kein Produkt. Es gibt den Prozess und drei dünne Bausteine, die ihn ausführbar machen.
