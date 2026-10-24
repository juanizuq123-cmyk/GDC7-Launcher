---
name: GDC7 Launcher
description: A quiet orbital atlas that makes each Minecraft event profile and its real readiness easy to read.
colors:
  ink: "#0b0a12"
  surface: "#11101a"
  surface-hover: "#201d30"
  panel-surface: "#14131d"
  control-surface: "#191722"
  nav-current: "#211d31"
  event-current: "#1c192a"
  chip-surface: "#15131f"
  field-surface: "#0f0e17"
  line: "#302b42"
  line-strong: "#47405f"
  text: "#f2f0f8"
  muted: "#bab4cf"
  faint: "#928ba9"
  violet: "#ad9cf1"
  violet-strong: "#c5b8ff"
  copper: "#d4a56d"
  success: "#93cfad"
  warning: "#e7c17d"
  status-idle: "#756d8a"
  action-ink: "#171320"
  disabled-control: "#363142"
  chip-text: "#d9d4e7"
typography:
  display:
    fontFamily: "Sora, sans-serif"
    fontSize: "clamp(42px, 4.4vw, 62px)"
    fontWeight: 720
    lineHeight: 1.03
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Sora, sans-serif"
    fontSize: "clamp(30px, 3vw, 42px)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Sora, sans-serif"
    fontSize: "19px"
    fontWeight: 690
  body:
    fontFamily: "Sora, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Sora, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    letterSpacing: "0.09em"
  action:
    fontFamily: "Sora, sans-serif"
    fontSize: "17px"
    fontWeight: 690
    letterSpacing: "0.07em"
  nav:
    fontFamily: "Sora, sans-serif"
    fontSize: "12px"
    fontWeight: 620
  code:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
rounded:
  sm: "8px"
  md: "10px"
  nav: "11px"
  lg: "12px"
  surface: "14px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.violet-strong}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "58px"
    width: "188px"
    typography: "{typography.action}"
  button-primary-hover:
    backgroundColor: "#d2c9ff"
  button-primary-disabled:
    backgroundColor: "{colors.disabled-control}"
    textColor: "#c5bfd2"
  button-secondary:
    backgroundColor: "{colors.control-surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "46px"
    typography: "{typography.body}"
  nav-current:
    backgroundColor: "{colors.nav-current}"
    textColor: "{colors.text}"
    rounded: "{rounded.nav}"
    padding: "0 13px"
    height: "42px"
    typography: "{typography.nav}"
  input-text:
    backgroundColor: "{colors.field-surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "41px"
    typography: "{typography.body}"
  spec-chip:
    backgroundColor: "{colors.chip-surface}"
    textColor: "{colors.chip-text}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
    height: "31px"
  event-option-selected:
    backgroundColor: "{colors.event-current}"
    textColor: "{colors.text}"
    rounded: "{rounded.nav}"
    padding: "8px 11px"
    height: "67px"
  surface-card:
    backgroundColor: "{colors.panel-surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "24px"
  install-readout:
    backgroundColor: "rgba(13, 12, 20, 0.88)"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "15px 19px"
    height: "99px"
---

# Design System: GDC7 Launcher

## Overview

**Creative North Star: "Quiet Orbital Atlas"**

GDC7 Launcher turns the geometry of a star atlas into a calm, legible desktop interface. Near-black fields hold the content; violet marks the current route, selected event, and primary action; small copper points tie the original GDC7 illustration to its identity. Two custom concept illustrations give GDC7 and Estación Boreal distinct worlds; neither is presented as a gameplay screenshot. Sora gives the interface a precise, geometric voice without making the data feel technical or distant.

The system gives one event the foreground and makes its known installation facts easy to scan. Fine borders and tonal shifts separate panels while generous dark space preserves the orbital atmosphere. Account and installation states stay explicit: the GDC7 client pack is labelled Minecraft 26.1.2/NeoForge 26.1.2.95/Java 25, and its copy states that it does not include the GDC7 gameplay mod or a server. Boreal remains unavailable. The navigation, event choices, account state, and page controls use text and visible focus alongside color.

