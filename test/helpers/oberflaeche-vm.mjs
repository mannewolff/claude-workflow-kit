// Ein VM-Testrahmen mit Fake-DOM fuer das Browser-Skript der Einstellungs-Oberflaeche
// (Issue #814). Er fuehrt die verketteten SEITEN_BAUSTEINE in node:vm aus, reicht fetch
// an den echten Testserver weiter, fuehrt setTimeout von Hand und bildet vom DOM genau
// so viel nach, wie die Oberflaeche benutzt: Baum, Klassen, Eingabewerte, Fokus samt
// Auswahl und replaceChildren. Keine DOM-Bibliothek — das Kit kommt ohne
// Laufzeitabhaengigkeiten aus (Plan #721 E11), und ein Zustandsfehler der Oberflaeche
// ist ohne ausfuehrbaren Test nicht zu belegen.

import { runInNewContext } from "node:vm";

import { SEITEN_BAUSTEINE } from "../../kit/einstellungen.mjs";

class TextKnoten {
  constructor(text) { this.text = String(text); }
}

/** Eingabetypen mit Cursor — wie im Browser hat ein number- oder date-Feld keinen. */
const TEXT_TYPEN = new Set(["", "text", "search", "url", "tel", "password"]);

class Element {
  constructor(tag, dokument) {
    this.tagName = tag.toUpperCase();
    // Rueckverweise nicht enumerierbar: Ein Element in einer Assertion-Ausgabe zoege sonst
    // ueber dokument -> body den ganzen Baum je Knoten noch einmal in die Serialisierung.
    Object.defineProperty(this, "dokument", { value: dokument, writable: true });
    Object.defineProperty(this, "eltern", { value: null, writable: true });
    this.children = [];
    this.className = "";
    this.attribute = {};
    this.dataset = {};
    this.style = {};
    this.hoerer = {};
    this.type = "";
    this.disabled = false;
    this.checked = false;
    this.selected = false;
    this.open = false;
    this.title = "";
    this.placeholder = "";
    this._wert = undefined;
    this.selectionStart = null;
    this.selectionEnd = null;
  }

  istTextfeld() { return this.tagName === "TEXTAREA" || (this.tagName === "INPUT" && TEXT_TYPEN.has(this.type)); }

  optionen() { return this.children.filter((k) => k instanceof Element && k.tagName === "OPTION"); }

  get selectedIndex() {
    const optionen = this.optionen();
    const i = optionen.findIndex((o) => o.selected);
    if (i >= 0) return i;
    return optionen.length > 0 ? 0 : -1;
  }

  set selectedIndex(i) { this.optionen().forEach((o, j) => { o.selected = j === i; }); }

  get value() {
    if (this.tagName === "OPTION") return this._wert === undefined ? this.textContent : this._wert;
    if (this.tagName === "SELECT") {
      const gewaehlt = this.optionen()[this.selectedIndex];
      return gewaehlt === undefined ? "" : gewaehlt.value;
    }
    return this._wert === undefined ? "" : this._wert;
  }

  set value(wert) {
    if (this.tagName === "SELECT") {
      for (const o of this.optionen()) o.selected = o.value === String(wert);
      return;
    }
    this._wert = String(wert);
    if (this.istTextfeld()) {
      this.selectionStart = this._wert.length;
      this.selectionEnd = this._wert.length;
    }
  }

  get textContent() {
    let text = "";
    for (const kind of this.children) text += kind instanceof Element ? kind.textContent : kind.text;
    return text;
  }

  set textContent(text) {
    this.loeseKinder();
    this.children = String(text) === "" ? [] : [new TextKnoten(text)];
  }

  append(...kinder) {
    for (const kind of kinder) {
      if (kind instanceof Element) {
        kind.eltern = this;
        this.children.push(kind);
      } else if (kind instanceof TextKnoten) {
        this.children.push(kind);
      } else {
        this.children.push(new TextKnoten(kind));
      }
    }
  }

  /** Wie im Browser: Verliert ein fokussierter Knoten seinen Platz im Baum, faellt der Fokus auf body. */
  loeseKinder() {
    for (const kind of this.children) {
      if (kind instanceof Element) {
        kind.eltern = null;
        if (enthaelt(kind, this.dokument.activeElement)) this.dokument.activeElement = this.dokument.body;
      }
    }
  }

  replaceChildren(...kinder) {
    this.loeseKinder();
    this.children = [];
    this.append(...kinder);
  }

  klassen() { return this.className.split(/\s+/).filter(Boolean); }

  get classList() {
    const self = this;
    return {
      add(...namen) {
        const k = self.klassen();
        for (const name of namen) if (!k.includes(name)) k.push(name);
        self.className = k.join(" ");
      },
      toggle(name, an) {
        const k = self.klassen();
        const drin = k.includes(name);
        const soll = an === undefined ? !drin : Boolean(an);
        if (soll && !drin) k.push(name);
        if (!soll && drin) k.splice(k.indexOf(name), 1);
        self.className = k.join(" ");
        return soll;
      },
    };
  }

  setAttribute(name, wert) {
    if (name.startsWith("data-")) this.dataset[name.slice(5)] = String(wert);
    else this.attribute[name] = String(wert);
  }

  getAttribute(name) { return this.attribute[name] ?? null; }

  querySelectorAll(selektor) {
    const teile = selektor.split(",").map((t) => t.trim());
    const out = [];
    const lauf = (el) => {
      for (const kind of el.children) {
        if (!(kind instanceof Element)) continue;
        if (teile.some((t) => passt(kind, t))) out.push(kind);
        lauf(kind);
      }
    };
    lauf(this);
    return out;
  }

  querySelector(selektor) { return this.querySelectorAll(selektor)[0] ?? null; }

