# The Thinking Cap Podcast — Design Specification

A single-page podcast landing page for "Probably Sentient Labs." Dark-themed header and footer with a gradient hero, white content area, and episode cards with embedded players.

## Tokens

```yaml
colors:
  primary: "#1a1a2e"
  accent: "#7c73ff"
  accent-hover: "#5a52d5"
  text: "#2d2d2d"
  text-light: "#666666"
  bg: "#ffffff"
  bg-alt: "#f8f9fa"
  border: "#e9ecef"
  quote-bg: "#f0eeff"
  hero-badge-text: "#9ca3af"
  footer-text: "#999999"
  footer-link: "#b4a0ff"
  nav-link: "#cccccc"
  nav-link-active: "#ffffff"

typography:
  font-heading: "Georgia, serif"
  font-body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  font-hero-heading: "Georgia, 'Times New Roman', Times, serif"

spacing:
  max-width: "800px"
  header-max-width: "1200px"
```

## Layout

- **Header**: Sticky, dark (`primary`), full-width with inner constrained to 1200px. Flex row, logo left, nav right.
- **Hero**: Gradient background (135deg from #1a1a2e through #16213e to #0f3460). Centered content, max-width 800px. Contains badge pill, h1, and subtitle.
- **Main content**: Max-width 800px, auto-centered. Contains meta tags, intro paragraph (podcast name in bold italics), then episode cards.
- **Streaming section**: Full-width `bg-alt` background, centered heading and flex-row of streaming links.
- **Footer**: Dark (`primary`) background, centered text, max-width 1200px inner.

## Components

### Episode Card
Each episode card contains:
- **Episode header**: Flex row with numbered circle badge (accent bg, white text, 32px circle) and h2 title (Georgia, primary color)
- **Quote block**: Italicized blockquote with left accent border (4px), quote-bg background, right-rounded corners (12px)
- **Guest line**: Bold accent-colored text ("Featuring: ...")
- **Description**: Body text
- **Player**: Rounded card (8px radius, bg-alt background, border) with circular play button (44px, accent bg) and episode info

### Streaming Link
Pill-shaped links (8px radius) with white background, border, flex row with icon + text. Hover state adds accent border and shadow.

### Hero Badge
Inline-block pill (20px radius), semi-transparent gray background, gray text, small uppercase-like text.

### Meta Tag
Small inline pill (4px radius), bg-alt background, medium-weight text.

### Navigation
Horizontal link list with 2rem gap. Light gray inactive, white active/hover. System font, 500 weight.

## Accessibility

- Semantic landmarks: header, nav, main, footer, section
- Heading hierarchy: single h1 (hero), h2 per episode (8 total), h3 for streaming section
- Play buttons have aria-label ("Play episode N")
- Links use meaningful text
