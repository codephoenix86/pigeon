# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates dumb-init openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS dependencies

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS build

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM dependencies AS migration

ENV NODE_ENV=production

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "prisma:deploy"]

FROM base AS production-dependencies

COPY package.json package-lock.json ./
COPY prisma ./prisma
# Prisma Client declares the CLI and TypeScript as optional peers. Keep them in
# the migration image, but remove them from the long-running application image.
RUN npm ci --omit=dev --omit=peer --ignore-scripts \
  && npm uninstall --no-save --omit=dev --omit=peer prisma typescript
COPY --from=dependencies /app/node_modules/.prisma ./node_modules/.prisma

FROM base AS runtime

ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma

USER node

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
