# Agenten, Workflows und was davon in meiner Nacht-Kette steckt

Ich habe kürzlich einen Vortrag gesehen. Eine Firma hatte etwas gebaut, das meinem eigenen Werkzeug sehr ähnlich sieht: aus einer fachlichen Anforderung wird ein technischer Plan, der Plan wird geprüft, aus dem geprüften Plan werden Arbeitspakete geschnitten. Der Unterschied war die Bühne. Die anderen zeigten einen Graphen, in dem Agenten als Kästen hängen und mit Kanten zusammengesteckt werden. Mein Kettenmodus ist ein Node-Skript von 3800 Zeilen.

Also habe ich mir die Frage gestellt, die man sich nach solchen Vorträgen stellt: Baue ich das Falsche? Die Antwort war interessanter als erwartet, und sie fängt bei der Frage an, was ein Agent technisch überhaupt ist.

## Die Schleife

Ein Agent ist ein Sprachmodell in einer Schleife mit Werkzeugen. Das ist die ganze Idee, und sie passt in zehn Zeilen:

```
messages = [aufgabe]
solange wahr:
  antwort = modell(systemprompt, werkzeugliste, messages)
  wenn antwort.stop_reason == "end_turn":
      fertig
  wenn antwort.stop_reason == "tool_use":
      für jeden Werkzeugaufruf in antwort:
          ergebnis = werkzeug_ausführen(name, parameter)
      messages += antwort + ergebnisse
```

Das Modell bekommt neben dem Prompt eine Liste von Werkzeugen, jedes mit Namen, Beschreibung und einem JSON-Schema für seine Parameter. Statt mit Text antwortet es bei Bedarf mit einem strukturierten Block: ruf `Read` auf mit dem Pfad `kit/night.mjs`. Das Modell führt dabei selbst nichts aus. Es kann nichts ausführen. Die Software drumherum, die Harness, führt das Werkzeug aus, hängt das Ergebnis als Nachricht an und ruft das Modell erneut auf. Das geht so lange, bis eine normale Textantwort kommt.

Damit besteht ein Agent aus vier Dingen: einem Systemprompt, einer Werkzeugliste, einem Modell und dieser Schleife. Alles Weitere, also eigenes Kontextfenster, Berechtigungen, Abbruch nach n Runden, ist Verpackung um diese vier.

Wer das einmal gesehen hat, liest die Marketingfolien anders. Ein Agent tut nichts Geheimnisvolles. Er bekommt eine Werkzeugliste, und was nicht auf der Liste steht, hat er nicht.

## Workflow oder Agent

Anthropic zieht in "Building effective agents" eine Trennlinie, die ich für die brauchbarste in dem ganzen Feld halte. Ein Workflow ist ein System, in dem Code die Reihenfolge der Modellaufrufe festlegt. Ein Agent ist ein System, in dem das Modell selbst entscheidet, was als Nächstes passiert. Dazu kommen fünf benannte Workflow-Muster: Prompt Chaining für feste Abfolgen, Routing für die Verteilung nach Aufgabentyp, Parallelisierung, Orchestrator-Workers für ein verteilendes Modell mit arbeitenden Modellen, und Evaluator-Optimizer für die Schleife aus Erzeugen und Kritisieren.

Nach dieser Definition ist mein Kettenmodus ein Workflow, genauer Prompt Chaining. Mein `night.mjs` legt fest, dass erst der Fachplan kommt, dann der technische Plan, dann das Review, dann der Schnitt in Arbeitspakete. Kein Modell entscheidet über diese Reihenfolge.

Das ist eine Entscheidung und kein Rückstand. Die Reihenfolge ist reproduzierbar, die Kosten sind planbar, und das Ganze läuft ohne Aufsicht. Je autonomer die KI arbeitet, desto strenger müssen die menschlichen Kontrollpunkte sitzen, und ein Kontrollpunkt, dessen Position ein Modell jede Nacht neu bestimmt, ist keiner.

## Drei Bauformen bei Claude

Wenn man einen Agenten bauen will, gibt es bei Claude drei Ebenen, und sie unterscheiden sich darin, wie viel Harness man geschenkt bekommt.

Die erste Ebene ist der Subagent in Claude Code. Er ist eine Markdown-Datei mit Frontmatter unter `.claude/agents/` im Projekt oder unter `~/.claude/agents/` für alle Projekte:

