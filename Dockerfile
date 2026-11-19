# Cinematic Pointer CLI image.
#
# One image for every place the CLI runs unattended: capture, export, produce and tour, with
# Chromium and FFmpeg inside. CEQ's CPU worker is built on top of it (RFC 0061).
#
# The CLI runs through tsx, the way every verified take was produced, so the dev dependencies
# stay. Chromium is the only browser installed.
#
# Chromium runs without its own sandbox here, which is Playwright's default: it needs a kernel
# feature containers rarely grant. The container, and the network policy around it, are the
# boundary. Never run this image with more privilege than a plain non-root container.

FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    HUSKY=0 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    HOME=/home/pointer

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/cinematic-pointer

# Dependencies first, from the committed lockfile, without running any package's install script.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

# Chromium at the version the lockfile's Playwright expects, with the system libraries it needs.
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src
COPY catalog ./catalog
COPY journeys ./journeys
COPY LICENSE NOTICE ./

# The home directory already exists by now (npm made it, as root), so it is handed over
# explicitly, together with the working directory outputs are written to.
RUN useradd -r -u 1001 -d /home/pointer pointer \
    && install -d -o 1001 -g 1001 /home/pointer /work
USER 1001
WORKDIR /work

# The image is not published unless both halves actually run as the runtime user: the CLI
# starts, the native modules load, FFmpeg answers, and Chromium opens a page.
RUN set -eu; \
    CLI="/opt/cinematic-pointer/node_modules/.bin/tsx /opt/cinematic-pointer/src/cli.ts"; \
    $CLI --version; \
    $CLI capture page --help | grep -q -- '--allow-hosts'; \
    $CLI export --help > /dev/null; \
    $CLI produce --help > /dev/null; \
    ffmpeg -version > /dev/null; \
    touch /work/.writable "$HOME/.writable" && rm /work/.writable "$HOME/.writable"; \
    cd /opt/cinematic-pointer; \
    node -e "require('sharp'); require('esbuild')" 2>/dev/null || node -e "require('sharp')"; \
    node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage();await p.setContent('<h1>ok</h1>');const t=await p.textContent('h1');await b.close();if(t!=='ok')process.exit(1);console.log('chromium: opened a page')})().catch(e=>{console.error(e);process.exit(1)})"

ENTRYPOINT ["/opt/cinematic-pointer/node_modules/.bin/tsx", "/opt/cinematic-pointer/src/cli.ts"]
CMD ["--help"]
