# Repository boundary

> Last Updated: 2026-11-17

cinematic-pointer is a **public** repository in the `madfam-org` organisation. It owns the journey
replayer, the cursor overlay, the post-production pipeline and the catalog of trailer journeys for
MADFAM's public product pages.

Keep here: reusable code, schemas and specs, product documentation, synthetic test fixtures, secret
**names**, and journeys that visit **public, signed-out** pages of MADFAM's own products.

Never put here:

- secret values, tokens, client-id literals or credentials of any kind, including a test account's
  password inside a journey (`fill` steps take synthetic values only);
- node hostnames, IP addresses, hardware, cluster names or tunnel ids;
- secret-store paths or break-glass procedures (production operations are Enclii-first);
- raw links into MADFAM's private ops repository (name a document, never link it);
- MADFAM prices, costs, margins or quotes typed by hand. A trailer may **film** a public pricing page;
  it never restates a price in a caption, a journey comment or a document (pricing is ruled through
  Tulana and Dhanam);
- a client's hosts, workspace or name. A product that is delivered to a client is filmed on MADFAM's own
  public host or not at all;
- recordings of a signed-in session, a real person's data, or any page behind a sign-in;
- supplier, client or staff identities, or people's names beyond the public maintainer handles;
- rendered video, raw recordings or event logs (`artifacts/`, `exports/` are git-ignored; published
  trailers live with the product they belong to, not in this repository).

Enclii owns routine deployment, observability and secret intake. Record missing platform capabilities
privately; do not add a raw production-access fallback. Licensing, governance, naming, visibility and
access rulings remain with the owner. A test skip or an unavailable dependency is not verification, and
a pending CI run is not green.

Canonical policy: the MADFAM repository boundary contract, kept in MADFAM's private ops repository. The
[public ecosystem contract hub](https://github.com/madfam-org/solarpunk-foundry) owns shared public
ecosystem guidance.
