# Schriften der Einstellungs-Oberfläche

`kit/einstellungen.mjs` bettet diese Dateien als base64 ein (Plan #674 E12, Issue #678),
damit die Oberfläche ohne Netz die Schriften der „Kupferwarte" trägt.
`test/einstellungen-oberflaeche.test.mjs` hält die eingebetteten Daten gleich mit den
Dateien hier.

| Datei | Familie | Schnitt |
|-------|---------|---------|
| `ibm-plex-sans-latin-var.woff2` | IBM Plex Sans | variabel, Gewicht 400–600 |
| `ibm-plex-mono-latin-400.woff2` | IBM Plex Mono | 400 |
| `ibm-plex-mono-latin-500.woff2` | IBM Plex Mono | 500 |
| `ibm-plex-mono-latin-600.woff2` | IBM Plex Mono | 600 |
| `archivo-latin-var.woff2` | Archivo | variabel, Gewicht 400–800, Breite 100–125 % |

## Herkunft

Geladen am 2026-09-16 als fertige latin-Subsets von Google Fonts — die Dateien, die diese
CSS-Anfrage für einen aktuellen Browser nennt (Abschnitt `/* latin */`):

```
https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap
```

Die Lizenztexte stammen aus `github.com/google/fonts`, Ordner `ofl/archivo`, `ofl/ibmplexsans`
und `ofl/ibmplexmono`. Alle drei Familien stehen unter der SIL Open Font License 1.1
(`OFL-*.txt`).

## Austauschen

1. Die CSS-Anfrage oben mit einem Browser-User-Agent abrufen und die `latin`-Dateien laden.
2. Die Dateien hier unter denselben Namen ersetzen.
3. Die Konstante `SCHRIFTEN` in `kit/einstellungen.mjs` neu erzeugen — je Datei der base64-Inhalt.
4. `node --test test/einstellungen-oberflaeche.test.mjs` ausführen.
