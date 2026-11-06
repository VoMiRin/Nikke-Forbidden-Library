# Install the official security release while the Docker Hub image catches up.
# Cloud Run uses linux/amd64. Verify the archive before extracting it.
FROM node:22-slim AS patched-node
ADD https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.gz /tmp/node.tar.gz
RUN echo 'b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406  /tmp/node.tar.gz' | sha256sum -c - \
    && mkdir /opt/patched-node \
    && tar -xzf /tmp/node.tar.gz -C /opt/patched-node --strip-components=1 \
    && /opt/patched-node/bin/node --version

FROM node:22-slim
COPY --from=patched-node /opt/patched-node/ /usr/local/

WORKDIR /app

COPY package.json package-lock.json ./
# Fail if the base image does not meet package.json's patched Node.js requirement.
RUN node --version && npm ci --omit=dev --engine-strict

COPY lib/search.mjs lib/sourceLinks.mjs lib/pageRoutes.mjs lib/scriptBlocks.mjs ./lib/
COPY server/groundingSources.mjs ./server/groundingSources.mjs
COPY server/index.mjs ./server/index.mjs
COPY server/askRecovery.mjs ./server/askRecovery.mjs
COPY server/geminiFallback.mjs ./server/geminiFallback.mjs
COPY server/aiConfig.mjs ./server/aiConfig.mjs
COPY public/search-index.json public/script-manifest.json ./public/
COPY public/scripts ./public/scripts/

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/index.mjs"]
