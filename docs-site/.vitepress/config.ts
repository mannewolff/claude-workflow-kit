import { defineConfig } from "vitepress";

export default defineConfig({
  title: "claude-workflow-kit",
  description:
    "Zwölf Skills für KI-gestützte Entwicklung mit Claude Code — GitHub, GitLab oder lokal, mit drei bewussten menschlichen Stop-Punkten.",
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
        text: "Dokumentation",
        items: [
          { text: "Konzept & Voraussetzungen", link: "/dokumentation" },
          { text: "Installation & Config", link: "/dokumentation#die-config-datei" },
          { text: "Issue-Tracker & Code-Host", link: "/dokumentation#issue-tracker-und-code-host" },
          { text: "Die zwölf Skills", link: "/dokumentation#die-zwolf-skills-und-der-9-schritt-kernprozess" },
          { text: "Vollständiger Durchlauf", link: "/dokumentation#ein-vollstandiger-durchlauf" },
          { text: "Zwei Bahnen", link: "/dokumentation#zwei-bahnen" },
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
