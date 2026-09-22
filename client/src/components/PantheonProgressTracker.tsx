import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { PANTHEON_REPORT_DURATIONS_MS } from '@shared/pantheonReportConfig';
import { Search } from 'lucide-react';

interface PantheonProgressTrackerProps {
  searchDepth: number;
  isSearching: boolean;
  onComplete?: () => void;
  startedAt?: string | null;
  deadlineAt?: string | null;
  phase?: string;
  completed?: boolean;
  categoryNumber?: number | null;
  categoryName?: string | null;
  completedCategories?: number;
  processedCategories?: number;
  totalCategories?: number;
}

const DEPTH_DURATIONS = PANTHEON_REPORT_DURATIONS_MS;

const PANTHEON_CATEGORIES = [
  'Identity & Identity Verification','Phone Numbers','Email Addresses','Current Address','Address History','Relatives & Family','Associates & Household Connections','Social-Media Profiles','Usernames & Online Accounts','Photos & Public Images','Employment History','Education','Professional Licenses & Credentials','Business Ownership & Affiliations','Property & Real Estate','Vehicles & Transportation Records','Court Records','Criminal Records','Arrest & Police Records','Incarceration & Corrections','Probation & Parole Information','Warrants & Wanted-Person Records','Sex-Offender Registries','Civil Litigation & Judgments','Bankruptcies, Liens & Financial Public Records','Marriage, Divorce & Vital-Record Information','News & Media Mentions','Internet & Web Footprint','Government, Political & Public-Service Records','Relationship & Timeline Intelligence'
] as const;

