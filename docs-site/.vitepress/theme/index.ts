import DefaultTheme from "vitepress/theme";
import { inBrowser } from "vitepress";
import { h } from "vue";
import LegalFooter from "./LegalFooter.vue";
import { sprachwahl } from "./sprachwahl.mjs";
import "./style.css";

// Schluessel, unter dem die zuletzt per Umschalter gewaehlte Sprache liegt (Plan #1348, E3).
const SPRACHE_SCHLUESSEL = "kit-docs-sprache";

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      "layout-bottom": () => h(LegalFooter),
    });
  },
  enhanceApp({ router }) {
    if (!inBrowser) return;
    let vorigerPfad = window.location.pathname;
    const bisher = router.onAfterRouteChanged;
    router.onAfterRouteChanged = async (to) => {
      await bisher?.(to);
      const sprache = sprachwahl(vorigerPfad, to);
      vorigerPfad = to;
      if (!sprache) return;
      try {
        window.localStorage.setItem(SPRACHE_SCHLUESSEL, sprache);
      } catch {
        // localStorage gesperrt (privater Modus): die Wahl gilt dann nur fuer diesen Besuch.
      }
    };
  },
};
