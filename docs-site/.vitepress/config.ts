import { defineConfig } from "vitepress";

export default defineConfig({
  title: "claude-workflow-kit",
  description:
    "Zehn Skills für KI-gestützte Entwicklung mit Claude Code — mit bewussten menschlichen Stop-Punkten.",
  appearance: false,
  srcDir: "../docs",
  outDir: ".vitepress/dist",

  head: [
    [
      "link",
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
    ],
    [
      "link",
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "",
      },
    ],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Mulish:wght@400;600;700&family=Open+Sans:wght@400;600&family=Playfair+Display:wght@700&display=swap",
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: "5-Minuten-Guide", link: "/quickstart" },
      { text: "Dokumentation", link: "/dokumentation" },
      {
        text: "Installer herunterladen",
        link: "https://mwolff.org/claude-workflow-kit/install.mjs",
      },
    ],

    sidebar: [
      {
        text: "Einstieg",
        items: [{ text: "5-Minuten-Guide", link: "/quickstart" }],
      },
      {
        text: "Dokumentation",
        items: [
          { text: "Konzept & Voraussetzungen", link: "/dokumentation" },
          { text: "Installation & Config", link: "/dokumentation#die-config-datei" },
          { text: "Die zehn Skills", link: "/dokumentation#die-zehn-skills" },
          { text: "Vollständiger Durchlauf", link: "/dokumentation#ein-vollstandiger-durchlauf" },
          { text: "Menschliche Stop-Punkte", link: "/dokumentation#die-menschlichen-stop-punkte" },
          { text: "Was nicht im Kit ist", link: "/dokumentation#was-bewusst-nicht-im-kit-ist" },
          { text: "kontext.config.json", link: "/dokumentation#kontext-config-json--referenz" },
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
