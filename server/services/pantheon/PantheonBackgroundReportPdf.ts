import { createHash } from 'node:crypto';
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

interface PantheonCategoryOutcomeForPdf {
  index?: number;
  label?: string;
  targetCount?: number;
  evidenceCount?: number;
  findings?: string[];
  urlsAttempted?: number;
  urlsSuccessful?: number;
  urlsFailed?: number;
  crawlersUsed?: string[];
  expectedCapabilities?: string[];
  completionState?: string;
  completionReason?: string;
  evidenceRejected?: number;
  requiredWorkCount?: number;
  successfulWorkCount?: number;
  crawlerAudit?: CrawlerAuditEntry[];
  categoryOutcomes?: PantheonCategoryOutcomeForPdf[];
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
  reportCompleteness?: 'complete' | 'partial';
  coverageGaps?: Array<{
    category?: string;
    state?: string;
    reason?: string;
    pendingUrls?: number;
    missingCapabilities?: string[];
  }>;
  categoryOutcomes?: PantheonCategoryOutcomeForPdf[];
}

export interface PantheonPdfInput {
  reportId: string;
  report: PantheonReportForPdf;
  job?: Record<string, unknown> | null;
  createdAt?: Date | string | null;
  completedAt?: Date | string | null;
  categoryOutcomes?: PantheonCategoryOutcomeForPdf[];
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

export interface PantheonPdfVerification {
  verified: true;
  bytes: number;
  pageCount: number;
  streamCount: number;
  sha256: string;
  verifiedAt: string;
}

export function verifyPantheonReportModel(input: PantheonPdfInput): void {
  const outcomes = input.categoryOutcomes || input.report.categoryOutcomes || [];
  const indexes = outcomes.map(outcome => Number(outcome.index));
  if (indexes.some(index => !Number.isInteger(index) || index < 0 || index >= 30)) {
    throw new Error('Pantheon report model contains an invalid category index');
  }
  if (new Set(indexes).size !== indexes.length) {
    throw new Error('Pantheon report model contains duplicate category outcomes');
  }
  if (input.report.reportCompleteness === 'complete') {
    if (outcomes.length !== 30 || outcomes.some(outcome => outcome.completionState !== 'completed')) {
      throw new Error('Pantheon report cannot claim complete coverage without 30 completed category outcomes');
    }
    if ((input.report.coverageGaps || []).length > 0) {
      throw new Error('Pantheon report cannot claim complete coverage while coverage gaps exist');
    }
  }
  for (const outcome of outcomes) {
    if (outcome.completionState === 'completed' && Number(outcome.urlsAttempted || 0) <= 0) {
      throw new Error(`Pantheon category ${Number(outcome.index) + 1} cannot be represented as worked without an attempted URL`);
    }
    if (outcome.completionState === 'completed'
      && Number(outcome.successfulWorkCount || outcome.urlsSuccessful || 0) < Number(outcome.requiredWorkCount || 1)) {
      throw new Error(`Pantheon category ${Number(outcome.index) + 1} claimed completion without its live-work quota`);
    }
  }
}

export function verifyPantheonPdfBuffer(buffer: Buffer, expectedMinimumPages = 1): PantheonPdfVerification {
  const raw = buffer.toString('latin1');
  const pageCount = (raw.match(/\/Type\s*\/Page\b/g) || []).length;
  const streamCount = (raw.match(/\bstream\r?\n/g) || []).length;
  const minimumPages = Math.max(1, Math.floor(expectedMinimumPages));
  if (!raw.startsWith('%PDF-') || !/%%EOF\s*$/.test(raw) || buffer.length < 5_000) {
    throw new Error('Pantheon PDF verification failed: malformed or truncated document');
  }
  if (pageCount < minimumPages || streamCount < pageCount) {
    throw new Error(`Pantheon PDF verification failed: expected at least ${minimumPages} rendered pages`);
  }
  return {
    verified: true,
    bytes: buffer.length,
    pageCount,
    streamCount,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    verifiedAt: new Date().toISOString(),
  };
}

export async function generatePantheonBackgroundReportPdf(input: PantheonPdfInput): Promise<Buffer> {
  verifyPantheonReportModel(input);
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
    const reportCompleteness = cleanText(report.reportCompleteness) || cleanText(input.job?.investigationStatus) || cleanText((report as Record<string, unknown>).investigationStatus) || 'partial';
    addLabelValue(doc, 'REPORT COVERAGE', reportCompleteness);
    if (reportCompleteness !== 'complete') {
      doc.fillColor('#B42318').font('Helvetica-Bold').fontSize(10).text('PARTIAL REPORT — exact omissions are listed below.');
      doc.fillColor('#111827');
    }
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

    if (report.reportCompleteness !== 'complete') {
      addSectionTitle(doc, 'Coverage Gaps & Exact Omissions');
      const gaps = report.coverageGaps || [];
      if (!gaps.length) {
        doc.font('Helvetica-Oblique').fontSize(8).text('One or more category outcomes were not persisted; those categories are omitted.');
      } else {
        for (const gap of gaps) {
          if (doc.y > 700) doc.addPage();
          doc.font('Helvetica').fontSize(8).text(
            `• ${cleanText(gap.category) || 'Unknown category'}: ${cleanText(gap.state) || 'partial'} — ${cleanText(gap.reason) || 'coverage incomplete'}; pending URLs: ${Number(gap.pendingUrls || 0)}; missing capabilities: ${(gap.missingCapabilities || []).map(cleanText).filter(Boolean).join(', ') || 'none recorded'}`,
            { indent: 8, lineGap: 1 },
          );
        }
      }
    }

    addSectionTitle(doc, '30-Category Investigation Results');
    const categoryOutcomes = input.categoryOutcomes || report.categoryOutcomes || [];
    const canonicalCategories = [
      'Identity & Identity Verification','Phone Numbers','Email Addresses','Current Address','Address History','Relatives & Family','Associates & Household Connections','Social-Media Profiles','Usernames & Online Accounts','Photos & Public Images','Employment History','Education','Professional Licenses & Credentials','Business Ownership & Affiliations','Property & Real Estate','Vehicles & Transportation Records','Court Records','Criminal Records','Arrest & Police Records','Incarceration & Corrections','Probation & Parole Information','Warrants & Wanted-Person Records','Sex-Offender Registries','Civil Litigation & Judgments','Bankruptcies, Liens & Financial Public Records','Marriage, Divorce & Vital-Record Information','News & Media Mentions','Internet & Web Footprint','Government, Political & Public-Service Records','Relationship & Timeline Intelligence'
    ] as const;
    for (let index = 0; index < canonicalCategories.length; index += 1) {
      if (doc.y > 650) doc.addPage();
      const outcome = categoryOutcomes.find(item => Number(item.index) === index);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#183B63').text(`${index + 1}. ${canonicalCategories[index]}`);
      doc.font('Helvetica').fontSize(8).fillColor('#111827');
      if (!outcome) {
        doc.text('No persisted category outcome was available. This category is not represented as completed.');
      } else {
        doc.text(`Coverage status: ${cleanText(outcome.completionState) || 'not recorded'}${outcome.completionReason ? ` — ${cleanText(outcome.completionReason)}` : ''}`);
        doc.text(`URLs attempted: ${Number(outcome.urlsAttempted || 0)} | Successful retrieval/evidence paths: ${Number(outcome.urlsSuccessful || 0)} | Failed paths: ${Number(outcome.urlsFailed || 0)}`);
        doc.text(`Required live work: ${Number(outcome.requiredWorkCount || 0)} | Completed live work: ${Number(outcome.successfulWorkCount || 0)}`);
        const crawlers = (outcome.crawlersUsed || []).map(cleanText).filter(Boolean);
        if (crawlers.length) doc.text(`Crawler capabilities used: ${crawlers.join(', ')}`);
        const findings = (outcome.findings || []).map(cleanText).filter(Boolean);
        if (!findings.length) {
          doc.font('Helvetica-Oblique').text('No verified subject-specific finding returned by the completed category investigation.');
        } else {
          doc.font('Helvetica');
          for (const finding of findings) {
            if (doc.y > 705) doc.addPage();
            doc.text(`• ${finding}`, { indent: 8, lineGap: 1 });
          }
        }
      }
      doc.moveDown(0.6);
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
        const citationId = cleanText(sourceData.citationId || sourceData.evidenceId);
        const sourceUrl = cleanText(sourceData.url);
        const contentHash = cleanText(sourceData.contentHash);
        const provenance = sourceData.provenance && typeof sourceData.provenance === 'object'
          ? sourceData.provenance as Record<string, unknown>
          : {};
        if (citationId) doc.text(`Citation ID: ${citationId}`, { lineGap: 1 });
        if (sourceUrl) doc.text(`Source: ${sourceUrl}`, { lineGap: 1 });
        if (contentHash) doc.text(`Content SHA-256: ${contentHash}`, { lineGap: 1 });
        const transport = cleanText(provenance.transport);
        if (transport) doc.text(`Retrieval transport: ${transport}`, { lineGap: 1 });
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
      doc.moveTo(48, 694).lineTo(564, 694).lineWidth(0.5).strokeColor('#D5DEE8').stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#6B7280').text(
        `LEGAL WHAT? • PANTHEON   |   Report ${input.reportId.slice(0, 8)}   |   Page ${index + 1} of ${pageRange.count}`,
        48, 700, { width: 516, align: 'center', lineBreak: false },
      );
    }

    doc.end();
  });
}
