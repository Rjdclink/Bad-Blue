import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_OCR_PAGES = 5;

export interface PantheonParsedDocument {
  content: string;
  parser: 'html-text' | 'json' | 'xml' | 'csv' | 'plain-text' | 'pdf-text' | 'pdf-ocr' | 'image-ocr';
  ocrApplied: boolean;
}

function cleanExtractedText(value: string): string {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, 2_000_000);
}

function extensionFor(contentType: string, url: string): string {
  const type = contentType.toLowerCase();
  if (type.includes('png') || /\.png(?:$|[?#])/i.test(url)) return '.png';
  if (type.includes('tiff') || /\.tiff?(?:$|[?#])/i.test(url)) return '.tiff';
  if (type.includes('bmp') || /\.bmp(?:$|[?#])/i.test(url)) return '.bmp';
  return '.jpg';
}

async function tesseract(file: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw signal.reason || new Error('Pantheon OCR cancelled');
  const { stdout } = await execFileAsync('tesseract', [file, 'stdout', '--psm', '3'], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    signal,
  });
  return cleanExtractedText(stdout);
}

async function parseImage(buffer: Buffer, contentType: string, url: string, signal?: AbortSignal): Promise<PantheonParsedDocument> {
  const directory = await mkdtemp(path.join(tmpdir(), 'pantheon-ocr-'));
  try {
    const source = path.join(directory, `source${extensionFor(contentType, url)}`);
    await writeFile(source, buffer, { flag: 'wx', mode: 0o600 });
    const content = await tesseract(source, signal);
    if (content.length < 2) throw new Error('Pantheon image OCR returned no readable text');
    return { content, parser: 'image-ocr', ocrApplied: true };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function parsePdf(buffer: Buffer, signal?: AbortSignal): Promise<PantheonParsedDocument> {
  const directory = await mkdtemp(path.join(tmpdir(), 'pantheon-pdf-'));
  try {
    const source = path.join(directory, 'source.pdf');
    await writeFile(source, buffer, { flag: 'wx', mode: 0o600 });
    const textResult = await execFileAsync('pdftotext', ['-layout', source, '-'], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
      signal,
    });
    const text = cleanExtractedText(textResult.stdout);
    if (text.length >= 40) return { content: text, parser: 'pdf-text', ocrApplied: false };

    const prefix = path.join(directory, 'page');
    await execFileAsync('pdftoppm', ['-f', '1', '-l', String(MAX_OCR_PAGES), '-r', '150', '-png', source, prefix], {
      timeout: 25_000,
      maxBuffer: 2 * 1024 * 1024,
      signal,
    });
    const pages = (await readdir(directory))
      .filter(name => /^page-\d+\.png$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const extracted: string[] = [];
    for (const page of pages.slice(0, MAX_OCR_PAGES)) {
      const pageText = await tesseract(path.join(directory, page), signal);
      if (pageText) extracted.push(pageText);
    }
    const content = cleanExtractedText(extracted.join('\n\n'));
    if (content.length < 2) throw new Error('Pantheon scanned-PDF OCR returned no readable text');
    return { content, parser: 'pdf-ocr', ocrApplied: true };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function parsePantheonDocument(input: {
  bytes: Buffer;
  contentType: string;
  url: string;
  signal?: AbortSignal;
}): Promise<PantheonParsedDocument> {
  const type = input.contentType.toLowerCase();
  if (type.includes('pdf') || /\.pdf(?:$|[?#])/i.test(input.url)) return parsePdf(input.bytes, input.signal);
  if (/^image\/(?:png|jpe?g|tiff?|bmp)/i.test(type) || /\.(?:png|jpe?g|tiff?|bmp)(?:$|[?#])/i.test(input.url)) {
    return parseImage(input.bytes, input.contentType, input.url, input.signal);
  }

  const raw = cleanExtractedText(new TextDecoder('utf-8', { fatal: false }).decode(input.bytes));
  if (type.includes('json')) {
    try {
      return { content: JSON.stringify(JSON.parse(raw), null, 2), parser: 'json', ocrApplied: false };
    } catch {
      return { content: raw, parser: 'json', ocrApplied: false };
    }
  }
  if (/(?:xml|rss|atom)/i.test(type) || /\.(?:xml|rss|atom)(?:$|[?#])/i.test(input.url)) {
    return { content: raw, parser: 'xml', ocrApplied: false };
  }
  if (/csv/i.test(type) || /\.csv(?:$|[?#])/i.test(input.url)) {
    return { content: raw, parser: 'csv', ocrApplied: false };
  }
  if (/html/i.test(type) || /<html\b|<!doctype\s+html/i.test(raw)) {
    return { content: raw, parser: 'html-text', ocrApplied: false };
  }
  return { content: raw, parser: 'plain-text', ocrApplied: false };
}
