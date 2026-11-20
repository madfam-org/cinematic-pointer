---
name: Cinematic Pointer
description: The glass case outside a neighbourhood cinema, pinned with real stills of a real film.
colors:
  ink: '#1b100c'
  stock: '#f6f1e4'
  vermilion: '#e2502a'
  marigold: '#f2b705'
  night: '#12355b'
  green: '#0b6e4f'
  tack-red: '#b5361a'
  card-soft: '#54453c'
  today-text: '#eef0ea'
  today-register: '#07192d'
  today-rule: '#3a5f8a'
  soon-text: '#f0f4ec'
  soon-register: '#043524'
  hero-field-night: '#8a2a14'
  hero-text-night: '#f8ebe0'
  shots-field-night: '#3b2a04'
  shots-text-night: '#f1e9d2'
  shots-register-night: '#1c1300'
  today-field-night: '#0a1626'
  today-rule-night: '#2b4668'
  soon-field-night: '#06382a'
  soon-register-night: '#021d15'
  box-field-night: '#1a1310'
  box-text-night: '#ece5d6'
  box-title-night: '#ff7a52'
  box-register-night: '#5b2412'
  marquee-night: '#05090f'
typography:
  display:
    fontFamily: 'Bowlby One, Archivo, sans-serif'
    fontSize: 'clamp(2.35rem, 4.35vw, 4.25rem)'
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: '-0.012em'
  headline:
    fontFamily: 'Bowlby One, Archivo, sans-serif'
    fontSize: 'clamp(2.3rem, 6.2vw, 4.75rem)'
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: '-0.012em'
  title:
    fontFamily: 'Bowlby One, Archivo, sans-serif'
    fontSize: 'clamp(1.3rem, 2.1vw, 1.75rem)'
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: '-0.012em'
  lede:
    fontFamily: 'Archivo, system-ui, sans-serif'
    fontSize: 'clamp(1.125rem, 1.5vw, 1.3125rem)'
    fontWeight: 500
    lineHeight: 1.45
  body:
    fontFamily: 'Archivo, system-ui, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'Archivo Narrow, Archivo, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '0.1em'
  billing:
    fontFamily: 'Archivo Narrow, Archivo, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: '0.075em'
  script:
    fontFamily: 'Yesteryear, cursive'
    fontSize: 'clamp(1.35rem, 2.4vw, 1.9rem)'
    fontWeight: 400
    lineHeight: 1
  code:
    fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace'
    fontSize: '0.875rem'
    lineHeight: 1.5
rounded:
  paper: '2px'
  stamp: '3px'
spacing:
  gutter: 'clamp(1rem, 4vw, 3rem)'
  band: 'clamp(3.5rem, 9vw, 7.5rem)'
components:
  stub:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.stock}'
    typography: '{typography.label}'
    rounded: '{rounded.paper}'
    padding: '0.55rem 1.25rem'
    height: '2.75rem'
  stub-hover:
    backgroundColor: '{colors.vermilion}'
    textColor: '{colors.ink}'
  stub-primary:
    backgroundColor: '{colors.vermilion}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.paper}'
    padding: '0.55rem 1.75rem'
    height: '2.75rem'
  stub-primary-hover:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.stock}'
  stub-play:
    backgroundColor: '{colors.marigold}'
    textColor: '{colors.ink}'
    height: '2.5rem'
  stub-done:
    backgroundColor: '{colors.green}'
    textColor: '{colors.stock}'
  lobby-card:
    backgroundColor: '{colors.stock}'
    textColor: '{colors.ink}'
    rounded: '{rounded.paper}'
    padding: 'clamp(0.55rem, 1.1vw, 0.9rem)'
  ticket:
    backgroundColor: '{colors.stock}'
    textColor: '{colors.ink}'
    rounded: '{rounded.paper}'
    padding: '1.15rem 1.5rem 1.25rem'
  ticket-command:
    textColor: '{colors.ink}'
    typography: '{typography.code}'
    rounded: '{rounded.paper}'
    padding: '0.75rem 0.85rem'
  marquee:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.stock}'
    typography: '{typography.label}'
    padding: '0.7rem clamp(1rem, 4vw, 3rem)'
  stamp:
    textColor: '{colors.soon-text}'
    typography: '{typography.label}'
    rounded: '{rounded.stamp}'
    padding: '0.4rem 0.8rem'
---

# Design System: Cinematic Pointer

## Overview

**Creative North Star: "The Case Outside the Cinema"**

