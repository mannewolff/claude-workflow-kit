# Rollen als Agenten

Stand: 16.09.2026. Grundlage: `claude-workflow-kit` v1.53.0, konkret `kit/night.mjs` (Kettenmodus), `skills/issue-review/SKILL.md`, `.claude/workflow.config.json` (Blöcke `issueReview` und `reviewStufen`), `.claude/settings.json` und `install.mjs`.

Das Dokument beantwortet eine Frage: Was ändert sich, wenn ich meine Reviewer-Rollen aus dem Fließtext eines Skills in eigene Agentendateien hole. Der Nachtlauf, die Kette und die Skills bleiben dabei, wie sie sind.

---

## 1. Befund in fünf Sätzen

Meine Kette ist heute schon eine Agenten-Kette, ich habe die Agenten nur nirgends hingeschrieben. Jede Stufe startet mit `claude -p` eine vollständige Session mit allen Werkzeugen, die `.claude/settings.json` erlaubt, und die Rollen der Reviewer stehen als Prompt-Blöcke im `issue-review`-Skill. Dass ein Reviewer nur liest und nichts ändert, ist damit eine Bitte im Prompt und keine Grenze. Bei den Fremdmodellen ist es längst eine Grenze: Der qwen-Reviewer läuft mit `--allowedTools Read,Glob,Grep`, kann also gar nicht schreiben. Ich baue also nichts Neues, ich ziehe den Claude-Reviewern nach, was die Fremdmodelle schon haben.

---

## 2. Ist: wie ein Review heute startet

Die Kette ruft in `stufeReview` den Prompt `/issue-review #<planId>` auf. Der Skill liest die Config, wählt mit `board.mjs issue-review check` die Reviewer, paart sie über `issueReview.pairs` mit den Rollen aus `reviewStufen`, und startet sie. `kind: claude` läuft als Subagent mit dem konfigurierten Modell, `kind: command` als CLI mit dem Prompt über stdin. Die Rollentexte selbst stehen ab Zeile 56 im SKILL.md, fünf Stück: `pruefbarkeit`, `form-beobachtbarkeit`, `abgrenzung`, `architektur-bestand` und `schnitt-abhaengigkeiten`.

Das funktioniert. Es hat drei Kanten.

Die erste Kante ist die Werkzeugliste. Ein Claude-Subagent erbt, was die aufrufende Session darf, und die Nacht-Session läuft mit `--permission-mode acceptEdits`. Der Reviewer könnte also Dateien ändern. Er tut es nicht, weil im Prompt steht, dass er Befunde melden soll. Ich halte das für die schwächste Stelle des Aufbaus: Anti-Pattern 9 sagt, dass ein Modell nicht entscheidet, ob etwas durchgeht. Der gleiche Gedanke gilt eine Ebene tiefer. Ein Modell sollte auch nicht selbst entscheiden, ob es schreibt.

Die zweite Kante ist der Weg des Prompts. Der Rollentext steht im SKILL.md, also muss die aufrufende Session das SKILL.md lesen, den passenden Block heraussuchen und ihn an den Subagenten weitergeben. Bei fünf Rollen sind das rund hundert Zeilen, die bei jedem Lauf durch den Kontext der Session wandern, damit am Ende eine davon gebraucht wird.

Die dritte Kante ist `schnitt-abhaengigkeiten`. Diese Rolle ist im SKILL.md kein eigener Prompt, sondern ein Satz über einen anderen Prompt: derselbe Text wie `architektur-bestand`, aber mit vier anderen Fragen. Das Modell soll die Rolle also beim Lesen selbst zusammensetzen. Was dabei herauskommt, steht in keiner Datei und ist zwischen zwei Nächten nicht dasselbe.

---

## 3. Was eine Agentendatei ist

Eine Datei unter `.claude/agents/` im Projekt oder unter `~/.claude/agents/` für alle Projekte. Markdown mit Frontmatter, der Rumpf ist der Systemprompt:

```markdown
---
name: pruefbarkeit
description: Prüft ein Arbeitspaket auf maschinell prüfbare Akzeptanzkriterien.
tools: Read, Grep, Glob
model: claude-sonnet-5
---

Du prüfst ein Arbeitspaket, das gleich implementiert werden soll.
Du kennst die Entstehungsgeschichte nicht, das ist gewollt.
...
```

Wichtig für mich sind drei Eigenschaften. Der Agent bekommt ein eigenes, frisches Kontextfenster und sieht den Gesprächsverlauf des Aufrufers nicht, was genau der Fremdblick ist, den ich beim Review haben will. `tools` ist eine Positivliste: Was nicht dasteht, hat der Agent nicht. Und zurück an den Aufrufer geht nur die Abschlussnachricht, also die Befunde, und nicht der Weg dorthin.

---

## 4. Entwurf: eine Datei je Rolle

Jede der fünf Rollen bekommt eine Datei unter `.claude/agents/`. Der Rumpf ist der Rollentext, wie er heute im SKILL.md steht, ohne den Platzhalter `{{ISSUE_BODY}}`: Das Dokument kommt als Auftrag herein, nicht als Teil des Systemprompts. `tools` steht bei allen fünf auf `Read, Grep, Glob`, weil jede Rolle ausdrücklich den Bestand lesen darf und keine schreiben soll.

