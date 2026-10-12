FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY lib/search.mjs lib/sourceLinks.mjs lib/pageRoutes.mjs lib/scriptBlocks.mjs ./lib/
COPY server/groundingSources.mjs ./server/groundingSources.mjs
COPY server/index.mjs ./server/index.mjs
COPY server/askRecovery.mjs ./server/askRecovery.mjs
COPY server/geminiFallback.mjs ./server/geminiFallback.mjs
COPY public/search-index.json public/script-manifest.json ./public/
COPY public/scripts ./public/scripts/

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/index.mjs"]
