# Home Dashboard

## Inställningar

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
| `entities` | `- light.alva_taklampa` | Valfritt. Barnets egna enheter, som visas under "Mina lampor". Lampor, strömbrytare, fläktar och `input_boolean` kan slås av och på med ett tryck. Barnet kan bara styra det som står här. |

Exempel med lampor:

```yaml
children:
  - name: Alva
    ha_user: alva
    entities:
      - light.alva_taklampa
      - light.alva_lavalampa
      - sensor.alva_rumstemperatur
```

Entitets-id hittar du under **Inställningar → Enheter och tjänster → Entiteter**.

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

## Ett konto för barnet

Skapa en vanlig användare (inte administratör) under **Inställningar → Personer**
och ange användarnamnet i `ha_user`. Logga in med det kontot på barnets platta.
