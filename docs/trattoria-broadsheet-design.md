---
version: "superdesign-alpha"
name: "Trattoria broadsheet"
description: "A cream newsprint system framed by a hairline red rulebox, giant serif display type in rationed vermillion, and engraved woodcut illustration standing in for photography."
colors:
  background: "#F9F8F2"
  surface: "#CABFB5"
  accent: "#DA4143"
  text-primary: "#333333"
  text-secondary: "#3C3C3C"
  text-on-accent: "#FFFFFF"
  ink-black: "#1A1A1A"
  border-hairline: "#DA4143"
typography:
  display-lg:
    fontFamily: "Playfairdisplay Variablefont Wght"
    fontSize: "304px"
    fontWeight: 700
    lineHeight: "0.9"
    letterSpacing: "-4px"
  headline-md:
    fontFamily: "Playfairdisplay Variablefont Wght"
    fontSize: "224px"
    fontWeight: 700
    lineHeight: "1"
    letterSpacing: "-4px"
  body-md:
    fontFamily: "Bitter"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: "1.3"
  label-md:
    fontFamily: "Playfairdisplay Variablefont Wght"
    fontSize: "88px"
    fontWeight: 700
    lineHeight: "1.15"
  body-variable:
    fontFamily: "Bitter Variablefont Wght"
    fontSize: "18px"
    fontWeight: 300
    lineHeight: "1.3"
  accent-serif:
    fontFamily: "Zodiak Variable"
    fontStyle: "italic"
  label-sans:
    fontFamily: "PT Sans"
spacing:
  base: "4px"
  gap: "16px"
  section-padding: "64px"
  content-max-width: "64px"
rounded:
  control: "2px"
  pill: "500px"
  soft: "50px"
components:
  button-nav-ghost:
    background: "transparent"
    text-color: "#333333"
    radius: "0px"
    height: "63px"
    padding: "0px"
  button-link-red:
    background: "transparent"
    text-color: "#DA4143"
    radius: "0px"
    height: "27px"
    padding: "0px"
  button-hero-primary:
    background: "transparent"
    text-color: "#FFFFFF"
    radius: "500px"
    height: "42px"
    padding: "10px"
    border: "2px solid #DA4143"
  card-media-panel:
    background: "transparent"
    radius: "0px"
    padding: "0px"
  card-red-block:
    background: "#DA4143"
    radius: "0px"
    padding: "0px"
  card-product-tile:
    background: "transparent"
    radius: "0px"
    padding: "0px"
---
# Trattoria broadsheet
Source: https://damaria-roma.webflow.io/

## Overview
This is an editorial, Swiss-adjacent broadsheet aesthetic dressed for hospitality: a cream, paper-grain page enclosed by a thin red rulebox that behaves like a printed page border, punctuated by an oversized Playfair Display marquee running edge-to-edge. Photography is sparing and cropped tight (satin fabric, forkfuls of pasta, marble tabletops); everywhere else, fine engraved woodcut illustration — a phone, a coupe glass, jars of preserve — carries the "product" imagery instead of screenshots. The system reads as vintage-menu-meets-newspaper-masthead: red rubber-stamp circle graphics, a wax-seal CTA outline, and serif italics standing in for handwriting.

## Composition
The first screen is dominated by a single giant word broken across the fold in Playfair Display at ~304px, tracked tight (-4px), interrupted mid-line by a small red diamond glyph — this is the signature move, spanning two type-fills split by one ornament, repeated once per hero pass. Above it sits a compact three-part navbar; below, a full-bleed portrait crop bleeds to the frame's inner edge. Scrolling down, rhythm alternates: a dark caption card floats over the base of the hero photo, then a two-column band (prose left, solid red block right) introduces the food copy, then a three-column illustration+text grid, then a red-panel testimonial beside a photo, then commerce tiles, then a reservation form and footer. Density is generous — wide gutters, single accent per band — never more than one photograph competing with one illustration at a time. The deliberate choice is illustration-over-photography for secondary content (menu items, products, decorative motifs), rejecting a photo-grid gallery approach; this keeps the system feeling archival and printed rather than photographic and modern.

