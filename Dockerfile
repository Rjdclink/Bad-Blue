FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Diagnostic-only PR: isolate the first prebuild boundary. PR #495 remains
# untouched and this branch must never merge.
RUN node scripts/cryptocrawl/verify-deployment-preflight.cjs

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "-e", "const http=require('http');const p=Number(process.env.PORT)||3000;http.createServer((_q,r)=>{r.statusCode=200;r.end('deployment-preflight-ok')}).listen(p,'0.0.0.0')"]
