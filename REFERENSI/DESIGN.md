---
name: Artisanal Street Bites
colors:
  surface: '#fff8f1'
  surface-dim: '#e0d9cf'
  surface-bright: '#fff8f1'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#faf2e9'
  surface-container: '#f5ede3'
  surface-container-high: '#efe7dd'
  surface-container-highest: '#e9e1d8'
  on-surface: '#1e1b15'
  on-surface-variant: '#5a4138'
  inverse-surface: '#33302a'
  inverse-on-surface: '#f7f0e6'
  outline: '#8e7166'
  outline-variant: '#e2bfb2'
  surface-tint: '#a73a00'
  primary: '#a33900'
  on-primary: '#ffffff'
  primary-container: '#cc4900'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb599'
  secondary: '#1f6c3a'
  on-secondary: '#ffffff'
  secondary-container: '#a4f1b2'
  on-secondary-container: '#24703e'
  tertiary: '#994100'
  on-tertiary: '#ffffff'
  tertiary-container: '#c05400'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbce'
  primary-fixed-dim: '#ffb599'
  on-primary-fixed: '#370e00'
  on-primary-fixed-variant: '#7f2b00'
  secondary-fixed: '#a6f4b5'
  secondary-fixed-dim: '#8bd79b'
  on-secondary-fixed: '#00210b'
  on-secondary-fixed-variant: '#005226'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#ffb690'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#783200'
  background: '#fff8f1'
  on-background: '#1e1b15'
  surface-variant: '#e9e1d8'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '800'
    lineHeight: 44px
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 34px
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 26px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '700'
    lineHeight: 20px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-desktop: 1.25rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system establishes a warm, appetizing, and lively mobile-first culinary experience tailored for modern artisanal street snack culture. The personality balances punchy Indonesian street-food conviviality with refined, clean digital ordering convenience.

### Visual Aesthetic & Movement
- **Style Blend:** Modern tactile minimalism combined with vibrant food-marketing high-contrast accents.
- **Atmosphere:** Sunlit, aromatic, and deeply welcoming. The palette draws on savory steamed dim sum, chili oil sheen, and iced refreshing fruit jellies.
- **Emotion:** Crave-inducing, upbeat, trustworthy, and frictionless.
- **Audience:** Gen-Z and young urban professionals ordering comfort street food on the go via mobile browsers and QR code scan-to-order touchpoints.

## Colors

The color palette directly references the warm amber-orange brand identity, steamed wooden baskets, and herbal tea-leaf accents:

- **Primary (`#EA580C`):** Rich steamed chili & burnt amber orange. Used for main action buttons, active tab indicators, price highlights, and hero badges.
- **Secondary (`#166534`):** Deep herbal basil green. Evokes freshness, natural garnish, lime sprigs, and successful order confirmations.
- **Tertiary (`#F97316`):** Bright zesty tangerine. Used for promo badges, limited-time banner backgrounds, and cart count bubbles.
- **Neutral Surface (`#FFF7ED` to `#FAFAF9`):** Warm milk-tea cream and soft bone white for clean, appetising backgrounds that prevent visual fatigue compared to stark sterile white.
- **Dark Neutral (`#1C1917`):** Charcoal roast black for ultra-crisp typographic contrast and legibility under direct sunlight.

## Typography

The type hierarchy is powered exclusively by **Plus Jakarta Sans**, offering geometric clarity, lively rounded aperture terminals, and regional Indonesian typographic resonance.

- **Headlines:** Set in Bold (`700`) and ExtraBold (`800`) weights to provide mouth-watering dish titles, energetic promotional callouts, and clean category separators.
- **Body:** Set with comfortable line-height to ensure ingredient breakdowns, chili spice levels, and order notes are effortlessly scanned.
- **Labels & Prices:** Set in Semibold (`600`) and ExtraBold (`800`), ensuring snack bundle prices (`Rp 16K`) and status tags stand out sharply on compact mobile viewports.

## Layout & Spacing

A compact, thumb-friendly mobile layout designed for agile ordering on smartphones while gracefully adapting to tablets and desktop screens.