## Colors
Background is an off-white paper tone `#F9F8F2` (~84% declared area, confirmed dominant in the pixel field at ~67-73% combined with its near-white neighbors) — this is the page, not a neutral gray; it carries visible grain/texture throughout. `#CABFB5` (~5.1%) is a muted warm taupe used as a secondary surface tone in illustration panels. The vermillion `#DA4143` / `#D84848` (~6% pixel share, ~4.2% declared) is the single rationed accent: hairline rule borders around the whole page and around cards, the giant hero headline fill, link-style buttons, italic labels, and one full solid card fill per section (the red block, the testimonial panel). Near-black `#1A1A1A` and body ink `#333333`/`#3C3C3C` carry all reading text and the small square drop-cap tiles. White `#FFFFFF` is reserved for text sitting on the red panels and for the page's outer margin. Nothing else is colored — illustrations stay pure line-engraving black-on-cream, and there is no blue, green, or secondary hue anywhere; `#3898EC` appears only as a negligible link-default trace, not a used role.

## Typography
Playfair Display (variable weight, 700) is the display and label voice at three scales — 304px hero, 224px secondary headline, 88px label — always tight-tracked at -4px and near-solid leading (0.9–1.15), giving it a stamped, masthead density rather than airy editorial spacing. Body copy runs in Bitter at 18px/400 (measured) with a lighter 300-weight variable cut also present for longer paragraphs, color `#333333`, generous 1.3 line-height for comfortable reading blocks capped at the 864px measure. Small drop-cap initials (a single boxed capital letter, black fill, white text) open major paragraphs — a woodcut-manuscript device. Italic serif treatments (Zodiak Variable and italicized Playfair) mark eyebrow labels, quoted lines, and signature-style sign-offs, always short phrases, never full paragraphs. PT Sans appears as a plain-sans utility face for minor UI labels.

## Layout
The page is bounded by a persistent thin red-ruled rectangle inset a small margin from the viewport edge on all sides — everything lives inside this "printed sheet." Content max-width sits at 864px for text columns, while media and colored panels run wider, edge-to-edge within the rule. Primary grids are 3-column (gap 64px/48px, 7 items, rows arranged 2-wide-plus-1 then 3-across) and simpler 3-up card rows (gap 24px) and 2-up split panels (gap 48px, two roughly equal 49%/49% halves). Card families repeat a flat, radius-0, padding-0 construction throughout — no card ever gets rounded corners or a shadow fill; separation comes purely from the red hairline rules and generous whitespace. Spacing increments observed are 64/40/32/16/13/4px, giving a fairly tight rhythm for a page this editorial. The layout is not responsive-grid-driven in the conventional sense — it behaves like fixed newspaper columns that would stack single-file on narrow viewports.