```markdown
---
name: pruefbarkeit
description: Prüft ein Arbeitspaket auf maschinell prüfbare Akzeptanzkriterien.
tools: Read, Grep, Glob
model: claude-sonnet-5
---

Du prüfst ein Arbeitspaket, das gleich implementiert werden soll.
Du kennst die Entstehungsgeschichte nicht, das ist gewollt.
```

Der Rumpf ist der Systemprompt, der Frontmatter regelt Werkzeuge, Modell und Dinge wie ein Turn-Limit. Drei Eigenschaften machen die Sache brauchbar. Der Subagent bekommt ein frisches Kontextfenster und sieht den Gesprächsverlauf des Aufrufers nicht. `tools` ist eine Positivliste. Und zurück an den Aufrufer geht ausschließlich die Abschlussnachricht, also das Ergebnis und nicht der Weg dorthin.

Die zweite Ebene ist das Agent SDK. Dieselbe Schleife, die Claude Code antreibt, als Node-Bibliothek, mit denselben eingebauten Werkzeugen und ohne Terminal:

```javascript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const msg of query({
  prompt: "Reviewe docs/plan-042.md mit dem plan-reviewer",
  options: {
    allowedTools: ["Read", "Grep", "Glob", "Agent"],
    maxTurns: 30,
    agents: {
      "plan-reviewer": {
        description: "Prüft technische Pläne gegen den Code-Bestand",
        prompt: "Du bist Reviewer für technische Pläne ...",
        tools: ["Read", "Grep", "Glob"],
        model: "sonnet",
      },
    },
  },
})) {
  if (msg.type === "result") console.log(msg.result);
}
```

Jeder `query()`-Aufruf ist ein eigener Lauf mit frischem Kontext. Agenten definiert man hier im Code statt in Dateien, und die Nachrichten kommen als Objekte zurück, inklusive Kosten und Werkzeugaufrufen.

Die dritte Ebene ist die rohe Messages API. Dort baut man die Schleife von oben selbst, schickt `tools` mit JSON-Schema mit, bekommt `stop_reason: "tool_use"` zurück, führt aus, schickt `tool_result`-Blöcke als Nutzernachricht zurück und wiederholt, bis `end_turn` kommt. Die SDKs bringen dafür einen Tool Runner mit, der die Schleife übernimmt. Eingebaute Werkzeuge gibt es auf dieser Ebene keine. Man bekommt genau das, was man selbst schreibt.

Für einen Nachtlauf, der Dateien liest, Tests startet und committet, wäre die dritte Ebene Selbstbau ohne Anlass. Die erste und die zweite sind die realistischen Kandidaten.

## Was davon Claude-spezifisch ist

Die Frage stellt sich in einem Feld, das sich alle sechs Monate häutet, mit einiger Berechtigung. Die Antwort fällt auf drei Ebenen unterschiedlich aus.

Das Prinzip ist nicht Claude-spezifisch. Werkzeugaufrufe mit JSON-Schema und die Schleife darum gibt es bei allen großen Anbietern und bei offenen Modellen. Nur das Nachrichtenformat unterscheidet sich im Detail. Bei Anthropic heißen die Blöcke `tool_use` und `tool_result`, anderswo heißt es Function Calling. Mein lokales Qwen über Ollama bedient dieselben Werkzeuge; ich habe das mit dem Read-Tool auf einer README nachgeprüft, und es funktioniert.

Die Verpackung ist spezifisch. Die Markdown-Datei unter `.claude/agents/` versteht nur Claude Code. Das Agent SDK spricht die Anthropic-API, wobei man es über `ANTHROPIC_BASE_URL` auch auf ein lokales Modell richten kann. Codex bringt sein eigenes Äquivalent mit.

Herstellerneutral sind zwei Dinge. MCP als Protokoll für Werkzeuge, das inzwischen alle Harnesses sprechen. Und die Graph-Frameworks wie LangGraph, in denen ein Workflow aus Knoten und Kanten besteht, ein gemeinsames Zustandsobjekt durch den Graphen wandert und bedingte Kanten Schleifen erlauben. Das grafische Zusammenstöpseln aus dem Vortrag war genau das. Technisch ist es dasselbe wie mein `night.mjs`, nur deklarativ als Graph statt als Ablauf im Code, und mit austauschbarem Modell je Knoten.

