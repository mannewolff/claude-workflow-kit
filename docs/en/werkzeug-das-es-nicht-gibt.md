# The tool I need does not exist
<!-- de: 35584baec1bd -->

Text from 29.06.2026, state before kit 1.5.0. Figures and platforms describe the state at that time.

Everyone is talking about agents. An agent plans. An agent writes the issue. An agent codes. An agent reviews. An agent checks security. Every week a new tool that takes over one more step.

I have a process for AI-assisted development. Nine steps, from the first plan to the release. When I looked for tool support for it, I noticed something: Nobody is building the tool I need right now.

What everyone is building is more autonomy. What I need is the opposite, at three precisely defined places.

My process has AI steps and human steps. The AI plans, writes issues, implements, prepares the review. Those are the steps I am happy to hand over. Three steps I carry myself: the GO for implementation, the push to main, the merge to production. These three are not a missing feature. They are the point where I take on responsibility.

A tool that automates these three steps away as well is not a better tool for me. It is a more dangerous one.

That is why the tool I need is not a platform. It is thin. Three building blocks.

A library of slash commands in Claude Code, one per AI step. Plan, issues, implement, review. Versioned in the repo, not in someone's head. Everyone on the team calls the same step with the same wording. That is the prompt library that does not get lost in the chat, because it is part of the code.

A block of hard checks (Prüfungen) in the build. Coverage, mutation, ArchUnit, plus the security tools that have learned nothing and simply check. A red build blocks the push mechanically. No model that might take a look.

A board that shows the status. Five columns (Spalten). The AI moves issues to In progress and In review. The moves to Ready and Done are mine.

The difference from the agent tools is not the technology. It is the attitude. The agent tools ask: What else can the AI take over? My tool asks: Where must the human stay, without exception?

That sounds like less. It is more. A tool that does nothing at the right three places is harder to build than one that does something everywhere. Because it has to know the places.

Why does nobody build this off the shelf? Because autonomy sells better than a stop point (Stop-Punkt). A tool that promises to open a pull request on its own at night sounds like progress. A tool that promises to wait for me at three places sounds like a brake. But it is not. It is steering.

So I am building it myself. Eight skills, one config, an installer for Mac, Windows and Linux. One morning in the repo. Nothing about it is spectacular. That is the point.

AI amplifies good habits as well as bad ones. A tool that supports the process has to amplify the good places and lock the dangerous ones. Whoever only adds autonomy amplifies both. I want the one without the other. There is no product for that yet. There is the process and three thin building blocks that make it executable.