**Key Characteristics:**
- Quiet orbital geometry with original GDC7 marks and event-specific concept art.
- Deep ink surfaces with violet wayfinding and restrained copper details.
- Event-specific profiles and readiness shown as separate states.
- Compact, highly legible information with visible focus and reduced-motion support.

## Colors

The palette is built from ink, lifted charcoal panels, cool lavender text, and a narrow violet-to-copper accent vocabulary.

### Primary
- **Selected Violet:** Marks the active navigation item, selected event, links, primary action, and keyboard focus. The brighter violet is reserved for selected and focused states.
- **Atlas Violet:** A quieter companion for secondary icon marks and control accents.

### Secondary
- **GDC7 Copper:** A small identity marker in the orbital scene and event emblem. Keep it as a pinpoint accent rather than a large surface fill.

### Tertiary
- **Confirmed Green:** Indicates a verified, ready state.
- **Pending Amber:** Identifies installation or authorization states that are not ready yet.

### Neutral
- **Ink:** The deepest canvas and full-window background.
- **Base Surface:** The app frame and broad structural surfaces.
- **Panel Surface:** Repeated information panels and detail cards.
- **Control and Field Surfaces:** Quiet fills for buttons, chips, and editable fields.
- **Dividers:** Fine low-contrast borders; stronger dividers define focused structural edges.
- **Primary, Muted, and Faint Text:** A clear text ladder for headings, supporting copy, and metadata.
- **Idle Status:** A subdued marker for a disconnected or inactive account state.

**The Violet Wayfinding Rule.** Use violet to identify a current route, selected choice, focus ring, or primary action. Do not spread it as a decorative glow across whole panels.

## Typography

**Display Font:** Sora (with a sans-serif fallback)
**Body Font:** Sora (with a sans-serif fallback)
**Label/Mono Font:** Sora for labels; Cascadia Code or Consolas for selectable paths and identifiers.

**Character:** Sora is geometric and compact, with close, slightly tracked display headlines and clear sentence-case body copy. Small uppercase labels use deliberate tracking to read as metadata rather than miniature headlines.

### Hierarchy
- **Display** (weight 720, `clamp(42px, 4.4vw, 62px)`, line-height 1.03): The selected event title on Home.
- **Headline** (weight 700, `clamp(30px, 3vw, 42px)`, line-height 1.1): Page titles in Events, Wardrobe, and Settings.
- **Title** (weight 690, 19px): Card and panel headings.
- **Body** (weight 400, 14px base; supporting copy commonly 12–15px, line-height 1.5): Descriptions, status explanations, and settings details. Keep long descriptive copy to the observed 50–70 character line widths where the layout allows.
- **Label** (weight 650, 11px, 0.09em tracking, uppercase): Short status, section metadata, and readout labels.
- **Code** (weight 400, 11px): Local paths and identifiers only; allow paths to wrap rather than compete with the interface.

**The Quiet Label Rule.** Reserve uppercase and expanded tracking for short status and metadata labels. Keep explanatory sentences in normal case.

## Layout

The window is a framed desktop workspace with a slim title bar, a top navigation and account row, a flexible content area, and a compact footer. The Home hero uses equal columns at wide widths: event name, playable client versions, launch limits, and the install/play action on the left; event-specific concept art and a profile readout on the right. A bottom strip holds illustrated event choices and the visible news-source state.

At widths up to 900px, the header navigation moves to a second row and the Home hero becomes one column; the active event illustration remains visible as a low-contrast backdrop above the copy. At widths up to 790px, event choices in the Events page become a horizontal scroller. At 1100px the header and account panels tighten; at 600px the identity panel and settings aside collapse further. The app frame declares a minimum working size of 760 × 620px. Inner pages scroll vertically; the overall frame stays fixed.

Spacing follows an 8px base rhythm, with recurring 12px, 16px, and 24px gaps. Content uses fluid horizontal padding at desktop widths and tighter page padding at narrow widths. Keep the hierarchy intact when space contracts: preserve account state and the news-source availability label, and let long event lists scroll horizontally where coded.

## Elevation & Depth

