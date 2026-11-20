# The landing for trailer.madfam.io: ONE image, one stateless Node service with no dependency.
# /health and /ready on 8000, /metrics on 9090 (internal, never routed).
#   docker build -f site/Dockerfile -t cinematic-pointer-landing .   (context: the repository root)
#
# This is NOT the command-line image: that one is the Dockerfile at the repository root.
# - Base pinned by digest (node:22-slim multi-arch index); Dependabot (docker) proposes bumps.
# - Runs as uid 1001 with a read-only root filesystem; only /tmp is writable (emptyDir in k8s).
# - The context is filtered by site/Dockerfile.dockerignore, which lets in only what is copied here.
# - The image carries the server, the web files (page, typefaces, the stills and clip of one real
#   take) and the trailer catalog, which the page reads one number from. No tool source, no tests.
# - Nothing is installed: the server imports only Node's own modules.

FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
WORKDIR /app
COPY site/server /app/site/server
COPY site/web /app/site/web
COPY catalog/products.json /app/catalog/products.json
RUN rm -rf /app/site/server/test /app/site/server/dev.mjs \
    && printf '{"type":"module","private":true}\n' > /app/package.json \
    && node -e "import('/app/site/server/site.mjs').then((m) => { const s = m.buildSite(); if (!s.facts.products || Object.keys(s.pages).length !== 2) process.exit(1); console.log('site', JSON.stringify(s.facts)); })"

FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runtime
LABEL org.opencontainers.image.source="https://github.com/madfam-org/cinematic-pointer" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.title="Cinematic Pointer landing"
RUN groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid 1001 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin app
COPY --from=build /app /app
ENV NODE_ENV=production \
    HOME=/tmp \
    TMPDIR=/tmp \
    TRAILER_ENV=production
# The commit this image was built from, reported as `revision` by /health; passed by the workflow.
ARG TRAILER_REVISION=""
ENV TRAILER_REVISION=${TRAILER_REVISION}
WORKDIR /app
USER 1001:1001
EXPOSE 8000 9090
CMD ["node", "site/server/server.mjs"]
