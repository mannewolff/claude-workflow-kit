import { defineConfig, type DefaultTheme } from "vitepress";
import sprachen from "../sprachen.json";

// Bis zur Aktivierung bleiben die englischen Seiten und das Glossar ungebaut, die
// deutsche Doku unverändert sichtbar (Issue #1355, Plan #1348 E6, E10).
const srcExclude = sprachen.englischAktiv ? [] : ["en/**", "glossar.md"];

// Absolute URLs sind Absicht: VitePress setzt daran das External-Link-Icon, und der
// Server liefert die Dateien per Content-Disposition als Download aus
// (docs/public/.htaccess). Beide Sprachen zeigen auf dieselben Dateien (Plan #1348, E13).
const DOWNLOAD = {
  installer: "https://docs.mwolff.org/install.mjs",
  boardUi: "https://docs.mwolff.org/board-ui.mjs",
  einstellungen: "https://docs.mwolff.org/einstellungen.mjs",
};

// Bedientexte je Sprache (Plan #1348, E13). Die deutsche Wurzel zeigte bis dahin die
// englischen Standardtexte von VitePress. Bewusst kein Text für lastUpdated.
const themeDe: DefaultTheme.Config = {
  nav: [
    { text: "5-Minuten-Guide", link: "/quickstart" },
    { text: "Dokumentation", link: "/dokumentation" },
    { text: "Installer herunterladen", link: DOWNLOAD.installer },
    { text: "Board-UI herunterladen", link: DOWNLOAD.boardUi },
    { text: "Einstellungs-Oberfläche herunterladen", link: DOWNLOAD.einstellungen },
  ],

  sidebar: [
    {
      text: "Einstieg",
      items: [
        { text: "5-Minuten-Guide", link: "/quickstart" },
        { text: "Windows über WSL2", link: "/wsl2" },
        { text: "Lokal arbeiten (kein Remote, kein Board)", link: "/lokal" },
      ],
    },
    {
      text: "Dokumentation",
      items: [
        { text: "Konzept & Voraussetzungen", link: "/dokumentation" },
        { text: "Installation & Config", link: "/dokumentation#die-config-datei" },
        { text: "Issue-Tracker & Code-Host", link: "/dokumentation#issue-tracker-und-code-host" },
        { text: "Die sechzehn Skills", link: "/dokumentation#die-sechzehn-skills-und-der-9-schritt-kernprozess" },
        { text: "Vollständiger Durchlauf", link: "/dokumentation#ein-vollstandiger-durchlauf" },
        { text: "Drei Bahnen", link: "/dokumentation#drei-bahnen" },
        { text: "Menschliche Stop-Punkte", link: "/dokumentation#die-drei-menschlichen-stop-punkte" },
        { text: "Was nicht im Kit ist", link: "/dokumentation#was-bewusst-nicht-im-kit-ist" },
        { text: "Regeln im Werkzeug", link: "/regeln-im-werkzeug" },
        { text: "Prüfbereiche", link: "/pruefbereiche" },
        { text: "kontext.config.json", link: "/kontext-config-reference" },
        { text: "Glossar", link: "/glossar" },
      ],
    },
  ],

  footer: {
    message: "claude-workflow-kit — frei verfügbar",
    copyright: "© Manfred Wolff · mwolff.org",
  },

  outline: { label: "Auf dieser Seite" },
  docFooter: { prev: "Vorherige Seite", next: "Nächste Seite" },
  returnToTopLabel: "Nach oben",
  sidebarMenuLabel: "Menü",
  langMenuLabel: "Sprache wechseln",
};

