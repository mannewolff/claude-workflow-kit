/**
 * preise.mjs — Preise je Modell und Million Token (Issue #734)
 *
 * STAND DER TABELLE: 2026-09-18. Dieses Datum ist der Kern der Datei. Preise
 * aendern sich, Modelle kommen dazu; eine Tabelle ohne Stand behauptet eine
 * Aktualitaet, die sie nicht hat.
 *
 * Wozu: Das Sitzungsprotokoll von Claude Code fuehrt keinen Dollarbetrag — nur
 * Tokenmengen (geprueft am 2026-09-18 ueber alle Protokolle dieses Projekts: kein
 * einziges Feld mit 'cost' im Namen). Der Sitzungs-Melder in board.mjs rechnet den
 * Betrag deshalb aus den Mengen. Das ist die Antwort auf E20 des Plans
 * mannewolff/kanban-kit#1007: "rechnen", nicht "durchreichen".
 *
 * Herkunft der Zahlen: die Modell-Registry von Claude Code selbst, gelesen aus dem
 * ausgelieferten Binary (Fassung 2.1.236). Sie ist dieselbe Quelle, aus der die CLI
 * ihr eigenes `total_cost_usd` rechnet — damit stimmt der hier gerechnete Betrag
 * einer interaktiven Sitzung mit dem ueberein, den der Nacht-Runner durchreicht.
 * Nachlesbar mit:
 *
 *     LC_ALL=C grep -a -o -E 'tier_3_15:\{[^}]*\}' "$(readlink -f "$(which claude)")"
 *
 * PFLEGELAST: Diese Datei veraltet von allein. Ein Modell ohne Eintrag fuehrt zu
 * KEINEM Betrag (nie zu 0 und nie zu einem geratenen) — der Verbrauch in Token wird
 * trotzdem gemeldet. Wer einen fehlenden Betrag im Leitstand sieht, traegt das
 * Modell hier nach und setzt STAND neu. Die Pflicht steht in docs/ und in der
 * Nutzerdokumentation des Kits.
 *
 * Preise in US-Dollar je 1.000.000 Token.
 */

export const KIT_VERSION = "1.53.6";

/** Der Tag, an dem die Tabelle zuletzt gegen die Quelle gehalten wurde. */
export const PREISE_STAND = "2026-09-18";

/**
 * Die Preisstufen. Ein Modell bekommt keinen eigenen Satz Zahlen, sondern eine
 * Stufe — genauso fuehrt die Registry es, und so bleibt ein neues Modell derselben
 * Stufe eine einzige Zeile weiter unten.
 *
 * Vier Mengen, weil das Protokoll vier fuehrt. `cacheSchreiben5m` und
 * `cacheSchreiben1h` sind getrennt: Der Stunden-Zwischenspeicher kostet das Doppelte
 * der Eingabe, der Fuenf-Minuten-Speicher das 1,25-fache. Beide in einen Satz zu
 * werfen verfehlte den Betrag um bis zu 60 Prozent — und Claude Code faehrt fuer
 * lange Sitzungen den Stunden-Speicher.
 */
export const PREIS_STUFEN = {
  haiku_35:    { eingabe: 0.8, ausgabe: 4,  cacheSchreiben5m: 1,     cacheSchreiben1h: 1.6, cacheLesen: 0.08 },
  haiku_45:    { eingabe: 1,   ausgabe: 5,  cacheSchreiben5m: 1.25,  cacheSchreiben1h: 2,   cacheLesen: 0.1 },
  tier_3_15:   { eingabe: 3,   ausgabe: 15, cacheSchreiben5m: 3.75,  cacheSchreiben1h: 6,   cacheLesen: 0.3 },
  tier_5_25:   { eingabe: 5,   ausgabe: 25, cacheSchreiben5m: 6.25,  cacheSchreiben1h: 10,  cacheLesen: 0.5 },
  tier_10_50:  { eingabe: 10,  ausgabe: 50, cacheSchreiben5m: 12.5,  cacheSchreiben1h: 20,  cacheLesen: 1 },
  tier_15_75:  { eingabe: 15,  ausgabe: 75, cacheSchreiben5m: 18.75, cacheSchreiben1h: 30,  cacheLesen: 1.5 },
};

/**
 * Modell-Kennung aus dem Protokoll auf eine Preisstufe.
 *
 * Beide Schreibweisen stehen drin — die kurze Kennung und die datierte
 * `first_party`-Kennung —, weil das Protokoll mal die eine, mal die andere fuehrt
 * (`claude-haiku-4-5-20251001` neben `claude-sonnet-5`). Eine Normalisierung per
 * Praefix waere geraten: `claude-opus-4-1` und `claude-opus-4-5` liegen in
 * verschiedenen Stufen, obwohl die eine Kennung Praefix der anderen ist.
 *
 * Nicht enthalten und damit ohne Betrag: `<synthetic>` (Claude Codes eigene
 * Platzhalter-Nachrichten, immer mit null Token) und fremde Modelle hinter einem
 * Reviewer-Kommando, etwa `qwen-kit`. Beides ist richtig so — fuer sie kennt diese
 * Datei keinen Preis.
 */
export const MODELL_STUFEN = {
  "claude-3-5-haiku": "haiku_35",
  "claude-3-5-haiku-20241022": "haiku_35",
  "claude-haiku-4-5": "haiku_45",
  "claude-haiku-4-5-20251001": "haiku_45",
  "claude-3-5-sonnet": "tier_3_15",
  "claude-3-5-sonnet-20241022": "tier_3_15",
  "claude-3-7-sonnet": "tier_3_15",
  "claude-3-7-sonnet-20250219": "tier_3_15",
  "claude-sonnet-4-0": "tier_3_15",
  "claude-sonnet-4-20250514": "tier_3_15",
  "claude-sonnet-4-5": "tier_3_15",
  "claude-sonnet-4-5-20250929": "tier_3_15",
  "claude-sonnet-4-6": "tier_3_15",
  "claude-sonnet-5": "tier_3_15",
  "claude-opus-4-0": "tier_15_75",
  "claude-opus-4-20250514": "tier_15_75",
  "claude-opus-4-1": "tier_15_75",
  "claude-opus-4-1-20250805": "tier_15_75",
  "claude-opus-4-5": "tier_5_25",
  "claude-opus-4-5-20251101": "tier_5_25",
  "claude-opus-4-6": "tier_5_25",
  "claude-opus-4-7": "tier_5_25",
  "claude-opus-4-8": "tier_5_25",
  "claude-opus-5": "tier_5_25",
  "claude-fable-5": "tier_10_50",
  "claude-mythos-5": "tier_10_50",
};

/**
 * Der Preissatz eines Modells, oder `null`, wenn die Tabelle es nicht kennt.
 *
 * `null` ist die Antwort, nicht ein Ersatzwert: Ein geratener Satz erzeugte einen
 * Betrag, der aussieht wie gemessen. Der Aufrufer macht daraus einen fehlenden
 * Betrag — siehe `sitzungKosten` in board.mjs.
 */
export function preisFuer(modell) {
  const stufe = MODELL_STUFEN[modell];
  return stufe ? PREIS_STUFEN[stufe] : null;
}
