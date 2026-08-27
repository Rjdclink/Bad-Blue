import assert from 'node:assert/strict';

const scenario = process.argv[2];
assert.ok(scenario === 'us' || scenario === 'global', 'scenario must be us or global');

process.env.OKX_API_KEY = 'test-okx-key';
process.env.OKX_API_SECRET = 'test-okx-secret';
process.env.OKX_API_PASSPHRASE = 'test-okx-passphrase';
process.env.CRYPTO_ARBITRAGE_OKX_TAKER_FEE_BPS = '35';
delete process.env.OKX_API_BASE_URL;

const calls: string[] = [];

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  calls.push(url);

  const isUs = url.startsWith('https://us.okx.com');
  const isGlobal = url.startsWith('https://openapi.okx.com');
  const isTradeFee = url.includes('/api/v5/account/trade-fee?');
  const isInstrumentDirectory = url.includes('/api/v5/public/instruments?instType=SPOT');
  const isGroupFee = isTradeFee && url.includes('groupId=1');
  const isAuthProbe = isTradeFee && !url.includes('groupId=') && !url.includes('instId=');

  if (scenario === 'global' && isUs && isAuthProbe) {
    return json({ code: '50119', msg: "API key doesn't exist" }, 401);
  }

  const selected = scenario === 'us' ? isUs : isGlobal;
  if (!selected) {
    throw new Error(`Unexpected request to non-selected OKX origin: ${url}`);
  }

  if (isAuthProbe) {
    return json({ code: '0', msg: '', data: [{ taker: '-0.0035', maker: '-0.0020' }] });
  }

  if (isInstrumentDirectory) {
    return json({
      code: '0',
      msg: '',
      data: [
        { instType: 'SPOT', instId: 'BTC-USDT', groupId: '1', state: 'live' },
        { instType: 'SPOT', instId: 'ETH-USDT', groupId: '1', state: 'live' },
        { instType: 'SPOT', instId: 'OLD-USDT', groupId: '1', state: 'suspend' },
      ],
    });
  }

  if (isGroupFee) {
    return json({
      code: '0',
      msg: '',
      data: [{
        feeGroup: [{ groupId: '1', taker: '-0.0035', maker: '-0.0020' }],
      }],
    });
  }

  throw new Error(`Unexpected OKX request: ${url}`);
}) as typeof fetch;

try {
  const {
    resolveCexFeeEvidence,
    primeCexFeeEvidence,
    getCachedCexFeeEvidence,
  } = await import('../../server/services/cryptocrawl/intelligence/cex-fee-resolver.js');

  const prime = await primeCexFeeEvidence(['BTCUSDT', 'FIGRHELOCUSDT']);
  assert.equal(prime.requestedSymbols, 2);
  assert.equal(prime.okxResolved, 1, 'only the supported OKX instrument may resolve');
  assert.ok(
    prime.unresolved.some(item => item.venue === 'okx' && item.symbol === 'FIGRHELOCUSDT'),
    'unsupported OKX symbol must remain unresolved',
  );

  const invalid = await resolveCexFeeEvidence('okx', 'FIGRHELOCUSDT');
  assert.equal(invalid, null, 'configured fee fallback must not rescue an unsupported OKX instrument');
  assert.equal(
    getCachedCexFeeEvidence('okx', 'FIGRHELOCUSDT'),
    null,
    'unsupported instrument must not become cached/configured executable fee evidence',
  );

  const valid = await resolveCexFeeEvidence('okx', 'BTCUSDT');
  assert.ok(valid, 'supported OKX symbol should resolve authenticated fee evidence');
  assert.equal(valid.source, 'okx_account_trade_fee');
  assert.equal(valid.takerFeeBps, 35);

  assert.equal(
    calls.some(url => url.includes('instId=FIGRHELOC-USDT')),
    false,
    'unsupported symbol must be rejected before an authenticated per-instrument fee call',
  );

  const usDirectoryCalls = calls.filter(url =>
    url.startsWith('https://us.okx.com') && url.includes('/api/v5/public/instruments?instType=SPOT'),
  );
  const globalDirectoryCalls = calls.filter(url =>
    url.startsWith('https://openapi.okx.com') && url.includes('/api/v5/public/instruments?instType=SPOT'),
  );

  if (scenario === 'us') {
    assert.equal(usDirectoryCalls.length, 1, 'US-selected credentials must use the US instrument directory');
    assert.equal(globalDirectoryCalls.length, 0, 'US-selected credentials must not probe the global instrument directory');
    assert.equal(
      calls.some(url => url.startsWith('https://openapi.okx.com') && url.includes('/api/v5/account/trade-fee')),
      false,
      'US-selected credentials must not be retried against the global private endpoint',
    );
  } else {
    assert.equal(usDirectoryCalls.length, 0, 'failed US authentication must not lead to US instrument requests');
    assert.equal(globalDirectoryCalls.length, 1, 'global-selected credentials must use the global instrument directory');
    const usAuthCalls = calls.filter(url =>
      url.startsWith('https://us.okx.com') &&
      url.includes('/api/v5/account/trade-fee?instType=SPOT') &&
      !url.includes('groupId=') &&
      !url.includes('instId='),
    );
    assert.equal(usAuthCalls.length, 1, 'US origin may be attempted once only for credential-region selection');
  }

  console.log(`OKX fee authority verification passed (${scenario})`);
} finally {
  globalThis.fetch = originalFetch;
}
