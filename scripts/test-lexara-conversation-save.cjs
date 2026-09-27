const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const express = require('express');

const root = path.resolve(__dirname, '..');
const state = { records: [], pending: null, fail: false };
globalThis.__lexaraSaveFixture = state;

const mocks = {
  '../logger': `export function createLogger(){ return {info(){},warn(){},error(){}}; }`,
  '../../shared/lexaraVoicePersona': `export const LEXARA_PERSONA={name:'Fixture',traits:[]};`,
  '../lexara/personaKernel': `export const LEXARA_KERNEL={identity:{name:'Fixture',age:1,style:''},speech:{}}; export function mergePersonaWithKernel(){return {};}`,
  '../lexara/LexaraConversationOrchestrator': `
    export async function generateLexaraConversationResponse(){return {text:'Fixture answer',jurisdiction:'Iowa',mappedLawType:'general'};}
    export function getLexaraImmediateAcknowledgement(){return {text:'Fixture ack',terminal:false,kind:'ack'};}
  `,
  '../masterPassword': `export const MASTER_USER_ID='fixture-master';`,
  '../auth': `export function isAuthenticated(req,res,next){
    const id=req.headers['x-fixture-user'];
    if (!id) return res.status(401).json({success:false});
    req.user={id,isMasterBypass:id==='fixture-master'}; next();
  }`,
  '../aiHarmonyModelRegistry': `export function getConfiguredHarmonyParticipants(){return [];}`,
  '../lexara/legalDocumentRegistry': `export function isBlankLegalDocumentRequest(){return false;} export function resolveLegalDocumentType(){return null;}`,
  './db': `export const db={}; export const isDatabaseConfigured=true;`,
  './services/lexara/LexaraConversationPersistenceDatabase': `
    import { PgDialect } from 'drizzle-orm/pg-core';
    const dialect = new PgDialect();
    const state = globalThis.__lexaraSaveFixture;
    function filtered(predicate) {
      const { sql, params } = dialect.sqlToQuery(predicate);
      const fields = [...sql.matchAll(/"lexara_conversations"\\."(id|user_id|session_id)"\\s*=\\s*\\$(\\d+)/g)];
      const lawType = /"lexara_conversations"\\."context"->>'lawType'\\s*=\\s*\\$(\\d+)/.exec(sql);
      return state.records.filter(record =>
        fields.every(([, field, index]) => record[{
          id:'id', user_id:'userId', session_id:'sessionId'
        }[field]] === params[Number(index)-1])
        && (!lawType || record.context?.lawType === params[Number(lawType[1])-1])
      );
    }
    export function getLexaraConversationPersistenceDb() {
      return {
        insert(){return {values(record){return {async returning(){
          if (state.pending) await state.pending;
          if (state.fail) throw new Error('fixture database unavailable');
          const saved = {...record, createdAt:new Date(Date.UTC(2026,0,1)+state.records.length*1000)};
          state.records.push(saved); return [saved];
        }}}}},
        select(fields){return {from(){return {
          where(predicate){return {
            async limit(count){return filtered(predicate).slice(0,count).map(row =>
              fields ? Object.fromEntries(Object.keys(fields).map(key=>[key,row[key]])) : row);},
            orderBy(){return {async limit(count){
              return filtered(predicate).sort((a,b)=>b.createdAt-a.createdAt).slice(0,count).map(row =>
                fields ? Object.fromEntries(Object.keys(fields).map(key=>[key,row[key]])) : row);
            }}}
          }}
        }}}}
      };
    }
  `,
};