export function PantheonProgressTracker({ 
  searchDepth, 
  isSearching,
  onComplete,
  startedAt,
  deadlineAt,
  phase = 'collecting',
  completed = false,
  categoryNumber = null,
  categoryName = null,
  completedCategories = 0,
  processedCategories = 0,
  totalCategories = PANTHEON_CATEGORIES.length,
}: PantheonProgressTrackerProps) {
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const totalDuration = DEPTH_DURATIONS[searchDepth as keyof typeof DEPTH_DURATIONS] || 30000;

  useEffect(() => {
    if (completed) {
      setProgress(100);
      setElapsedTime(totalDuration);
      setNowMs(Date.now());
      onComplete?.();
      return;
    }
    if (!isSearching) return;

    const parsedStartedAt = startedAt ? Date.parse(startedAt) : NaN;
    const parsedDeadlineAt = deadlineAt ? Date.parse(deadlineAt) : NaN;
    const startTime = Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now();
    const effectiveDuration = Number.isFinite(parsedDeadlineAt)
      ? Math.max(1, parsedDeadlineAt - startTime)
      : totalDuration;
    const tick = () => {
      const elapsed = Math.max(0, Date.now() - startTime);
      const boundedElapsed = Math.min(elapsed, effectiveDuration);
      setElapsedTime(boundedElapsed);
      setNowMs(Date.now());
      const authoritativeProgress = totalCategories > 0 ? (processedCategories / totalCategories) * 100 : 0;
      setProgress(Math.min(authoritativeProgress, 99));
    };
    tick();
    const interval = setInterval(tick, 50);
    return () => clearInterval(interval);
  }, [completed, deadlineAt, isSearching, onComplete, processedCategories, startedAt, totalCategories, totalDuration]);

  const parsedDeadlineAt = deadlineAt ? Date.parse(deadlineAt) : NaN;
  const remainingMs = Number.isFinite(parsedDeadlineAt)
    ? Math.max(0, parsedDeadlineAt - nowMs)
    : Math.max(0, totalDuration - elapsedTime);
  const finalizing = !completed && phase === 'finalizing';
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  const milliseconds = Math.floor((remainingMs % 1000) / 10);

  const formatDigit = (num: number, digits: number = 2) => {
    return num.toString().padStart(digits, '0');
  };

  return (
    <Card className="border-2 border-primary/50 shadow-xl relative overflow-hidden">
      {/* Animated Background Glow */}
      <div className="absolute inset-0 bg-primary/5 animate-pulse" />
      
      <CardContent className="p-6 space-y-5 relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-6 h-6 text-primary animate-pulse" />
            <h3 className="font-bold text-xl">
              PANTHEON Intelligence Scan
            </h3>
          </div>
          <Badge variant="secondary" className="text-base px-3 py-1">
            {Math.round(progress)}%
          </Badge>
        </div>

        {/* Digital Countdown Timer */}
        <div className="relative p-6 rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-black border-2 border-cyan-500/50 shadow-inner">
          {/* LED-style glow effect */}
          <div className="absolute inset-0 bg-cyan-500/5 rounded-xl animate-pulse" />
          
          <div className="relative z-10 flex items-center justify-center gap-1 min-w-0 overflow-hidden">
            {/* Minutes */}
            <div className="flex flex-col items-center">
              <div className="flex gap-1">
                <DigitDisplay digit={Math.floor(minutes / 10)} color="cyan" />
                <DigitDisplay digit={minutes % 10} color="cyan" />
              </div>
              <span className="text-xs text-muted-foreground mt-1 font-mono">MIN</span>
            </div>

            {/* Separator */}
            <div className="flex flex-col gap-2 px-2">
              <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse shadow-lg shadow-cyan-500/50" />
              <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse shadow-lg shadow-cyan-500/50" />
            </div>

            {/* Seconds */}
            <div className="flex flex-col items-center">
              <div className="flex gap-1">
                <DigitDisplay digit={Math.floor(seconds / 10)} color="cyan" />
                <DigitDisplay digit={seconds % 10} color="cyan" />
              </div>
              <span className="text-xs text-muted-foreground mt-1 font-mono">SEC</span>
            </div>

            {/* Separator */}
            <div className="flex flex-col gap-2 px-2">
              <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse shadow-lg shadow-cyan-500/50" />
              <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse shadow-lg shadow-cyan-500/50" />
            </div>

            {/* Milliseconds */}
            <div className="flex flex-col items-center min-w-0">
              <span className="text-cyan-300 font-mono text-sm tabular-nums">{formatDigit(milliseconds, 3)}</span>
              <span className="text-[10px] text-muted-foreground mt-1 font-mono">MS</span>
            </div>
          </div>

          {/* Scanline effect */}
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-transparent to-transparent animate-scan pointer-events-none rounded-xl" />
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress 
            value={progress} 
            className="h-3 bg-slate-900"
          />
        </div>

        {/* Current category plus complete registry taxonomy. */}
        <div className="rounded-lg border border-cyan-500/30 bg-slate-950/70 p-3 text-center">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Current stage</div>
          <div className="mt-1 font-semibold">{completed ? 'Report assembly complete' : finalizing ? 'Finalizing report from collected evidence' : (categoryName || PANTHEON_CATEGORIES[Math.min(PANTHEON_CATEGORIES.length - 1, Math.max(0, (categoryNumber || 1) - 1))])}</div>
          <div className="mt-1 text-xs text-muted-foreground">{finalizing ? 'Collection closed — assembling available evidence' : <>Category {completed ? totalCategories : Math.min(totalCategories, Math.max(1, categoryNumber || processedCategories + 1))} of {totalCategories} · {completedCategories} fully covered</>}</div>
        </div>

        {/* Real registry categories: one compact panel rather than synthetic scan-stage tags. */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="font-semibold text-sm">30 Background Report Categories</span>
            <span className="text-xs text-muted-foreground">4,500-source registry</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
            {PANTHEON_CATEGORIES.map((category, index) => (
              <span key={category} className="text-[11px] leading-snug text-muted-foreground">
                {index + 1}. {category}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// LED-style Digital Display Component
function DigitDisplay({ digit, color, small = false }: { digit: number; color: 'red' | 'cyan'; small?: boolean }) {
  const colorClasses = {
    red: 'text-red-500 shadow-red-500/50',
    cyan: 'text-cyan-400 shadow-cyan-400/50',
  };

  return (
    <div className={`
      ${small ? 'w-10 h-14' : 'w-16 h-24'}
      bg-black/80 rounded-lg border-2 ${color === 'red' ? 'border-red-900/50' : 'border-cyan-900/50'}
      flex items-center justify-center
      shadow-inner
      relative
      overflow-hidden
    `}>
      {/* LED segments background glow */}
      <div className={`absolute inset-0 bg-gradient-to-br ${
        color === 'red' ? 'from-red-950/20' : 'from-cyan-950/20'
      } to-transparent`} />
      
      {/* The digit */}
      <span className={`
        ${small ? 'text-4xl' : 'text-6xl'}
        font-bold
        font-mono
        ${colorClasses[color]}
        relative z-10
        leading-none
        drop-shadow-lg
        select-none
      `}
      style={{
        textShadow: `0 0 10px currentColor, 0 0 20px currentColor, 0 0 30px currentColor`,
      }}>
        {digit}
      </span>

      {/* Scanline effect on digit */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}
