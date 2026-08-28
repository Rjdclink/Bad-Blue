import assert from 'node:assert/strict';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  verify as cryptoVerify,
} from 'node:crypto';
import { createCoinbaseRestJwt } from '../../server/services/cryptocrawl/intelligence/coinbase-advanced-trade-authority.js';
import { parseCoinbaseSpotFeeSummary } from '../../server/services/cryptocrawl/intelligence/coinbase-fee-evidence.js';

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(normalized + padding, 'base64');
}

const nowMs = 1_800_000_000_000;
process.env.COINBASE_API_KEY = 'organizations/test-org/apiKeys/test-key';

// Legacy ECDSA compatibility path.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
process.env.COINBASE_API_SECRET = pem.replace(/\n/g, '\\n');
const jwt = createCoinbaseRestJwt('GET', '/api/v3/brokerage/key_permissions', nowMs);
const [headerPart, payloadPart, signaturePart] = jwt.split('.');
assert.ok(headerPart && payloadPart && signaturePart, 'Coinbase JWT must have three segments');
const header = JSON.parse(fromBase64Url(headerPart).toString('utf8'));
const payload = JSON.parse(fromBase64Url(payloadPart).toString('utf8'));
assert.equal(header.alg, 'ES256');
assert.equal(header.kid, process.env.COINBASE_API_KEY);
assert.equal(payload.sub, process.env.COINBASE_API_KEY);
assert.equal(payload.iss, 'cdp');
assert.deepEqual(payload.aud, ['cdp_service']);
assert.equal(payload.uri, 'GET api.coinbase.com/api/v3/brokerage/key_permissions');
assert.equal(payload.exp - payload.nbf, 120);
assert.ok(typeof header.nonce === 'string' && header.nonce.length >= 16);
assert.equal(cryptoVerify(
  'sha256',
  Buffer.from(`${headerPart}.${payloadPart}`),
  { key: publicKey, dsaEncoding: 'ieee-p1363' },
  fromBase64Url(signaturePart),
), true, 'ES256 JWT signature must verify against the generated public key');

// Current Coinbase-recommended Ed25519 path: base64(seed || publicKey), 64 bytes.
const seed = randomBytes(32);
const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
const edPrivate = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, seed]), format: 'der', type: 'pkcs8' });
const edPublic = createPublicKey(edPrivate);
const edPublicDer = edPublic.export({ format: 'der', type: 'spki' });
const publicRaw = edPublicDer.subarray(edPublicDer.length - 32);
process.env.COINBASE_API_SECRET = Buffer.concat([seed, publicRaw]).toString('base64');
const edJwt = createCoinbaseRestJwt('POST', '/api/v3/brokerage/orders', nowMs);
const [edHeaderPart, edPayloadPart, edSignaturePart] = edJwt.split('.');
const edHeader = JSON.parse(fromBase64Url(edHeaderPart).toString('utf8'));
const edPayload = JSON.parse(fromBase64Url(edPayloadPart).toString('utf8'));
assert.equal(edHeader.alg, 'EdDSA');
assert.equal(edPayload.uri, 'POST api.coinbase.com/api/v3/brokerage/orders');
assert.equal(cryptoVerify(
  null,
  Buffer.from(`${edHeaderPart}.${edPayloadPart}`),
  edPublic,
  fromBase64Url(edSignaturePart),
), true, 'Ed25519 JWT signature must verify against the derived public key');
process.env.COINBASE_API_SECRET = seed.toString('base64');
assert.throws(
  () => createCoinbaseRestJwt('GET', '/api/v3/brokerage/key_permissions', nowMs),
  /exactly 64 bytes/,
  'Malformed 32-byte Ed25519 secret must fail closed instead of being guessed valid',
);

const fees = parseCoinbaseSpotFeeSummary({
  fee_tier: {
    pricing_tier: '<$10k',
    taker_fee_rate: '0.0010',
    maker_fee_rate: '0.0006',
  },
}, nowMs);
assert.equal(fees.takerFeeBps, 10);
assert.equal(fees.makerFeeBps, 6);
assert.equal(fees.source, 'coinbase_transaction_summary');
assert.equal(fees.productType, 'SPOT');
assert.equal(fees.observedAt, nowMs);
assert.throws(() => parseCoinbaseSpotFeeSummary({ fee_tier: { taker_fee_rate: '0.0010' } }), /maker\/taker fee rates/);

console.log('coinbase-advanced-trade-authority:pass');
