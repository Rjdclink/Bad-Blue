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
  if (doc.y > 675) doc.addPage();
  doc.moveDown(0.8);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#183B63').text(title.toUpperCase());
  doc.moveTo(48, y + 17).lineTo(564, y + 17).lineWidth(0.7).strokeColor('#B7C7D8').stroke();
  doc.fillColor('#111827').moveDown(0.55);
}

function addLabelValue(doc: PDFKit.PDFDocument, label: string, value: unknown): void {
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#374151').text(label, { continued: true });
  doc.font('Helvetica').fillColor('#111827').text(`  ${cleanText(value) || 'Not recorded'}`);
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

    doc.rect(0, 0, 612, 118).fill('#102A43');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11).text('LEGAL WHAT?', 48, 35);
    doc.fontSize(24).text('PANTHEON', 48, 53);
    doc.font('Helvetica').fontSize(10).fillColor('#D9E7F5').text('Comprehensive Public-Source Background Report', 48, 84);
    doc.y = 138;
    addLabelValue(doc, 'SUBJECT', subject);
    addLabelValue(doc, 'REPORT ID', input.reportId);
    addLabelValue(doc, 'GENERATED', formatDate(input.completedAt || new Date()));
    addLabelValue(doc, 'INVESTIGATION STARTED', formatDate(input.createdAt));
    const searchDepth = report.searchDepthUsed ?? (cleanText(input.job?.searchDepth) || 'N/A');
    addLabelValue(doc, 'SEARCH DEPTH', searchDepth);
    addLabelValue(doc, 'OVERALL CONFIDENCE', percent(report.confidenceScore));
    doc.moveDown(0.7);
    doc.roundedRect(48, doc.y, 516, 46, 5).fillAndStroke('#F4F7FA', '#D5DEE8');
    const noticeY = doc.y + 9;
    doc.fillColor('#4B5563').font('Helvetica-Oblique').fontSize(7.8).text(
      'This report summarizes evidence returned from lawful public-source research and configured data services. It is not an official government record, criminal-history certification, or substitute for source-record verification.',
      58, noticeY, { width: 496, align: 'justify', lineGap: 1 },
    );
    doc.fillColor('#111827');
    doc.y = noticeY + 46;

    addSectionTitle(doc, 'Identity Summary');
    addLabelValue(doc, 'Name', subject);
    addLabelValue(doc, 'Aliases', (report.identitySummary?.aliases || []).map(cleanText).filter(Boolean).join(', ') || 'None verified');
    addLabelValue(doc, 'Age', cleanText(report.identitySummary?.age) || 'Not verified');
    addLabelValue(doc, 'Date of birth', cleanText(report.identitySummary?.dateOfBirth) || 'Not verified');
    addLabelValue(doc, 'Gender', cleanText(report.identitySummary?.gender) || 'Not verified');
    addLabelValue(doc, 'Verification status', cleanText(report.identitySummary?.verificationStatus) || 'Not recorded');

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

    // Crawler diagnostics remain internal. Customer reports contain findings and
    // source provenance, never execution/audit internals.

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
        const sourceData = source.data && typeof source.data === 'object'
          ? source.data as Record<string, unknown>
          : {};
        const sourceUrl = cleanText(sourceData.url);
        if (sourceUrl) doc.text(`Source: ${sourceUrl}`, { lineGap: 1 });
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
      doc.moveTo(48, 742).lineTo(564, 742).lineWidth(0.5).strokeColor('#D5DEE8').stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#6B7280').text(
        `LEGAL WHAT? • PANTHEON   |   Report ${input.reportId.slice(0, 8)}   |   Page ${index + 1} of ${pageRange.count}`,
        48, 750, { width: 516, align: 'center' },
      );
    }

    doc.end();
  });
}
