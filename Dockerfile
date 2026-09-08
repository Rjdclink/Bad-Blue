FROM node:20-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN npm install --legacy-peer-deps --ignore-scripts
RUN npm ls basic-ftp axios form-data generative-bayesian-network mongoose undici preact ip-address brace-expansion browserslist minimatch picomatch rollup --all || true
RUN npm audit --json > /tmp/npm-audit.json || true
RUN node -e "const fs=require('fs'); const a=JSON.parse(fs.readFileSync('/tmp/npm-audit.json','utf8')); console.log('AUDIT_META '+JSON.stringify(a.metadata?.vulnerabilities||{})); for (const [name,v] of Object.entries(a.vulnerabilities||{})) if (v.severity==='critical'||v.severity==='high') console.log('AUDIT_VULN '+JSON.stringify({name,severity:v.severity,isDirect:v.isDirect,range:v.range,effects:v.effects||[],fixAvailable:v.fixAvailable,nodes:v.nodes||[]}));"
CMD ["node", "-e", "console.log('dependency-trace-complete')"]
