# Einrichtung Referenz-Editor (Supabase)

Kurzleitfaden für den Betreiber im Supabase-Dashboard. Es werden keine
Schlüsselwerte in diesem Dokument genannt.

## Voraussetzung

Im selben Supabase-Projekt wurde bereits das Setup der Blockschaltbild-App
ausgeführt (Tabellen `profiles`, `projects`, Funktionen `public.is_admin()`,
`public.is_active()`, `public.touch_updated_at()`).

## Schritte

1. **Datenbank einrichten**
   Öffne im Supabase-Dashboard den SQL Editor, lade die Datei
   `supabase/referenz_setup.sql` und führe sie aus. Das Skript ist wiederholbar.

2. **Edge Function anlegen**
   Dashboard > Edge Functions > Create via Editor.
   - Name exakt: `referenz-ki`
   - Code aus `supabase/functions/referenz-ki/index.ts` einfügen und speichern.
   - Option "Verify JWT" **AN** lassen (die Function prüft zusätzlich selbst
     den Zugang des Nutzers gegen die Tabelle `profiles`).

3. **Secret setzen**
   Dashboard > Edge Functions > Secrets: lege das Secret `ABACUS_API_KEY` mit
   dem Abacus-Zugangsschlüssel an. Ohne dieses Secret meldet die Function beim
   Aufruf von `action: "analyze"`, dass kein Schlüssel gefunden wurde.

4. **Redirect-URL ergänzen**
   Dashboard > Authentication > URL Configuration: trage die Redirect-URL der
   neuen Seite ein:
   `https://blockschaltbild.github.io/Referenzeditor/`
   Falls die Blockschaltbild-App weiter genutzt wird, die dort bereits
   vorhandenen Einträge (z. B. `https://blockschaltbild.github.io/`)
   **behalten**.

5. **Anmeldung beachten**
   Die Anmeldedaten (E-Mail und Passwort) sind dieselben wie in der
   Blockschaltbild-App, da dasselbe Auth-Projekt verwendet wird. Der
   Login-Status wird jedoch pro Adresse (URL) getrennt gespeichert: Man muss
   sich also einmal in der Blockschaltbild-App und einmal im Referenz-Editor
   anmelden.
