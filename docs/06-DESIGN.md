# 06 — Design: "Trattoria broadsheet" applied to The Dispatch

**Decision:** use the *Trattoria broadsheet* system (`trattoria-broadsheet-design.md`). Do **not** use *Archival Cream Ledger*, and do not mix the two.

## 1. Why this system

| Reason | Detail |
|---|---|
| The product is a newsletter | A cream newsprint page, a ruled box and a giant serif masthead are the visual language of a printed dispatch. The identity is already "The Dispatch". |
| One rationed accent | Vermillion carries status, rules and emphasis, so the pipeline state is readable at a glance without a second hue. |
| It survives email | Flat fills, hairline borders, 0 radius, no gradients, no shadows, no backdrop blur. All of it renders in Gmail/Outlook. The Ledger system relies on gradients, `backdrop-filter`, video and a proprietary face (Concrette). |
| Free assets | Playfair Display, Bitter, PT Sans are on Google Fonts. Concrette is not. |
| Cheap to build | Flat rectangles and rules. No component library, no illustration pipeline. |
| Tables fit | Hairline-ruled rows are natural for run logs and subscriber counts. |

Borrow nothing visual from the Ledger system. (Its idea of table-like list rows is already covered by hairline-ruled rows.)

## 2. Where we deliberately adapt the system

The source is a restaurant landing page. We extend it in only these ways, and document them in `docs/DECISIONS.md`:

1. **The 304 px marquee is used once**: the landing-page masthead "The Dispatch", scaled with `clamp()` so it fits mobile. Everywhere else (dashboard, archive, forms) use the 88/48/28/20 px steps below. Never shrink the *landing* marquee to a normal H1.
2. **Status without a second hue.** The source forbids any other color. Status is shown with text labels, glyphs and the red stamp: `● CONFIRMED`, `○ PENDING`, a red outline + `!` for errors. No green/yellow/blue.
3. **Data tables and bars** use ink-on-cream with red used only for the highlighted row/bar.
4. **Engraved illustrations**: we do not have the woodcut art. Use one or two inline SVG ornaments only (diamond glyph, rubber-stamp circle, simple rule flourishes). No stock illustrations, no photos, no emoji in the web UI.
5. **Motion**: CSS transitions only (no GSAP/Lenis). Respect `prefers-reduced-motion`.

## 3. Tokens

```css
:root {
  --paper: #F9F8F2;
  --paper-taupe: #CABFB5;
  --ink: #1A1A1A;
  --ink-body: #333333;
  --ink-soft: #3C3C3C;
  --red: #DA4143;
  --white: #FFFFFF;

  --rule: 1px solid var(--red);        /* hairline */
  --rule-thick: 2px solid var(--red);
  --frame-inset: 12px;

  --font-display: "Playfair Display", Georgia, "Times New Roman", serif;
  --font-body: "Bitter", Georgia, serif;
  --font-ui: "PT Sans", Arial, sans-serif;

  --space-1: 4px; --space-2: 8px; --space-3: 16px; --space-4: 24px;
  --space-5: 32px; --space-6: 48px; --space-7: 64px;
  --measure: 864px;
  --radius-pill: 500px;               /* only for pill buttons */
  --radius-0: 0;
}
```

**Radius:** 0 everywhere except pill buttons (500px) and circular stamp/badge. No shadows on cards. The only shadow allowed is the soft lift under the outer page frame: `0 5px 25px rgba(0,0,0,.25)` (optional).

**Paper grain:** a fixed full-page background using an inline SVG `feTurbulence` noise as a data-URI at ~4–6% opacity over `--paper`. No image file needed.

## 4. Type scale

| Role | Font | Size | Weight | Leading | Tracking |
|---|---|---|---|---|---|
| Landing marquee | Playfair Display | `clamp(72px, 18vw, 304px)` | 700 | 0.9 | -4px (scale down on mobile: -0.015em) |
| Page title | Playfair Display | 88px (desktop), 48px (mobile) | 700 | 1.05 | -2px |
| Section heading | Playfair Display | 48px → 28px | 700 | 1.1 | -1px |
| Card heading | Playfair Display | 28px → 20px | 700 | 1.2 | -0.5px |
| Body | Bitter | 18px | 400 (300 for long text) | 1.4 | 0 |
| Eyebrow / label | Playfair Display italic | 16px | 400 italic | 1.2 | 0 |
| UI labels, table headers, buttons | PT Sans | 14px, uppercase, +0.08em | 400/700 | 1.2 | |
| Drop-cap numerals | Playfair Display | 28px, white on ink square 40×40 | 700 | 1 | |

Italic serif is for eyebrows, quotes and sign-offs only, never full paragraphs.

## 5. Colour use rules

- Cream page; ink text. Red appears as: the page rulebox, card borders, the marquee fill (landing), one solid red panel per section, link/CTA text, and the highlighted row/bar.
- **Accessibility:** red on cream is about 4.1:1 and white on red about 4.4:1 (approximate, verify with a checker). That fails 4.5:1 for small text. Therefore: red text only at **≥18 px or bold ≥14 px**; small text always `--ink`. White-on-red only for ≥18 px bold or headings.
- Never tint the cream background. Never add a second hue.

## 6. Layout

- **Page frame:** every page is inside a 1 px red rulebox inset 12 px from the viewport edge (`position: fixed` pseudo-element or a wrapper with `border`). On mobile inset 6 px.
- Text measure max 864 px. Panels may go wider inside the frame.
- Section padding 64 px desktop / 32 px mobile.
- Grids: 3-up cards (gap 24), 2-up split (gap 48). Stack to single column below 768 px.
- Cards: 0 radius, transparent, 1 px red border (or no border with generous space). One solid red card per section at most.

