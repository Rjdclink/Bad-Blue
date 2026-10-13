import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { TavilyBudget } from '../server/lexara/TavilyBudget';
const signal = new AbortController().signal;
const usage = (limit = 1, used = 0) => ({ key: { limit, usage: used }, account: { plan_limit: limit, plan_usage: used, paygo_limit: 0, paygo_usage: 0 } });
let passed = 0;
async function check(name: string, run: () => Promise<void>) { await run(); console.log('PASS', name); passed++; }
await check('zero credits prevents admission', async () => {
  assert.equal(await new TavilyBudget(async () => usage(0)).reserve('fixture', signal), 'quota-exhausted');
});
await check('concurrent callers share usage lookup and cannot overspend one credit', async () => {
  let calls = 0;
  const budget = new TavilyBudget(async () => { calls++; return usage(); });
  const signals = Array.from({ length: 20 }, () => new AbortController().signal);
  const results = await Promise.all(signals.map(s => budget.reserve('fixture', s)));
  for (const s of signals) assert.equal(getEventListeners(s, 'abort').length, 0);
  assert.equal(calls, 1); assert.equal(results.filter(x => x === 'allowed').length, 1);
});
await check('unknown schema denies searches', async () => {
  for (const payload of [{}, { key: { limit: Infinity } }, null]) {
    assert.equal(await new TavilyBudget(async () => payload).reserve('fixture', signal), 'budget-unavailable');
  }
});
await check('tighter key or account ceiling applies', async () => {
  for (const payload of [{ ...usage(5), key: { limit: 0, usage: 0 } }, { ...usage(0), key: { limit: 5, usage: 0 } }]) {
    assert.equal(await new TavilyBudget(async () => payload).reserve('fixture', signal), 'quota-exhausted');
  }
});
await check('failed usage lookup is cached against a retry storm', async () => {
  let calls = 0, now = 0;
  const b = new TavilyBudget(async () => { calls++; throw new Error('fixture'); }, () => now);
  await assert.rejects(b.reserve('fixture', signal));
  for (let i = 0; i < 20; i++) assert.equal(await b.reserve('fixture', signal), 'budget-unavailable');
  assert.equal(calls, 1); now = 65_000; await assert.rejects(b.reserve('fixture', signal)); assert.equal(calls, 2);
});
await check('stale usage cannot restore reserved credits', async () => {
  let now = 0;
  const b = new TavilyBudget(async () => usage(), () => now);
  assert.equal(await b.reserve('fixture', signal), 'allowed'); now = 65_000;
  assert.equal(await b.reserve('fixture', signal), 'quota-exhausted');
});
await check('rolling rate ceiling expires after a minute', async () => {
  let now = 0;
  const b = new TavilyBudget(async () => usage(1000), () => now);
  for (let i = 0; i < 90; i++) assert.equal(await b.reserve('fixture', signal), 'allowed');
  assert.equal(await b.reserve('fixture', signal), 'rate-limit'); now = 60_000;
  assert.equal(await b.reserve('fixture', signal), 'allowed');
});
await check('aborted callers do not reserve', async () => {
  const c = new AbortController(); c.abort(); let calls = 0;
  await assert.rejects(new TavilyBudget(async () => { calls++; return usage(); }).reserve('fixture', c.signal));
  assert.equal(calls, 0);
});
await check('cancelling one waiter preserves shared usage for the other', async () => {
  let release!: (value: unknown) => void;
  let upstream!: AbortSignal;
  const b = new TavilyBudget(async (_key, s) => { upstream = s; return new Promise(resolve => { release = resolve; }); });
  const first = new AbortController(), second = new AbortController();
  const a = b.reserve('fixture', first.signal);
  const rejection = assert.rejects(a, { name: 'AbortError' });
  const pending = b.reserve('fixture', second.signal);
  first.abort(); await rejection;
  assert.equal(upstream.aborted, false);
  assert.equal(getEventListeners(first.signal, 'abort').length, 0);
  release(usage()); assert.equal(await pending, 'allowed');
});
await check('last cancelled waiter aborts usage without reserving credit', async () => {
  let upstream!: AbortSignal;
  const b = new TavilyBudget(async (_key, s) => { upstream = s; return new Promise(() => {}); });
  const c = new AbortController(); const pending = b.reserve('fixture', c.signal);
  const rejection = assert.rejects(pending, { name: 'AbortError' }); c.abort(); await rejection;
  assert.equal(upstream.aborted, true);
});
await check('key rotation cannot admit stale callers or replace the new budget', async () => {
  let release!: (value: unknown) => void;
  const b = new TavilyBudget(async key => key === 'old' ? new Promise(resolve => { release = resolve; }) : usage(0));
  const old = b.reserve('old', signal); const rejection = assert.rejects(old, { name: 'AbortError' });
  assert.equal(await b.reserve('new', signal), 'quota-exhausted'); await rejection;
  release(usage(100)); await Promise.resolve();
  assert.equal(await b.reserve('new', signal), 'quota-exhausted');
});
await check('fractional or unsafe counters cannot establish a credit budget', async () => {
  for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const payload = usage(10); payload.key.usage = value;
    assert.equal(await new TavilyBudget(async () => payload).reserve('fixture', signal), 'budget-unavailable');
  }
});
console.log(`${passed} Tavily budget checks passed`);
