# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated (2026-11-19): plain static HTML and CSS with a small amount of script, served by one
dependency-free Node service, because that is how MADFAM's other stateless landings are built and
deployed. The tool itself is a TypeScript command-line program and has no interface of its own.

## Users

MADFAM's own product teams (owner ruling, 2026-11-19): the people who own a platform in the estate and
want a film of it. They arrive from an internal mention or a link, at a desk, with their own product's
public page in mind. Their job on the landing: see what a take looks like, learn what the tool does
today, and find how to ask for one (the repository and its commands). Outside builders can read the
page and use the open-source tool, but the page is not written for them first.

## Product Purpose

Cinematic Pointer films marketing material from MADFAM's own platforms. It opens a public, signed-out
page of a product in a real browser and turns it into a short film in which the pointer is the
protagonist: the pointer stands for the person the product is for. Success is a product team holding a
film of their own page that they did not have to shoot or edit by hand.

## Positioning

The films are made from the product's real, live public page, by a command, and every output is
measured before it is listed (bytes, length, dimensions, codec, two frames that differ). A take either
passed its measurements or is reported as failed; nothing is called a film on trust.

## Operating Context

A command line and a catalog. `catalog/products.json` lists the filmable products from MADFAM's public
product projection; `produce` films them one at a time; `capture page` writes a page as tiles with a
manifest; `export` writes one take to a matrix of formats and aspects with `export.json`; `tour` flies
past each product's captured page. The same tool is published as a container image for runs on
MADFAM's infrastructure.

## Capabilities and Constraints

Exists today:

- Cinematic takes of a page: title card, push-in on the headline, a montage of sections, a close on
  the call to action, an end card; 24 fps, letterbox, grain, a grade and a synthesized score. The page
  is a still inside the take, so nothing on it moves.
- A stepped recorder (a plain eased scroll, frame by frame) and a real-time recorder with the cursor
  overlay.
- Page capture as PNG tiles plus a manifest, read-only.
- Export to mp4, webm, hevc, gif and prores in 16:9, 9:16, 1:1, 4:5, 4:3 and 21:9; non-16:9 aspects
  are a centre crop.
- The estate tour stage: a flight past each product's captured page. Verified with one product; the
  whole estate has not been filmed.
- A catalog of 25 filmable products, and a published, signed command-line image.

In progress, not shipped: the pointer as a character with outfits (arrow, pointing hand, press,
I-beam, hourglass, move, crosshair, focus frame) and personas (guide, operator, analyst, explorer,
maker). It may be described only as in progress.

Constraints: public, signed-out pages of MADFAM's own products only. No prices restated, no client
names, no invented metrics. One real take has been rendered end to end on film (the Enclii landing);
the landing must not imply a library of films.

## Brand Commitments

Name: Cinematic Pointer. Host: `trailer.madfam.io`. Licence AGPL-3.0-only, holder Innovaciones MADFAM
S.A.S. de C.V. Spanish is the source language and English is served beside it (owner ruling,
2026-11-19). No visual identity existed before the landing.

## Evidence on Hand

- One real cinematic take of `https://enclii.dev/`, filmed 2026-11-18 at 1280x720 (draft quality: one
  picture per frame, no motion blur). The owner allowed the landing to ship stills and a short clip of
  it (2026-11-19); they live under `site/web/footage/` with a record of their source.
- The measured record of the first stepped take: 648 frames, 21.6 s, 1280x720.
- The catalog (`catalog/products.json`) and the documented command set in `AGENTS.md`.
- Absent, never to be fabricated: testimonials, customer logos, view counts, render-speed claims,
  films of any other product.

## Product Principles

1. The pointer is the protagonist, and behind it is the person the product is for.
2. Film the real page, never a mock-up of it.
3. A film is listed only after it is measured.
4. Read-only by default: a generated journey looks and never clicks.
5. Say what exists; label what is in progress.

## Accessibility & Inclusion

WCAG 2.2 AA for the landing. Motion respects `prefers-reduced-motion`; the film never plays sound
unasked; the page says the same thing with scripts off.
