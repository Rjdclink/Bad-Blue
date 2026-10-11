const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../server/claude.ts'), 'utf8');
const start = source.indexOf('export async function callClaudeWebSearch(');
const end = source.indexOf('\nconst CLAUDE_DIRECT_IMAGE_TYPES', start);
assert(start >= 0 && end > start);
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const cited = { type: 'web_search_tool_result', content: [{ url: 'https://records.example.test/fixture', title: 'Fixture source' }] };
const text = value => ({ type: 'text', text: value });

function transport(responses) {
  const calls = [];
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, DOMException,
    CURRENT_AI_MODELS: { claudeBalanced: 'fixture' },
    getClaudeClient: () => ({ messages: { create: async (request, options) => {
      calls.push({ request, options });
      assert(calls.length <= responses.length, 'unexpected additional paid request');
      return responses[calls.length - 1];
    } } }),
    meterClaudeRequest: async (_model, _task, request) => request(),
    console: { info() {}, warn() {} },
  });
  return { run: exports.callClaudeWebSearch, calls };
}

(async () => {
  const normal = transport([
    { stop_reason: 'max_tokens', content: [text('Unverified partial text')] },
    { stop_reason: 'end_turn', content: [cited, text('Grounded fixture')] },
  ]);
  const standard = await normal.run('Fixture', { maxTokens: 384 });
  assert.equal(normal.calls.length, 2, 'ordinary callers keep their bounded retry');
  assert.equal(normal.calls[1].request.max_tokens, 2048);
  assert.equal(standard.sources.length, 1);

  const spectra = transport([{ stop_reason: 'max_tokens', content: [text('Unverified partial text')] }]);
  const partial = await spectra.run('Fixture', { maxTokens: 2048, retryTruncatedOutput: false });
  assert.equal(spectra.calls.length, 1, 'Spectra must not buy the same truncated search twice');
  assert.equal(spectra.calls[0].request.max_tokens, 2048);
  assert.equal(partial.sources.length, 0, 'model prose does not become source evidence');
  assert.equal(spectra.calls[0].options.maxRetries, 0);

  const sourceOnly = transport([{ stop_reason: 'max_tokens', content: [cited] }]);
  const evidence = await sourceOnly.run('Fixture', { maxTokens: 2048, retryTruncatedOutput: false });
  assert.equal(sourceOnly.calls.length, 1);
  assert.equal(evidence.sources[0].url, cited.content[0].url, 'source evidence survives truncated output');

  const continued = transport([
    { stop_reason: 'pause_turn', content: [cited] },
    { stop_reason: 'end_turn', content: [text('Grounded fixture')] },
  ]);
  const finished = await continued.run('Fixture', { maxTokens: 2048, retryTruncatedOutput: false });
  assert.equal(continued.calls.length, 2, 'necessary tool continuations remain available');
  assert.equal(finished.sources.length, 1);
  assert.equal(continued.calls[1].request.messages.at(-1).role, 'assistant');
  console.log('PASS Spectra Claude fallback: one usable output budget, no duplicate truncation retry, retained sources and tool continuations, unchanged ordinary caller retry. Provider I/O mocked.');
})().catch(error => { console.error(error); process.exitCode = 1; });
