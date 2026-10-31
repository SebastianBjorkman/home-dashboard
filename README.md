# Home Dashboard

Familjens vardag på en skärm, som ett tillägg (add-on) i Home Assistant:
skolschema, skolmat, nedräkning till lovet, kalendrar och hemmets sensorer –
med en egen vy för barnen.

## Installera i Home Assistant

1. **Inställningar → Tillägg → Tilläggsbutik → ⋮ → Förråd** och lägg till
   `https://github.com/SebastianBjorkman/home-dashboard`
2. Installera **Home Dashboard**, fyll i barn och skola (se [DOCS](home_dashboard/DOCS.md)) och starta.
3. Slå på **Visa i sidofältet**. Dashboarden heter *Hemma*.
4. Välj rum, enheter och kalendrar under **Inställningar** i dashboarden.

Nya versioner dyker upp i tilläggsbutiken och installeras med **Uppdatera**.

## Moduler

| Modul | Källa | Status |
|---|---|---|
| Skolschema | Skola24:s öppna schemavisning (klasschema, valfri halvklass) | ✅ |
| Skolmat | Kommunens matsedelssidor (Sitevision) | ✅ |
| Nedräkning | "Sovningar kvar" till nästa lov | ✅ |
| Kalender | Kalendrar i Home Assistant (M365, Google, ICS …) | ✅ |
| Hemmet | Valfria sensorer/enheter från Home Assistant | ✅ |
| Barnets rum | Barnets område i HA plus valfria enheter, tänd och släck med ett tryck | ✅ |
| Lämning & hämtning | Vem lämnar och hämtar | Planerad |
| Aktiviteter, sysslor, inköpslista | Familjens egna listor | Planerad |
| Notiser | Via Home Assistants notify-tjänster | Planerad |
| Fler skolplattformar | Skolmaten.se, SchoolSoft m.fl. | Planerad |

## Säkerhet och integritet

- **Nås bara via Home Assistant Ingress.** HA sköter inloggningen; ingen port öppnas
  och servern vägrar alla anrop som inte kommer från Ingress-proxyn.
- **Roller:** användare som är kopplade till ett barn ser bara barnvyn med sitt eget
  schema. Kalendrar och enheter visas bara för vuxna.
- **Varje hushåll kör sin egen kopia.** Inga data lämnar hemmet utöver hämtningen
  från Skola24 och kommunens webbplats; ingen central tjänst lagrar något.
- **Styrning med tydliga gränser:** den enda skrivvägen slår av/på en enhet som
  finns i inställningarna. Barn styr bara sina egna enheter, och anropet kräver
  dashboardens egen header från samma ursprung och begränsas per användare.
- **Läsbara källor, inga beroenden:** ren Node.js utan npm-paket, strikt CSP.
- Lärares initialer från Skola24 sparas eller visas inte.

## Utveckla lokalt

```bash
cd home_dashboard/app
cp dev/options.example.json dev/options.json
npm test
npm run dev   # http://127.0.0.1:8099 – ?view=kid för barnvyn
```

I utvecklingsläget lyssnar servern bara på 127.0.0.1. För att prova enheter utan
riktig HA finns en låtsas-HA:

```bash
npm run dev:ha    # i ett eget fönster
HD_HA_URL=http://127.0.0.1:8123 SUPERVISOR_TOKEN=dev npm run dev
```

Mot en riktig HA: sätt `HD_HA_URL=http://homeassistant.local:8123/api` och
`SUPERVISOR_TOKEN` till en långlivad token.

## Licens

MIT