## 7. Components

| Component | Spec |
|---|---|
| Navbar | Three zones inside the frame: left circular red "MENU"-style badge (for us: the diamond glyph), centre bordered wordmark box "THE DISPATCH", right pill button "SUBSCRIBE". Mobile: wordmark + pill only. |
| Pill button (primary) | Transparent fill, `--ink` text at 14 px uppercase PT Sans bold (red text allowed only if ≥18 px), 2 px red border, radius 500px, height 42 px, padding 10px 24px. Hover: fill red, text white, `transform: translateY(-1px)` with `cubic-bezier(0.25,0.1,0.754,2.474)` over 0.15 s (reduced-motion: no transform). |
| Ghost text button | Transparent, `--ink-body`, 0 radius, underline on hover. |
| Red link | PT Sans/Playfair italic, red, ≥18 px. |
| Input | Label above (Playfair italic 16 px, ink), field with 1 px ink border, 0 radius, 44 px tall, cream-tinted translucent fill. Focus: 2 px red outline offset 2 px. |
| Stamp | 96 px circle, 2 px red border, uppercase PT Sans 12 px red, rotated −8°, used for issue status on dashboard: `CONFIRMED`, `HELD`, `SENT`. |
| Status marker | Text + glyph: `● CONFIRMED`, `○ PENDING`, `◐ SENDING`, `! HELD` (red outline). |
| Table | Full-width, 1 px red top and bottom rules, 1 px `rgba(218,65,67,.25)` row rules, header row PT Sans uppercase 14 px, cells Bitter 16 px, no zebra fill, no radius. |
| Bar (chart) | Horizontal bars in `--ink`; highlighted bar `--red`; label left, value right; no gridlines beyond a baseline rule. |
| Drop-cap numeral | Black square with white numeral for story numbers in the archive and the email. |
| Footer | Full-width box with red rule, three columns (Pages / Elsewhere / About), small italic labels. |

## 7b. Pages

> **As built (2026-10-12):** the landing page and subscribe form below were built, then removed when the app became Shreya's desk. `/` now redirects to `/desk`, which uses the same tokens, rulebox and type scale (its hero uses the 48 px section heading). The "dashboard" became `/status` (Settings & status). See `docs/DECISIONS.md`.

**Landing `/`** *(removed)*
1. Masthead marquee "THE / DISPATCH" split across two lines with a red diamond glyph between (the signature move). Eyebrow italic: "A weekly read on India's startup ecosystem".
2. Two-column band: left = prose + subscribe form; right = solid red panel with the latest issue's headline list (white text ≥18 px bold).
3. Three-up "How it works" cards: Collected → Curated → Confirmed (one line each).
4. Footer.

**Archive `/issues`** — hairline-ruled list: date, number of stories, topics as italic labels.
**Issue `/issues/[slug]`** — web view of the sent email: masthead, numbered stories with drop-cap numerals, topic eyebrow, headline, commentary, source link.

**Dashboard `/dashboard`** (public read-only, counts only, no emails)
- Top: issue stamp + status marker + issue date.
- Row of four figures in Playfair 88 px: articles fetched this week · new candidates · duplicates caught · stories picked.
- Table: last 15 `pipeline_runs` (job, started IST, duration, ok, key counts).
- Table: sources with last OK time and failures (active/paused).
- Bars: topic spread of current picks; subscribers by status.
- Block: "Voice match" — % of commentary accepted unedited.
- Admin strip (only if `ADMIN_TOKEN` cookie present): Run now buttons per job, simulate bounce/unsubscribe.
- Auto-refresh every 30 s via a small client component (no websocket).

**Unsubscribe `/unsubscribe`** — one centred card, one pill button "Unsubscribe me", a quiet "Never mind" link. After: "You're off the list" in Playfair italic.

## 8. Email template (`lib/mail/render.ts`)

Email clients ignore most modern CSS. Rules:

- Table-based layout, 600 px wide container, centred; all CSS **inline**.
- Colours: background `#F9F8F2`, ink `#333333`, rule/accent `#DA4143`. A 1 px red border around the 600 px container is the rulebox.
- Fonts: `font-family: Georgia, 'Times New Roman', serif` for headings and body (do not rely on web fonts; Playfair/Bitter may be added via `<link>` for clients that support it, but Georgia fallback must look right). Sizes: masthead 44 px, story headline 22 px bold, body 16 px/1.5.
- Masthead: "THE DISPATCH" centred, red diamond `◆`, issue date in italic, hairline red rule.
- Each story: ink square with white numeral (table cell, 32×32), topic label in small italic red caps ≥14 px bold (or ink), headline linking to the source, commentary paragraph, "Read at {publisher} →" link.
- Footer: small text, unsubscribe link (also in header), "You get this because you subscribed at {APP_URL}".
- No images required. No gradients, shadows, rounded corners, or video.
- Provide a plain-text alternative (`renderIssueText`) with the same content.
- Preview the HTML in the archive page (X3) to eyeball it. Test by sending to the allowlisted inbox and opening in Gmail web + mobile.
- Subject: `The Dispatch · {Thu 15 Oct} · {top story headline, ≤55 chars}`.

## 9. Guardrails (carried over, adapted)

- Never round card/panel corners. Pills only on buttons.
- Never add a second hue. Status = text/glyph/stamp.
- Keep red rationed: rules, one solid panel per section, large type, highlight.
- Keep the rulebox on every page.
- No photography; engraved art replaced by minimal inline SVG ornaments.
- Marquee scale is for the landing masthead only.