async function main() {
  const result = await esbuild.build({
    entryPoints: ['fixture-entry'],
    bundle: true, platform: 'node', format: 'cjs', packages: 'external',
    write: false, logLevel: 'silent',
    plugins: [{ name: 'fixture-modules', setup(build) {
      build.onResolve({ filter: /^fixture-entry$/ }, () => ({ path: 'fixture-entry', namespace: 'fixture-entry' }));
      build.onResolve({ filter: /^\//, namespace: 'fixture-entry' }, args => ({ path: args.path }));
      build.onLoad({ filter: /.*/, namespace: 'fixture-entry' }, () => ({
        contents: `
          export { default } from ${JSON.stringify(path.join(root, 'server/routes/lexara.chat.routes.ts'))};
          export { storage as __storageForTest } from ${JSON.stringify(path.join(root, 'server/storage.ts'))};
        `,
        loader: 'ts',
      }));
      build.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
        ? { path: args.path, namespace: 'fixture' } : null);
      build.onResolve({ filter: /^[^./]/, namespace: 'fixture' }, args => ({
        path: args.path, external: true,
      }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
        contents: mocks[args.path], loader: 'ts',
      }));
    }}],
  });
  const bundle = new Module(path.join(root, 'scripts/.lexara-save-fixture.cjs'), module);
  bundle.filename = path.join(root, 'scripts/.lexara-save-fixture.cjs');
  bundle.paths = Module._nodeModulePaths(path.dirname(bundle.filename));
  bundle._compile(result.outputFiles[0].text, bundle.filename);
  const app = express();
  app.use('/api/lexara', bundle.exports.default);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/lexara`;
  const post = (endpoint, user = 'fixture-ordinary') => fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fixture-user': user },
    body: JSON.stringify({
      prompt: 'Fixture nonpersonal legal question',
      includeAudio: false,
      context: { sessionId: 'fixture-session', lawType: 'contracts' },
    }),
  });
  const getLatest = (user, lawType) => fetch(
    `${baseUrl}/conversations/latest${lawType ? `?lawType=${encodeURIComponent(lawType)}` : ''}`,
    { headers: user ? { 'x-fixture-user': user } : {} },
  );
  try {
    assert.equal((await post('/chat', '')).status, 401, 'unauthenticated requests are rejected');
    let release;
    state.pending = new Promise(resolve => { release = resolve; });
    let completed = false;
    const pending = post('/chat').then(async response => {
      completed = true;
      assert.equal(response.status, 200);
      return response.json();
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(completed, false, 'success is not returned before the insert commits');
    release();
    state.pending = null;
    const saved = await pending;
    assert.equal(saved.persistenceStatus, 'saved');
    assert.equal(saved.persistenceSuccess, true);
    assert.equal(state.records.length, 1);
    assert.equal(saved.conversationId, state.records[0].id);
    assert.equal(state.records[0].userId, 'fixture-ordinary');
    assert.equal(state.records[0].lexaraResponse, saved.response);
    assert.equal(state.records[0].sessionId, 'fixture-session');

    // Exercise the real storage read methods against the same fixture backing store.
    const stored = bundle.exports.__storageForTest;
    assert.equal((await stored.getLexaraConversation(saved.conversationId)).id, saved.conversationId);
    assert.equal((await stored.getUserLexaraConversations('fixture-ordinary')).length, 1);
    assert.equal((await stored.getUserLexaraConversations('other-user')).length, 0);
    assert.equal((await stored.getLexaraConversationsBySession('fixture-session')).length, 1);

    const streamed = await post('/chat/stream');
    assert.equal(streamed.status, 200);
    const events = await streamed.text();
    assert.match(events, /event: complete/);
    assert.match(events, /"persistenceStatus":"saved"/);
    assert.equal(state.records.length, 2);
    const resumed = await (await getLatest('fixture-ordinary', 'contracts')).json();
    assert.equal(resumed.conversation.sessionId, 'fixture-session');
    assert.deepEqual(resumed.conversation.turns.map(turn => turn.id), state.records.map(turn => turn.id));
    assert.equal(resumed.conversation.turns[1].lexaraResponse, 'Fixture answer');
    assert.equal(resumed.conversation.turns[0].userId, undefined, 'history exposes only selected fields');
    state.records.push({
      ...state.records[0],
      id: 'fixture-other-user-turn',
      userId: 'other-user',
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });
    assert.equal((await (await getLatest('fixture-ordinary', 'contracts')).json()).conversation.turns.length, 2,
      'a shared session ID must not include another user’s turn');
    const otherHistory = await (await getLatest('other-user', 'contracts')).json();
    assert.deepEqual(otherHistory.conversation.turns.map(turn => turn.id), ['fixture-other-user-turn']);
    state.records.pop();
    state.records.push({
      ...state.records[0],
      id: 'fixture-torts-turn',
      sessionId: 'fixture-torts-session',
      context: { lawType: 'torts' },
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });
    assert.equal((await (await getLatest('fixture-ordinary', 'contracts')).json()).conversation.turns.length, 2,
      'restoration is scoped to the selected law area');
    assert.equal((await (await getLatest('fixture-ordinary')).json()).conversation.sessionId, 'fixture-torts-session',
      'without a law area, the latest session is restored');
    state.records.pop();
    assert.equal(await stored.getLatestUserLexaraSession('other-user', 'contracts'), null);
    assert.equal((await (await getLatest('other-user', 'contracts')).json()).conversation, null);
    assert.equal((await (await getLatest('fixture-master')).json()).conversation, null);
    assert.equal((await getLatest('')).status, 401);

    const master = await (await post('/chat', 'fixture-master')).json();
    assert.equal(master.persistenceStatus, 'master-ephemeral');
    assert.equal(master.conversationId, null);
    const masterStream = await (await post('/chat/stream', 'fixture-master')).text();
    assert.match(masterStream, /"persistenceStatus":"master-ephemeral"/);
    assert.equal(state.records.length, 2, 'master turns are never persisted');

    state.fail = true;
    const failed = await post('/chat');
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).persistenceStatus, 'failed');
    const failedStream = await (await post('/chat/stream')).text();
    assert.match(failedStream, /event: error/);
    assert.doesNotMatch(failedStream, /event: complete/);
    assert.equal(state.records.length, 2);
    console.log('Lexara per-reply autosave, owner-scoped restore, master isolation, and save-failure checks passed (offline).');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });