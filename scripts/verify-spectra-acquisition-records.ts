import assert from 'node:assert/strict';
import {
  buildSpectraAcquisitionRecords,
  prepareSpectraAcquisitionEvidenceRecords,
  spectraAcquisitionRecordHash,
  readSpectraAcquisitionEvidenceRecords,
  writeSpectraAcquisitionEvidenceRecords,
  SPECTRA_EVIDENCE_BATCH_MAX_BYTES,
  SPECTRA_EVIDENCE_BATCH_MAX_RECORDS,
  SPECTRA_EVIDENCE_RECORD_MAX_BYTES,
  type SpectraAcquisitionEvidenceRecord,
  type SpectraEvidenceQuery,
} from '../server/services/spectra/SpectraAcquisitionRecords';

const time = '2026-10-10T12:00:00.000Z';
const later = '2026-10-11T12:00:00.000Z';
const url = 'https://records.example.org/document';
const searchHit = { url, title: 'Search title', snippet: 'Search-only text', provider: 'discovery-engine' };
assert.deepEqual(buildSpectraAcquisitionRecords([
  searchHit,
  { ...searchHit, metadata: { retrievedAt: time } },
  { ...searchHit, metadata: { fetchedExcerpt: 'No verified fetch time' } },
  { ...searchHit, metadata: { retrievedAt: time, fetchedTitle: '', fetchedExcerpt: ' ' } },
]), [], 'unfetched or search-only results must never become acquired document snapshots');

const documents = buildSpectraAcquisitionRecords([
  { ...searchHit, metadata: {
    retrievedAt: time, fetchedTitle: 'Fetched document title', fetchedContentType: 'text/html',
    fetchedAddressBlocks: ['100 Fictional Street'],
    retrievedLocationEvidence: [{ latitude: 10, longitude: 20, subjectMatchConfidence: 1 }],
  } },
]);
assert.equal(documents.length, 1);
assert.equal(documents[0].payload.title, 'Fetched document title');
assert.equal(documents[0].payload.textExcerpt, undefined, 'a missing fetched excerpt cannot fall back to a search snippet');
assert.equal(documents[0].payload.contentType, 'text/html');
assert.equal(documents[0].payload.snapshotKind, 'extracted_document');
assert.deepEqual(documents[0].payload.addressBlocks, ['100 Fictional Street']);
assert.equal((documents[0].payload.locationEvidence as any[])[0].subjectMatchConfidence, 0);
assert.equal((documents[0].payload.locationEvidence as any[])[0].currentPositionVerified, false);

const json = { id: 'record-1', properties: { observedAt: time, value: 17 } };
const structured = buildSpectraAcquisitionRecords([
  { ...searchHit, metadata: { retrievedAt: time, fetchedRecord: json, fetchedContentType: 'application/json' } },
  { ...searchHit, metadata: { retrievedAt: time, fetchedRecordOmitted: true } },
]);
assert.equal(structured[0].payload.snapshotKind, 'structured_record');
assert.deepEqual(structured[0].payload.structuredRecord, json);
assert.equal(structured[1].payload.snapshotKind, 'retrieval_metadata');
assert.equal(structured[1].payload.structuredRecordOmitted, true);
assert.equal(structured[1].payload.structuredRecord, undefined, 'an oversized body is explicitly absent, never claimed as retained');

const context = { provider: 'Fixture environmental adapter', observedAt: time, temperatureC: 17 };
const contexts = buildSpectraAcquisitionRecords([], { weather: context, places: [null, {}] });
assert.equal(contexts.length, 1);
assert.equal(contexts[0].recordType, 'geographic_context');
assert.equal(contexts[0].payload.snapshotKind, 'normalized_record');
assert.deepEqual(contexts[0].payload.record, context);
assert.equal(contexts[0].payload.currentPositionVerified, false);
const earlierContext = buildSpectraAcquisitionRecords([], { weather: { ...context, retrievedAt: time, metadata: { retrievedAt: time } } })[0];
const laterContext = buildSpectraAcquisitionRecords([], { weather: { ...context, retrievedAt: later, metadata: { retrievedAt: later } } })[0];
assert.equal(spectraAcquisitionRecordHash(earlierContext), spectraAcquisitionRecordHash(laterContext),
  'wrapping normalized adapter records must not turn receipt timestamps into changed source content');