This is a flat, tonal system with no box shadows. Depth comes from near-black canvas regions, slightly raised panel fills, and thin violet-gray borders. The Home illustrations supply their own light and atmosphere; the interface does not add a shadow halo around controls.

**The Flat-at-Rest Rule.** Keep panels flat at rest. Use a border or a small tonal shift to show structure and state; do not add ambient drop shadows.

Motion is restrained: the orbital scene drifts slowly over a 28-second alternate loop, and interface state transitions use short 150ms easing. Both the operating-system reduced-motion preference and the local Reduce Motion setting suppress animation and transition duration.

## Shapes

Surfaces use softly rounded, consistent corners, while chips and fields stay tighter. Most main cards use a 14px radius; event details and readouts use 12px; buttons and fields use 10px or 8px. Navigation and event tiles use an 11px radius. Borders are thin and quiet, not heavy outlines. The orbital artwork and brand mark use ellipses, arcs, and faceted orbital forms; controls remain rectangular and calm rather than ornamental.

## Components

### Buttons
- **Shape:** Gently rounded (10px) with a 1px border or transparent border.
- **Primary:** Lavender fill, dark ink text, uppercase tracking, and a larger Home play target (188 × 58px; narrower controls reduce to 145 × 45px below 790px).
- **Hover / Focus:** Primary fill lightens on hover; keyboard focus uses a 2px bright-violet outline offset by 3px. Pressed buttons move down by 1px.
- **Disabled:** The play action is visibly muted and keeps its specific blocker in the accessible description. Secondary disabled controls lower opacity.
- **Secondary:** Dark fill, quiet border, normal-case label; hover raises the fill and border contrast.

### Chips
- **Style:** Compact requirement chips use a dark inset fill, muted border, and light label/value pair (8px radius, 31px minimum height).
- **State:** Event chips in the Home strip use a brighter border and a modest tonal shift when selected; the selected state also has `aria-pressed`.

### Cards / Containers
- **Corner Style:** Soft 12–14px corners, with the event detail and profile panels at the larger end.
- **Background:** A charcoal panel against the ink content canvas.
- **Shadow Strategy:** Flat; use a fine border and tonal contrast, never a shadow.
- **Border:** Thin, low-contrast divider; stronger on selection or the focused structural element.
- **Internal Padding:** Common panel padding is 17–24px, tuned to density.

### Inputs / Fields
- **Style:** Dark inset field, 1px muted border, 8px corners, and readable placeholder text.
- **Focus:** Bright-violet 2px outline with 3px offset, shared with buttons and links.
- **Error / Disabled:** Disabled controls become subdued; errors and destructive actions use a text label as well as color.

### Navigation
- **Style:** Four icon-and-label destinations centered in the top bar, with account status at the right. The active page has a lifted tonal fill and border; hover only raises contrast. At widths up to 900px, the navigation occupies its own centered second row. The account label remains visible at the 760px minimum frame width.

### Event Choice and Readiness Readout
The selected event tile pairs a square crop of its illustration with its name and status; a thin violet border plus `aria-pressed` makes selection clear. The installation readout overlays the event art in a translucent dark panel, carrying a factual heading and one supporting line. The GDC7 primary action changes from importing the profile in Prism to launching that installed profile. Its short description states that the historical client does not include the current NeoForge mod or a configured server.

## Do's and Don'ts

### Do:
- **Do** use the existing ink, panel, violet, and copper palette roles for new launcher surfaces.
- **Do** pair readiness color with a clear written state; only use green for a confirmed verified state.
- **Do** keep keyboard focus visible with the shared bright-violet outline.
- **Do** show the selected event's facts and blockers together, and keep event settings visually attached to that event.
- **Do** retain the visible news-source availability state at narrow widths.

### Don't:
- **Don't** turn the atlas geometry into a busy texture or add unrelated decorative gradients.
- **Don't** use violet as a broad ambient glow or copper as a large panel fill.
- **Don't** infer a server, player count, news source, account, or installation state from visual styling.
- **Don't** hide the reason a primary action is disabled or indicate selection using color alone.
- **Don't** add box shadows to panels or controls.
