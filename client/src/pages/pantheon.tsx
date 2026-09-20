/**
 * 🏛️ PANTHEON PAGE
 * 
 * Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity
 * 
 * Advanced intelligence platform for comprehensive identity profiling
 */

import { useEffect, useState } from 'react';
import { DoomsdayClockSelector } from '@/components/DoomsdayClockSelector';
import { PantheonProgressTracker } from '@/components/PantheonProgressTracker';
import { SEOHead } from "@/components/SEOHead";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, AlertCircle, Download, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getPantheonReportDurationLabel, normalizePantheonSearchDepth } from "@shared/pantheonReportConfig";
import './pantheon.css';

// Constants
const NETWORK_HEAD_IMAGE = '/images/digital-mind-abstract-representation-human-intelligence-neural-network_191095-87127.jpg';

interface SearchConfig {
  name: string;
  location?: string;
  searchDepth: number;
}


export default function PantheonPage() {
  const [searching, setSearching] = useState(false);
  const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null);
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [reportState, setReportState] = useState<'idle' | 'processing' | 'completed' | 'failed'>('idle');
  const [reportError, setReportError] = useState<string | null>(null);
  const [downloadReady, setDownloadReady] = useState(false);
  const [reportStartedAt, setReportStartedAt] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();
  
  useEffect(() => {
    const persistedJobId = window.localStorage.getItem('pantheon.activeReportJobId');
    if (persistedJobId) {
      setReportJobId(persistedJobId);
      setSearching(true);
      setReportState('processing');
    }
  }, []);

  useEffect(() => {
    if (!reportJobId) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let consecutivePollFailures = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/osint/report-jobs/${encodeURIComponent(reportJobId)}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          // A freshly-created durable job can briefly be invisible while the report
          // journal/database mirror converges across production instances. Treat that
          // bounded 404 exactly like other transient report-store conditions.
          if ([404, 429, 502, 503, 504].includes(response.status) && consecutivePollFailures < 8) {
            consecutivePollFailures += 1;
            const retrySeconds = Number(response.headers.get('Retry-After')) || Math.min(10, consecutivePollFailures * 2);
            pollTimer = setTimeout(poll, retrySeconds * 1000);
            return;
          }
          throw new Error(payload?.message || `Report status failed: ${response.status}`);
        }
        if (cancelled) return;
        consecutivePollFailures = 0;

        const job = payload?.job && typeof payload.job === 'object' ? payload.job : null;
        if (job?.name) {
          setSearchConfig({
            name: String(job.name),
            location: job.location ? String(job.location) : undefined,
            searchDepth: normalizePantheonSearchDepth(job.searchDepth),
          });
        }

        if (typeof job?.startedAt === 'string') setReportStartedAt(job.startedAt);

        if (payload.status === 'processing') {
          setSearching(true);
          setDownloadReady(false);
          setReportState('processing');
          setReportError(null);
          pollTimer = setTimeout(poll, 2000);
          return;
        }

        setSearching(false);

        if (payload.status === 'completed' && payload.downloadReady === true) {
          setDownloadReady(true);
          setReportState('completed');
          setReportError(null);
          toast({
            title: 'PANTHEON Search Complete',
            description: `Background report generated for ${payload.subjectName || job?.name || 'the requested subject'}.`,
          });
          return;
        }

        window.localStorage.removeItem('pantheon.activeReportJobId');
        setDownloadReady(false);
        setReportState('failed');
        setReportError(payload.error || 'The background report failed.');
      } catch (error) {
        if (cancelled) return;
        // A mobile network transition or transient proxy interruption must not
        // convert a still-running durable report into a terminal UI failure.
        if (consecutivePollFailures < 8) {
          consecutivePollFailures += 1;
          pollTimer = setTimeout(poll, Math.min(10_000, consecutivePollFailures * 1_500));
          return;
        }
        setSearching(false);
        setDownloadReady(false);
        setReportState('failed');
        setReportError(error instanceof Error ? error.message : 'Unable to retrieve the background report.');
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [reportJobId, toast]);

  const handleSearchStart = async (config: SearchConfig) => {
    setSearching(true);
    setSearchConfig(config);
    setDownloadReady(false);
    setReportState('processing');
    setReportError(null);
    setReportStartedAt(new Date().toISOString());

    try {
      const response = await fetch('/api/osint/report-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: config.name,
          location: config.location,
          searchDepth: config.searchDepth,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.jobId) {
        throw new Error(payload?.message || `Unable to start report: ${response.status}`);
      }

      const jobId = String(payload.jobId);
      window.localStorage.setItem('pantheon.activeReportJobId', jobId);
      setReportJobId(jobId);
    } catch (error) {
      setSearching(false);
      setReportState('failed');
      setReportError(error instanceof Error ? error.message : 'Unable to start the background report.');
      toast({
        title: 'Search Failed',
        description: error instanceof Error ? error.message : 'Unable to start the background report.',
        variant: 'destructive',
      });
    }
  };
  
  const handleDownloadReport = async () => {
    if (!reportJobId || !downloadReady || downloading) return;
    setDownloading(true);

    try {
      const response = await fetch(`/api/osint/report-jobs/${encodeURIComponent(reportJobId)}/download`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || `Report download failed: ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `Pantheon-Background-Report-${reportJobId.slice(0, 8)}.pdf`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast({
        title: 'Download Failed',
        description: error instanceof Error ? error.message : 'Unable to download the generated background report.',
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <SEOHead
        title="PANTHEON - Advanced Intelligence Platform | LegalWhat"
        description="PANTHEON: Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity. Advanced intelligence platform for comprehensive identity profiling."
        keywords="PANTHEON, intelligence platform, identity profiling, OSINT, background investigation, people search"
      />
      
      <div className="min-h-screen bg-background">
        <AppHeader 
          title="PANTHEON"
          subtitle="Intelligence Platform"
          fallbackRoute="/welcome"
        />
        
        <div className="pantheon-container">
          {/* Hero Section */}
          <section className="hero">
            <div className="logo">
              <h1 className="title">PANTHEON</h1>
              <p className="subtitle">
                Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity
              </p>
            </div>
            
            <p className="tagline">
              Comprehensive public-source intelligence through coordinated crawler analysis.
            </p>
          </section>
          
          {/* Network Head Background Section - Between Hero and Description */}
          <section 
            className="network-head-section"
            style={{
              backgroundImage: `url(${NETWORK_HEAD_IMAGE})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              position: 'relative',
              padding: '6rem 2rem',
              margin: '4rem 0',
            }}
          >
            <div 
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.85) 0%, rgba(17, 24, 39, 0.9) 50%, rgba(0, 0, 0, 0.85) 100%)',
                backdropFilter: 'blur(2px)',
              }}
            />
            <div 
              style={{
                position: 'relative',
                zIndex: 1,
                maxWidth: '900px',
                margin: '0 auto',
                textAlign: 'center',
              }}
            >
              <h2 
                style={{
                  fontSize: '2.5rem',
                  fontWeight: '700',
                  marginBottom: '1.5rem',
                  background: 'linear-gradient(to right, #3b82f6, #8b5cf6, #ec4899)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Parallel Autonomous Network for Tactical Heuristic Evidence-Obtaining Entity
              </h2>
              <p 
                style={{
                  fontSize: '1.125rem',
                  lineHeight: '1.75rem',
                  color: 'rgba(255, 255, 255, 0.9)',
                  marginBottom: '1rem',
                }}
              >
                The AI consciousness orchestrating all intelligence crawlers simultaneously
              </p>
              <p 
                style={{
                  fontSize: '0.875rem',
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontStyle: 'italic',
                }}
              >
                Coordinated evidence collection across the full PANTHEON crawler roster
              </p>
            </div>
          </section>
          
          {/* Description Section */}
          <section className="description">
            <h2>What is PANTHEON?</h2>
            
            <p className="main-description">
              PANTHEON is an advanced intelligence platform that locates and profiles 
              individuals across the digital landscape. By synthesizing data from dozens 
              of sources simultaneously, it constructs comprehensive identity profiles 
              including contact information, addresses, relationships, employment history, 
              digital footprints, and associated records.
            </p>
            
            <p className="secondary-description">
              Leveraging adaptive search strategies and multi-source correlation, PANTHEON 
              uncovers information that <strong>even the most expensive information gathering 
              services miss</strong>—revealing connections, patterns, and insights hidden 
              across fragmented public records.
            </p>
          </section>
          
          {/* PANTHEON registry categories — mirrors the real 4,500-source search taxonomy. */}
          <section className="capabilities">
            <h2>Background Report Categories</h2>
            <Card className="pantheon-category-card capability-card">
              <CardContent className="p-5">
                <div className="pantheon-category-heading">
                  <div className="capability-icon"><Search className="w-8 h-8" /></div>
                  <div>
                    <h3>Public-Source Background Intelligence</h3>
                    <p>30 categories searched across PANTHEON's prioritized 4,500-source registry.</p>
                  </div>
                </div>
                <div className="pantheon-category-list">
                  <span className="pantheon-category-item">1. Identity & Identity Verification</span>
                  <span className="pantheon-category-item">2. Phone Numbers</span>
                  <span className="pantheon-category-item">3. Email Addresses</span>
                  <span className="pantheon-category-item">4. Current Address</span>
                  <span className="pantheon-category-item">5. Address History</span>
                  <span className="pantheon-category-item">6. Relatives & Family</span>
                  <span className="pantheon-category-item">7. Associates & Household Connections</span>
                  <span className="pantheon-category-item">8. Social-Media Profiles</span>
                  <span className="pantheon-category-item">9. Usernames & Online Accounts</span>
                  <span className="pantheon-category-item">10. Photos & Public Images</span>
                  <span className="pantheon-category-item">11. Employment History</span>
                  <span className="pantheon-category-item">12. Education</span>
                  <span className="pantheon-category-item">13. Professional Licenses & Credentials</span>
                  <span className="pantheon-category-item">14. Business Ownership & Affiliations</span>
                  <span className="pantheon-category-item">15. Property & Real Estate</span>
                  <span className="pantheon-category-item">16. Vehicles & Transportation Records</span>
                  <span className="pantheon-category-item">17. Court Records</span>
                  <span className="pantheon-category-item">18. Criminal Records</span>
                  <span className="pantheon-category-item">19. Arrest & Police Records</span>
                  <span className="pantheon-category-item">20. Incarceration & Corrections</span>
                  <span className="pantheon-category-item">21. Probation & Parole Information</span>
                  <span className="pantheon-category-item">22. Warrants & Wanted-Person Records</span>
                  <span className="pantheon-category-item">23. Sex-Offender Registries</span>
                  <span className="pantheon-category-item">24. Civil Litigation & Judgments</span>
                  <span className="pantheon-category-item">25. Bankruptcies, Liens & Financial Public Records</span>
                  <span className="pantheon-category-item">26. Marriage, Divorce & Vital-Record Information</span>
                  <span className="pantheon-category-item">27. News & Media Mentions</span>
                  <span className="pantheon-category-item">28. Internet & Web Footprint</span>
                  <span className="pantheon-category-item">29. Government, Political & Public-Service Records</span>
                  <span className="pantheon-category-item">30. Relationship & Timeline Intelligence</span>
                </div>
              </CardContent>
            </Card>
          </section>
          
          {/* Search Depth Selector */}
          <section className="search-depth">
            <h2>Select Search Depth</h2>
            
            <DoomsdayClockSelector 
              onSearchStart={handleSearchStart}
              isSearching={searching}
            />
          </section>
          
          {/* Progress Tracker */}
          {searchConfig && reportState !== 'idle' && (
            <section className="search-progress">
              <PantheonProgressTracker
                searchDepth={searchConfig.searchDepth}
                isSearching={reportState === 'processing'}
                startedAt={reportStartedAt}
                completed={reportState === 'completed'}
              />
            </section>
          )}
          
          {(reportState !== 'idle' || downloadReady) && (
            <section className="report-delivery" aria-live="polite">
              {reportState === 'processing' && (
                <Card className="report-delivery-card">
                  <CardHeader>
                    <CardTitle>Background Report in Progress</CardTitle>
                    <CardDescription>
                      {searchConfig
                        ? `${searchConfig.name} — ${getPantheonReportDurationLabel(searchConfig.searchDepth)} investigation budget`
                        : 'Recovering active PANTHEON report job…'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    PANTHEON is collecting and cross-checking public-source evidence. The download control will appear here when the report is complete.
                  </CardContent>
                </Card>
              )}

              {reportState === 'failed' && (
                <Card className="report-delivery-card border-destructive/50">
                  <CardHeader>
                    <CardTitle>Report Could Not Be Completed</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-destructive">
                    {reportError || 'The background report failed.'}
                  </CardContent>
                </Card>
              )}

              {reportState === 'completed' && downloadReady && (
                <button
                  type="button"
                  className="report-download-button"
                  onClick={handleDownloadReport}
                  disabled={downloading}
                  aria-label="Download generated background report"
                >
                  <Download className="w-5 h-5" aria-hidden="true" />
                  <span>{downloading ? 'Preparing Download…' : 'Download Background Report'}</span>
                </button>
              )}
            </section>
          )}

          {/* Data Sources */}
          <section className="sources">
            <h2>Data Sources</h2>
            <p>
              PANTHEON synthesizes evidence returned by its configured public-source crawlers, including:
            </p>
            <ul className="sources-list">
              <li>Court records and legal filings</li>
              <li>Property databases and deed records</li>
              <li>Business registrations and corporate filings</li>
              <li>Social media platforms</li>
              <li>News archives and media mentions</li>
              <li>Professional networks and directories</li>
              <li>Government records and public registries</li>
              <li>Educational institutions and alumni databases</li>
              <li>Licensing boards and credential registries</li>
              <li>And many more...</li>
            </ul>
          </section>
          
          {/* Privacy Notice */}
          <section className="privacy-notice">
            <Card className="border-yellow-500/50 bg-yellow-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-yellow-600">
                  <AlertCircle className="w-5 h-5" />
                  Important Notice
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">
                  PANTHEON aggregates information exclusively from publicly available sources. 
                  All data is obtained legally and ethically from records that are already 
                  accessible to the public. We do not access private databases, hack systems, 
                  or obtain information through unauthorized means.
                </p>
                <p className="text-sm">
                  Results should be used responsibly and in compliance with applicable laws, 
                  including the Fair Credit Reporting Act (FCRA) and other privacy regulations.
                </p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t">
                  <Shield className="w-3 h-3" />
                  <strong>Legal & Ethical Use Only</strong>
                </div>
              </CardContent>
            </Card>
          </section>
          
        </div>
      </div>
    </>
  );
}
