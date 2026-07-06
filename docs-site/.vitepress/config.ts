import { defineConfig } from "vitepress";

export default defineConfig({
  title: "claude-workflow-kit",
  description:
    "Zehn Skills für KI-gestützte Entwicklung mit Claude Code — GitHub, GitLab oder lokal, mit drei bewussten menschlichen Stop-Punkten.",
  appearance: false,
  srcDir: "../docs",
  outDir: ".vitepress/dist",

  themeConfig: {
    nav: [
      { text: "5-Minuten-Guide", link: "/quickstart" },
      { text: "Dokumentation", link: "/dokumentation" },
      {
        text: "Installer herunterladen",
        link: "https://docs.mwolff.org/install.mjs",
      },
    ],

    sidebar: [
      {
        text: "Einstieg",
        items: [
          { text: "5-Minuten-Guide", link: "/quickstart" },
          { text: "Lokal arbeiten (kein Remote, kein Board)", link: "/lokal" },
        ],
      },
      {
        text: "mwolff-board-ui",
        items: [
          { text: "Das Board", link: "/mwolff-board-ui" },
          { text: "Board", link: "/mwolff-board-ui#board" },
          { text: "Liste", link: "/mwolff-board-ui#liste" },
          { text: "Epics", link: "/mwolff-board-ui#epics" },
          { text: "Neues Issue anlegen", link: "/mwolff-board-ui#neues-issue-anlegen" },
        ],
      },
      {
        text: "Dokumentation",
        items: [
          { text: "Konzept & Voraussetzungen", link: "/dokumentation" },
          { text: "Installation & Config", link: "/dokumentation#die-config-datei" },
          { text: "Issue-Tracker & Code-Host", link: "/dokumentation#issue-tracker-und-code-host" },
          { text: "Die zehn Skills", link: "/dokumentation#die-zehn-skills-und-der-9-schritt-kernprozess" },
          { text: "Vollständiger Durchlauf", link: "/dokumentation#ein-vollstandiger-durchlauf" },
          { text: "Menschliche Stop-Punkte", link: "/dokumentation#die-drei-menschlichen-stop-punkte" },
          { text: "Was nicht im Kit ist", link: "/dokumentation#was-bewusst-nicht-im-kit-ist" },
          { text: "kontext.config.json", link: "/kontext-config-reference" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/mannewolff/claude-workflow-kit" },
    ],

    footer: {
      message: "claude-workflow-kit — frei verfügbar",
      copyright: "© Manfred Wolff · mwolff.org",
    },

    search: {
      provider: "local",
    },
  },
});
