// Das Projekt gibt die Uebergaenge der Kette einzeln frei (Plan #1079, E1, E12; Issue #1087):
// die Lesart von `night.kette.uebergaenge` im selben Prozess.
//
// `night.kette.uebergaenge` traegt vier Schalter: `planReview`, `reviewPakete` und
// `paketeAbdeckung` (Vorgabe `true`) sowie `abdeckungUmsetzung` (ohne Vorgabe: Fehlt er,
// gilt das Verhalten von vor #1087 — Variante A endet `fertig`, Variante B setzt um;
// Issue #1105). Ein
// gesperrter Uebergang endet mit `lauf:wartet` und dem Wortlaut aus E1, die Kette mit dem
// Ausgang `unvollstaendig`. Gesperrt wird nur das AUTOMATISCHE Folgen: Ein neues
// `kit:night` setzt bei der ersten Stufe ohne Ergebnis an und laeuft dort los (#1086).
// `abdeckungUmsetzung` wirkt nur zusammen mit `kit:durchziehen` — das GO bleibt an der Karte.
//
// Wie die Kette an einem gesperrten Uebergang anhaelt, pruefen seit Issue #1229 die
// Ablauf-Pruefungen in test/ablauf-night-session-uebergaenge.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ladeKetteUebergaenge, KETTE_UEBERGAENGE_DEFAULTS } from "../kit/night/session.mjs";

test("[night-uebergaenge] ladeKetteUebergaenge: ohne Feld die Vorgabe, abdeckungUmsetzung nicht gesetzt", () => {
  assert.deepEqual(ladeKetteUebergaenge({}), { planReview: true, reviewPakete: true, paketeAbdeckung: true, abdeckungUmsetzung: null });
  assert.deepEqual(ladeKetteUebergaenge({ night: { kette: {} } }), KETTE_UEBERGAENGE_DEFAULTS);
  assert.deepEqual(ladeKetteUebergaenge({ night: { kette: { uebergaenge: { planReview: false, abdeckungUmsetzung: true } } } }),
    { planReview: false, reviewPakete: true, paketeAbdeckung: true, abdeckungUmsetzung: true });
});

test("[night-uebergaenge] ladeKetteUebergaenge: ein Schalter, der kein Wahrheitswert ist, wirft mit Feldnamen", () => {
  assert.throws(() => ladeKetteUebergaenge({ night: { kette: { uebergaenge: { reviewPakete: "ja" } } } }), /night\.kette\.uebergaenge\.reviewPakete/);
  assert.throws(() => ladeKetteUebergaenge({ night: { kette: { uebergaenge: { planPakete: true } } } }), /night\.kette\.uebergaenge\.planPakete/);
  assert.throws(() => ladeKetteUebergaenge({ night: { kette: { uebergaenge: true } } }), /night\.kette\.uebergaenge/);
});
