# Sticker Collection Tracker - Design System

## Design Principles

The application should feel:

- Fun but not childish
- Modern and fast
- Optimised for mobile devices
- Highly readable outdoors while scanning stickers
- Focused on collection progress
- Accessible and colourblind-friendly
- Comfortable in both light and dark mode

The primary user journey is:

1. Open collection
2. Scan sticker(s)
3. View progress
4. Identify missing stickers
5. Manage duplicates

The design should emphasise:

- Completion percentage
- Collection statistics
- Scan actions
- Missing stickers

---

# Colour Palette

## Brand Colours

### Primary

Collector Blue

HEX: #2563EB

Used for:

- Primary buttons
- Links
- Active navigation
- Progress indicators

### Secondary

Victory Green

HEX: #16A34A

Used for:

- Completed stickers
- Success states
- Collection milestones
- Rewards

### Accent

Album Gold

HEX: #F59E0B

Used for:

- Rare stickers
- Highlights
- Featured collections
- Premium indicators

---

# Status Colours

## Missing

HEX: #E5E7EB

Represents:

- Missing stickers
- Empty album slots

## Owned

HEX: #3B82F6

Represents:

- Collected stickers

## Duplicate

HEX: #8B5CF6

Represents:

- Duplicate stickers

## Recently Added

HEX: #10B981

Represents:

- Newly scanned stickers

## Error

HEX: #DC2626

Represents:

- OCR failures
- Validation errors

## Warning

HEX: #F97316

Represents:

- Partial scans
- Low confidence matches

---

# Light Theme

## Background

Page Background

HEX: #F8FAFC

## Surface

HEX: #FFFFFF

## Secondary Surface

HEX: #F1F5F9

## Border

HEX: #E2E8F0

## Text Primary

HEX: #0F172A

## Text Secondary

HEX: #475569

## Text Muted

HEX: #94A3B8

---

# Dark Theme

## Background

HEX: #0F172A

## Surface

HEX: #1E293B

## Secondary Surface

HEX: #334155

## Border

HEX: #475569

## Text Primary

HEX: #F8FAFC

## Text Secondary

HEX: #CBD5E1

## Text Muted

HEX: #94A3B8

---

# Camera Scanner Theme

The scanner should have a distinct visual style.

Scanner Overlay

RGBA(15, 23, 42, 0.65)

Scanner Frame

HEX: #2563EB

Scanner Success Flash

HEX: #16A34A

Scanner Error Flash

HEX: #DC2626

Detected Sticker Highlight

HEX: #F59E0B

---

# Progress Visualisation

Completion colours:

0-24%
#DC2626

25-49%
#F97316

50-74%
#F59E0B

75-99%
#3B82F6

100%
#16A34A

---

# Typography

## Font Families

### Headings & Display

**Primary**: Poppins
- Modern, friendly, rounded aesthetic
- Excellent readability at all sizes
- Great on mobile devices
- Weights: 600, 700

**Fallback**: Inter, system-ui, sans-serif

### Body Text

**Primary**: Inter
- Highly optimised for readability
- Superior mobile performance
- Designed for accessibility (dyslexia-friendly)
- Readable in outdoor lighting conditions
- Weights: 400, 500

**Fallback**: system-ui, -apple-system, sans-serif

### Monospace (Code, Scanner IDs)

**Primary**: IBM Plex Mono
- Clear distinction of similar characters
- Excellent for scanning contexts
- Weights: 400, 600

**Fallback**: JetBrains Mono, Roboto Mono, monospace

## Font Loading

Use Google Fonts or similar CDN:
```
https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Inter:wght@400;500&family=IBM+Plex+Mono:wght@400;600&display=swap
```

## Heading Scale

| Level | Size | Weight | Line Height | Letter Spacing | Use Case |
|-------|------|--------|-------------|----------------|----------|
| H1 | 32px | 700 | 1.2 | -0.02em | Page titles, major sections |
| H2 | 24px | 700 | 1.3 | -0.01em | Section headings, collection names |
| H3 | 20px | 600 | 1.4 | 0 | Subsections, team names |
| H4 | 18px | 600 | 1.4 | 0 | Card titles, sticker labels |
| H5 | 16px | 600 | 1.5 | 0 | Small headings, UI labels |
| H6 | 14px | 500 | 1.5 | 0 | Captions, secondary labels |

## Body Text

| Size | Weight | Use Case | Line Height |
|------|--------|----------|-------------|
| 16px | 400 | Large body, primary content | 1.6 |
| 14px | 400 | Standard body text | 1.6 |
| 12px | 400 | Small labels, metadata | 1.5 |
| 11px | 400 | Captions, hints | 1.5 |

