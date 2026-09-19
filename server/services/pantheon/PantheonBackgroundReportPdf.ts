import PDFDocument from 'pdfkit';

interface SourceEntry {
  name?: string;
  confidence?: number;
  timestamp?: Date | string;
  data?: unknown;
}

interface CrawlerAuditEntry {
  crawler?: string;
  capabilityClass?: string;
  status?: string;
  evidenceCount?: number;
  attempts?: number;
  targets?: number;
  error?: string;
}

interface PantheonReportForPdf {
  identitySummary?: {
    name?: string;
    aliases?: string[];
    age?: number;
    dateOfBirth?: string;
    gender?: string;
    verificationStatus?: string;
  };
  contactInformation?: string[];
  socialMediaPresence?: string[];
  employmentAndEducation?: string[];
  locationHistory?: string[];
  publicRecords?: string[];
  onlineMentions?: string[];
  riskAndReputation?: string[];
  caseHistory?: Array<Record<string, unknown>>;
  summary?: string;
  confidenceScore?: number;
  sources?: SourceEntry[];
  emails?: unknown;
  breaches?: unknown;
  spiderfoot?: unknown;
  searchDepthUsed?: number;
  crawlersActivated?: string[];
  crawlerAudit?: CrawlerAuditEntry[];
}

export interface PantheonPdfInput {
  reportId: string;
  report: PantheonReportForPdf;
  job?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
  completedAt?: Date | string | null;
}

function cleanText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'Not recorded';
}

function safeFilenamePart(value: string): string {
  const normalized = value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized.slice(0, 80) || 'subject';
}

function percent(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'N/A';
  const normalized = number <= 1 ? number * 100 : number;
  return `${Math.max(0, Math.min(100, normalized)).toFixed(0)}%`;
}

function addSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  if (doc.y > 680) doc.addPage();
  doc.moveDown(0.7);
  doc.font('Helvetica-Bold').fontSize(13).text(title.toUpperCase());
  doc.moveDown(0.35);
}

function addList(doc: PDFKit.PDFDocument, items: unknown[] | undefined): void {
  const values = (items || []).map(cleanText).filter(Boolean);
  if (values.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).text('No verified finding returned by the available public sources.');
    return;
  }
  doc.font('Helvetica').fontSize(9);
  for (const item of values) {
    if (doc.y > 710) doc.addPage();
    doc.text(`• ${item}`, { indent: 8, lineGap: 2 });
  }
}

