# Home Dashboard

## Kom igång

1. Starta tillägget och slå på **Visa i sidofältet**. Dashboarden heter **Hemma**.
2. Öppna **Hemma** och klicka på **Inställningar** uppe till höger (syns bara för vuxna).
3. Fyll i och klicka **Spara**. Ändringar syns direkt, utan omstart.

Inget behöver ställas in på tilläggets flik Konfiguration.

## Inställningssidan

### Barn

Klicka **Lägg till barn** för varje barn.

- **Namn** – visas i dashboarden.
- **Barnets konto i Home Assistant** – välj barnets person. När barnet loggar in med
  sitt konto visas bara barnvyn med hens eget schema, och hen kan bara styra sina egna
  lampor. Skapa kontot under **Inställningar → Personer** (inte administratör).
- **Skola** – öppna schemat i Skola24, kopiera adressen och klistra in den under
  **Schemalänk**. Kommun och skola fylls i; välj sedan **Klass** och vid behov
  **Halvklass** i listorna. Fungerar för skolor som visar klasscheman utan inloggning.
- **Matsedel** – länken till kommunens matsedelssida för köket som lagar skolans mat.
  Klicka **Testa** för att se att den går att läsa.
- **Rum och lampor** – välj barnets rum (ett område i Home Assistant). Rummets lampor,
  strömbrytare, fläktar och temperatursensorer visas med kryssrutor; bocka ur det
  barnet inte ska se eller styra. Under **Fler enheter** söker du fram t.ex. hallampan.

Lägger du till en ny lampa i rummet i Home Assistant dyker den upp inom fem minuter.
Bocka ur den om barnet inte ska styra den.

### Lov

Första lovdagen för nedräkningen "sovningar kvar". Datumen finns under läsårstider
på kommunens webbplats.

### Familjevyn

Enheter och kalendrar som bara vuxna ser. Lägg först till din M365-, Google- eller
ICS-kalender i Home Assistant, så går den att välja här.

## Tilläggets konfiguration (valfri)

Fliken Konfiguration används bara tills inställningssidan har sparats första gången.
Fälten heter samma sak som ovan (`children` med `name`, `skola24_host`,
`skola24_unit`, `skola24_class`, `skola24_group`, `school_menu_url`, `area`,
`entities`, `exclude`, samt `calendars`, `entities` och `holidays`).

## Felsökning

Fliken **Logg** på tillägget visar vid start om Home Assistant är ansluten.
Står det "ingen token", starta om tillägget och kontrollera att versionen är 0.4.0 eller senare.

Inställningarna sparas i tilläggets egen datamapp och följer med i Home Assistants säkerhetskopior.
