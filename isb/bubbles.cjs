'use strict';
// Isolated, in-memory moving decoy cells. These are not routes to LegalWhat.
const {createHash, randomBytes: secureRandomBytes} = require('node:crypto');

function createIronBubbles(options = {}) {
  const size = options.size === undefined ? 128 : options.size;
  const radius = options.radius === undefined ? 2 : options.radius;
  const rotationMs = options.rotationMs === undefined ? 60_000 : options.rotationMs;
  const isolationMs = options.isolationMs === undefined ? 30_000 : options.isolationMs;
  if (!Number.isInteger(size) || size < 5 || size > 2048) throw new RangeError('Invalid decoy bubble count');
  if (!Number.isInteger(radius) || radius < 1 || radius * 2 >= size) throw new RangeError('Invalid decoy radius');
  if (!Number.isInteger(rotationMs) || rotationMs < 100 || rotationMs > 86_400_000) throw new RangeError('Invalid rotation');
  if (!Number.isInteger(isolationMs) || isolationMs < 100 || isolationMs > 86_400_000) throw new RangeError('Invalid regeneration delay');

  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const rng = typeof options.randomBytes === 'function' ? options.randomBytes : secureRandomBytes;
  const born = clock();
  if (!Number.isFinite(born)) throw new TypeError('Invalid clock');
  let nonce = 0, cursor = 0, shifted = 0, pops = 0, restored = 0;

  function freshToken() {
    // Distinct even with a deterministic test RNG. Identifiers have no authorization meaning.
    const salt = rng(16);
    if (!Buffer.isBuffer(salt) || salt.length !== 16) throw new TypeError('Invalid random source');
    return createHash('sha256').update(salt).update(String(++nonce)).digest('hex').slice(0, 32);
  }
  const cells = Array.from({length:size}, () => ({token: freshToken(), isolatedUntil: 0, rotateAt: born + rotationMs}));
  const publicEffect = Object.freeze({action: 'observe', enforcement: 'none'});

  function surrounding(center) {
    const indexes = [];
    for(let i = -radius; i <= radius; i++) indexes.push((center + i + size) % size);
    return indexes;
  }

  function react(input) {
    if (!input || input.channel !== 'decoy' || !['soft','hard'].includes(input.severity)) return publicEffect;
    try {
      const now = clock();
      if (!Number.isFinite(now)) return publicEffect;
      const selected = surrounding(cursor++ % size);
      // Generate replacement identifiers BEFORE altering existing cells.
      if (input.severity === 'soft') {
        const fresh = selected.map(() => freshToken());
        selected.forEach((n, i) => {
          if (cells[n].token === null || cells[n].isolatedUntil > now) return;
          cells[n].token = fresh[i];
          cells[n].rotateAt = now + rotationMs;
          shifted++;
        });
        return publicEffect;
      }
      for(const n of selected) {
        if (cells[n].token === null || cells[n].isolatedUntil > now) continue;
        cells[n].isolatedUntil = now + isolationMs;
        cells[n].token = null; // Pop decoy identity; never a live application connection.
        pops++;
      }
      return Object.freeze({action: 'observe', enforcement: 'decoys-only'});
    } catch { return publicEffect; }
  }

  function tick() {
    let recovered = 0;
    try {
      const now = clock();
      if (!Number.isFinite(now)) return {restored: 0, action: 'observe'};
      for(const cell of cells) {
        if (cell.isolatedUntil > 0) {
          if (now >= cell.isolatedUntil) {
            const fresh = freshToken();
            cell.token = fresh;
            cell.isolatedUntil = 0;
            cell.rotateAt = now + rotationMs;
            recovered++;
            restored++;
          }
          continue;
        }
        if (now >= cell.rotateAt) {
          const fresh = freshToken();
          cell.token = fresh;
          cell.rotateAt = now + rotationMs;
          shifted++;
        }
      }
    } catch { /* all failures stay inside decoys */ }
    return {restored: recovered, action: 'observe'};
  }

  function publicPaths(max = 5) {
    const limit = Number.isInteger(max) && max >= 1 ? Math.min(max, 32) : 5;
    const now = clock();
    return cells.filter(cell => cell.isolatedUntil <= now && typeof cell.token === 'string')
      .slice(0, limit).map(cell => '/__isb__/' + cell.token.slice(0, 16) + '/backup');
  }

  function status() {
    const now = clock();
    const isolated = cells.filter(c=>c.token === null || c.isolatedUntil > now).length;
    return Object.freeze({action: 'observe', total: size, active: size-isolated, isolated, shifted, pops, restored});
  }
  return Object.freeze({react, tick, status, publicPaths});
}
module.exports = {createIronBubbles};
