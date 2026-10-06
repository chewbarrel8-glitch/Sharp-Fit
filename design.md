# Design — Sharp Fit

A locked design system for the desktop training-plan application. Every UI
change follows this file so that planning, delivery and performance review stay
recognisably one product.

## Genre

Modern-minimal, technical and high-trust. The interface is deliberately calm:
training data and coach decisions lead; decoration never competes with either.

## Macrostructure family

- App pages: **Workbench** — a clear control strip, a compact visual summary,
  and progressive data panels for planning and review.
- Data-analysis pages: **Map / Diagram** — visible relationships between
  period, athlete, load, readiness and the selected time range.
- Reference/content pages: **Catalogue** — dense but scannable libraries and
  inventories with filters.

## Theme

- Paper: deep graphite, never pure black.
- Accent: electric lime, reserved for primary action, active state and planned
  progression.
- Data colours: blue = information, green = stable/complete, amber = review,
  red = attention. Colour always has a matching label or value.
- All runtime tokens live in `tokens.css`; legacy aliases remain in
  `src/css/style.css` for compatibility with existing view code.

## Typography

- Display/body: system UI with PingFang SC on Chinese systems.
- Mono/numbers: system monospace only for dense numeric contexts.
- Display is roman; no italic headings.
- Number displays use tabular figures where available.

## Spacing and components

- Four-point token scale, with 8/16/24/32 px the working rhythm.
- Cards have one purpose and one visual hierarchy; large analysis regions get
  more space than controls.
- Button voice: rounded-rectangle, compact by default, clear filled primary
  action. Icon-only actions need an accessible name.

## Motion

- Reveal: short opacity + transform only, never layout movement.
- Charts use restrained entrance/value transitions.
- Reduced-motion: opacity-only transitions no longer than 150 ms.

## Load-monitoring stance

- sRPE, CTL, ATL, TSB and ACWR are monitoring signals, not injury diagnoses.
- A completed session is required before it contributes to external-load
  summaries. Missing detailed sets may be transparently estimated from the
  completed plan.
- Personal load is the default unit of action; team totals support staffing and
  schedule review, never replace the individual view.
