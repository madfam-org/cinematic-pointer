# Deployment contract: the landing

> Last Updated: 2026-11-20
>
> Boundary: Enclii-first. This file names the service, its ports, its host and the absence of secrets.
> Operator gates and adapter-gap records live in MADFAM's private ops repository; this file keeps the
> public-safe command sequence only.

Only the landing is deployed from this repository. The command-line tool is not a service: it is an
image (`ghcr.io/madfam-org/cinematic-pointer`, built by `image.yml`) that consumers pin by digest.

The Landing workflow is **dispatch-only**; a merge never builds or deploys by itself
(`autoDeploy: false` in [`../enclii.yaml`](../enclii.yaml)).

## Host names

| Host                | Surface                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `trailer.madfam.io` | The landing (owner direction, 2026-11-19). The only host that exists today |

MADFAM's wildcard certificate covers one level under `madfam.io`, so a name is never nested. A further
surface takes a hyphenated name on the same level: `trailer-api.madfam.io` for an interface to request
or fetch films, `trailer-admin.madfam.io` for an operator view. Neither exists. A host is declared in
`enclii.yaml` only when a runtime exists for it, and creating each new name needs the owner's word.

## What is served

| Path  | Surface                                      | Indexing                                                                                  |
| ----- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/`   | The landing in Spanish (the source language) | `X-Robots-Tag: noindex, nofollow`, `<meta name="robots">` and a disallow-all `robots.txt` |
| `/en` | The same landing in English                  | the same                                                                                  |

The page stays out of search until the owner says to index it; `INDEXABLE` in
[`../site/server/config.mjs`](../site/server/config.mjs) is the one switch, and a test holds it off.
The zone's edge places its own managed block ahead of any `robots.txt`, so the header and the meta tag
carry the rule, never `robots.txt` alone.

The host answers `/health` (liveness) and `/ready` (the site was built: both languages, the catalog
count, the assets). `/metrics` listens only on the internal port 9090 (Service
`cinematic-pointer-landing-metrics`), never routed; on 8000 it is 404. In production any other host
gets 421. Stateless: **no database, no bucket, no Janua client, no secret, no cookie, no analytics, no
outbound call**. The page's only links out go to this repository.

**Footage.** The landing ships five stills and one clip of a real take of `https://enclii.dev/`, by
the owner's permission (2026-11-19). They are the only recordings in this repository; their source is
recorded in [`../site/web/footage/SOURCE.json`](../site/web/footage/SOURCE.json), and the exception is
written in [`REPO_BOUNDARY.md`](./REPO_BOUNDARY.md).

## Runtime

One image ([`../site/Dockerfile`](../site/Dockerfile), `node:22-slim` pinned by digest, nothing
installed) behind one Service `cinematic-pointer-landing` (Service port 80 → container 8000). uid 1001,
read-only root (only `/tmp` writable), drop ALL capabilities, seccomp RuntimeDefault, no service links,
no service-account token. Two replicas, surge rollout, PodDisruptionBudget, liveness and readiness
probes ([`../infra/k8s/production/`](../infra/k8s/production/)). Network: default deny; ingress 8000
from the tunnel namespace only, 9090 from the monitoring namespace only; egress DNS only.

The image holds the server, the web files and `catalog/products.json` (the page reads the count of
filmable products from it). The tool's source is not in it.

| Variable               | Value               | Meaning                                   |
| ---------------------- | ------------------- | ----------------------------------------- |
| `TRAILER_ENV`          | `production`        | turns on the host check, HSTS and caching |
| `TRAILER_PUBLIC_HOSTS` | `trailer.madfam.io` | the only host that gets the page          |
| `TRAILER_PORT`         | `8000`              | the port the page is served on            |
| `TRAILER_METRICS_PORT` | `9090`              | the internal port `/metrics` answers on   |
| `TRAILER_REVISION`     | set at build        | the commit `/health` reports              |

## Guards

CI and the Landing workflow's preflight run `node --test site/server/test/*.test.mjs`: host and 421,
security headers, unindexed, both languages with the same structure, the clip's byte ranges, no
third-party request, no cookie, no price in the copy, a record for every footage and typeface file,
and the deployment files agreeing with each other (host, port 80, replicas, surge, read-only root, no
secret, digest pin, dispatch-only, the Dockerfile's COPY sources watched by the workflow).

Local preview without a container:

```bash
node site/server/dev.mjs
```

Local check of the image:

```bash
docker build -f site/Dockerfile --build-arg TRAILER_REVISION=local -t cinematic-pointer-landing:local .
```

```bash
docker run --rm --read-only --tmpfs /tmp --user 1001:1001 --cap-drop ALL -p 127.0.0.1:18760:8000 cinematic-pointer-landing:local
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: trailer.madfam.io' http://127.0.0.1:18760/
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: other.example' http://127.0.0.1:18760/
```

Expect 200 and 421.

## Onboarding sequence

Run from a machine with an Enclii login (`enclii login`) and the GitHub CLI. Each apply follows its own
dry run. Nothing here takes a secret value, and nothing here creates a Janua client: the landing has no
sign-in.

1. **Merge** the landing pull request into `main` (CI green).
2. **Build** (replaces the all-zero placeholder digest with the signed image digest, committed to `main`):

   ```bash
   gh workflow run landing.yml -R madfam-org/cinematic-pointer --ref main
   ```

3. **Onboard** (project, service, namespace `cinematic-pointer`, GitOps application; no database,
   bucket or secret). A first run can report `PARTIAL` until pods serve; `onboard ensure` then
   registers the domain:

   ```bash
   enclii onboard --repo madfam-org/cinematic-pointer --project cinematic-pointer --manifest-path infra/k8s/production --skip-postgres --skip-r2 --skip-secrets --dry-run
   ```

   ```bash
   enclii onboard ensure --repo madfam-org/cinematic-pointer --project cinematic-pointer --manifest-path infra/k8s/production --namespace cinematic-pointer
   ```

4. **Domain** (proxied DNS and TLS for the one host declared in `enclii.yaml`). Run it until
   `stillMissing` is empty; a first pass can end `partial`:

   ```bash
   enclii ops domains reconcile cinematic-pointer-landing
   ```

5. **Tunnel route** (to the Service `cinematic-pointer-landing`, port 80):

   ```bash
   enclii providers cloudflare tunnels-apply --project cinematic-pointer
   ```

6. **Probe** from outside:

   ```bash
   curl -s https://trailer.madfam.io/health
   ```

   ```bash
   curl -sI https://trailer.madfam.io/ | grep -i -E '^(HTTP|x-robots-tag|content-security-policy)'
   ```

The zone's edge adds an analytics script tag to HTML it serves to browsers. The page's content
security policy (`script-src 'self'`) refuses it, so nothing is measured; do not loosen that policy.
Turning the tag off is a zone setting and the owner's call.
