# Playground Atlas

Spielplätze entdecken, Besuche mit Datum und Uhrzeit festhalten und eine gemeinsame Bewertung pro Spot abgeben. Statische Website für **GitHub Pages**, OpenStreetMap als Datenquelle und eine **Supabase-Free-Datenbank** für gemeinsame Einträge. Kein Login und keine individuellen Bewertungen.

## Funktionen

- Interaktive Karte mit Spielplätzen und optional Fitness-/Calisthenics-Spots aus OpenStreetMap.
- Ortssuche, Standortsuche auf Knopfdruck und Suche im aktuellen Kartenausschnitt.
- Besuche mit aktueller oder nachgetragener Uhrzeit. Speicherung als UTC, Anzeige in der lokalen Gerätezeitzone.
- Genau eine gemeinsame Bewertung je Spielplatz: **Variety**, **Climbability**, **Pull ups possibility**, jeweils ganzzahlig **0 bis 10**. Gesamtscore = Mittelwert. 0 ist eine gültige Bewertung.
- Filter, Sortierung und eine gemeinsame Sammlung unabhängig vom aktuellen Kartenausschnitt.
- Google-Maps-Button öffnet die exakten Koordinaten, ohne Google-API-Key.
- JSON-Export des zuletzt geladenen Datenbestands als Sicherung.
- Responsive Ansicht für Desktop und Smartphone, Tastaturbedienung und reduzierte Animationen.

## Kostenlos einrichten

### 1. Supabase-Projekt anlegen

