FROM node:22-slim

WORKDIR /app

COPY server/index.mjs ./server/index.mjs
COPY public/search-index.json ./public/search-index.json

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/index.mjs"]