Wem Unabhängigkeit wichtig ist, der findet sie im Werkzeugprotokoll und in der Orchestrierung. Die Agentendefinition selbst ist bei jedem Anbieter ein Stück Prompt plus Werkzeugliste und in zehn Minuten portiert.

## Wie das bei mir aussieht

Jetzt der Blick in den eigenen Code. Mein `night.mjs` startet für jede Stufe einen Kindprozess:

```javascript
cmd = "claude";
cmdArgs = ["-p", prompt, "--model", args.model,
           "--permission-mode", "acceptEdits",
           "--output-format", "stream-json", "--verbose"];
```

Die Prompts sind meine Slash-Kommandos: `/techplan #F`, `/issue-review #plan`, `/issues #plan`. Jede Stufe läuft in einem eigenen Git-Worktree, hat ein eigenes Zeitbudget, und über der ganzen Kette liegt ein Kostenbudget, das nach einer Stufe greift und nie mittendrin.

Damit ist jede Stufe bereits ein vollwertiger Agentenlauf. Dieselbe Harness wie in meiner interaktiven Sitzung, dieselbe Schleife, alle Werkzeuge, die meine `settings.json` erlaubt. Ich habe eine Agenten-Kette gebaut und die Agenten nirgends hingeschrieben.

Und genau da liegt der Befund, der mich an dem Vortrag am meisten interessiert hat. Meine Reviewer-Rollen stehen als Prompt-Blöcke im Fließtext eines Skills. Dass ein Reviewer nur liest und nichts ändert, steht in diesem Prompt. Die Nacht-Session läuft mit `acceptEdits`, ein Claude-Subagent erbt diese Erlaubnis, also könnte der Reviewer schreiben. Er tut es nicht, weil er gebeten wurde.

Eine Leitplanke, die argumentiert, ist keine. Sie muss scheitern können.

Der Witz an der Sache: Bei meinen Fremdmodellen ist es längst eine Grenze. Der Reviewer, der auf meinem lokalen Qwen läuft, wird mit `--allowedTools Read,Glob,Grep` gestartet und kann gar nicht schreiben. Ich habe die harte Fassung also schon gebaut, nur eben für die anderen und nicht für Claude.

Die Konsequenz ist ein kleiner Schnitt. Jede Rolle wird eine Datei unter `.claude/agents/` mit `tools: Read, Grep, Glob`. Der Frontmatter ist die Claude-Verpackung, der Rumpf ist die Rolle, und denselben Rumpf bekommen Codex und Qwen über stdin. Die Rolle steht damit einmal im Repository, versioniert und diffbar, statt in jedem Lauf vom aufrufenden Modell aus einem SKILL.md herausgeschrieben zu werden.

## Was ich nicht baue

Keinen Orchestrator-Agenten, der entscheidet, welche Stufe als Nächstes dran ist. Die Reihenfolge meiner Kette ist eine fachliche Entscheidung, und der Stopp nach den Arbeitspaketen ist mein Entscheidungspunkt. Beides gehört in Code.

Ich habe im Sommer erlebt, was passiert, wenn der Apparat zu groß wird. Mein damaliger Prüfstand hatte zwei Reviewer je Dokument, eine Synthese und die Prüfung der Synthese durch ein viertes Modell. Er war so gebaut, dass er nie eine falsche Entscheidung trifft, und deshalb traf er keine. In einer ganzen Woche kam keine einzige Vorstufe unbeaufsichtigt durch. Was durchlief, war die Implementierung, weil dort ein deterministisches Werkzeug sagt, ob etwas fertig ist.

Anthropics eigener Rat lautet sinngemäß, mit einfachen Prompts anzufangen, sie mit Auswertung zu verbessern und mehrstufige agentische Systeme erst dann zu bauen, wenn das Einfachere nicht reicht. Das deckt sich mit meiner Erfahrung, und es kostet Geld, diese Erfahrung selbst zu machen.

Der Gewinn durch Agenten liegt bei mir nicht in der Orchestrierung, er liegt eine Ebene tiefer: in einer Werkzeugliste, die eine Bitte in eine Grenze verwandelt. Die Kästen und Kanten aus dem Vortrag sehen auf einer Folie besser aus. Was nachts hält, ist die Liste.