1. Unter [supabase.com/dashboard](https://supabase.com/dashboard) ein Konto und ein Projekt im **Free-Tarif** erstellen, vorzugsweise mit EU-Region.
2. Im Projekt **SQL Editor → New query** öffnen.
3. Den gesamten Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen und ausführen. Das Skript kann erneut ausgeführt werden, ohne Einträge zu löschen.
4. Unter **Project Settings → API Keys** die **Projekt-URL** und einen **Publishable key** (`sb_publishable_…`) kopieren. Ein bisheriger `anon`-Key funktioniert ebenfalls.

**Keinen Secret-/Service-Role-Key verwenden.** Der Publishable-Key ist für den öffentlichen Browserzugriff vorgesehen. Schreibvorgänge sind auf zwei Datenbankfunktionen beschränkt. Direkte Tabellenänderungen und Löschen von Besuchen sind für Besucher gesperrt.

### 2. GitHub Pages konfigurieren

1. Änderungen auf den Branch `main` dieses Repositories pushen.
2. Im Repository **Settings → Secrets and variables → Actions → Variables** zwei Repository-Variablen setzen:

   | Name | Wert |
   | --- | --- |
   | `SUPABASE_URL` | Projekt-URL, z. B. `https://PROJECT.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | Öffentlicher Publishable- oder Anon-Key |

3. Unter **Settings → Pages → Build and deployment → Source** **GitHub Actions** auswählen.
4. Unter **Actions → Publish Playground Atlas → Run workflow** ausführen. Weitere Pushes auf `main` veröffentlichen automatisch.
5. Der Workflow zeigt die tatsächliche Seiten-URL an. Für dieses Repository ist die erwartete Projektadresse `https://p-ael.github.io/Playgrounds/`.

Die Seite funktioniert unter dem Repository-Unterpfad. Es gibt keinen Build-Service, keine Laufzeit-Abhängigkeiten und keinen Node-Server im Hosting.

### 3. Auf zwei Geräten prüfen

Auf Gerät A einen Spot öffnen, einen Besuch und eine Bewertung speichern. Auf Gerät B dieselbe Seite öffnen. Beides muss sichtbar sein. Änderungen werden beim Öffnen, bei Rückkehr zum Tab, einmal pro Minute im sichtbaren Tab und manuell über den Speicherstatus → **Gemeinsame Daten aktualisieren** geladen. Bei parallelen Änderungen gilt die zuletzt gespeicherte Bewertung; Besuche bleiben einzelne Datensätze.

Ohne Supabase-Konfiguration ist die Karte bereits nutzbar. Speichern bleibt erkennbar deaktiviert und wird **nicht heimlich lokal ersetzt**. Bei einem Verbindungsfehler bestätigt die App keinen erfolgreichen Speichervorgang. Bereits geladene Daten bleiben sichtbar.

## Kosten und gemeinsamer Zugriff

- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) kann für ein öffentliches Repository im kostenlosen GitHub-Tarif verwendet werden.
- [Supabase Free](https://supabase.com/pricing) umfasst derzeit 500 MB Datenbank. Für eine kleine Sammlung reicht das voraussichtlich aus. Es wird kein kostenpflichtiger Tarif vorausgesetzt.
- Free-Projekte können nach ungefähr einer Woche ohne ausreichende Aktivität pausieren. Ein pausiertes Projekt muss im Dashboard über **Resume/Restore** reaktiviert werden; ein Website-Schreibzugriff startet es nicht automatisch. [Dokumentation](https://supabase.com/docs/guides/platform/free-project-pausing).
- Ohne Login können alle Besucher die gemeinsame Bewertung ändern und Besuche hinzufügen. Auch die Besuchszeiten sind öffentlich lesbar. Es werden keine persönlichen Profile, Gerätenamen oder Standortverläufe gespeichert. Ein privates GitHub-Repository allein macht eine GitHub Page nicht privat.
- Datenbankprüfungen begrenzen gültige Werte und sperren direkte Tabellen-Schreibzugriffe. Die öffentlichen Schreibfunktionen verhindern keinen Spam. Für größere öffentliche Nutzung sollten Zugriffskontrolle oder Rate Limits ergänzt werden.

## Lokal starten

Voraussetzung: Node.js 22 oder neuer. Keine Paketinstallation nötig.

```sh
npm run dev
```

Adresse: `http://127.0.0.1:4173`. Für lokale gemeinsame Speicherung die öffentlichen Supabase-Werte in `config.js` eintragen. Alternativ einen Build mit den Umgebungsvariablen `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY` erstellen und `dist/` mit einem statischen Webserver öffnen.

```sh
npm test
npm run build
```

Der Build schreibt nur Website-Dateien nach `dist/`; Datenbankschema, Tests und Git-Dateien werden nicht veröffentlicht. Geheime Supabase-Schlüssel werden vom Build abgewiesen.

## Datenquellen und Grenzen

Overpass liefert `leisure=playground` sowie optional `leisure=fitness_station`. Primär wird der [Dresel-Mirror](https://ovp.dresel.systems/en/) für Europa/Nordamerika genutzt; bei Ausfall oder leerem Ergebnis wird die globale FOSSGIS-Instanz versucht. Kein vollständiger weltweiter Abruf und keine Vollständigkeitsgarantie. Suche nur im sichtbaren Bereich (max. 650 km², höchstens 35 km je Seite). Ziehen/Zoomen löst keine Spielplatzsuche aus; dafür **Diesen Bereich durchsuchen** verwenden. Ortsnamen werden nur beim Absenden an Nominatim geschickt, ohne Autocomplete. Der letzte OSM-Suchbereich wird 24 Stunden lokal zwischengespeichert; Bewertungen und Besuche kommen aus der gemeinsamen Datenbank.

Öffentliche OSM-/Overpass-/Nominatim-Dienste sind für geringe Nutzung gedacht und können ausfallen oder begrenzen. Für größere Nutzung geeignete eigene/gehostete Dienste über `config.js` konfigurieren. Keine Offline-Kacheldownloads oder Vorabdownloads. OSM-Attribution bleibt sichtbar; der Browser sendet seinen normalen Referer. Hinweise: [Tiles](https://operations.osmfoundation.org/policies/tiles/), [Nominatim](https://operations.osmfoundation.org/policies/nominatim/), [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API).

Google Maps wird nur über den Standort-Link geöffnet. Keine Google-Ortsdaten werden gescrapt oder gespeichert. [Google-Richtlinie](https://developers.google.com/maps/documentation/places/web-service/policies).

Leaflet 1.9.4 und MarkerCluster 1.5.3 liegen lokal in `assets/`; Lizenzen: [`assets/LEAFLET-LICENSE`](assets/LEAFLET-LICENSE), [`assets/MARKERCLUSTER-LICENSE`](assets/MARKERCLUSTER-LICENSE). Nahe Kartenpunkte werden gruppiert und beim Vergrößern getrennt. Keine externen Schriftarten oder Analyse-Tracker.
