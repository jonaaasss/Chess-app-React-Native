@AGENTS.md
@PROJECT_CONTEXT.md
@STATUS.md

# Werkafspraken

- Antwoord in het Nederlands, maximaal 10 zinnen (code, tabellen, JSON en PGN tellen niet mee), in alinea's. Bij een oplossing: stappenplan.
- Maak geen aannames over setup of data: vraag bij onduidelijkheid.
- Stel wijzigingen eerst voor (oud/nieuw in een tabel) en wacht op akkoord, tenzij Jonas zegt dat het meteen mag.
- Zeg na elke wijziging wat Jonas moet doen: alleen import = oude opening verwijderen en opnieuw importeren; DEV-app = `r` in Metro; permanente app = `npm run android:permanent`. Nooit data wissen of de app verwijderen.
- Controleer met `npx tsc --noEmit` en `npx expo export --platform android`, daarna `rm -rf dist`. Ik kan niet op het toestel testen en zeg dat eerlijk.
- Commit en push alleen op verzoek.
- Gebruik geen bash-heredocs met backticks: schrijf scripts met de Write-tool.
- Lees bij het maken of importeren van openingen eerst `docs/IMPORT_REGELS.md`.
- Werk `STATUS.md` bij als Jonas dat vraagt (aan het eind van een chat).
