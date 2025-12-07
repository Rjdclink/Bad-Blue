import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Clock, 
  Database, 
  Search, 
  Network, 
  FileText, 
  Users, 
  MapPin,
  Eye,
  CheckCircle2,
  Zap,
  Cpu
} from 'lucide-react';

interface PantheonProgressTrackerProps {
  searchDepth: number;
  isSearching: boolean;
  onComplete?: () => void;
}

interface SearchStage {
  id: string;
  icon: any;
  label: string;
  duration: number; // percentage of total time
  color: string;
}

const DEPTH_DURATIONS = {
  1: 30000,  // 30 seconds
  2: 60000,  // 60 seconds
  3: 120000, // 120 seconds
  4: 180000, // 180 seconds
};

const SEARCH_STAGES: SearchStage[] = [
  { id: 'init', icon: Zap, label: 'Initializing', duration: 5, color: 'text-yellow-500' },
  { id: 'databases', icon: Database, label: 'Scanning Databases', duration: 20, color: 'text-blue-500' },
  { id: 'social', icon: Network, label: 'Social Analysis', duration: 15, color: 'text-purple-500' },
  { id: 'records', icon: FileText, label: 'Public Records', duration: 20, color: 'text-green-500' },
  { id: 'location', icon: MapPin, label: 'Location Tracking', duration: 15, color: 'text-orange-500' },
  { id: 'relationships', icon: Users, label: 'Relationships', duration: 15, color: 'text-pink-500' },
  { id: 'analysis', icon: Search, label: 'Deep Analysis', duration: 10, color: 'text-cyan-500' },
];

const EYE_OF_GOD_STAGES: SearchStage[] = [
  { id: 'init', icon: Eye, label: 'EYE Activation', duration: 3, color: 'text-red-500' },
  { id: 'quantum', icon: Zap, label: 'Quantum Scan', duration: 12, color: 'text-yellow-500' },
  { id: 'databases', icon: Database, label: 'Database Sweep', duration: 15, color: 'text-blue-500' },
  { id: 'social', icon: Network, label: 'Network Crawl', duration: 12, color: 'text-purple-500' },
  { id: 'records', icon: FileText, label: 'Records Deep Dive', duration: 15, color: 'text-green-500' },
  { id: 'location', icon: MapPin, label: 'Location History', duration: 10, color: 'text-orange-500' },
  { id: 'relationships', icon: Users, label: 'Relationship Graph', duration: 12, color: 'text-pink-500' },
  { id: 'patterns', icon: Search, label: 'Pattern Recognition', duration: 10, color: 'text-cyan-500' },
  { id: 'synthesis', icon: Cpu, label: 'Intelligence Synthesis', duration: 8, color: 'text-red-500' },
  { id: 'complete', icon: CheckCircle2, label: 'Complete Intel', duration: 3, color: 'text-emerald-500' },
];

export function PantheonProgressTracker({ 
  searchDepth, 
  isSearching,
  onComplete 
}: PantheonProgressTrackerProps) {
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [stageProgress, setStageProgress] = useState(0);

  const stages = searchDepth === 4 ? EYE_OF_GOD_STAGES : SEARCH_STAGES;
  const totalDuration = DEPTH_DURATIONS[searchDepth as keyof typeof DEPTH_DURATIONS] || 30000;

  useEffect(() => {
    if (!isSearching) {
      setProgress(0);
      setCurrentStage(0);
      setElapsedTime(0);
      setStageProgress(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progressPercent = Math.min((elapsed / totalDuration) * 100, 100);
      
      setProgress(progressPercent);
      setElapsedTime(elapsed);

      // Calculate which stage we're in
      let cumulativeDuration = 0;
      let foundStage = 0;
      let stageStartPercent = 0;

      for (let i = 0; i < stages.length; i++) {
        const stageEndPercent = cumulativeDuration + stages[i].duration;
        if (progressPercent < stageEndPercent) {
          foundStage = i;
          stageStartPercent = cumulativeDuration;
          break;
        }
        cumulativeDuration = stageEndPercent;
      }

      setCurrentStage(foundStage);

      // Calculate progress within current stage
      const stageRange = stages[foundStage]?.duration || 1;
      const progressInStage = ((progressPercent - stageStartPercent) / stageRange) * 100;
      setStageProgress(Math.min(progressInStage, 100));

      if (progressPercent >= 100) {
        clearInterval(interval);
        if (onComplete) {
          setTimeout(onComplete, 500);
        }
      }
    }, 50); // Update every 50ms for smooth animation

    return () => clearInterval(interval);
  }, [isSearching, searchDepth, totalDuration, stages, onComplete]);

  if (!isSearching && progress === 0) {
    return null;
  }

  const remainingMs = totalDuration - elapsedTime;
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

        {/* Current Stage */}
        <div className={`p-3 rounded-lg bg-gradient-to-r ${
          searchDepth === 4 
            ? 'from-red-950/50 to-pink-950/50 border border-red-500/30' 
            : 'from-primary/10 to-primary/5 border border-primary/20'
        }`}>
          <div className="flex items-center gap-3">
            {(() => {
              const StageIcon = stages[currentStage]?.icon || Search;
              return (
                <StageIcon 
                  className={`w-5 h-5 ${stages[currentStage]?.color || 'text-primary'} animate-pulse`} 
                />
              );
            })()}
            <div className="flex-1">
              <span className="font-semibold text-sm">
                {stages[currentStage]?.label || 'Processing...'}
              </span>
              <Progress 
                value={stageProgress} 
                className="h-1 mt-1"
              />
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {Math.round(stageProgress)}%
            </span>
          </div>
        </div>

        {/* Stage Indicators */}
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2">
          {stages.map((stage, index) => {
            const StageIcon = stage.icon;
            const isPast = index < currentStage;
            const isCurrent = index === currentStage;

            return (
              <div
                key={stage.id}
                className={`relative flex flex-col items-center gap-1 p-2 rounded-lg transition-all duration-300 ${
                  isPast 
                    ? 'bg-green-950/30 border border-green-500/30' 
                    : isCurrent 
                    ? `${searchDepth === 4 ? 'bg-red-900/40 border-2 border-red-500/50' : 'bg-primary/20 border-2 border-primary/50'} scale-105 shadow-lg` 
                    : 'bg-muted/20 border border-muted opacity-40'
                }`}
              >
                {isPast && (
                  <CheckCircle2 className="w-3 h-3 text-green-500 absolute -top-1 -right-1 animate-pulse" />
                )}
                <StageIcon 
                  className={`w-4 h-4 ${
                    isPast 
                      ? 'text-green-500' 
                      : isCurrent 
                      ? `${stage.color} animate-pulse` 
                      : 'text-muted-foreground'
                  }`} 
                />
                <span className="text-[10px] text-center leading-tight">
                  {stage.label}
                </span>
              </div>
            );
          })}
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
