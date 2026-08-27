import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scenario = process.argv[2];
assert.ok(scenario === 'us' || scenario === 'global', 'scenario must be us or global');

process.env.OKX_API_KEY = 'test-okx-key';
process.env.OKX_API_SECRET = 'test-okx-secret';
process.env.OKX_API_PASSPHRASE = 'test-okx-passphrase';
process.env.CRYPTO_ARBITRAGE_OKX_TAKER_FEE_BPS = '35';
delete process.env.OKX_API_BASE_URL;

interface RecordedCall {
  url: string;
  method: string;
}

const calls: RecordedCall[] = [];

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  calls.push({ url, method });

  const isUs = url.startsWith('https://us.okx.com');
  const isGlobal = url.startsWith('https://openapi.okx.com');
  const isTradeFee = url.includes('/api/v5/account/trade-fee?');
  const isInstrumentDirectory = url.includes('/api/v5/public/instruments?instType=SPOT');
  const isGroupFee = isTradeFee && url.includes('groupId=1');
  const isAuthProbe = isTradeFee && !url.includes('groupId=') && !url.includes('instId=');
  const isTradeOrder = url.includes('/api/v5/trade/order');

  if (scenario === 'global' && isUs && isAuthProbe) {
    return json({ code: '50119', msg: "API key doesn't exist" }, 401);
  }

  const selected = scenario === 'us' ? isUs : isGlobal;
  if (!selected) {
    throw new Error(`Unexpected non-probe request to non-selected OKX origin: ${url}`);
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

  if (isTradeOrder && method === 'POST') {
    return json({
      code: '0',
      msg: '',
      data: [{ sCode: '0', sMsg: '', ordId: 'test-order-1' }],
    });
  }

  throw new Error(`Unexpected OKX request: ${method} ${url}`);
}) as typeof fetch;

try {
  const {
    resolveCexFeeEvidence,
    primeCexFeeEvidence,
    getCachedCexFeeEvidence,
  } = await import('../../server/services/cryptocrawl/intelligence/cex-fee-resolver.js');

  const prime = await primeCexFeeEvidence(['BTCUSDT', 'FIGRHELOCUSDT', 'OLDUSDT']);
  assert.equal(prime.requestedSymbols, 3);
  assert.equal(prime.okxResolved, 1, 'only a live supported OKX instrument may resolve');
  assert.ok(
    prime.unresolved.some(item => item.venue === 'okx' && item.symbol === 'FIGRHELOCUSDT'),
    'unknown OKX symbol must remain unresolved',
  );
  assert.ok(
    prime.unresolved.some(item => item.venue === 'okx' && item.symbol === 'OLDUSDT'),
    'suspended OKX instrument must remain unresolved',
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
    calls.some(call => call.url.includes('instId=FIGRHELOC-USDT')),
    false,
    'unsupported symbol must be rejected before an authenticated per-instrument fee call',
  );

  const expectedBaseUrl = scenario === 'us' ? 'https://us.okx.com' : 'https://openapi.okx.com';
  const {
    getOkxExecutionRestBaseUrl,
    getOkxPrivateAuthoritySnapshot,
  } = await import('../../server/services/cryptocrawl/intelligence/cex-private-authority.js');
  assert.equal(
    await getOkxExecutionRestBaseUrl(),
    expectedBaseUrl,
    'shared execution authority must select the credential-compatible OKX region',
  );
  assert.equal(getOkxPrivateAuthoritySnapshot().baseUrl, expectedBaseUrl);

  const { createProductionCexSettlementAdapters } = await import(
    '../../server/services/cryptocrawl/execution/cex-settlement.js'
  );
  const receipt = await createProductionCexSettlementAdapters().okx.submit({
    symbol: 'BTCUSDT',
    side: 'buy',
    quantity: 0.001,
    price: 100,
  });
  assert.equal(receipt.venue, 'okx');
  assert.equal(receipt.orderId, 'test-order-1');
  const orderSubmit = calls.find(call => call.method === 'POST' && call.url.includes('/api/v5/trade/order'));
  assert.ok(orderSubmit, 'OKX order adapter must issue an authenticated order request');
  assert.ok(
    orderSubmit.url.startsWith(expectedBaseUrl),
    `OKX order submission must stay on selected region ${expectedBaseUrl}`,
  );
  assert.ok(getOkxPrivateAuthoritySnapshot().lanes.order_write.requestCount >= 1);

  const usDirectoryCalls = calls.filter(call =>
    call.url.startsWith('https://us.okx.com') && call.url.includes('/api/v5/public/instruments?instType=SPOT'),
  );
  const globalDirectoryCalls = calls.filter(call =>
    call.url.startsWith('https://openapi.okx.com') && call.url.includes('/api/v5/public/instruments?instType=SPOT'),
  );
  if (scenario === 'us') {
    assert.equal(usDirectoryCalls.length, 1, 'US-selected credentials must use the US instrument directory');
    assert.equal(globalDirectoryCalls.length, 0, 'US-selected credentials must not use the Global instrument directory');
  } else {
    assert.equal(usDirectoryCalls.length, 0, 'failed US authentication must not lead to US instrument requests');
    assert.equal(globalDirectoryCalls.length, 1, 'Global-selected credentials must use the Global instrument directory');
    assert.ok(
      calls.some(call =>
        call.url.startsWith('https://us.okx.com') &&
        call.url.includes('/api/v5/account/trade-fee?instType=SPOT') &&
        !call.url.includes('groupId=') &&
        !call.url.includes('instId=')),
      'US origin may be used only as an authentication probe before Global selection',
    );
  }

  const nonProbeCalls = calls.filter(call => !(
    call.url.includes('/api/v5/account/trade-fee?instType=SPOT') &&
    !call.url.includes('groupId=') &&
    !call.url.includes('instId=')
  ));
  assert.equal(
    nonProbeCalls.every(call => !call.url.includes('okx.com') || call.url.startsWith(expectedBaseUrl)),
    true,
    'all non-probe OKX fee/execution requests must remain on the selected account region',
  );

  const arbitrageSource = readFileSync(
    new URL('../../server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts', import.meta.url),
    'utf8',
  );
  assert.match(arbitrageSource, /getOkxExecutionRestBaseUrl/);
  assert.doesNotMatch(arbitrageSource, /https:\/\/www\.okx\.com\/api\/v5\/market\/books/);
  assert.match(arbitrageSource, /return fetchOkxTopOfBook\(symbol\);/);
  assert.match(arbitrageSource, /if \(venue === 'okx' && !evidence\) return null;/);

  const settlementSource = readFileSync(
    new URL('../../server/services/cryptocrawl/execution/cex-settlement.ts', import.meta.url),
    'utf8',
  );
  assert.match(settlementSource, /cex-private-authority/);
  assert.match(settlementSource, /okxPrivateRequest/);
  assert.match(settlementSource, /krakenPrivateRequest/);
  assert.doesNotMatch(settlementSource, /createHmac/);
  assert.doesNotMatch(settlementSource, /lastNonce/);

  const regionFacadeSource = readFileSync(
    new URL('../../server/services/cryptocrawl/intelligence/okx-region-authority.ts', import.meta.url),
    'utf8',
  );
  assert.match(regionFacadeSource, /cex-private-authority/);
  assert.doesNotMatch(regionFacadeSource, /createHmac/);

  console.log(`OKX fee, symbol and single private-region authority verification passed (${scenario})`);
} finally {
  globalThis.fetch = originalFetch;
}
