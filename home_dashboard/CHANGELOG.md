# Changelog

## 0.2.0

- Each child can have their own devices (`entities` under the child). They show
  in the kid view under "Mina lampor" and in the child's card for parents.
- Lights, switches, fans and input_booleans can be switched on and off by tapping.
  A child can only switch their own devices; parents can switch every configured one.
- Write requests require the dashboard's own header and same-origin, and are rate limited.

## 0.1.0

- First version: family view and kid view inside Home Assistant (Ingress).
- Skola24 class timetable, with optional sub-group filter.
- School lunch menu from Sitevision municipality pages.
- Home Assistant calendars and entities for parents.
- Countdown to the next school holiday.