const fixture: SpectraAcquisitionEvidenceRecord = {
  recordType: 'retrieved_document', provider: 'fixture', sourceUrl: url, retrievedAt: time,
  payload: { snapshotKind: 'extracted_document', textExcerpt: 'Actual fetched text', nested: { b: 2, a: 1 }, retrievedAt: time },
};
const reordered: SpectraAcquisitionEvidenceRecord = {
  ...fixture, retrievedAt: later,
  payload: { retrievedAt: later, nested: { a: 1, b: 2 }, textExcerpt: 'Actual fetched text', snapshotKind: 'extracted_document' },
};
assert.equal(spectraAcquisitionRecordHash(fixture), spectraAcquisitionRecordHash(reordered),
  'key order and acquisition receipt times must not create fake document versions');
assert.notEqual(spectraAcquisitionRecordHash(fixture), spectraAcquisitionRecordHash({
  ...fixture, payload: { ...fixture.payload, textExcerpt: 'Changed source text' },
}), 'changed source contents must remain distinct versions');
assert.notEqual(spectraAcquisitionRecordHash(fixture), spectraAcquisitionRecordHash({ ...fixture, sourceUrl: `${url}/other` }));
assert.notEqual(spectraAcquisitionRecordHash({ ...fixture, payload: { record: { observedAt: time } } }),
  spectraAcquisitionRecordHash({ ...fixture, payload: { record: { observedAt: later } } }),
  'source observation timestamps remain part of version identity');

const prepared = prepareSpectraAcquisitionEvidenceRecords([fixture, reordered]);
assert.equal(prepared.records.length, 1);
assert.equal(prepared.omissions.duplicate, 1);
assert.equal(prepared.omittedCount, 0, 'a represented duplicate is not lost evidence');
assert.equal(prepared.records[0].firstSeenAt, time);
assert.equal(prepared.records[0].lastSeenAt, later);
assert.equal(prepared.records[0].retrievedAt, time);
fixture.payload.textExcerpt = 'Caller mutation after snapshot';
assert.equal(prepared.records[0].payload.textExcerpt, 'Actual fetched text', 'snapshots are isolated from later caller mutations');

const cyclic: any = {};
cyclic.self = cyclic;
const invalid = prepareSpectraAcquisitionEvidenceRecords([
  { ...fixture, retrievedAt: 'not a date' },
  { ...fixture, payload: cyclic },
  { ...fixture, payload: { text: '🚆'.repeat(70_000) } },
]);
assert.equal(invalid.omissions.invalid, 2);
assert.equal(invalid.omissions.recordTooLarge, 1, 'the per-record bound is bytes, not character count');
assert.equal(invalid.omittedCount, 3);
const largeBatch = prepareSpectraAcquisitionEvidenceRecords(Array.from({ length: 14 }, (_, n) => ({
  ...fixture, sourceUrl: `${url}/${n}`, payload: { text: 'A'.repeat(220_000) },
})));
assert.ok(largeBatch.omissions.batchLimit > 0);
assert.equal(largeBatch.records.length + largeBatch.omittedCount, 14);
assert.ok(Buffer.byteLength(JSON.stringify(largeBatch.records)) <= SPECTRA_EVIDENCE_BATCH_MAX_BYTES);
assert.equal(largeBatch.bytes, Buffer.byteLength(JSON.stringify(largeBatch.records)));
assert.ok(largeBatch.records.every(row => Buffer.byteLength(JSON.stringify(row)) <= SPECTRA_EVIDENCE_RECORD_MAX_BYTES));
assert.ok(largeBatch.records.every(row => (row.payload.text as string).length === 220_000), 'retained payloads must not be silently truncated');
const manyRecords = prepareSpectraAcquisitionEvidenceRecords(Array.from({ length: SPECTRA_EVIDENCE_BATCH_MAX_RECORDS + 1 }, (_, n) => ({
  ...fixture, sourceUrl: `${url}/${n}`,
})));
assert.equal(manyRecords.omissions.batchLimit, 1);

