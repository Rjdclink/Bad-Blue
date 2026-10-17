#!/usr/bin/env node
'use strict';
// One-shot, read-only processor of Railway --http --json NDJSON. No network access.
const {createMesh} = require('./mesh.cjs');
const MAX_LINE_BYTES = 16 * 1024;
const mesh = createMesh();
let buffer = '';
let discarding = false;

function completeLine(part) {
  if (discarding || Buffer.byteLength(buffer, 'utf8') + Buffer.byteLength(part, 'utf8') > MAX_LINE_BYTES) {
    mesh.observe(null);
  } else {
    const line = buffer + part;
    if (line.trim()) {
      try { mesh.observe(JSON.parse(line)); } catch { mesh.observe(null); }
    }
  }
  buffer = '';
  discarding = false;
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  const parts = chunk.split('\n');
  for (let i = 0; i < parts.length - 1; i++) completeLine(parts[i]);
  const remainder = parts[parts.length - 1];
  if (!discarding) {
    if (Buffer.byteLength(buffer, 'utf8') + Buffer.byteLength(remainder, 'utf8') > MAX_LINE_BYTES) {
      buffer = '';
      discarding = true;
    } else {
      buffer += remainder;
    }
  }
});
process.stdin.on('end', () => {
  if (buffer || discarding) completeLine('');
  process.stdout.write(JSON.stringify(mesh.snapshot()) + '\n');
});
