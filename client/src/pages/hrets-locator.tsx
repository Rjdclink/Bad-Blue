/**
 * HRETS-Locator: Triangulated Satellite-Hybrid Positioning Engine
 * 
 * A hyper-accurate location tracking system featuring:
 * - Multi-source triangulation (GPS, WiFi, Cellular, IP)
 * - Satellite imagery hybridization with multiple tile sources
 * - Predictive position projection with probability cone
 * - Historical playback with Kalman-filtered smoothing
 * - Monte-Carlo enhancement for precision optimization
 * - Ethereal cinematic UI with glowing reticle
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { 
  ArrowLeft, Play, Pause, SkipBack, SkipForward,
  Satellite, Map, Layers, Target, Navigation,
  Clock, Zap, Radio, Wifi, Signal, Globe,
  ChevronLeft, ChevronRight, Settings, RefreshCw
} from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { cn } from '@/lib/utils';
import { HRETSMap } from '@/components/HRETSMap';
import { useHRETSLocator } from '@/hooks/useHRETSLocator';

// ============================================================================
// TYPES
// ============================================================================

type MapMode = 'satellite' | 'hybrid' | 'street';
type ViewMode = 'live' | 'playback' | 'forecast';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function HRETSLocatorPage() {
  const [, setLocation] = useLocation();
  
  // State
  const [mapMode, setMapMode] = useState<MapMode>('satellite');
  const [viewMode, setViewMode] = useState<ViewMode>('live');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [forecastMinutes, setForecastMinutes] = useState(30);
  const [showSettings, setShowSettings] = useState(false);
  
  // HRETS Locator hook
  const {
    currentPosition,
    positionHistory,
    predictedCone,
    triangulationData,
    accuracy,
    isTracking,
    startTracking,
    stopTracking,
    getHistoryRange,
    monteCarloScore,
    systemHealth,
  } = useHRETSLocator();
  
  // Playback animation
  useEffect(() => {
    if (!isPlaying || viewMode !== 'playback' || positionHistory.length === 0) return;
    
    const interval = setInterval(() => {
      setPlaybackIndex(prev => {
        if (prev >= positionHistory.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 100);
    
    return () => clearInterval(interval);
  }, [isPlaying, viewMode, positionHistory.length]);
  
  // Current display position based on view mode
  const displayPosition = useMemo(() => {
    if (viewMode === 'playback' && positionHistory[playbackIndex]) {
      return positionHistory[playbackIndex];
    }
    return currentPosition;
  }, [viewMode, playbackIndex, positionHistory, currentPosition]);
  
  // Heat trail data for visualization
  const heatTrailData = useMemo(() => {
    if (viewMode === 'playback') {
      return positionHistory.slice(0, playbackIndex + 1);
    }
    return positionHistory;
  }, [viewMode, playbackIndex, positionHistory]);
  
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 overflow-hidden">
      <SEOHead 
        title="HRETS-Locator | Triangulated Positioning Engine" 
        description="Hyper-accurate satellite-hybrid positioning system"
      />
      
      {/* Ethereal Background Glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/3 rounded-full blur-3xl" />
      </div>
      
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800/50">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation('/welcome')}
                className="text-slate-400 hover:text-slate-100"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Exit
              </Button>
              
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Target className="h-6 w-6 text-cyan-400" />
                  <span className="absolute -top-1 -right-1 h-2 w-2 bg-emerald-400 rounded-full animate-pulse" />
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-wide">
                    HRETS<span className="text-cyan-400">-Locator</span>
                  </h1>
                  <p className="text-xs text-slate-500 font-mono tracking-wider">
                    TRIANGULATED POSITIONING ENGINE
                  </p>
                </div>
              </div>
            </div>
            
            {/* Status Indicators */}
            <div className="flex items-center gap-4">
              {/* Triangulation Sources */}
              <div className="hidden md:flex items-center gap-2">
                <Badge variant="outline" className={cn(
                  "text-xs font-mono",
                  triangulationData.gps.active ? "border-emerald-500/50 text-emerald-400" : "border-slate-600 text-slate-500"
                )}>
                  <Navigation className="h-3 w-3 mr-1" />
                  GPS
                </Badge>
                <Badge variant="outline" className={cn(
                  "text-xs font-mono",
                  triangulationData.wifi.active ? "border-emerald-500/50 text-emerald-400" : "border-slate-600 text-slate-500"
                )}>
                  <Wifi className="h-3 w-3 mr-1" />
                  WiFi
                </Badge>
                <Badge variant="outline" className={cn(
                  "text-xs font-mono",
                  triangulationData.cellular.active ? "border-emerald-500/50 text-emerald-400" : "border-slate-600 text-slate-500"
                )}>
                  <Signal className="h-3 w-3 mr-1" />
                  Cell
                </Badge>
                <Badge variant="outline" className={cn(
                  "text-xs font-mono",
                  triangulationData.ip.active ? "border-emerald-500/50 text-emerald-400" : "border-slate-600 text-slate-500"
                )}>
                  <Globe className="h-3 w-3 mr-1" />
                  IP
                </Badge>
              </div>
              
              {/* Accuracy */}
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/50 border border-slate-700/50">
                <Zap className="h-3 w-3 text-amber-400" />
                <span className="text-xs font-mono text-slate-300">
                  ±{accuracy.toFixed(1)}m
                </span>
              </div>
              
              {/* Tracking Status */}
              <Button
                size="sm"
                onClick={isTracking ? stopTracking : startTracking}
                className={cn(
                  "font-mono text-xs",
                  isTracking 
                    ? "bg-emerald-600 hover:bg-emerald-500" 
                    : "bg-slate-700 hover:bg-slate-600"
                )}
              >
                {isTracking ? (
                  <>
                    <Radio className="h-3 w-3 mr-1 animate-pulse" />
                    TRACKING
                  </>
                ) : (
                  <>
                    <Target className="h-3 w-3 mr-1" />
                    START
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Map Viewport */}
      <main className="pt-16 h-screen">
        <div className="relative h-full">
          {/* Map Component */}
          <HRETSMap
            position={displayPosition}
            heatTrail={heatTrailData}
            predictedCone={viewMode === 'forecast' ? predictedCone : null}
            mapMode={mapMode}
            forecastMinutes={forecastMinutes}
            accuracy={accuracy}
          />
          
          {/* View Mode Controls */}
          <div className="absolute top-4 left-4 z-20">
            <Card className="bg-slate-900/90 border-slate-700/50 backdrop-blur-sm">
              <CardContent className="p-2 flex gap-1">
                <Button
                  size="sm"
                  variant={viewMode === 'live' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('live')}
                  className="text-xs font-mono"
                >
                  <Radio className="h-3 w-3 mr-1" />
                  LIVE
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'playback' ? 'default' : 'ghost'}
                  onClick={() => { setViewMode('playback'); setPlaybackIndex(0); }}
                  className="text-xs font-mono"
                >
                  <Clock className="h-3 w-3 mr-1" />
                  PLAYBACK
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'forecast' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('forecast')}
                  className="text-xs font-mono"
                >
                  <Navigation className="h-3 w-3 mr-1" />
                  FORECAST
                </Button>
              </CardContent>
            </Card>
          </div>
          
          {/* Map Mode Toggle */}
          <div className="absolute top-4 right-4 z-20">
            <Card className="bg-slate-900/90 border-slate-700/50 backdrop-blur-sm">
              <CardContent className="p-2 flex gap-1">
                <Button
                  size="sm"
                  variant={mapMode === 'satellite' ? 'default' : 'ghost'}
                  onClick={() => setMapMode('satellite')}
                  className="text-xs"
                >
                  <Satellite className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={mapMode === 'hybrid' ? 'default' : 'ghost'}
                  onClick={() => setMapMode('hybrid')}
                  className="text-xs"
                >
                  <Layers className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={mapMode === 'street' ? 'default' : 'ghost'}
                  onClick={() => setMapMode('street')}
                  className="text-xs"
                >
                  <Map className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
          
          {/* Playback Controls */}
          {viewMode === 'playback' && positionHistory.length > 0 && (
            <div className="absolute bottom-24 left-4 right-4 z-20">
              <Card className="bg-slate-900/90 border-slate-700/50 backdrop-blur-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Button size="sm" variant="ghost" onClick={() => setPlaybackIndex(0)}>
                      <SkipBack className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPlaybackIndex(Math.max(0, playbackIndex - 10))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button 
                      size="sm" 
                      onClick={() => setIsPlaying(!isPlaying)}
                      className={isPlaying ? "bg-amber-600 hover:bg-amber-500" : ""}
                    >
                      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPlaybackIndex(Math.min(positionHistory.length - 1, playbackIndex + 10))}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPlaybackIndex(positionHistory.length - 1)}>
                      <SkipForward className="h-4 w-4" />
                    </Button>
                    
                    <div className="flex-1 mx-4">
                      <Slider
                        value={[playbackIndex]}
                        max={Math.max(0, positionHistory.length - 1)}
                        step={1}
                        onValueChange={([val]) => setPlaybackIndex(val)}
                        className="w-full"
                      />
                    </div>
                    
                    <div className="text-xs font-mono text-slate-400 min-w-[120px] text-right">
                      {positionHistory[playbackIndex]?.timestamp 
                        ? new Date(positionHistory[playbackIndex].timestamp).toLocaleTimeString()
                        : '--:--:--'
                      }
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          
          {/* Forecast Controls */}
          {viewMode === 'forecast' && (
            <div className="absolute bottom-24 left-4 right-4 z-20">
              <Card className="bg-slate-900/90 border-slate-700/50 backdrop-blur-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-mono text-slate-400">FORECAST RANGE</span>
                    <div className="flex-1">
                      <Slider
                        value={[forecastMinutes]}
                        min={5}
                        max={60}
                        step={5}
                        onValueChange={([val]) => setForecastMinutes(val)}
                        className="w-full"
                      />
                    </div>
                    <span className="text-sm font-mono text-cyan-400 min-w-[60px] text-right">
                      {forecastMinutes} min
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          
          {/* Side Panel - System Status */}
          <div className="absolute top-20 right-4 z-20 w-64">
            <Card className="bg-slate-900/90 border-slate-700/50 backdrop-blur-sm">
              <CardHeader className="py-3 px-4 border-b border-slate-800/50">
                <CardTitle className="text-sm font-mono text-slate-400 flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  SYSTEM STATUS
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {/* Position Info */}
                <div className="space-y-2">
                  <div className="text-xs font-mono text-slate-500">COORDINATES</div>
                  <div className="font-mono text-sm text-slate-300">
                    {displayPosition.lat.toFixed(6)}, {displayPosition.lon.toFixed(6)}
                  </div>
                </div>
                
                {/* Triangulation Weights */}
                <div className="space-y-2">
                  <div className="text-xs font-mono text-slate-500">TRIANGULATION WEIGHTS</div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">GPS</span>
                      <span className="text-cyan-400">{(triangulationData.gps.weight * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={triangulationData.gps.weight * 100} className="h-1" />
                    
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Network</span>
                      <span className="text-cyan-400">{(triangulationData.network.weight * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={triangulationData.network.weight * 100} className="h-1" />
                    
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Vector</span>
                      <span className="text-cyan-400">{(triangulationData.vector.weight * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={triangulationData.vector.weight * 100} className="h-1" />
                  </div>
                </div>
                
                {/* Monte-Carlo Score */}
                <div className="space-y-2">
                  <div className="text-xs font-mono text-slate-500">MONTE-CARLO SCORE</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Progress value={monteCarloScore * 100} className="h-2" />
                    </div>
                    <span className="text-xs font-mono text-emerald-400">
                      {(monteCarloScore * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                
                {/* System Health */}
                <div className="space-y-2">
                  <div className="text-xs font-mono text-slate-500">SYSTEM HEALTH</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <div className={cn("h-2 w-2 rounded-full", systemHealth.cpu < 65 ? "bg-emerald-400" : "bg-amber-400")} />
                      <span className="text-slate-400">CPU</span>
                      <span className="ml-auto text-slate-300">{systemHealth.cpu}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className={cn("h-2 w-2 rounded-full", systemHealth.memory < 80 ? "bg-emerald-400" : "bg-amber-400")} />
                      <span className="text-slate-400">RAM</span>
                      <span className="ml-auto text-slate-300">{systemHealth.memory}%</span>
                    </div>
                  </div>
                </div>
                
                {/* History Count */}
                <div className="pt-2 border-t border-slate-800/50">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">History Points</span>
                    <span className="text-slate-300 font-mono">{positionHistory.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Bottom Info Bar */}
          <div className="absolute bottom-4 left-4 right-4 z-10">
            <Card className="bg-slate-900/80 border-slate-700/50 backdrop-blur-sm">
              <CardContent className="py-2 px-4">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Heading:</span>
                      <span className="font-mono text-slate-300">{displayPosition.heading?.toFixed(0) || '--'}°</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Speed:</span>
                      <span className="font-mono text-slate-300">{displayPosition.speed?.toFixed(1) || '0.0'} m/s</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Altitude:</span>
                      <span className="font-mono text-slate-300">{displayPosition.altitude?.toFixed(0) || '--'}m</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Last Update:</span>
                    <span className="font-mono text-emerald-400">
                      {displayPosition.timestamp 
                        ? new Date(displayPosition.timestamp).toLocaleTimeString() 
                        : '--:--:--'
                      }
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