const themeEn: DefaultTheme.Config = {
  nav: [
    { text: "5-minute guide", link: "/en/quickstart" },
    { text: "Documentation", link: "/en/dokumentation" },
    { text: "Download installer", link: DOWNLOAD.installer },
    { text: "Download board UI", link: DOWNLOAD.boardUi },
    { text: "Download settings interface", link: DOWNLOAD.einstellungen },
  ],

  sidebar: [
    {
      text: "Getting started",
      items: [
        { text: "5-minute guide", link: "/en/quickstart" },
        { text: "Windows via WSL2", link: "/en/wsl2" },
        { text: "Working locally (no remote, no board)", link: "/en/lokal" },
      ],
    },
    {
      text: "Documentation",
      items: [
        { text: "Concept & prerequisites", link: "/en/dokumentation" },
        { text: "Installation & config", link: "/en/dokumentation#the-config-file" },
        { text: "Issue tracker & code host", link: "/en/dokumentation#issue-tracker-and-code-host" },
        { text: "The sixteen skills", link: "/en/dokumentation#the-sixteen-skills-and-the-9-step-core-process" },
        { text: "A complete pass", link: "/en/dokumentation#a-complete-pass" },
        { text: "Three lanes", link: "/en/dokumentation#three-lanes" },
        { text: "Human stop points", link: "/en/dokumentation#the-three-human-stop-points" },
        { text: "What is not in the kit", link: "/en/dokumentation#what-is-deliberately-not-in-the-kit" },
        { text: "Rules in the tool", link: "/en/regeln-im-werkzeug" },
        { text: "Check areas", link: "/en/pruefbereiche" },
        { text: "kontext.config.json", link: "/en/kontext-config-reference" },
        { text: "Glossary", link: "/en/glossar" },
      ],
    },
  ],

  footer: {
    message: "claude-workflow-kit — freely available",
    copyright: "© Manfred Wolff · mwolff.org",
  },

  outline: { label: "On this page" },
  docFooter: { prev: "Previous page", next: "Next page" },
  returnToTopLabel: "Return to top",
  sidebarMenuLabel: "Menu",
  langMenuLabel: "Change language",
};

// Der erste Besuch der Startseite landet auf Englisch, solange nicht Deutsch gewählt
// wurde (Plan #1348, E2). Nur `/` und `/index.html`: Tiefe Verweise auf deutsche Seiten
// bleiben ohne Umleitung (AK 6). Die Browsersprache wird bewusst nicht gelesen (AK 1).
// Den Schlüssel schreibt der Sprachumschalter (theme/index.ts, E3).
const WEITERLEITUNG = `(function () {
  var pfad = location.pathname;
  if (pfad !== "/" && pfad !== "/index.html") return;
  var sprache = null;
  try { sprache = localStorage.getItem("kit-docs-sprache"); } catch (e) {}
  if (sprache !== "de") location.replace("/en/");
})();`;

export default defineConfig({
  title: "claude-workflow-kit",
  // Ohne Angabe setzt VitePress "en-US"; die Fußzeile liest lang (Issue #1369).
  lang: "de",
  description:
    "Sechzehn Skills für KI-gestützte Entwicklung mit Claude Code: GitHub, GitLab oder lokal, mit drei bewussten menschlichen Stop-Punkten.",
  appearance: false,
  srcDir: "../docs",
  srcExclude,
  outDir: ".vitepress/dist",

  // Deutsch bleibt unter der Wurzel, Englisch kommt nach /en/ (Plan #1348, E1); der
  // eingebaute Umschalter tauscht nur das Präfix (E4).
  ...(sprachen.englischAktiv && {
    head: [["script", {}, WEITERLEITUNG]],
    locales: {
      root: { label: "Deutsch", lang: "de", themeConfig: themeDe },
      en: {
        label: "English",
        lang: "en",
        link: "/en/",
        description:
          "Sixteen skills for AI-assisted development with Claude Code: GitHub, GitLab or local, with three deliberate human stop points.",
        themeConfig: themeEn,
      },
    },
  }),

  themeConfig: {
    ...themeDe,

    socialLinks: [
      { icon: "github", link: "https://github.com/mannewolff/claude-workflow-kit" },
    ],

    // Die lokale Suche indiziert je Locale getrennt (AK 7); hier nur ihre Bedientexte.
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: "Suchen", buttonAriaLabel: "Suchen" },
              modal: {
                displayDetails: "Detailansicht",
                resetButtonTitle: "Suche zurücksetzen",
                backButtonTitle: "Suche schließen",
                noResultsText: "Keine Treffer für",
                footer: {
                  selectText: "auswählen",
                  selectKeyAriaLabel: "Eingabetaste",
                  navigateText: "navigieren",
                  navigateUpKeyAriaLabel: "Pfeil nach oben",
                  navigateDownKeyAriaLabel: "Pfeil nach unten",
                  closeText: "schließen",
                  closeKeyAriaLabel: "Escape",
                },
              },
            },
          },
          en: {
            translations: {
              button: { buttonText: "Search", buttonAriaLabel: "Search" },
              modal: {
                displayDetails: "Display detailed list",
                resetButtonTitle: "Reset search",
                backButtonTitle: "Close search",
                noResultsText: "No results for",
                footer: {
                  selectText: "to select",
                  selectKeyAriaLabel: "enter",
                  navigateText: "to navigate",
                  navigateUpKeyAriaLabel: "up arrow",
                  navigateDownKeyAriaLabel: "down arrow",
                  closeText: "to close",
                  closeKeyAriaLabel: "escape",
                },
              },
            },
          },
        },
      },
    },
  },
});
