# Home Dashboard

## Rum och enheter – enklast i dashboarden

Öppna **Hemma** i sidofältet och klicka på **Inställningar** (bara vuxna ser den).
Där väljer du:

- **Rum** för varje barn i en lista över områdena i Home Assistant. Rummets lampor,
  strömbrytare, fläktar och temperatursensorer visas med kryssrutor – bocka ur det
  barnet inte ska se eller styra.
- **Fler enheter** för barnet, t.ex. hallampan, genom att söka på namnet.
- **Enheter och kalendrar** i familjevyn.

Klicka **Spara**. Ändringen syns direkt, utan omstart. Det du väljer här gäller
före motsvarande fält i tilläggets inställningar nedan.

## Tilläggets inställningar

### children

Ett block per barn.

| Fält | Exempel | Beskrivning |
|---|---|---|
| `name` | `Alva` | Visas i dashboarden |
| `ha_user` | `alva` | Barnets **användarnamn** i Home Assistant. Den användaren ser bara barnvyn med sitt eget schema. Lämna tomt om barnet inte har ett eget konto. |
| `skola24_host` | `kommun.skola24.se` | Kommunens Skola24-adress (står i schemalänken) |
| `skola24_unit` | `Skolan` | Skolans namn exakt som i Skola24 |
| `skola24_class` | `2B` | Klassen |
| `skola24_group` | `2B:1` | Valfritt. Visar bara den halvklassen när klassen delas |
| `school_menu_url` | `https://kommun.se/…/skolkoket.html` | Matsedelssidan för köket som lagar skolans mat |
| `area` | `Alvas rum` | Valfritt. Barnets rum, alltså ett område i Home Assistant. Lampor, strömbrytare, fläktar, `input_boolean` och temperatur-/fuktsensorer i rummet visas automatiskt under "Mitt rum". |
| `entities` | `- light.hallen` | Valfritt. Fler enheter, t.ex. utanför rummet. Visas under "Annat". |
| `exclude` | `- switch.laddare` | Valfritt. Enheter i rummet som barnet inte ska se eller kunna styra. |

Lampor, strömbrytare, fläktar och `input_boolean` slås av och på med ett tryck.
Barnet kan bara styra det som visas i hens vy: rummet plus `entities`, minus `exclude`.

Exempel:

```yaml
children:
  - name: Alva
    ha_user: alva
    area: Alvas rum
    entities:
      - light.hallen
    exclude:
      - switch.alva_laddare
```

Områdets namn står under **Inställningar → Områden, etiketter och zoner**.
Entitets-id hittar du under **Inställningar → Enheter och tjänster → Entiteter**.

Lägger du till en ny lampa i rummet i Home Assistant dyker den upp inom fem minuter.
Kontrollera då att den inte är något barnet inte borde styra; lägg den i `exclude` i så fall.

Skolschemat fungerar för skolor som visar klasscheman utan inloggning i
Skola24:s schemavisare. Öppna
`https://web.skola24.se/timetable/timetable-viewer/<kommun>.skola24.se/<Skola>/`
och se om klassen går att välja.

### calendars

Kalenderentiteter som visas för vuxna, t.ex. `calendar.familj`. Lägg först till
din M365-, Google- eller ICS-kalender i Home Assistant.

### entities

Sensorer och enheter som visas för vuxna, t.ex. `sensor.utetemperatur`.

### holidays

Lov för nedräkningen. `start` är första lovdagen, `ÅÅÅÅ-MM-DD`. Hämta datumen
från kommunens läsårstider.

## Felsökning

Fliken **Logg** på tillägget visar vid start om Home Assistant är ansluten.
Står det "ingen token", starta om tillägget och kontrollera att det är version 0.4.0 eller senare.

## Ett konto för barnet

Skapa en vanlig användare (inte administratör) under **Inställningar → Personer**
och ange användarnamnet i `ha_user`. Logga in med det kontot på barnets platta.