Der Kern des Entwurfs ist, dass diese Datei für alle Reviewer gilt, nicht nur für die von Claude. Der Frontmatter ist die Claude-Verpackung, der Rumpf ist die Rolle. Ein `kind: command`-Reviewer bekommt denselben Rumpf über stdin, so wie heute auch. Damit habe ich die Rolle einmal im Repo stehen, und Codex, qwen und Claude lesen dieselben Sätze. Wenn ich an einer Frage schraube, schraube ich für alle.

`schnitt-abhaengigkeiten` wird dabei ausgeschrieben. Aus einem Verweis wird eine Datei mit vier Fragen, die in jeder Nacht dieselben sind.

Was in der Config bleibt: `issueReview.reviewers` mit Modellen und Kommandos, `pairs` und `reviewStufen`. Die Config sagt weiterhin, WER prüft. Die Agentendatei sagt, WORAUF geprüft wird. Das Modell gehört damit in die Config und nicht in den Frontmatter, sonst habe ich zwei Wahrheiten. Ich lasse `model` im Frontmatter deshalb leer.

---

## 5. Was sich wo ändert

Fünf neue Dateien unter `skills/` hilft mir nicht, die Agenten brauchen ihren eigenen Ort. Ich lege sie unter `agents/` neben `skills/` an. `tools/sync-blobs.mjs` erzeugt daraus einen zweiten Blob, so wie heute für die Skills, und `install.mjs` kopiert ihn nach `~/.claude/agents/` oder `./.claude/agents/`, in denselben Zielbereich wie die Skills. Der Installer fragt heute schon einmal global oder projektweit; die Antwort gilt dann für beides.

`skills/issue-review/SKILL.md` verliert rund hundert Zeilen Rollentext. An ihre Stelle tritt der Abschnitt "Reviewer starten" mit zwei Sätzen: `kind: claude` startet den gleichnamigen Agenten mit dem Dokument als Auftrag, `kind: command` liest den Rumpf der Agentendatei und schickt ihn mit dem Dokument über stdin. Der Rest des Skills bleibt unberührt, besonders die Transportregel und der Befunde-Kommentar.

`kit/night.mjs` ändert sich nicht. `.claude/settings.json` ändert sich nicht. `.claude/workflow.config.json` ändert sich nicht.

---

## 6. Was ich ausdrücklich nicht ändere

Die Reihenfolge der Kette bleibt im Code. Kein Orchestrator-Agent entscheidet nachts, welche Stufe dran ist. Fachplan, Plan, Review, Pakete ist eine fachliche Entscheidung, und der Stopp nach den Paketen ist mein Entscheidungspunkt, nicht der eines Modells.

Die Stufen selbst bekommen vorerst keine Agentendefinition. `/techplan` und `/issues` schreiben, sie brauchen die volle Harness, und eine engere Werkzeugliste würde dort nur eine zweite Liste neben `settings.json` aufmachen.

Das Agent SDK bleibt draußen. Der Wechsel von `claude -p` auf `query()` wäre der sauberere Bau, aber er fasst `runProcess`, `leseKennzahlen` und den Test-Hook `NIGHT_CLAUDE_CMD` gleichzeitig an. Das ist ein eigenes Vorhaben und kein Teil von diesem.

---

## 7. Migration in vier Schritten

Zuerst der Ordner `agents/` mit den fünf Dateien, Rumpf wörtlich aus dem SKILL.md übernommen, nur `schnitt-abhaengigkeiten` neu ausgeschrieben. Dann `sync-blobs.mjs` und `install.mjs` um den zweiten Blob erweitern, mit Test. Dann das SKILL.md kürzen und auf die Agenten verweisen. Zuletzt eine Nacht mit `--verbose` mitlesen und prüfen, ob die Befunde-Kommentare aussehen wie vorher.

Der dritte Schritt ist der einzige mit Rückfallrisiko: Solange das SKILL.md die Rollen noch trägt und die Agenten schon liegen, laufen beide Wege. Ich schneide den alten Weg erst ab, wenn eine Nacht mit dem neuen durch ist.

---

## 8. Offene Fragen

Erstens: Gilt die Positivliste `Read, Grep, Glob` wirklich für alle fünf Rollen? `architektur-bestand` soll den Bestand prüfen. Wenn dazu ein Build oder ein Test gehört, braucht die Rolle `Bash` mit enger Einschränkung, und dann ist sie keine reine Leserolle mehr.

Zweitens: Was passiert mit einem Reviewer, dessen Agentendatei fehlt? Ich neige zu derselben Antwort wie bei einem fehlenden Reviewer: unbeaufsichtigt weiterlaufen und den Ausfall in Zeile 2 des Kommentars nennen. Anhalten wäre der Prüfapparat von früher.

Drittens: Sollen die Agenten global oder projektweit liegen? Global ist bequem, projektweit wandert mit dem Repo und ist diffbar. Ich tendiere zu projektweit, weil eine Rolle zu einem Prozessstand gehört und Prozessstände bei mir versioniert werden.

---

## 9. Woran ich messe, ob es etwas gebracht hat

Ein Reviewer kann nach dem Umbau keine Datei mehr ändern, auch wenn er es versucht. Das prüfe ich einmal absichtlich mit einem Prompt, der zum Ändern auffordert.

Die Befunde bleiben inhaltlich gleich gut. Dafür lasse ich dasselbe Dokument einmal vor und einmal nach dem Umbau prüfen und lege die beiden Kommentare nebeneinander.

Und die Session, die `/issue-review` aufruft, verbraucht weniger Tokens, weil sie die Rollentexte nicht mehr durch ihren Kontext schleift. Das sehe ich im Kostenfeld der Stufe.
