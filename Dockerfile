FROM node:20-bookworm-slim
WORKDIR /app
COPY . .
# DIAGNOSTIC ONLY: source-only CJS prebuild verifiers require no npm install.
RUN node scripts/cryptocrawl/verify-deployment-preflight.cjs
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "-e", "const http=require('http');const p=Number(process.env.PORT)||3000;http.createServer((_q,r)=>{r.statusCode=200;r.end('preflight-diag-ok')}).listen(p,'0.0.0.0')"]
