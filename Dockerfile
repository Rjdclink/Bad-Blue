FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Diagnostic-only PR: execute the exact repository prebuild chain and stop before
# Vite/esbuild. This branch is never mergeable; it exists only to separate a
# verifier/prebuild failure from a compiler/build failure using Railway as the
# executable oracle while GitHub Actions is unavailable.
RUN npm run prebuild

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "-e", "const http=require('http');const p=Number(process.env.PORT)||3000;http.createServer((_q,r)=>{r.statusCode=200;r.end('prebuild-ok')}).listen(p,'0.0.0.0')"]
