# Build context MUST be the /isb directory, never the LegalWhat repository root.
# Collector image has Railway API access but intentionally has NO HTTP listener.
FROM node:22-bookworm-slim AS verify
WORKDIR /opt/isb
COPY *.cjs ./
COPY Dockerfile Dockerfile.decoy ./
COPY collect.sh ./
RUN node --test *.test.cjs

FROM node:22-bookworm-slim
RUN npm install -g --no-audit --no-fund @railway/cli@5.68.0
WORKDIR /opt/isb
COPY observer.cjs normalize.cjs mesh.cjs agent.cjs run-agent.cjs ./
ENV NODE_ENV=production
USER node
CMD ["node", "run-agent.cjs", "--watch"]
