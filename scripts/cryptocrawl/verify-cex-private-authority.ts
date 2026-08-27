import assert from 'node:assert/strict';

process.env.KRAKEN_API_KEY = 'test-kraken-key';
process.env.KRAKEN_API_SECRET = Buffer.from('test-kraken-secret').toString('base64');
process.env.OKX_API_KEY = 'test-okx-key';
process.env.OKX_API_SECRET = 'test-okx-secret';
process.env.OKX_API_PASSPHRASE = 'test-okx-passphrase';
process.env.CRYPTO_OKX_FEE_MIN_INTERVAL_MS = '425';
process.env.CRYPTO_OKX_ORDER_MIN_INTERVAL_MS = '0';
delete process.env.OKX_API_BASE_URL;

interface Call {
  url: string;
  method: string;
  body: string;
  startedAt: number;
}

const calls: Call[] = [];
const krakenNonces: number[] = [];
let delayNextRegionalFee = false;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const body = typeof init?.body === 'string' ? init.body : '';
  calls.push({ url, method, body, startedAt: Date.now() });

  if (url.startsWith('https://api.kraken.com/0/private/')) {
    const nonce = Number(new URLSearchParams(body).get('nonce'));
    assert.ok(Number.isFinite(nonce), 'Kraken private request must carry a numeric nonce');
    krakenNonces.push(nonce);
    return json({ error: [], result: { ok: true } });
  }

  const isUs = url.startsWith('https://us.okx.com');
  const isGlobal = url.startsWith('https://openapi.okx.com');
  const isFee = url.includes('/api/v5/account/trade-fee');
  const isOrder = url.includes('/api/v5/trade/order');
  const isProbe = isFee && url.includes('instType=SPOT') && !url.includes('groupId=') && !url.includes('instId=');

  if (isUs && isProbe) return json({ code: '50119', msg: "API key doesn't exist" }, 401);
  if (!isGlobal) throw new Error(`Unexpected OKX origin after region probe: ${url}`);

  if (isProbe) return json({ code: '0', msg: '', data: [{ taker: '-0.0035', maker: '-0.0020' }] });
  if (isFee) {
    if (delayNextRegionalFee) {
      delayNextRegionalFee = false;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return json({ code: '0', msg: '', data: [{ taker: '-0.0035', maker: '-0.0020' }] });
  }
  if (isOrder) return json({ code: '0', msg: '', data: [{ sCode: '0', ordId: 'test-order' }] });
  throw new Error(`Unexpected request: ${method} ${url}`);
}) as typeof fetch;

try {
  const {
    getKrakenPrivateAuthoritySnapshot,
    getOkxExecutionRestBaseUrl,
    getOkxPrivateAuthoritySnapshot,
    krakenPrivateRequest,
    okxPrivateRequest,
  } = await import('../../server/services/cryptocrawl/intelligence/cex-private-authority.js');

  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    krakenPrivateRequest('/0/private/Balance', { request: String(index) }),
  ));
  assert.equal(krakenNonces.length, 12);
  for (let index = 1; index < krakenNonces.length; index += 1) {
    assert.ok(
      krakenNonces[index] > krakenNonces[index - 1],
      `Kraken nonce order must be strictly increasing on the wire: ${krakenNonces[index - 1]} -> ${krakenNonces[index]}`,
    );
  }
  assert.equal(getKrakenPrivateAuthoritySnapshot().requestCount, 12);

  assert.equal(await getOkxExecutionRestBaseUrl(), 'https://openapi.okx.com');

  // After region selection, a slow fee call and an order write use separate lanes.
  // The order must not wait behind the fee lane's work or its 425ms cadence.
  delayNextRegionalFee = true;
  const completion: string[] = [];
  const slowFee = okxPrivateRequest(
    '/api/v5/account/trade-fee',
    'GET',
    { instType: 'SPOT', instId: 'BTC-USDT' },
    { lane: 'trade_fee' },
  ).then(() => completion.push('fee'));
  const order = okxPrivateRequest(
    '/api/v5/trade/order',
    'POST',
    { instId: 'BTC-USDT', tdMode: 'cash', side: 'buy', ordType: 'ioc', px: '100', sz: '0.001' },
    { lane: 'order_write' },
  ).then(() => completion.push('order'));
  await Promise.all([slowFee, order]);
  assert.equal(completion[0], 'order', 'OKX order-write lane must not queue behind fee-discovery work');

  const snapshot = getOkxPrivateAuthoritySnapshot();
  assert.equal(snapshot.baseUrl, 'https://openapi.okx.com');
  assert.ok(snapshot.lanes.trade_fee.minIntervalMs >= 425);
  assert.equal(snapshot.lanes.order_write.minIntervalMs, 0);
  assert.ok(snapshot.lanes.order_write.requestCount >= 1);

  const okxNonProbe = calls.filter(call =>
    call.url.includes('okx.com') &&
    !(call.url.startsWith('https://us.okx.com') && call.url.includes('/api/v5/account/trade-fee')),
  );
  assert.ok(okxNonProbe.length > 0);
  assert.equal(
    okxNonProbe.every(call => call.url.startsWith('https://openapi.okx.com')),
    true,
    'all OKX non-probe private traffic must remain on the selected credential region',
  );

  console.log(JSON.stringify({
    krakenRequests: getKrakenPrivateAuthoritySnapshot().requestCount,
    krakenNoncesStrictlyIncreasing: true,
    okxBaseUrl: snapshot.baseUrl,
    okxFeeLaneMinIntervalMs: snapshot.lanes.trade_fee.minIntervalMs,
    okxOrderLaneMinIntervalMs: snapshot.lanes.order_write.minIntervalMs,
    firstConcurrentCompletion: completion[0],
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