## Components
- **Navbar**: top of first screen only, edge-to-edge width matching the outer rule frame (not a floating inset bar). Three zones: a red circular "MENU" badge with a small counter pill beneath it (left), a bounded rectangle wordmark lockup with hairline red border and two text lines (center), and a red-outlined pill/oval "RESERVE" button (right). No visible corner-radius unity across zones — badge is a circle, wordmark box is square-cornered, reserve control is a full pill (500px) — an intentional four-shape mix rather than one navbar shape.
- **Hero primary CTA**: not present as a filled button on the first screen — the reserve pill in the nav is the only interactive control visible, styled transparent fill, white text, 2px solid `#DA4143` border, height 42px, 500px pill radius, 10px padding. Treat this pill as the hero-adjacent primary action given no bolder button competes above the fold.
- **Ghost text buttons (button-nav-ghost)**: transparent fill, `#333333` text, 0px radius, 63px tall, no padding — used for large-target text-only links/menu triggers mid-page (e.g., "VIEW MENU" bordered variants elsewhere use a thin red rectangle outline around this same text logic).
- **Red link buttons (button-link-red)**: transparent fill, `#DA4143` text, 0px radius, 27px tall — small inline text actions, italic serif face, used for secondary calls like menu jumps.
- **Caption overlay card**: a solid near-black block floating over the lower-left of the hero food photograph, white body text, no radius, functions as a pull-quote/description panel anchored on the image rather than beside it.
- **Full-width media + solid-color split card**: pairs a tall illustration/photo panel with an adjacent full-bleed solid `#DA4143` rectangle of matching height; appears mid-page as a two-up 49/49 layout, no radius, no padding, color block carries no text at that point — pure chromatic punctuation.
- **Three-tile illustration grid**: three equal-width panels (rows at 100% each stacked, i.e., one wide row of tiles), each carrying a top-aligned fine-line engraving (glass, plate of food) filling most of the tile, an italicized caption label beneath, and a short body sentence — used for specials/feature call-outs with schedule-style micro-copy under the illustration.
- **Product tile row**: three-across grid, each tile transparent/no radius, engraved bottle-or-jar illustration filling the top ~70% of the tile, a red small-caps product name label, and a plain price line below — a commerce strip styled as apothecary-label art rather than product photography.
- **Testimonial/announcement panel**: solid `#DA4143` fill card, no radius, white italic serif heading, white body paragraph, white signature-style sign-off line in a larger italic serif — sits stacked above a photograph of a pouring gesture, together forming a two-part right-column module beside the product grid.
- **Reservation form module**: label + input pairs arranged in a 2-column grid (Name/Email, Phone/People, Date&Time + a red-outlined "VIEW MENU" submit button filling the second column's third row), each label is a small red italic caption sitting above a faint bordered input field, no visible fill on inputs beyond a translucent gray wash.
- **Footer**: full-width panel bounded by the same red hairline rule (thicker here, forming a complete box), three plain text columns (Pages / Socials / Address) in a small caps italic-label + plain-link pattern, sits at the very bottom inside the outer frame, no background fill distinct from the page.

## Graphics & Effects
No gradients are used anywhere on this page — every color area is a flat fill or flat illustration line; the "aurora" and "mesh" categories are absent. The single measured shadow, `rgba(0, 0, 0, 0.25) 0px 5px 25px 0px`, sits under the outer page frame, giving the whole cream sheet a subtle lifted-paper elevation against the surrounding gray page mat visible at the canvas edges. A rubber-stamp circular badge graphic (rotated, grayscale ink) sits pinned to the hero's right edge, overlapping the type — a printed-authenticity motif rather than a UI element. Fine-line engraving/woodcut illustrations (utensils, jars, glassware, plated dishes) substitute for product photography throughout the mid-page grids; photography itself is reserved for hero-scale human/food moments only, always cropped tight with natural daylight tonality (no color-graded overlay or scrim). The page-wide paper-grain texture is a visible noise layer under all content, most apparent in the large flat cream and red fields.

## Motion
Interactive elements use short, snappy transform transitions: `transform 0.15s cubic-bezier(0.25, 0.1, 0.754, 2.474)` for overshoot-style hover bounces (buttons, badges), `transform 0.2s cubic-bezier(0.076, -0.005, 0.234, 1.124)` and `transform 0.3s cubic-bezier(0.696, 0.012, 0.25, 1)` for slightly slower settles, and a plain `color, background-color 0.3s ease` for text/link hover recoloring. A `spin` keyframe drives any continuously rotating badge/seal element. Scroll behavior is orchestrated with GSAP + ScrollTrigger and smoothed via Lenis, implying scroll-linked reveals and inertial scrolling rather than hard-cut section jumps — sections likely fade/rise into place as they cross the viewport, consistent with the generous inter-section whitespace observed.

## Guardrails
- Never round the flat card, panel, or grid-tile corners — every measured card is 0px radius; only the nav badge, reserve pill, and form-submit control use circular/pill shapes.
- Do not replace the engraved line-art illustrations with photography or flat icons — the illustration-vs-photo split is structural to this identity.
- Keep the red accent rationed to rules, one solid panel per section, and type fills — never tint the cream background itself or introduce a second hue.
- Preserve the hairline red outer rulebox on every viewport — it is the page's frame, not a decorative divider.
- Do not shrink or reflow the giant Playfair marquee into a conventional hero headline size; its scale relative to body copy (roughly 15–17×) is the system's central gesture.
- Never substitute the glass/pill reserve button's spec for a differently-styled ghost text button, and vice versa — the two coexist as distinct variants.