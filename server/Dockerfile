FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server/index.mjs ./server/index.mjs
COPY server/askRecovery.mjs ./server/askRecovery.mjs
COPY public/search-index.json ./public/search-index.json

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/index.mjs"]