The page is the glass case on the wall outside a neighbourhood cinema. Behind the glass, flat
printed colour runs edge to edge, and on it hang lobby cards: pale card stock, a thin ink border, a
thumbtack, a small tilt. Every card holds a real still of a film the tool made from a live page.
The reader is a passer-by deciding whether to buy a ticket, so the controls are ticket stubs and
the commands sit on tickets.

It is a printed world. Colour is ink laid flat, one ink per band, with no gradients and no glass.
Lettering is fat poster type with a second ink printed slightly out of register. The only soft
thing on the page is the shadow a pinned card throws on the wall behind it. Density is generous:
five bands, each with one job, each large enough to be read from across the street.

The system is honest by construction. A card may only frame footage that exists, and work that has
not shipped is stamped as in production and shown as line drawings, never as stills.

**Key Characteristics:**

- One flat ink owns each whole band; cards and tickets are the only pale objects on it.
- Card stock is a constant: it does not change between the light and dark schemes.
- Poster lettering carries a hard, unblurred second ink offset down and to the right.
- Every control is a ticket stub with a perforated short edge.
- Stills are real frames; a halftone screen covers the printed still and lifts while film plays.
- The second ink registers once on arrival; nothing animates on scroll.

## Colors

Six printing inks, used flat and at full strength, each given a whole field to itself.

### Primary

