import assert from 'node:assert/strict';
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
  const results = await Promise.all(Array.from({ length: 20 }, () => budget.reserve('fixture', signal)));
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
console.log(`${passed} Tavily budget checks passed`);
