FROM node:20-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN npm install --package-lock-only --legacy-peer-deps --ignore-scripts
RUN npm audit fix --package-lock-only --legacy-peer-deps --ignore-scripts || true
RUN node -e "const fs=require('fs'),z=require('zlib'),c=require('crypto'); const raw=fs.readFileSync('package-lock.json'); const b=z.gzipSync(raw,{level:9}).toString('base64'); console.log('LOCK_SHA256 '+c.createHash('sha256').update(raw).digest('hex')); console.log('LOCK_SIZE '+raw.length); console.log('LOCK_GZIP_B64_SIZE '+b.length); for(let i=0,n=0;i<b.length;i+=20000,n++) console.log('LOCK_CHUNK_'+String(n).padStart(3,'0')+' '+b.slice(i,i+20000));"
CMD ["node", "-e", "console.log('lock-emitter-complete')"]