## Text Styles

**Emphasis**: Font weight 500, primary color
**Disabled**: Text muted color, 60% opacity
**Link**: Primary color, underline on hover
**Code/IDs**: Monospace, secondary surface background, small padding

## Mobile Optimization

- Base font size: 16px (prevents zoom on iOS input focus)
- Minimum touch target text: 12px
- All headings 1.2–1.5 line height for readability
- Letter spacing increased on smaller text for clarity
- Enhanced readability for outdoor scanning scenarios

---

# Elevation & Shadows

The shadow system provides depth and visual hierarchy. All shadows use a consistent dark color with varying opacity and blur.

## Shadow Levels

| Level | Use Case | Shadow Definition |
|-------|----------|-------------------|
| **0 (Flat)** | Default state, background elements | None |
| **1 (Subtle)** | Cards, input fields, slight lift | `0px 2px 4px rgba(15, 23, 42, 0.1)` |
| **2 (Raised)** | Hovered cards, floating elements, modals | `0px 8px 16px rgba(15, 23, 42, 0.15)` |
| **3 (Lifted)** | Dropdowns, popovers, overlays | `0px 16px 32px rgba(15, 23, 42, 0.2)` |
| **4 (Top)** | Modal dialogs, notifications | `0px 24px 48px rgba(15, 23, 42, 0.25)` |
| **5 (Floating)** | Floating action buttons, tooltips | `0px 32px 64px rgba(15, 23, 42, 0.3)` |

## Component Elevation Map

- **Buttons (default)**: None
- **Buttons (hover)**: Shadow 1
- **Buttons (active)**: None (inset)
- **Cards**: Shadow 1
- **Cards (hover)**: Shadow 2
- **Input fields**: Shadow 1 (subtle)
- **Modals**: Shadow 4
- **Floating action button**: Shadow 5
- **Dropdown menu**: Shadow 3
- **Notification toast**: Shadow 3
- **Sticker collection grid**: Shadow 1 per item
- **Scanner overlay**: None (full screen overlay with 65% opacity background)

## Transition with Elevation

- Elevation changes should animate smoothly
- Duration: 200ms
- Easing: ease (or ease-out for enter, ease-in for exit)

---

# Spacing

Base Unit

4px

Spacing Scale

xs  = 4px
sm  = 8px
md  = 12px
lg  = 16px
xl  = 24px
2xl = 32px
3xl = 48px

---

# Border Radius

Small
6px

Standard
12px

Card
16px

Modal
20px

Floating Action Button
999px

---

# Components

## Buttons

### Button States

| State | Styling | Elevation |
|-------|---------|-----------|
| Default | Background: Surface-alt, Text: Surface-alt-contrast | Elevation 1 |
| Hover | Same colors, slight brightening | Elevation 2 |
| Active | Same colors, subtle press effect | Elevation 4 |
| Disabled | Opacity 40%, cursor not-allowed | Elevation 0 |
| Focus | Visible keyboard focus ring | Elevation 1 |

### Button Variants

**Solid (Default)**
- Background: Primary color
- Text: High contrast on primary
- Border: None
- Padding: 10px 14px (height: 40px)
- Radius: 6px
- States: Hover (+elevation), Active (+elevation), Disabled (40% opacity)

**Outlined**
- Background: Transparent
- Text: Primary/Secondary/Success/Warning/Danger/Info color
- Border: 1px, same as text color
- Padding: 10px 14px
- Radius: 6px
- States: Hover (background tint), Active, Disabled

**Flat**
- Background: Transparent
- Text: Primary/Secondary/Success/Warning/Danger/Info
- Border: None
- No elevation or shadow
- States: Hover (subtle background), Disabled

**Icon Button**
- Square/circular button for icons only
- Padding: 8px
- No text labels
- Height: auto (typically 36-40px)
- All variants available

### Button Sizes
- **Height**: 40px (standard touch target)
- **Padding**: 10px 14px (horizontal varies by content)
- **Font Size**: 14px
- **Icon Size**: 16-20px

---

## Input Fields

### Text Inputs

- Background: Surface
- Border: 1px solid border-color
- Radius: 6px
- Padding: 12px
- Font Size: 14px
- Placeholder: Text-muted color
- Focus: Primary color border, no outline
- Disabled: 40% opacity, cursor not-allowed

### Floating Label

- Label positioned absolutely at top-left of input
- Animates up (16px) and shrinks (12px) on focus/fill
- Transition: 200ms ease
- Color: Text-secondary → Primary (on focus)

