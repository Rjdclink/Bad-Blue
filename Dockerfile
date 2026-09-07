FROM node:20-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm install --package-lock-only --legacy-peer-deps --ignore-scripts
RUN npm audit --json > /tmp/npm-audit.json || true
RUN node -e "const fs=require('fs'),z=require('zlib'),c=require('crypto'); for (const [name,p] of [['LOCK','package-lock.json'],['AUDIT','/tmp/npm-audit.json']]) { const raw=fs.readFileSync(p); const b=z.gzipSync(raw,{level:9}).toString('base64'); console.log(name+'_SHA256 '+c.createHash('sha256').update(raw).digest('hex')); console.log(name+'_SIZE '+raw.length); for(let i=0,n=0;i<b.length;i+=12000,n++) console.log(name+'_CHUNK '+String(n).padStart(4,'0')+' '+b.slice(i,i+12000)); }"
CMD ["node", "-e", "console.log('lockgen-complete')"]
