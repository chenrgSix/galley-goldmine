FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim

WORKDIR /app
ENV GOLDMINE_HOME=/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ARG DEBIAN_MIRROR=http://mirrors.ustc.edu.cn/debian
COPY --from=build /app/node_modules ./node_modules
RUN npm install --global --omit=dev --ignore-scripts @wechatsync/cli@1.1.0 \
    && npm cache clean --force \
    && sed -Ei "s|^URIs: https?://deb\.debian\.org/debian/?$|URIs: ${DEBIAN_MIRROR}|" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && node node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 0700 -o node -g node /data
COPY package.json ./
COPY drizzle ./drizzle
COPY --from=build /app/dist ./dist

USER node
ENTRYPOINT ["node", "/app/dist/cli/index.js"]
CMD ["--help"]
