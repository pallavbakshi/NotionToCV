---
name: Modern Jurisprudence
colors:
  surface: '#fff8f4'
  surface-dim: '#e0d9d3'
  surface-bright: '#fff8f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#faf2ed'
  surface-container: '#f4ece7'
  surface-container-high: '#eee7e1'
  surface-container-highest: '#e9e1dc'
  on-surface: '#1e1b18'
  on-surface-variant: '#444650'
  inverse-surface: '#33302c'
  inverse-on-surface: '#f7efea'
  outline: '#757681'
  outline-variant: '#c5c6d2'
  surface-tint: '#475b9c'
  primary: '#00103e'
  on-primary: '#ffffff'
  primary-container: '#0a2463'
  on-primary-container: '#7a8ed2'
  inverse-primary: '#b5c4ff'
  secondary: '#006496'
  on-secondary: '#ffffff'
  secondary-container: '#75c3ff'
  on-secondary-container: '#004f79'
  tertiary: '#33000c'
  on-tertiary: '#ffffff'
  tertiary-container: '#59001c'
  on-tertiary-container: '#fe4e75'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b5c4ff'
  on-primary-fixed: '#00164d'
  on-primary-fixed-variant: '#2e4382'
  secondary-fixed: '#cce5ff'
  secondary-fixed-dim: '#91cdff'
  on-secondary-fixed: '#001e31'
  on-secondary-fixed-variant: '#004b72'
  tertiary-fixed: '#ffd9dd'
  tertiary-fixed-dim: '#ffb2bb'
  on-tertiary-fixed: '#400012'
  on-tertiary-fixed-variant: '#910033'
  background: '#fff8f4'
  on-background: '#1e1b18'
  surface-variant: '#e9e1dc'
typography:
  headline-xl:
    fontFamily: Noto Serif
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Noto Serif
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-md:
    fontFamily: Noto Serif
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Noto Serif
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Noto Serif
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Noto Serif
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Work Sans
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Work Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  headline-xl-mobile:
    fontFamily: Noto Serif
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

This design system embodies the intersection of classical authority and contemporary precision. It is tailored for high-stakes professional environments—legal, executive finance, and academic publishing—where clarity is paramount and heritage must be conveyed through a modern lens.

The aesthetic is **Corporate Modern with High-Contrast accents**. It utilizes a light, airy foundation punctuated by deep, authoritative tones and a singular, vibrant magenta to signal action and intellect. The visual language is structured, disciplined, and unapologetically premium, evoking a sense of "intellectual vigor" and "unshakable reliability."

## Colors

The palette is driven by high-contrast pairings to ensure maximum legibility and architectural hierarchy.

- **Imperial Blue (#0A2463):** The anchor of the system. Used for primary navigation, heavy headings, and core structural elements.
- **Blue Bell (#3E92CC):** Used for supportive UI elements, information icons, and secondary actions to prevent the interface from feeling too heavy.
- **Magenta Bloom (#D8315B):** The "Pulse" color. Reserved exclusively for primary Calls to Action (CTAs), critical alerts, and highlights that require immediate cognitive attention.
- **Ghost White (#FFFAFF):** The expansive canvas. This slightly warm off-white reduces eye strain compared to pure white while maintaining a crisp, editorial feel.
- **Carbon Black (#1E1B18):** Used strictly for body text and deep borders to ensure a grounded, ink-on-paper readability.

## Typography

The system utilizes **Noto Serif** as its primary typeface to maintain a scholarly and authoritative presence. Its transition from headlines to long-form body text creates a seamless, literary experience.

To balance the traditional serif, **Work Sans** is introduced for functional labels, metadata, and button text. This sans-serif utility font provides the necessary "modern" contrast, ensuring that navigational elements feel like tools rather than just content.

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

- **Buttons:** Primary buttons use Magenta Bloom (#D8315B) with white Work Sans text. Secondary buttons use Imperial Blue (#0A2463) with a ghost-white background and 1px solid border.
- **Inputs:** Fields are Ghost White with a Carbon Black (#1E1B18) bottom border. When focused, the border transitions to Imperial Blue. Labels sit above the field in Work Sans Bold.
- **Chips:** Used for legal tags or categories. They feature a light Blue Bell background with Imperial Blue text.
- **Cards:** Cards are white with a 1px border. On hover, they gain an Imperial Blue "accent line" (2px) on the left side to indicate selection.
- **Lists:** High-contrast separators (1px line in Carbon Black at 10% opacity) between items. Use Noto Serif for the list title and Work Sans for the metadata.
- **Checkboxes:** Square with a 2px radius. When checked, they fill with Imperial Blue and a white checkmark.
