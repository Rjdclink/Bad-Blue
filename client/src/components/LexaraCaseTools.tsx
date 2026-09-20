import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { AlertCircle, Brain, CheckCircle2, Download, FileText, Loader2, Scale, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import FMIAnalysis from '@/components/FMIAnalysis';
import { useAuth } from '@/hooks/useAuth';
import { mapProductLawTypeToExpert } from '@shared/legalDomainMapping';

interface LexaraCaseToolsProps {
  lawTypeId?: string;
  lawTypeName?: string;
}

interface ConsultationNextStep {
  action?: string;
  reason?: string;
  priority?: string;
  deadline?: string;
}

interface ConsultationQuestion {
  question?: string;
  purpose?: string;
  priority?: string;
}

interface ConsultationResult {
  analysis?: string;
  recommendations?: string[];
  nextSteps?: ConsultationNextStep[];
  questions?: ConsultationQuestion[];
  verified?: boolean;
  verificationDetails?: unknown;
  fullAnalysis?: unknown;
  error?: string;
  message?: string;
}

const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'],
  ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['DC', 'District of Columbia'],
] as const;

export default function LexaraCaseTools({ lawTypeId, lawTypeName }: LexaraCaseToolsProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [state, setState] = useState('');
  const [situation, setSituation] = useState('');
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [analysis, setAnalysis] = useState<ConsultationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fmiContext, setFmiContext] = useState<unknown>(null);
  const [documentType, setDocumentType] = useState('Motion');
  const [documentInstructions, setDocumentInstructions] = useState('');
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentDraft, setDocumentDraft] = useState('');
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const documentTypes = [
    'Motion','Supporting Brief','Memorandum of Law','Complaint','Answer','Counterclaim',
    'Interrogatories','Request for Production','Request for Admission','Discovery Response',
    'Affidavit','Declaration','Demand Letter','Cease and Desist Letter','Settlement Proposal',
    'Settlement Agreement','Motion to Suppress','Motion to Dismiss','Motion to Compel',
    'Motion for Continuance','Bond or Bail Motion','Sentencing Memorandum','Post-Conviction Motion',
    'Notice of Appeal','Appellate Brief','Habeas Petition','FOIA or Public Records Request',
    'Contract or Agreement','Release or Waiver','Legal Research Memorandum','Case Chronology',
    'Witness Summary','Deposition Outline','Witness List','Exhibit List','Proposed Jury Instructions',
    'Motion in Limine','Trial Brief','Proposed Order','Client Letter','Administrative Appeal',
    'Landlord-Tenant Notice','Family-Law Pleading','Probate or Estate Document',
    'Business Governance Document','Immigration Support Letter','Custom Document',
  ];

  const generateDocument = async () => {
    if (!state || !situation.trim() || documentBusy) return;
    setDocumentBusy(true); setDocumentError(null);
    try {
      const response = await fetch('/api/lexara/documents/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, facts: situation.trim(), lawType: mapProductLawTypeToExpert(lawTypeId) || lawTypeId, documentType, instructions: documentInstructions.trim() || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'LEXARA could not generate the document.');
      setDocumentTitle(data.title || documentType); setDocumentDraft(data.document || '');
    } catch (e) { setDocumentError(e instanceof Error ? e.message : 'Document generation failed.'); }
    finally { setDocumentBusy(false); }
  };

  const downloadDocument = async (format: 'docx' | 'pdf') => {
    if (!documentDraft.trim()) return;
    setDocumentError(null);
    try {
      const response = await fetch('/api/lexara/documents/export', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: documentTitle || documentType, content: documentDraft, format }),
      });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Export failed.'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = `${(documentTitle || documentType).replace(/[^a-z0-9._-]+/gi, '-') }.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (e) { setDocumentError(e instanceof Error ? e.message : 'Document export failed.'); }
  };

  const canAnalyze = useMemo(
    () => disclaimerAccepted && !!state && !!situation.trim() && !isLoading,
    [disclaimerAccepted, isLoading, situation, state],
  );

  const analyze = async () => {
    if (!canAnalyze) return;

    setIsLoading(true);
    setError(null);

    try {
      const engineLawType = mapProductLawTypeToExpert(lawTypeId) || lawTypeId;
      const response = await fetch('/api/legal-consultation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          state,
          situation: situation.trim(),
          lawType: engineLawType,
          fmiContext: fmiContext || undefined,
        }),
      });

      const data = await response.json().catch(() => ({})) as ConsultationResult;
      if (!response.ok) {
        throw new Error(data.error || data.message || `Consultation failed (${response.status})`);
      }

      setAnalysis(data);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'LEXARA could not complete the case analysis.');
    } finally {
      setIsLoading(false);
    }
  };

  const prepareDocument = (route: '/complaint-form' | '/lawsuit-form') => {
    if (!user) {
      window.location.href = '/api/login';
      return;
    }

    try {
      localStorage.setItem('prefillData', JSON.stringify({
        state,
        lawType: lawTypeId,
        situation,
        consultationAnalysis: analysis?.analysis || '',
      }));
    } catch {
      // Navigation remains available even if local storage is unavailable.
    }
    setLocation(route);
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Full Case Analysis
          </CardTitle>
          <CardDescription>
            {lawTypeName || 'Legal case'} tools use the existing structured consultation engine. This mode does not start a second microphone or camera session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="lexara-case-state">State / jurisdiction</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger id="lexara-case-state">
                <SelectValue placeholder="Select a state" />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map(([code, name]) => (
                  <SelectItem key={code} value={code}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lexara-case-situation">Case facts</Label>
            <Textarea
              id="lexara-case-situation"
              value={situation}
              onChange={event => setSituation(event.target.value)}
              rows={9}
              placeholder="Describe what happened, including dates, locations, parties, documents, witnesses, and the result you are seeking."
            />
          </div>

          <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
            <Checkbox
              id="lexara-case-disclaimer"
              checked={disclaimerAccepted}
              onCheckedChange={checked => setDisclaimerAccepted(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor="lexara-case-disclaimer" className="font-normal leading-relaxed">
              I understand LEXARA provides legal information and analysis, not legal advice or an attorney-client relationship, and important authorities and deadlines should be independently verified.
            </Label>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button onClick={() => void analyze()} disabled={!canAnalyze} className="w-full sm:w-auto">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
            {isLoading ? 'Analyzing case…' : 'Run full case analysis'}
          </Button>
        </CardContent>
      </Card>

      {analysis?.analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              LEXARA Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{analysis.analysis}</div>

            {!!analysis.recommendations?.length && (
              <div>
                <h3 className="mb-2 font-semibold">Recommendations</h3>
                <ul className="space-y-2 text-sm">
                  {analysis.recommendations.map((item, index) => (
                    <li key={`${index}-${item}`} className="rounded-lg bg-muted/40 p-3">{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {!!analysis.nextSteps?.length && (
              <div>
                <h3 className="mb-2 font-semibold">Next steps</h3>
                <div className="space-y-2">
                  {analysis.nextSteps.map((step, index) => (
                    <div key={`${index}-${step.action || 'step'}`} className="rounded-lg border p-3 text-sm">
                      <div className="font-medium">{step.action || 'Next step'}</div>
                      {step.reason && <div className="mt-1 text-muted-foreground">{step.reason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!!analysis.questions?.length && (
              <div>
                <h3 className="mb-2 font-semibold">Questions that could materially change the analysis</h3>
                <div className="space-y-2">
                  {analysis.questions.map((question, index) => (
                    <div key={`${index}-${question.question || 'question'}`} className="rounded-lg border p-3 text-sm">
                      <div>{question.question}</div>
                      {question.purpose && <div className="mt-1 text-xs text-muted-foreground">{question.purpose}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => prepareDocument('/complaint-form')}>
                <FileText className="mr-2 h-4 w-4" />
                Prepare complaint
              </Button>
              <Button variant="outline" onClick={() => prepareDocument('/lawsuit-form')}>
                <FileText className="mr-2 h-4 w-4" />
                Prepare lawsuit
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card id="lexara-document-studio">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />LEXARA Document Studio</CardTitle>
          <CardDescription>Generate a legal-document draft from the case facts already provided, review and edit it here, then export the same reviewed draft as DOCX or PDF.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Document type</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{documentTypes.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lexara-document-instructions">Optional drafting instructions</Label>
            <Textarea id="lexara-document-instructions" value={documentInstructions} onChange={e => setDocumentInstructions(e.target.value)} rows={3} placeholder="Example: focus on the suppression issue and leave unknown caption information as placeholders." />
          </div>
          <Button onClick={() => void generateDocument()} disabled={!state || !situation.trim() || documentBusy}>
            {documentBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {documentBusy ? 'LEXARA is drafting…' : 'Draft document from case facts'}
          </Button>
          {documentError && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{documentError}</div>}
          {documentDraft && (
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <Label htmlFor="lexara-document-title">Document title</Label>
                <input id="lexara-document-title" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" value={documentTitle} onChange={e => setDocumentTitle(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="lexara-document-draft">Preview & edit</Label>
                <Textarea id="lexara-document-draft" value={documentDraft} onChange={e => setDocumentDraft(e.target.value)} rows={22} className="mt-1 font-serif leading-relaxed" />
              </div>
              <p className="text-xs text-muted-foreground">Verify facts, authorities, local court rules, deadlines, signatures, service, and filing requirements before use. Unknown facts should remain bracketed rather than invented.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void downloadDocument('docx')}><Download className="mr-2 h-4 w-4" />Download DOCX</Button>
                <Button variant="outline" onClick={() => void downloadDocument('pdf')}><Download className="mr-2 h-4 w-4" />Download PDF</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <section id="fmi-section">
        <FMIAnalysis
          lawType={lawTypeId || 'general'}
          lawTypeName={lawTypeName || 'Legal Analysis'}
          state={state || undefined}
          caseContext={situation.trim() || undefined}
          onAnalysisComplete={setFmiContext}
        />
      </section>
    </main>
  );
}