### Grid & Canvas Structure
- **Mobile (<640px):** Single-column layout with fixed bottom navigation or sticky order summary bar. 16px (`1rem`) outer screen margin with 12px (`0.75rem`) card gutters.
- **Tablet (640px - 1024px):** 2-column card grid with side navigation sheet or sticky cart drawer.
- **Desktop (>1024px):** Centered max-width canvas constrained to 480px for a dedicated mobile web preview wrapper or an expanded 3-column split view (Categories | Menu Items | Order Cart).

### Vertical Rhythm
- Spacing strictly follows an 8pt-derived rhythm (`0.25rem`, `0.5rem`, `0.75rem`, `1rem`, `1.5rem`).
- Food cards feature compact vertical gaps (`space-md`) to ensure high snack discovery density above the fold.

## Elevation & Depth

This system avoids heavy drop shadows in favor of crisp, appetising tonal layering complemented by subtle warm-tinted ambient glows.

### Elevation Hierarchy
- **Level 0 (Canvas Base):** Warm neutral canvas (`#FFF7ED`).
- **Level 1 (Menu Cards & Containers):** Pure porcelain white (`#FFFFFF`) cards resting on the warm neutral canvas with a hairline warm outline (`rgba(234, 88, 12, 0.08)`) and an ultra-subtle ambient shadow (`0 2px 8px -2px rgba(120, 53, 15, 0.06)`).
- **Level 2 (Modals, Customization Sheets, Active Filters):** Floating white surfaces with soft, spread amber-tinted shadow (`0 10px 24px -4px rgba(120, 53, 15, 0.12)`).
- **Level 3 (Sticky Floating Action Cart & Checkout Bars):** Raised pill or docked bottom bar with pronounced soft shadow (`0 12px 32px -4px rgba(234, 88, 12, 0.25)`).

## Shapes

The geometry reflects warm steamed bamboo containers, plump dumplings, and smooth jelly drops. A roundedness index of `2` provides friendly curves across cards, while high-intent actionable items adopt pill-rounded geometries.

- **Cards & Banners:** `rounded-lg` (16px / `1rem`) for approachable, non-aggressive modular blocks.
- **Bottom Sheets & Drawer Modals:** `rounded-t-2xl` (24px) providing soft, physical drawer containment.
- **Pills, Badges & Interactive Buttons:** Fully rounded pill silhouettes (`rounded-full` / `9999px`) for quick-tap visual affordance.

## Components

### Buttons
- **Primary Action (Add to Cart / Order Now):** Vibrant burnt orange (`#EA580C`) background, white text (`#FFFFFF`), bold typography, pill-shaped (`rounded-full`), padded with `12px 24px`. Subtle active scale-down (`active:scale-95`).
- **Secondary Action (View Details / Bundling):** Light warm cream background (`#FFEDD5`), rich orange text (`#EA580C`), no border.
- **Herbaceous Accent Action (WhatsApp Order / Direct Chat):** Forest green (`#166534`) filled button with white iconography and copy.

### Food & Product Cards
- Porcelain white background with high-resolution top food thumbnail (aspect ratio 4:3 or 1:1), displaying steamed dim sum or jelly drinks.
- Price displayed in bold orange (`#EA580C`) typography (`headline-sm`).
- Quick-add circular button (`+`) nested in the bottom-right corner for rapid single-tap cart additions.

### Status Chips & Pills
- **"OPEN PRE ORDER":** Deep green border and fill tint (`#DCFCE7`), text in herbal green (`#166534`), uppercase, compact tracking.
- **Discount & Bundling Badges ("16K", "Best Seller"):** Filled burnt orange pill badge (`#EA580C`) overlaying food photography corners.

### Quantity Selectors & Customizers
- Stepper component with circular minus and plus controls enclosing a prominent quantity digit, encased in a light ivory track (`#FEE2E2` / `#FFEDD5`).

### Form Inputs & Order Notes
- Generous touch targets (48px minimum height), rounded rectangular containers (`rounded-lg`), subtle warm borders (`#FED7AA`), focusing into a solid burnt orange ring (`2px #EA580C`).