---
name: Prometheus Modern
colors:
  surface: '#ffffff'
  surface-dim: '#f3f4f6'
  surface-bright: '#ffffff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f9fafb'
  surface-container: '#f3f4f6'
  surface-container-high: '#e5e7eb'
  surface-container-highest: '#d1d5db'
  on-surface: '#244855'
  on-surface-variant: '#874F41'
  inverse-surface: '#332f2c'
  inverse-on-surface: '#ffffff'
  outline: '#90AEAD'
  outline-variant: '#c1d5d4'
  surface-tint: '#244855'
  primary: '#244855'
  on-primary: '#ffffff'
  primary-container: '#1c3b46'
  on-primary-container: '#90AEAD'
  inverse-primary: '#90AEAD'
  secondary: '#90AEAD'
  on-secondary: '#ffffff'
  secondary-container: '#b5cdcc'
  on-secondary-container: '#244855'
  tertiary: '#874F41'
  on-tertiary: '#ffffff'
  tertiary-container: '#ebd5cf'
  on-tertiary-container: '#E64833'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d1e5ec'
  primary-fixed-dim: '#90AEAD'
  on-primary-fixed: '#1c3b46'
  on-primary-fixed-variant: '#244855'
  secondary-fixed: '#d5e4e3'
  secondary-fixed-dim: '#b5cdcc'
  on-secondary-fixed: '#1c2b2b'
  on-secondary-fixed-variant: '#244855'
  tertiary-fixed: '#F8F2EC'
  tertiary-fixed-dim: '#EFE4DA'
  on-tertiary-fixed: '#874F41'
  on-tertiary-fixed-variant: '#E64833'
  background: '#ffffff'
  on-background: '#244855'
  surface-variant: '#d1d5db'
typography:
  headline-xl:
    fontFamily: Basis Grotesque
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Basis Grotesque
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-md:
    fontFamily: Basis Grotesque
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Basis Grotesque
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Basis Grotesque
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Basis Grotesque
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Basis Grotesque
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Basis Grotesque
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  headline-xl-mobile:
    fontFamily: Basis Grotesque
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1280px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 20px
---

## Brand & Style

This design system embodies the intersection of classical authority and contemporary precision. It is tailored for high-stakes professional environments—legal, executive finance, and academic publishing—where heritage must be conveyed through a modern lens.

The aesthetic is **Corporate Modern with High-Contrast accents**. It utilizes a warm cream foundation punctuated by deep, slate blue tones and a singular, vibrant red-orange to signal action and intellect. The visual language is structured, disciplined, and unapologetically premium, evoking a sense of "intellectual vigor" and "unshakable reliability."

## Colors

The palette is driven by high-contrast pairings to ensure maximum legibility and architectural hierarchy.

- **Deep Slate Blue (#244855):** The anchor of the system. Used for primary navigation, heavy headings, and core structural elements.
- **Light Slate Teal (#90AEAD):** Used for supportive UI elements, information icons, and secondary actions to prevent the interface from feeling too heavy.
- **Red-Orange (#E64833):** The "Pulse" color. Reserved exclusively for primary Calls to Action (CTAs), critical alerts, and highlights that require immediate cognitive attention.
- **Pure White (#ffffff):** The expansive canvas. This clean white background matches the Notion editor workspace while maintaining a premium, contemporary feel.
- **Red-Brown (#874F41):** Used for deep borders, active states, and supportive text tones to ensure a grounded, ink-on-paper readability.

## Typography

The system utilizes **Basis Grotesque** as its primary typeface to maintain a contemporary, premium, and structured presence across the entire application interface. Its clean neo-grotesque details lend a high-end architectural discipline to layouts, buttons, and settings.

All large headlines use a slight negative letter spacing to feel "tight" and intentional, while labels use expanded tracking and uppercase styling for a sophisticated, architectural look.

## Layout & Spacing

This design system employs a **Fixed Grid** philosophy on desktop to preserve the editorial integrity of the content.

- **Grid:** A 12-column grid with 24px gutters. Content should be centered with wide 64px margins to create a "gallery" effect.
- **Rhythm:** An 8px linear scale governs all padding and margins.
- **Adaptation:** On tablet, margins reduce to 40px and the grid becomes 8 columns. On mobile, the system shifts to a 4-column fluid layout with 20px margins to maximize screen real estate.
- **Density:** We prioritize "Generous" spacing over "Compact" to ensure a calm, contemplative user experience.

## Elevation & Depth

To maintain the sophisticated "Jurisprudence" feel, the system avoids heavy shadows. Instead, it uses **Tonal Layers and Low-Contrast Outlines**.

- **Surfaces:** Depth is created by placing elements on a "Surface-2" layer (a 2% darkening of Ghost White) rather than using drop shadows.
- **Borders:** Use subtle 1px outlines in Blue Bell (#3E92CC) at 20% opacity to define container boundaries.
- **Interactions:** Only primary buttons and active cards receive a shadow—an "Ambient Lift"—which is highly diffused, using a 15% opacity of Imperial Blue to keep the shadow feeling integrated and "cool" rather than muddy.

## Shapes

The shape language is **Soft (0.25rem)**.

Rectangular forms with very slight rounding convey a sense of precision and "sturdy" construction. Sharp corners are avoided to prevent the UI from feeling aggressive, but large radii (pills) are avoided to maintain the professional, serious tone of the system.

- **Small elements (Buttons/Inputs):** 0.25rem (4px).
- **Large elements (Cards/Modals):** 0.5rem (8px).

## Components

- **Buttons:** Primary buttons use Red-Orange (#E64833) with white Work Sans text. Secondary buttons use Deep Slate Blue (#244855) with an off-white cream background and 1px solid border.
- **Inputs:** Fields are Off-White Cream with a Red-Brown (#874F41) bottom border. When focused, the border transitions to Deep Slate Blue. Labels sit above the field in Work Sans Bold.
- **Chips:** Used for legal tags or categories. They feature a light Light Slate Teal background with Deep Slate Blue text.
- **Cards:** Cards are white with a 1px border. On hover, they gain a Deep Slate Blue "accent line" (2px) on the left side to indicate selection.
- **Lists:** High-contrast separators (1px line in Red-Brown at 10% opacity) between items. Use Noto Serif for the list title and Work Sans for the metadata.
- **Checkboxes:** Square with a 2px radius. When checked, they fill with Deep Slate Blue and a white checkmark.
