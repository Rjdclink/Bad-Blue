import { retrieveSpectraPublicEvidence, type SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

export interface SpectraPublicWikimediaCollection {
  records: SpectraRetrievedEvidence[];
  status: 'not_supplied' | 'ok' | 'empty' | 'failed';
}

/** Only a file page explicitly supplied to Spectra is queried. */
export function suppliedCommonsFile(input: string): { title: string; url: string } | null {
  const match = /https:\/\/commons\.wikimedia\.org\/wiki\/(File:[^\s?#),;]+)/i.exec(input.slice(0, 13_000));
  if (!match) return null;
  let title: string;
  try { title = decodeURIComponent(match[1]).replace(/_/g, ' '); }
  catch { return null; }
  if (!/^File:[^\u0000-\u001f\[\]{}|<>#]{1,220}$/i.test(title)) return null;
  return { title, url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title).replace(/%3A/i, ':')}` };
}

export async function collectSpectraPublicWikimediaRecords(
  input: string,
  options: { signal?: AbortSignal; retrieve?: typeof retrieveSpectraPublicEvidence } = {},
): Promise<SpectraPublicWikimediaCollection> {
  const file = suppliedCommonsFile(input);
  if (!file) return { records: [], status: 'not_supplied' };
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.searchParams.set('action', 'query');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('prop', 'imageinfo');
  endpoint.searchParams.set('iiprop', 'timestamp|user|mime|size|sha1|metadata');
  endpoint.searchParams.set('iilimit', '1');
  endpoint.searchParams.set('titles', file.title);
  const [retrieved] = await (options.retrieve || retrieveSpectraPublicEvidence)([endpoint.toString()], options.signal).catch(() => []);
  const body = retrieved?.structuredRecord;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { records: [], status: 'failed' };
  const pages = (body as any).query?.pages;
  if (!pages || typeof pages !== 'object' || Array.isArray(pages)) return { records: [], status: 'failed' };
  const page = Object.values(pages).find(value => value && typeof value === 'object'
    && String((value as any).title || '').toLowerCase() === file.title.toLowerCase()) as any;
  const revision = page?.imageinfo?.[0];
  if (!revision || typeof revision !== 'object') return { records: [], status: 'empty' };
  const record: SpectraRetrievedEvidence = {
    url: file.url, requestedUrl: file.url, retrievedAt: retrieved.retrievedAt,
    contentType: 'application/json', title: `Wikimedia Commons ${file.title}`,
    structuredRecord: { title: page.title, pageid: page.pageid, imageinfo: revision },
    observations: [], // File metadata describes an image, not the investigated person's location.
  };
  return { records: [record], status: 'ok' };
}