// A query-injected store checks transaction SQL contracts and tenant arguments
// without importing db.ts, opening network sockets, or requiring secrets.
const owners = new Map([['investigation-a', { userId: 'user-a', sessionId: 'session-a' }], ['investigation-b', { userId: 'user-b', sessionId: 'session-b' }]]);
const stored: Array<Record<string, any>> = [];
const query: SpectraEvidenceQuery = async (sql, parameters) => {
  if (sql.startsWith('INSERT')) {
    assert.match(sql, /jsonb_to_recordset\(\$4::jsonb\)/);
    assert.match(sql, /ON CONFLICT \(investigation_id, record_type, provider, content_hash\)/);
    assert.match(sql, /user_id = EXCLUDED\.user_id/);
    assert.doesNotMatch(sql.split('DO UPDATE SET')[1], /payload\s*=/, 'a refetch must not overwrite a version payload');
    const [investigationId, userId, sessionId, serialized] = parameters;
    const rows: Array<Record<string, any>> = [];
    for (const incoming of JSON.parse(String(serialized))) {
      const existing = stored.find(row => row.investigation_id === investigationId && row.content_hash === incoming.contentSha256
        && row.record_type === incoming.recordType && row.provider === incoming.provider);
      if (existing) {
        if (existing.user_id !== userId || existing.session_id !== sessionId) continue;
        existing.first_seen_at = [existing.first_seen_at, incoming.firstSeenAt].sort()[0];
        existing.last_seen_at = [existing.last_seen_at, incoming.lastSeenAt].sort().at(-1);
        rows.push({ inserted: false });
      } else {
        stored.push({
          id: `record-${stored.length + 1}`, investigation_id: investigationId, user_id: userId, session_id: sessionId,
          record_type: incoming.recordType, provider: incoming.provider, source_url: incoming.sourceUrl,
          retrieved_at: incoming.retrievedAt, content_hash: incoming.contentSha256, payload: incoming.payload,
          first_seen_at: incoming.firstSeenAt, last_seen_at: incoming.lastSeenAt,
        });
        rows.push({ inserted: true });
      }
    }
    return { rows };
  }
  assert.match(sql, /JOIN public\.spectra_investigations i/);
  assert.match(sql, /i\.id = r\.investigation_id AND i\.session_id = r\.session_id AND i\.user_id = r\.user_id/);
  assert.match(sql, /r\.user_id = \$1 AND i\.user_id = \$1 AND r\.session_id = \$2 AND i\.session_id = \$2/);
  const [userId, sessionId, limit] = parameters;
  assert.ok(Number.isFinite(limit) && Number(limit) <= 500);
  return { rows: stored.filter(row => row.user_id === userId && row.session_id === sessionId
    && owners.get(row.investigation_id)?.userId === userId && owners.get(row.investigation_id)?.sessionId === sessionId).slice(0, Number(limit)) };
};
const ownerA = { investigationId: 'investigation-a', userId: 'user-a', sessionId: 'session-a' };
assert.deepEqual(await writeSpectraAcquisitionEvidenceRecords(query, ownerA, prepared), { count: 1, inserted: 1 });
assert.deepEqual(await writeSpectraAcquisitionEvidenceRecords(query, ownerA, prepared), { count: 1, inserted: 0 });
const changed = prepareSpectraAcquisitionEvidenceRecords([{ ...fixture, payload: { textExcerpt: 'New document version' } }]);
assert.deepEqual(await writeSpectraAcquisitionEvidenceRecords(query, ownerA, changed), { count: 1, inserted: 1 });
const listed = await readSpectraAcquisitionEvidenceRecords(query, 'user-a', ' session-a ', Number.POSITIVE_INFINITY);
assert.equal(listed.persistenceAvailable, true);
assert.equal(listed.records.length, 2, 'changed content appends a version instead of replacing history');
assert.equal(listed.records[0].payload.textExcerpt, 'Actual fetched text');
assert.equal(listed.records[0].firstSeenAt, time);
assert.equal(listed.records[0].lastSeenAt, later);
assert.deepEqual((await readSpectraAcquisitionEvidenceRecords(query, 'user-b', 'session-a')).records, [], 'another user cannot read the session archive');
assert.deepEqual((await readSpectraAcquisitionEvidenceRecords(query, "user-a' OR 1=1 --", 'session-a')).records, []);
await assert.rejects(writeSpectraAcquisitionEvidenceRecords(query, { ...ownerA, userId: 'user-b' }, prepared),
  /ownership mismatch/, 'an owner-conflicting row must abort persistence instead of disappearing without an omission');
owners.set('investigation-a', { userId: 'user-b', sessionId: 'session-a' });
assert.deepEqual((await readSpectraAcquisitionEvidenceRecords(query, 'user-a', 'session-a')).records, [], 'stale ownership on an evidence row is insufficient without the investigation owner');
const unavailable = await readSpectraAcquisitionEvidenceRecords(async () => { throw Object.assign(new Error('fixture internal detail'), { code: '42P01' }); }, 'user-a', 'session-a');
assert.equal(unavailable.persistenceAvailable, false);
assert.equal(unavailable.error, 'Acquisition record storage is not installed.');
assert.deepEqual(unavailable.records, []);
assert.equal((await readSpectraAcquisitionEvidenceRecords(async () => { throw new Error('must not query'); }, '', 'session-a')).persistenceAvailable, false);
console.log('SPECTRA acquisition archive: fetched-only snapshots, JSON retention, version deduplication, explicit bounds and tenant-scoped inspection passed.');
