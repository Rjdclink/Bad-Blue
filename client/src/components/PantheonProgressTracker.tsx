import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { PANTHEON_REPORT_DURATIONS_MS } from '@shared/pantheonReportConfig';
import { Search, Eye } from 'lucide-react';

interface PantheonProgressTrackerProps {
  searchDepth: number;
  isSearching: boolean;
  onComplete?: () => void;
}

const DEPTH_DURATIONS = PANTHEON_REPORT_DURATIONS_MS;

const PANTHEON_CATEGORIES = [
  'Identity & Identity Verification','Phone Numbers','Email Addresses','Current Address','Address History','Relatives & Family','Associates & Household Connections','Social-Media Profiles','Usernames & Online Accounts','Photos & Public Images','Employment History','Education','Professional Licenses & Credentials','Business Ownership & Affiliations','Property & Real Estate','Vehicles & Transportation Records','Court Records','Criminal Records','Arrest & Police Records','Incarceration & Corrections','Probation & Parole Information','Warrants & Wanted-Person Records','Sex-Offender Registries','Civil Litigation & Judgments','Bankruptcies, Liens & Financial Public Records','Marriage, Divorce & Vital-Record Information','News & Media Mentions','Internet & Web Footprint','Government, Political & Public-Service Records','Relationship & Timeline Intelligence'
] as const;

export function PantheonProgressTracker({ 
  searchDepth, 
  isSearching,
  onComplete 
}: PantheonProgressTrackerProps) {
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  const totalDuration = DEPTH_DURATIONS[searchDepth as keyof typeof DEPTH_DURATIONS] || 30000;

  useEffect(() => {
    if (!isSearching) {
      setProgress(0);
      setElapsedTime(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progressPercent = Math.min((elapsed / totalDuration) * 100, 99);
      
      setProgress(progressPercent);
      setElapsedTime(elapsed);

      // The server-side job is authoritative. The visual clock never aborts or
      // completes the investigation; it waits for persisted job status.
    }, 50); // Update every 50ms for smooth animation

    return () => clearInterval(interval);
  }, [isSearching, searchDepth, totalDuration, onComplete]);

  if (!isSearching && progress === 0) {
    return null;
  }

  const remainingMs = Math.max(0, totalDuration - elapsedTime);
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  const milliseconds = Math.floor((remainingMs % 1000) / 10);

  const formatDigit = (num: number, digits: number = 2) => {
    return num.toString().padStart(digits, '0');
  };

  return (
    <Card className={`border-2 ${searchDepth === 4 ? 'border-red-500/50 shadow-red-500/20 shadow-2xl' : 'border-primary/50 shadow-xl'} relative overflow-hidden`}>
      {/* Animated Background Glow */}
      <div className={`absolute inset-0 ${searchDepth === 4 ? 'bg-red-900/5' : 'bg-primary/5'} animate-pulse`} />
      
      <CardContent className="p-6 space-y-5 relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {searchDepth === 4 ? (
              <Eye className="w-6 h-6 text-red-500 animate-pulse" />
            ) : (
              <Search className="w-6 h-6 text-primary animate-pulse" />
            )}
            <h3 className="font-bold text-xl">
              {searchDepth === 4 ? 'EYE OF GOD' : 'PANTHEON'} Intelligence Scan
            </h3>
          </div>
          <Badge variant="secondary" className={`text-base px-3 py-1 ${searchDepth === 4 ? 'bg-red-500/20 text-red-400 border-red-500/50' : ''}`}>
            {Math.round(progress)}%
          </Badge>
        </div>

        {/* Digital Countdown Timer */}
        <div className={`relative p-6 rounded-xl bg-gradient-to-br ${
          searchDepth === 4 
            ? 'from-red-950 via-red-900 to-black' 
            : 'from-slate-900 via-slate-800 to-black'
        } border-2 ${
          searchDepth === 4 ? 'border-red-500/50' : 'border-cyan-500/50'
        } shadow-inner`}>
          {/* LED-style glow effect */}
          <div className={`absolute inset-0 ${
            searchDepth === 4 ? 'bg-red-500/5' : 'bg-cyan-500/5'
          } rounded-xl animate-pulse`} />
          
          <div className="relative z-10 flex items-center justify-center gap-1">
            {/* Minutes */}
            <div className="flex flex-col items-center">
              <div className="flex gap-1">
                <DigitDisplay digit={Math.floor(minutes / 10)} color={searchDepth === 4 ? 'red' : 'cyan'} />
                <DigitDisplay digit={minutes % 10} color={searchDepth === 4 ? 'red' : 'cyan'} />
              </div>
              <span className="text-xs text-muted-foreground mt-1 font-mono">MIN</span>
            </div>

            {/* Separator */}
            <div className="flex flex-col gap-2 px-2">
              <div className={`w-2 h-2 rounded-full ${
                searchDepth === 4 ? 'bg-red-500' : 'bg-cyan-500'
              } animate-pulse shadow-lg ${
                searchDepth === 4 ? 'shadow-red-500/50' : 'shadow-cyan-500/50'
              }`} />
              <div className={`w-2 h-2 rounded-full ${
                searchDepth === 4 ? 'bg-red-500' : 'bg-cyan-500'
              } animate-pulse shadow-lg ${
                searchDepth === 4 ? 'shadow-red-500/50' : 'shadow-cyan-500/50'
              }`} />
            </div>

            {/* Seconds */}
            <div className="flex flex-col items-center">
              <div className="flex gap-1">
                <DigitDisplay digit={Math.floor(seconds / 10)} color={searchDepth === 4 ? 'red' : 'cyan'} />
                <DigitDisplay digit={seconds % 10} color={searchDepth === 4 ? 'red' : 'cyan'} />
              </div>
              <span className="text-xs text-muted-foreground mt-1 font-mono">SEC</span>
            </div>

            {/* Separator */}
            <div className="flex flex-col gap-2 px-2">
              <div className={`w-2 h-2 rounded-full ${
                searchDepth === 4 ? 'bg-red-500' : 'bg-cyan-500'
              } animate-pulse shadow-lg ${
                searchDepth === 4 ? 'shadow-red-500/50' : 'shadow-cyan-500/50'
              }`} />
              <div className={`w-2 h-2 rounded-full ${
                searchDepth === 4 ? 'bg-red-500' : 'bg-cyan-500'
              } animate-pulse shadow-lg ${
                searchDepth === 4 ? 'shadow-red-500/50' : 'shadow-cyan-500/50'
              }`} />
            </div>

            {/* Milliseconds */}
            <div className="flex flex-col items-center">
              <div className="flex gap-1">
                <DigitDisplay 
                  digit={Math.floor(milliseconds / 10)} 
                  color={searchDepth === 4 ? 'red' : 'cyan'}
                  small 
                />
                <DigitDisplay 
                  digit={milliseconds % 10} 
                  color={searchDepth === 4 ? 'red' : 'cyan'}
                  small 
                />
              </div>
              <span className="text-xs text-muted-foreground mt-1 font-mono">MS</span>
            </div>
          </div>

          {/* Scanline effect */}
          <div className={`absolute inset-0 bg-gradient-to-b ${
            searchDepth === 4 
              ? 'from-red-500/10 via-transparent to-transparent' 
              : 'from-cyan-500/10 via-transparent to-transparent'
          } animate-scan pointer-events-none rounded-xl`} />
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress 
            value={progress} 
            className={`h-3 ${searchDepth === 4 ? 'bg-red-950' : 'bg-slate-900'}`}
          />
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
