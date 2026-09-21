import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import { BaseCrawler } from '../baseCrawler';
import {
  attachCrawlerCapabilityOutput,
  CrawlerType,
  requireVerifiedCrawlerSourceSnapshot,
  type CrawlerTask,
  type CrawlerSourceSnapshot,
  type EntropySignature,
} from '../core';

/** ICE: high-fidelity structured extraction from one verified live snapshot. */
export class IceCrawler extends BaseCrawler {
  private static readonly MAX_RESOURCES = 20;

  constructor(task: CrawlerTask) {
    super(task, CrawlerType.ICE);
  }

  async execute(): Promise<EntropySignature[]> {
    const snapshot = requireVerifiedCrawlerSourceSnapshot(this.task);
    const $ = cheerio.load(snapshot.content);
    const outputs: Array<Record<string, unknown>> = [];

    const metadata = this.extractMetadata($);
    if (Object.values(metadata).some(Boolean)) outputs.push({ type: 'metadata', ...metadata });

    const tables = this.extractTables($);
    if (tables.length > 0) outputs.push({ type: 'tables', tables, count: tables.length });

    const forms = this.extractForms($);
    if (forms.length > 0) outputs.push({ type: 'forms', forms, count: forms.length });

    const resources = this.describeResourceReferences($, snapshot);
    if (resources.length > 0) {
      outputs.push({
        type: 'resource_references',
        resources,
        count: resources.length,
        followedResources: 0,
      });
    }

    return outputs.map(output => attachCrawlerCapabilityOutput(
      this.generateEntropySignature(output),
      snapshot,
      Object.freeze({ function: 'snapshot-structured-extraction', ...output }),
    ));
  }

  private extractMetadata($: cheerio.CheerioAPI): Record<string, string | undefined> {
    return {
      title: $('title').text().trim() || undefined,
      description: $('meta[name="description"]').attr('content')?.trim(),
      keywords: $('meta[name="keywords"]').attr('content')?.trim(),
      author: $('meta[name="author"]').attr('content')?.trim(),
      ogTitle: $('meta[property="og:title"]').attr('content')?.trim(),
      ogDescription: $('meta[property="og:description"]').attr('content')?.trim(),
      ogImage: $('meta[property="og:image"]').attr('content')?.trim(),
      ogUrl: $('meta[property="og:url"]').attr('content')?.trim(),
      canonical: $('link[rel="canonical"]').attr('href')?.trim(),
    };
  }

  private extractTables($: cheerio.CheerioAPI): Array<Record<string, unknown>> {
    const tables: Array<Record<string, unknown>> = [];
    $('table').each((_tableIndex, table) => {
      const headers: string[] = [];
      const rows: string[][] = [];
      $(table).find('th').each((_headerIndex, cell) => {
        headers.push($(cell).text().trim());
      });
      $(table).find('tr').each((_rowIndex, rowElement) => {
        const row: string[] = [];
        $(rowElement).find('td').each((_cellIndex, cell) => {
          row.push($(cell).text().trim());
        });
        if (row.length > 0) rows.push(row);
      });
      if (headers.length > 0 || rows.length > 0) {
        tables.push({
          headers,
          rows,
          rowCount: rows.length,
          colCount: Math.max(headers.length, rows[0]?.length || 0),
        });
      }
    });
    return tables;
  }

  private extractForms($: cheerio.CheerioAPI): Array<Record<string, unknown>> {
    const forms: Array<Record<string, unknown>> = [];
    $('form').each((_formIndex, form) => {
      const fields: Array<Record<string, unknown>> = [];
      $(form).find('input, select, textarea').each((_fieldIndex, field) => {
        const name = $(field).attr('name');
        if (!name) return;
        const tagName = $(field).prop('tagName');
        fields.push({
          name,
          type: $(field).attr('type') || (tagName ? String(tagName).toLowerCase() : 'text'),
          required: $(field).attr('required') !== undefined,
          placeholder: $(field).attr('placeholder'),
        });
      });
      forms.push({
        action: $(form).attr('action') || '',
        method: ($(form).attr('method') || 'get').toUpperCase(),
        fields,
        fieldCount: fields.length,
      });
    });
    return forms;
  }

  private describeResourceReferences(
    $: cheerio.CheerioAPI,
    snapshot: Readonly<CrawlerSourceSnapshot>,
  ): Array<Record<string, unknown>> {
    const references = new Set<string>();
    $('a[href], img[src]').each((_index, element) => {
      const raw = $(element).attr('href') || $(element).attr('src');
      if (!raw || !/\.(?:pdf|docx?|xlsx?|jpe?g|png)(?:[?#].*)?$/i.test(raw)) return;
      try {
        const resolved = new URL(raw, snapshot.sourceUrl);
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') references.add(resolved.toString());
      } catch {
        // Invalid references are ignored without requesting them.
      }
    });
    return [...references].slice(0, IceCrawler.MAX_RESOURCES).map(url => ({
      url,
      referenceSha256: createHash('sha256').update(url).digest('hex'),
      extension: new URL(url).pathname.split('.').pop()?.toLowerCase() || '',
      observation: 'reference-only',
    }));
  }
}