function compactEvidence(value: unknown, max = 1800): string {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[evidence truncated in printable appendix]`;
}

export function pantheonReportFilename(report: PantheonReportForPdf, reportId: string): string {
  const subject = safeFilenamePart(cleanText(report.identitySummary?.name) || 'subject');
  return `Pantheon-Background-Report-${subject}-${reportId.slice(0, 8)}.pdf`;
}

export async function generatePantheonBackgroundReportPdf(input: PantheonPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 46, bottom: 46, left: 48, right: 48 },
      info: {
        Title: 'PANTHEON Comprehensive Public-Source Background Report',
        Author: 'Legal What? PANTHEON',
        Subject: cleanText(input.report.identitySummary?.name) || 'Background Report',
      },
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const report = input.report;
    const subject = cleanText(report.identitySummary?.name) || 'Unknown subject';

    doc.font('Helvetica-Bold').fontSize(18).text('LEGAL WHAT? — PANTHEON', { align: 'center' });
    doc.moveDown(0.25);
    doc.fontSize(15).text('COMPREHENSIVE PUBLIC-SOURCE BACKGROUND REPORT', { align: 'center' });
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(9);
    doc.text(`Report ID: ${input.reportId}`);
    doc.text(`Subject: ${subject}`);
    doc.text(`Generated: ${formatDate(input.completedAt || new Date())}`);
    doc.text(`Investigation started: ${formatDate(input.createdAt)}`);
    doc.text(`Search depth: ${report.searchDepthUsed ?? cleanText(input.job?.searchDepth) || 'N/A'}`);
    doc.text(`Overall confidence: ${percent(report.confidenceScore)}`);
    doc.moveDown(0.5);
    doc.font('Helvetica-Oblique').fontSize(8).text(
      'This report summarizes evidence returned from lawful public-source research and configured data services. It is not an official government record, criminal-history certification, or substitute for source-record verification.',
      { align: 'justify' },
    );

    addSectionTitle(doc, 'Identity Summary');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Name: ${subject}`);
    doc.text(`Aliases: ${(report.identitySummary?.aliases || []).map(cleanText).filter(Boolean).join(', ') || 'None verified'}`);
    doc.text(`Age: ${cleanText(report.identitySummary?.age) || 'Not verified'}`);
    doc.text(`Date of birth: ${cleanText(report.identitySummary?.dateOfBirth) || 'Not verified'}`);
    doc.text(`Gender: ${cleanText(report.identitySummary?.gender) || 'Not verified'}`);
    doc.text(`Verification status: ${cleanText(report.identitySummary?.verificationStatus) || 'Not recorded'}`);

    addSectionTitle(doc, 'Executive Summary');
    doc.font('Helvetica').fontSize(9).text(cleanText(report.summary) || 'No synthesis was produced.', { align: 'justify', lineGap: 2 });

    addSectionTitle(doc, 'Contact Information');
    addList(doc, report.contactInformation);

    addSectionTitle(doc, 'Location History');
    addList(doc, report.locationHistory);

    addSectionTitle(doc, 'Employment & Education');
    addList(doc, report.employmentAndEducation);

    addSectionTitle(doc, 'Social & Digital Footprint');
    addList(doc, report.socialMediaPresence);

    addSectionTitle(doc, 'Public Records');
    addList(doc, report.publicRecords);

    addSectionTitle(doc, 'Court / Case History');
    addList(doc, (report.caseHistory || []).map(item => compactEvidence(item, 1200)));

    addSectionTitle(doc, 'Online & Media Mentions');
    addList(doc, report.onlineMentions);

    addSectionTitle(doc, 'Risk & Reputation Indicators');
    addList(doc, report.riskAndReputation);

    if (report.emails) {
      addSectionTitle(doc, 'Email Discovery');
      doc.font('Helvetica').fontSize(8).text(compactEvidence(report.emails), { lineGap: 2 });
    }

    if (report.breaches) {
      addSectionTitle(doc, 'Public Breach Indicators');
      doc.font('Helvetica').fontSize(8).text(compactEvidence(report.breaches), { lineGap: 2 });
    }

    if (report.spiderfoot) {
      addSectionTitle(doc, 'SpiderFoot OSINT');
      doc.font('Helvetica').fontSize(8).text(compactEvidence(report.spiderfoot), { lineGap: 2 });
    }

    addSectionTitle(doc, 'Crawler Coverage');
    const audit = report.crawlerAudit || [];
    if (audit.length > 0) {
      doc.font('Helvetica').fontSize(8);
      for (const entry of audit) {
        if (doc.y > 710) doc.addPage();
        doc.text(
          `${cleanText(entry.crawler) || 'crawler'} [${cleanText(entry.capabilityClass) || 'crawler'}] — ${cleanText(entry.status) || 'unknown'}; evidence=${Number(entry.evidenceCount || 0)}; attempts=${Number(entry.attempts || 1)}; targets=${Number(entry.targets || 0)}${entry.error ? `; note=${cleanText(entry.error)}` : ''}`,
          { lineGap: 1 },
        );
      }
    } else {
      addList(doc, report.crawlersActivated || []);
    }

    addSectionTitle(doc, 'Source Provenance');
    const sources = report.sources || [];
    if (sources.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(9).text('No source provenance entries were returned.');
    } else {
      sources.forEach((source, index) => {
        if (doc.y > 665) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(9).text(`${index + 1}. ${cleanText(source.name) || 'Source'}`);
        doc.font('Helvetica').fontSize(8);
        doc.text(`Confidence: ${percent(source.confidence)} | Retrieved: ${formatDate(source.timestamp)}`);
        const evidence = compactEvidence(source.data, 1400);
        if (evidence) doc.text(evidence, { lineGap: 1 });
        doc.moveDown(0.4);
      });
    }

    addSectionTitle(doc, 'Methodology & Verification');
    doc.font('Helvetica').fontSize(8).text(
      'PANTHEON performs parallel, failure-isolated public-source retrieval, cross-source aggregation, entity correlation, and evidence-aware synthesis. Empty or failed crawler paths are recorded as such rather than converted into positive findings. Important facts should be verified against the cited originating source before consequential use.',
      { align: 'justify', lineGap: 2 },
    );

    const pageRange = doc.bufferedPageRange();
    for (let index = pageRange.start; index < pageRange.start + pageRange.count; index++) {
      doc.switchToPage(index);
      doc.font('Helvetica').fontSize(7).text(
        `Legal What? PANTHEON | Report ${input.reportId.slice(0, 8)} | Page ${index + 1} of ${pageRange.count}`,
        48,
        748,
        { width: 516, align: 'center' },
      );
    }

    doc.end();
  });
}