- **Vermilion** (#e2502a): the hero field, the primary stub, the hover ink of every other stub,
  and the box-office title on stock. It is the colour of the case itself.
- **Tack Red** (#b5361a): vermilion deepened for small text on card stock, where vermilion would
  be too faint: the script line, alternate card titles, the step numerals, and the thumbtack.

### Secondary

- **Marigold** (#f2b705): the field behind the five shots, the name on the marquee, the title on
  the night band, the play stub on a still, the stamp border, the selection colour, and the second
  ink behind the film's name on the feature card.

### Tertiary

- **Night Blue** (#12355b): the field for what runs today, and the ink of the film's name and of
  alternate card titles on stock.
- **Green** (#0b6e4f): the field for work in production, and the confirmed state of a stub (copied,
  sound on, shot playing).

### Neutral

- **Ink** (#1b100c): a warm brown-black. Text on the light fields, the marquee and footer, the card
  border, the default stub.
- **Stock** (#f6f1e4): pale card stock. Cards, tickets, the box-office field, lettering on
  vermilion and green.
- **Soft Ink** (#54453c): billing capitals, shot numbers and notes on card stock.
- **Field text** (today-text, soon-text): near-white tinted toward the field it sits on.
- **Register inks** (today-register, soon-register): a darker cut of the field, printed behind the
  lettering on the two deep bands where a bright second ink would shout.

### The five fields

Each band sets four roles: field, text, title and register (the second ink).

- **Hero:** vermilion field, ink text, stock title, ink register.
- **Shots:** marigold field, ink text, ink title, vermilion register.
- **Today:** night field, today-text, marigold title, today-register, today-rule for hairlines.
- **Soon:** green field, soon-text, stock title, soon-register.
- **Box office:** stock field, ink text, vermilion title, marigold register.

### The case at night

The dark scheme is the same case after dark: the fields go deep and the lit cards carry the light.
It follows the reader's system setting; there is no toggle.

- **Hero** stays a red field (hero-field-night), with hero-text-night and the stock title.
- **Shots** drops to a dark amber (shots-field-night); the title turns marigold.
- **Today** and **Soon** deepen (today-field-night, soon-field-night) with darker registers.
- **Box office** becomes a warm near-black (box-field-night) and its title a lit vermilion
  (box-title-night).
- **Marquee and footer** go to marquee-night.

### Named Rules

**The One Ink Per Band Rule.** A band is one flat ink from edge to edge. No gradient, no texture,
no second field inside it. The only things that sit on a field are type, hairlines, cards and
tickets.

**The Card Stock Rule.** Cards, tickets and stubs are printed objects lit by the case. Their stock,
ink and soft ink never change with the colour scheme.

**The Red Stays Red Rule.** At night the hero is still a red field. It darkens; it does not turn
grey, black or blue.

**The Large Vermilion Rule.** Vermilion against stock, in either direction, is for poster-size
lettering only (3.4:1). Small red text on stock uses tack red (5.3:1).

## Typography

**Display Font:** Bowlby One (with Archivo, sans-serif)
**Body Font:** Archivo, variable 100 to 900 (with system-ui, sans-serif)
**Label Font:** Archivo Narrow, 400 to 700 (with Archivo, sans-serif)
**Script Font:** Yesteryear (with cursive)

**Character:** A poster shouted in one fat face, credits set tight in narrow capitals beneath it,
and plain text that stays out of the way. All four families are self-hosted as Latin and
Latin-extended subsets; the page makes no third-party request. Commands are set in the reader's
own system monospace.

### Hierarchy

- **Display** (400, clamp(2.35rem, 4.35vw, 4.25rem), 0.98): the hero headline, two unbroken lines,
  stock on vermilion. Below 60rem it scales with the viewport instead (10.4vw).
- **Headline** (400, clamp(2.3rem, 6.2vw, 4.75rem), 0.98): one per band, in the band's title ink.
- **Title** (400, clamp(1.3rem, 2.1vw, 1.75rem), 1.05): the name of a shot on its card; the bill's
  row names use the same face slightly larger, without a second ink.
- **Lede** (500, clamp(1.125rem, 1.5vw, 1.3125rem), 1.45): the two lines under the headline.
- **Body** (400, 1.0625rem, 1.55): running copy, held to about 38rem; 0.9375rem inside cards.
- **Label** (700, 0.875rem, 0.1em, uppercase): stubs, the marquee, ticket headings, the stamp.
- **Billing** (500, 0.8125rem, 0.075em, uppercase, soft ink): the credits block under a film's
  name, and the shot number with its duration in tabular figures.
- **Script** (400, clamp(1.35rem, 2.4vw, 1.9rem), tack red): the single word after the presenter's
  name on the feature card.
- **Code** (system monospace, 0.875rem, 1.5): commands, inside a dashed box.

### Named Rules

**The Second Ink Rule.** Poster lettering is printed twice: once in its own colour and once in the
band's register ink, offset 0.045em right and 0.05em down with no blur. The offset is a
misregistered print, so it is always hard-edged, always the same direction, and only ever applied
to Bowlby One. The thumbtack and the pointer carry the same device.

**The Script Once Rule.** Yesteryear appears once per card, for the presenter's line. It never sets
a heading, a label or body text.

**The Billing Block Rule.** Archivo Narrow is always uppercase and letterspaced. It is for credits,
numbers and controls, never for sentences.

## Layout

Five full-bleed bands stack under a marquee bar: hero, shots, today, soon, box office, then a
footer in the marquee's ink. Content sits in a centred column (78rem; 84rem in the hero) with a
fluid gutter (clamp(1rem, 4vw, 3rem)) and fluid band padding (clamp(3.5rem, 9vw, 7.5rem)).

- **Hero:** two columns, 11 to 13, so the feature card is larger than the copy beside it. Below
  60rem it becomes one column in the order headline, card, ticket, lede, note.
- **The case:** five cards on a twelve-column grid, deliberately uneven: a 5 and 7 pair, then
  three of 4, with staggered top margins and tilts between -1.6deg and 1.8deg. Two columns below
  60rem, one below 36rem with cards at 94% width alternating left and right.
- **The bill:** a definition list of 4 to 8 rows between hairlines; one column below 48rem.
- **Soon:** copy at 5, the wardrobe grid at 7; the grid is four across, two below 30rem.
- **Box office:** three tickets stepped down like a hand of stubs (0, 1.5rem, 3rem); stacked and
  level below 60rem.
- **Marquee:** sticky on wide screens; below 44rem it is static and the nav takes its own row.

Nothing sits level if it is paper: cards tilt, the stamp tilts, tickets step. Fields, hairlines and
type stay square.

## Elevation & Depth

Flat, with one exception. The fields have no depth at all. Paper pinned in front of a field throws
one soft shadow; that is the only blurred shadow in the system and it means "this is a physical
object in the case".

### Shadow Vocabulary

- **Pinned paper** (`0 1px 1px rgb(20 10 6 / 0.3), 0 18px 30px -14px rgb(20 10 6 / 0.55)`): lobby
  cards and tickets.
- **The pointer's shadow** (`drop-shadow(0 10px 8px rgb(20 10 6 / 0.35))`): the pointer resting on
  the feature card.
- **Second ink** (`0.045em 0.05em 0`, no blur): not elevation. It is the off-register print on
  lettering, and on the thumbtack as `1.5px 1.5px 0` in marigold.

### Named Rules

**The Pinned Paper Rule.** Only paper casts a shadow. Fields, bands, the marquee, stubs and type
never lift.

## Shapes

Cut paper. Corners are barely eased (2px) on cards, tickets, stubs and the focus ring; the stamp is
3px. The only circles are the thumbtack and the notches: a ticket has a half-round bite out of each
short edge, and a stub has a column of small perforations down both short edges, cut with a mask
so the field shows through. Borders are thin ink lines (1.5px on cards, 2px around a still), and
dashed lines mean "tear here" or "type this": the command box and the bill's commands. Film frames
keep true aspect ratios; stills are 16:9.

## Components

### Lobby card

The system's signature. Pale stock with a 1.5px ink border, a narrow stock margin, a soft pinned
shadow, a small tilt and a tack-red thumbtack at top centre. Inside: a 16:9 still outlined in ink,
then a band of copy.

- **Feature card:** holds the playing take. Its band reads presenter in narrow capitals, one script
  word, the film's name in night blue with a marigold second ink, then the billing block and two
  stubs for play and sound. The pointer, printed in two inks, rests on its lower right corner.
- **Shot card:** a still under a halftone screen (4px dot grid, multiplied). Its band carries the
  shot's name in poster lettering (night blue on odd cards, tack red on even), the shot number
  with its real duration, and one line on what the camera does.
- **Playing:** choosing a card's stub plays that shot inside the card; the halftone fades out
  (0.3s), the stub turns green, and the card settles back to its still when the shot ends.
- **Without script:** cards are stills and the film keeps the browser's own controls.

### Ticket stub (every control)

- **Shape:** a 2px-cornered block with perforated short edges, 2.75rem tall at minimum.
- **Default:** ink with stock label in narrow bold capitals.
- **Primary:** vermilion with ink label, wider padding; one per ticket, for copying the command.
- **On a still:** marigold with ink label, pinned to the lower left of the still.
- **Link stub:** the repository link is a larger vermilion stub (3rem) that turns marigold.
- **Hover / active:** the ink swaps (ink to vermilion, vermilion to ink) and the stub moves 1px up,
  then 1px down on press, over 0.2s.
- **Done:** green with stock label, for 1.8s after a copy, and while sound is on.
- **Focus:** a 3px outline offset 4px, in the ink that reads on the surrounding field.

### Ticket

Stock paper with a half-round notch in each short edge, a pinned shadow, and no tilt. It holds a
narrow-capital heading, the command in a dashed box (selectable in one click), a copy stub and a
soft-ink note. In the box office three tickets are numbered in tack red and stepped down.

### Bill rows

What runs today, set as a cinema bill on the night field: the name in Bowlby One in stock on the
left, a sentence and its command on the right, 2px hairlines between rows. Commands sit in a dashed
box in marigold. The export row adds six small frames at true aspect ratios, each cut from a real
still and tagged with its ratio.

### Marquee

A bar in ink across the top: the product name in Bowlby One in marigold, section links in narrow
capitals, and the other language as an outlined link. Links turn marigold on hover.

### Stamp

A marigold-bordered label in narrow capitals, tilted -2deg, that marks a band as in production. It
is used wherever unshipped work is described and nowhere else.

### Wardrobe grid

A ruled grid of single-weight line drawings (1.5px, stock) with narrow-capital names. Line drawings
are the form for things that do not exist yet; they are never framed as cards.

### Motion

On arrival, the second ink of the headline and of the film's name slides into register (1.1s,
`cubic-bezier(0.16, 1, 0.3, 1)`), and the pointer arrives at the card (1.2s). Both happen once.
Nothing is revealed, moved or faded by scrolling. With reduced motion requested, neither plays, the
film does not start by itself, and transitions are instant.

## Do's and Don'ts

### Do:

- **Do** give each band one flat ink and set its field, text, title and register roles together.
- **Do** put photographs and film only inside a lobby card, on stock, with its ink border and tack.
- **Do** use real frames from a real take, kept beside a record of their source.
- **Do** state a shot's real number and duration on its card.
- **Do** stamp unshipped work as in production and draw it in line, on the green field.
- **Do** make every control a ticket stub with a visible focus outline and a 2.5rem minimum height.
- **Do** keep the second ink hard-edged, down and to the right, and on Bowlby One only.
- **Do** keep card stock constant at night and let the fields darken around it.
- **Do** keep every font and asset self-hosted.

### Don't:

- **Don't** frame a mock-up, a render or a placeholder as a lobby card; an empty case is honest.
- **Don't** imply a library of films: one take exists, and the page shows one.
- **Don't** blur the second ink, or use a soft shadow on anything that is not pinned paper.
- **Don't** put gradients, glows or glass on a field.
- **Don't** animate on scroll; the two arrival movements are the whole budget.
- **Don't** let the hero turn black or grey in the dark scheme.
- **Don't** set small text in vermilion on stock; use tack red.
- **Don't** set sentences in Archivo Narrow, or anything but the presenter's word in Yesteryear.
- **Don't** play sound unasked or start the film when reduced motion is requested.
