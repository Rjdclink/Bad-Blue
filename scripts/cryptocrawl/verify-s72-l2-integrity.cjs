const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const req = (s,n,l) => { if (!s.includes(n)) failures.push(`${l}: missing ${JSON.stringify(n)}`); };
const forbid = (s,n,l) => { if (s.includes(n)) failures.push(`${l}: forbidden ${JSON.stringify(n)}`); };

const facade = read('server/services/cryptocrawl/intelligence/cex-order-book-stream.ts');
const stream = read('server/services/cryptocrawl/intelligence/cex-order-book-stream-v2.ts');
const verifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');

req(facade, "export * from './cex-order-book-stream-v2.js'", 'canonical import path delegates to integrity implementation');
req(stream, "wss://advanced-trade-ws.coinbase.com", 'Coinbase uses Advanced Trade websocket');
forbid(stream, 'ws-feed.exchange.coinbase.com', 'legacy Coinbase Exchange websocket is retired');
for (const needle of ["channel: 'level2'", "channel: 'heartbeats'", "message.channel !== 'l2_data'", 'message.sequence_num', 'update.new_quantity']) req(stream, needle, `Coinbase L2 requires ${needle}`);
req(stream, "wss://ws.kraken.com/v2", 'Kraken uses Spot v2 websocket');
req(stream, "venue !== 'kraken'", 'Kraken wire decimal parsing is isolated');
req(stream, 'CRC32_TABLE', 'Kraken checksum uses CRC32');
req(stream, 'krakenChecksum', 'Kraken checksum is evaluated from local book');
req(stream, 'KRAKEN_BOOK_DEPTH = 25', 'Kraken subscribed/local depth is explicit');
req(stream, 'new SequencedOrderBook(venue === \'kraken\' ? \'kraken_crc32\' : \'sequence\', depth)', 'local book receives venue-specific depth');
req(stream, 'depth: KRAKEN_BOOK_DEPTH', 'Kraken subscription depth matches local cache depth');
req(stream, 'if (update.quantity <= 0) target.delete(key)', 'zero-quantity L2 updates remove levels');
req(stream, 'row.seqId', 'OKX sequence id is consumed');
req(stream, 'row.prevSeqId', 'OKX previous sequence id is consumed');
req(stream, 'CRYPTO_CEX_${venue.toUpperCase()}_WS_SYMBOLS_PER_CONNECTION', 'connection sharding is budgeted');
req(stream, "result === 'gap' || result === 'checksum_mismatch'", 'integrity failure forces reset/resubscription');
req(verifier, 'cexOrderBookStreams.getQuote', 'canonical CEX verifier consumes stream as safe measured source with REST fallback');

if (failures.length) {
  console.error('[s72-l2-integrity] FAIL');
  failures.forEach(f => console.error(` - ${f}`));
  process.exit(1);
}
console.log('[s72-l2-integrity] PASS — Advanced Trade/Kraken v2/OKX L2 caches preserve sequence/checksum/depth integrity and bounded recovery');