  focus() { this.dokument.activeElement = this; }

  setSelectionRange(anfang, ende) {
    if (!this.istTextfeld()) throw new Error(`setSelectionRange: ${this.tagName}[type=${this.type}] hat keinen Cursor`);
    this.selectionStart = anfang;
    this.selectionEnd = ende;
  }

  addEventListener(typ, fn) { (this.hoerer[typ] ??= []).push(fn); }

  ausloesen(typ, eigenschaften = {}) {
    for (const fn of this.hoerer[typ] ?? []) fn({ type: typ, target: this, preventDefault() {}, ...eigenschaften });
  }

  showModal() { this.open = true; }

  close() { this.open = false; }
}

function enthaelt(el, ziel) {
  if (el === ziel) return true;
  return el.children.some((kind) => kind instanceof Element && enthaelt(kind, ziel));
}

/** Ein einfacher Selektor: Tagname, Klassen und Attribut-Praesenz, kombinierbar. */
function passt(el, selektor) {
  const m = selektor.match(/^([a-z][a-z0-9]*)?((?:\.[\w-]+)*)((?:\[[\w-]+\])*)$/i);
  if (!m) throw new Error(`Selektor nicht unterstuetzt: ${selektor}`);
  const [, tag, klassenTeil, attributTeil] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  const klassen = (klassenTeil ?? "").split(".").filter(Boolean);
  if (!klassen.every((k) => el.klassen().includes(k))) return false;
  const attribute = [...(attributTeil ?? "").matchAll(/\[([\w-]+)\]/g)].map((t) => t[1]);
  return attribute.every((a) => (a.startsWith("data-") ? el.dataset[a.slice(5)] !== undefined : el.attribute[a] !== undefined));
}

class Dokument {
  constructor() {
    this.body = new Element("body", this);
    this.activeElement = this.body;
    this.ids = {};
  }

  createElement(tag) { return new Element(tag, this); }

  createTextNode(text) { return new TextKnoten(text); }

  getElementById(id) { return this.ids[id] ?? null; }
}

/** Alle Element-Nachfahren, die die Pruefung bestehen. */
function alle(wurzel, pruefung) {
  const out = [];
  const lauf = (el) => {
    for (const kind of el.children) {
      if (!(kind instanceof Element)) continue;
      if (pruefung(kind)) out.push(kind);
      lauf(kind);
    }
  };
  lauf(wurzel);
  return out;
}

/**
 * Fuehrt das Seitenskript gegen den Server unter `basis` aus und liefert die Handgriffe
 * der Tests: den Baum, die aufgezeichneten Anfragen, das Feuern der wartenden Timer und
 * das Warten auf offene Antworten. Die Seite hat beim Rueckgabezeitpunkt ihre Projektliste
 * geladen; ein Projekt oeffnen die Tests selbst per Klick.
 */
export async function oberflaecheStarten({ basis, token }) {
  const dokument = new Dokument();
  for (const id of ["stand", "projekte", "projektname", "themen", "meldungen", "einstellungen", "dialog"]) {
    const e = dokument.createElement(id === "dialog" ? "dialog" : "div");
    dokument.ids[id] = e;
    dokument.body.append(e);
  }

  const timer = new Map();
  let timerNr = 1;
  const anfragen = [];
  let offen = 0;

  const kontext = {
    document: dokument,
    location: { hash: `#token=${token}` },
    URLSearchParams,
    setTimeout: (fn, ms) => {
      const nr = timerNr++;
      timer.set(nr, { fn, ms });
      return nr;
    },
    clearTimeout: (nr) => { timer.delete(nr); },
    fetch: async (pfad, optionen = {}) => {
      anfragen.push({ pfad, methode: optionen.method ?? "GET", body: optionen.body ? JSON.parse(optionen.body) : null });
      offen += 1;
      try {
        const res = await fetch(`${basis}${pfad}`, optionen);
        const daten = await res.json().catch(() => null);
        return { status: res.status, json: async () => daten };
      } finally {
        offen -= 1;
      }
    },
  };

  const ruhe = async () => {
    let runden = 0;
    do {
      await new Promise((weiter) => setImmediate(weiter));
      if (++runden > 10_000) throw new Error("ruhe(): offene Anfragen kommen nicht zur Ruhe");
    } while (offen > 0);
    for (let i = 0; i < 5; i++) await new Promise((weiter) => setImmediate(weiter));
  };

  runInNewContext(Object.values(SEITEN_BAUSTEINE).join("\n"), kontext, { filename: "SEITEN_SKRIPT" });
  await ruhe();

  return {
    dokument,
    ids: dokument.ids,
    anfragen,
    ruhe,
    alle,
    /** Feuert alle wartenden Timer genau einmal und liefert ihre Zahl. */
    feuere() {
      const jetzt = [...timer.values()];
      timer.clear();
      for (const t of jetzt) t.fn();
      return jetzt.length;
    },
    wartend() { return timer.size; },
    klick(el) { el.ausloesen("click"); },
    /** Tippen wie ein Mensch: Fokus, Wert, Cursor, dann das input-Ereignis. */
    tippe(feld, wert, cursor) {
      feld.focus();
      feld.value = wert;
      if (cursor !== undefined) feld.setSelectionRange(cursor, cursor);
      feld.ausloesen("input");
    },
    knopf(wurzel, text) { return alle(wurzel, (e) => e.tagName === "BUTTON" && e.textContent === text)[0]; },
    projektKnopf(name) { return alle(dokument.ids.projekte, (e) => e.tagName === "BUTTON" && e.textContent.startsWith(name))[0]; },
    platten() { return dokument.ids.einstellungen.children.filter((k) => k instanceof Element && k.tagName === "SECTION"); },
  };
}