### Textarea

- Min height: 80px
- Resizable (or fixed height)
- Same border/padding as text inputs
- Monospace font option for IDs/codes

### Select / Dropdown

- Height: 40px (match buttons)
- Padding: 12px
- Border: 1px solid border-color
- Radius: 6px
- Options background: Surface-alt
- Options text: Surface-alt-contrast

---

## Cards

### Sticker Card

| Property | Value |
|----------|-------|
| Background | Surface |
| Border | 1px solid border-color |
| Border Radius | 12px |
| Padding | 16px |
| Elevation (default) | Elevation 1 |
| Elevation (hover) | Elevation 2 |
| Transition | 200ms ease |

**Content**:
- Sticker image (centered)
- Sticker ID (monospace, 12px)
- Player/Team name (14px, font-weight: 500)
- Collection status (icon + label)

**Status Indicators**:
- Missing: Border accent in missing color
- Owned: Checkmark overlay
- Duplicate: Badge with count
- Recently Added: Green glow effect

### Collection Progress Card

| Property | Value |
|----------|-------|
| Background | Surface |
| Border | 1px solid border-color |
| Padding | 20px |
| Radius | 12px |
| Elevation | Elevation 1 |

**Content**:
- Completion percentage (32px, 700 weight, primary color)
- Progress bar (12px height, completion colors)
- Stats grid: Owned | Missing | Duplicates
- Each stat: Large number (20px) + label (12px, text-muted)

---

## Scan Button (Floating Action Button)

| Property | Value |
|----------|-------|
| Shape | Circular |
| Size | 64px |
| Background | Primary color |
| Text | White |
| Icon | Camera (24px) |
| Elevation | Elevation 5 |
| Hover Elevation | Elevation 5 (scale 1.05) |
| Position | Fixed, bottom-right (16px from edges) |
| Border Radius | 50% |

**Accessibility**:
- Label: "Scan sticker"
- Keyboard accessible (Tab key)
- Focus ring visible
- Touch target: ≥48px

---

## Album Grid

### Grid Cell States

| State | Styling |
|-------|---------|
| Missing | Light grey background, subtle border |
| Owned | Primary blue, checkmark |
| Duplicate | Purple badge with count |
| Selected | Gold outline (4px), highlight |
| Recently Added | Green glow + pulse animation |

**Cell Size**:
- Default: 120×120px (mobile: 100×100px)
- Padding: 8px gutters between cells
- Radius: 8px

---

## Form Layout

**Form Groups**:
- Vertical stack
- Gap between inputs: 16px
- Label (14px, 500) above input

**Help Text**:
- Font size: 12px
- Color: Text-muted
- Positioned below input, 4px gap

**Error Messages**:
- Font size: 12px
- Color: Error color
- Icon: Error indicator
- Positioned below input

---

## Sticker Card

Background:
Surface

Border:
1px Border Colour

Radius:
16px

Hover:
Elevate with shadow

Contents:

- Sticker image
- Sticker ID
- Player/team name
- Collection status

---

## Album Grid

Cell States

Missing:
Light Grey

Owned:
Blue

Duplicate:
Purple

Selected:
Gold Outline

Recently Added:
Green Glow

---

## Scan Button

Shape:
Circular

Size:
64px

Colour:
Primary Blue

Icon:
Camera

Position:
Bottom Centre

Shadow:
Large floating shadow

---

## Collection Progress Card

Display:

- Percentage complete
- Owned count
- Missing count
- Duplicate count

Progress bar uses completion colours.

---

# Animations

Duration

Fast:
150ms

Standard:
250ms

Slow:
400ms

Use Cases

Card Hover:
150ms

Page Transition:
250ms

Scan Success:
250ms

Progress Update:
400ms

Avoid excessive animation.

---

# Accessibility

Minimum contrast ratio:
4.5:1

Touch targets:
Minimum 44px x 44px

Never rely solely on colour to indicate status.

Add:

- Icons
- Labels
- Tooltips

for all sticker states.

---

# Iconography

Icon Set

Lucide Icons

Preferred Icons

Album
BookOpen

Scan
Camera

Collection
Grid3x3

Missing
CircleDashed

Owned
CheckCircle

Duplicate
Copy

Statistics
ChartBar

Settings
Cog

Search
Search

Import
Upload

Export
Download

---

# Overall Visual Style

The application should feel like:

"A modern digital sticker album."

Key characteristics:

- Clean cards
- Bright accent colours
- Strong progress visualisation
- Mobile first
- Fast scanning workflows
- Minimal clutter
- Content-focused layout