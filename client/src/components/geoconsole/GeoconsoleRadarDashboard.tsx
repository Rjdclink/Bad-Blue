/**
 * Hybrid Geoconsole Dashboard
 * 
 * Professional weather-radar-style location tracking interface
 * Features:
 * - Real-time map with satellite overlay
 * - Animated motion trails
 * - Timeline scrubber with play/pause
 * - Futurecast prediction visualization
 * - Heat trail rendering
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  MapPin,
  Navigation,
  Clock,
  Activity,
  Layers,
  Settings,
  RefreshCw,
  Download,
  Eye,
  EyeOff,
  Satellite,
  Map as MapIcon,
} from 'lucide-react';
import type { 
  GPSPoint, 
  MotionTrail, 
  TimelineState, 
  LayerConfig,
} from '@shared/geoconsoleTypes';
import { MPS_TO_MPH, METERS_TO_KM } from '@shared/geoconsoleTypes';

interface GeoconsoleProps {
  initialData?: GPSPoint[];
  onProcess?: (data: GPSPoint[]) => Promise<void>;
}

export const GeoconsoleRadarDashboard: React.FC<GeoconsoleProps> = ({
  initialData = [],
  onProcess,
}) => {
  // State
  const [trail, setTrail] = useState<MotionTrail | null>(null);
  const [futurecast, setFuturecast] = useState<GPSPoint[]>([]);
  const [timeline, setTimeline] = useState<TimelineState>({
    currentTime: new Date(),
    isPlaying: false,
    playbackSpeed: 60,
    visibleRange: { start: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), end: new Date() },
  });
  
  const [layers, setLayers] = useState({
    satellite: true,
    trail: true,
    heatmap: true,
    markers: true,
    futurecast: true,
  });
  
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  
  const mapRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);

  // Process location data
  const processData = useCallback(async (data: GPSPoint[]) => {
    setProcessing(true);
    setProgress(0);
    setProgressMessage('Starting multimodal fusion...');

    try {
      const response = await fetch('/api/geoconsole/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: data.map(p => ({
            ...p,
            timestamp: p.timestamp instanceof Date ? p.timestamp.toISOString() : p.timestamp,
          })),
        }),
      });

      if (!response.ok) throw new Error('Processing failed');

      const result = await response.json();
      
      if (result.success) {
        setTrail(result.data.trail);
        setFuturecast(result.data.futurecast);
        
        // Update timeline range
        if (result.data.trail.startTime && result.data.trail.endTime) {
          setTimeline(prev => ({
            ...prev,
            visibleRange: {
              start: new Date(result.data.trail.startTime),
              end: new Date(result.data.trail.endTime),
            },
            currentTime: new Date(result.data.trail.startTime),
          }));
        }
      }

      setProgress(100);
      setProgressMessage('Complete');
      
      if (onProcess) await onProcess(data);
    } catch (error) {
      console.error('Processing error:', error);
      setProgressMessage('Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setProcessing(false);
    }
  }, [onProcess]);

  // Timeline playback
  useEffect(() => {
    if (!timeline.isPlaying || !trail) return;

    const interval = setInterval(() => {
      setTimeline(prev => {
        const newTime = new Date(prev.currentTime.getTime() + prev.playbackSpeed * 1000);
        
        if (newTime >= prev.visibleRange.end) {
          return { ...prev, isPlaying: false, currentTime: prev.visibleRange.end };
        }
        
        return { ...prev, currentTime: newTime };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeline.isPlaying, trail]);

  // Get current position from timeline
  const getCurrentPosition = useCallback((): GPSPoint | null => {
    if (!trail || trail.points.length === 0) return null;

    const currentMs = timeline.currentTime.getTime();
    
    for (let i = 0; i < trail.points.length - 1; i++) {
      const p1 = trail.points[i].position;
      const p2 = trail.points[i + 1].position;
      const t1 = new Date(p1.timestamp).getTime();
      const t2 = new Date(p2.timestamp).getTime();
      
      if (currentMs >= t1 && currentMs <= t2) {
        const ratio = (currentMs - t1) / (t2 - t1);
        return {
          latitude: p1.latitude + (p2.latitude - p1.latitude) * ratio,
          longitude: p1.longitude + (p2.longitude - p1.longitude) * ratio,
          timestamp: timeline.currentTime,
          source: 'interpolated',
          confidence: 0.9,
        };
      }
    }

    return trail.points[trail.points.length - 1].position;
  }, [trail, timeline.currentTime]);

  // Format time for display
  const formatTime = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  // Format duration
  const formatDuration = (ms: number): string => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Format distance
  const formatDistance = (meters: number): string => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  // Format speed
  const formatSpeed = (mps: number): string => {
    const mph = mps * 2.237;
    return `${mph.toFixed(1)} mph`;
  };

  const currentPos = getCurrentPosition();

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Satellite className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Hybrid Geoconsole</h1>
            <p className="text-sm text-slate-400">Personal Security Tracking System</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50">
            <Activity className="w-3 h-3 mr-1" />
            Live
          </Badge>
          <Button variant="ghost" size="icon">
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Map Area */}
        <div className="flex-1 relative">
          <div 
            ref={mapRef} 
            className="absolute inset-0 bg-slate-800"
            style={{
              backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.1) 0%, transparent 50%)',
            }}
          >
            {/* Map placeholder - integrate with Leaflet */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <MapIcon className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                <p className="text-slate-500">Map View</p>
                {currentPos && (
                  <p className="text-sm text-blue-400 mt-2">
                    {currentPos.latitude.toFixed(6)}, {currentPos.longitude.toFixed(6)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Layer Controls */}
          <div className="absolute top-4 right-4 bg-slate-800/90 rounded-lg p-3 backdrop-blur-sm border border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium">Layers</span>
            </div>
            
            {Object.entries(layers).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between py-1">
                <span className="text-xs text-slate-400 capitalize">{key}</span>
                <Switch
                  checked={value}
                  onCheckedChange={(checked) => setLayers(prev => ({ ...prev, [key]: checked }))}
                  className="scale-75"
                />
              </div>
            ))}
          </div>

          {/* Current Position Overlay */}
          {currentPos && (
            <div className="absolute bottom-4 left-4 bg-slate-800/90 rounded-lg p-3 backdrop-blur-sm border border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium">Current Position</span>
              </div>
              <p className="text-xs text-slate-400">
                Lat: {currentPos.latitude.toFixed(6)}
              </p>
              <p className="text-xs text-slate-400">
                Lng: {currentPos.longitude.toFixed(6)}
              </p>
              <p className="text-xs text-slate-400">
                Time: {formatTime(timeline.currentTime)}
              </p>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className="w-80 border-l border-slate-700 flex flex-col">
          {/* Stats */}
          <div className="p-4 border-b border-slate-700">
            <h3 className="text-sm font-medium mb-3">Motion Statistics</h3>
            
            {trail ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Distance</p>
                  <p className="text-lg font-bold text-blue-400">
                    {formatDistance(trail.totalDistance)}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Avg Speed</p>
                  <p className="text-lg font-bold text-green-400">
                    {formatSpeed(trail.averageSpeed)}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Max Speed</p>
                  <p className="text-lg font-bold text-orange-400">
                    {formatSpeed(trail.maxSpeed)}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-400">Duration</p>
                  <p className="text-lg font-bold text-purple-400">
                    {formatDuration(new Date(trail.endTime).getTime() - new Date(trail.startTime).getTime())}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No data loaded</p>
            )}
          </div>

          {/* Futurecast */}
          <div className="p-4 border-b border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">6-Hour Futurecast</h3>
              <Badge variant="outline" className={futurecast.length > 0 ? 'bg-purple-500/20 text-purple-400' : ''}>
                {futurecast.length > 0 ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            
            {futurecast.length > 0 ? (
              <div className="space-y-2">
                {futurecast.slice(0, 4).map((point, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span className="text-slate-400">
                      {formatTime(new Date(point.timestamp))}
                    </span>
                    <span className="text-purple-400 ml-auto">
                      {(point.confidence * 100).toFixed(0)}% conf
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Load data to generate predictions</p>
            )}
          </div>

          {/* Data Sources */}
          <div className="p-4 flex-1 overflow-auto">
            <h3 className="text-sm font-medium mb-3">Data Sources</h3>
            <div className="space-y-2">
              {['Device GPS', 'EXIF Photos', 'Public Records', 'Interpolated'].map((source) => (
                <div key={source} className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{source}</span>
                  <Badge variant="outline" className="text-xs">
                    Active
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Control Bar */}
      <div className="p-4 border-t border-slate-700 bg-slate-800/50 backdrop-blur-sm">
        {/* Progress Bar (when processing) */}
        {processing && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">{progressMessage}</span>
              <span className="text-xs text-slate-400">{progress}%</span>
            </div>
            <Progress value={progress} className="h-1" />
          </div>
        )}

        {/* Timeline */}
        <div className="flex items-center gap-4">
          {/* Playback Controls */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTimeline(prev => ({
                ...prev,
                currentTime: prev.visibleRange.start,
              }))}
              disabled={!trail}
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTimeline(prev => ({ ...prev, isPlaying: !prev.isPlaying }))}
              disabled={!trail}
            >
              {timeline.isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5" />
              )}
            </Button>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTimeline(prev => ({
                ...prev,
                currentTime: prev.visibleRange.end,
              }))}
              disabled={!trail}
            >
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          {/* Timeline Slider */}
          <div className="flex-1">
            <Slider
              value={[timeline.currentTime.getTime()]}
              min={timeline.visibleRange.start.getTime()}
              max={timeline.visibleRange.end.getTime()}
              step={60000}
              onValueChange={([value]) => {
                setTimeline(prev => ({
                  ...prev,
                  currentTime: new Date(value),
                  isPlaying: false,
                }));
              }}
              disabled={!trail}
              className="cursor-pointer"
            />
            <div className="flex justify-between mt-1 text-xs text-slate-500">
              <span>{formatTime(timeline.visibleRange.start)}</span>
              <span className="text-blue-400 font-medium">{formatTime(timeline.currentTime)}</span>
              <span>{formatTime(timeline.visibleRange.end)}</span>
            </div>
          </div>

          {/* Speed Control */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Speed:</span>
            <select
              value={timeline.playbackSpeed}
              onChange={(e) => setTimeline(prev => ({
                ...prev,
                playbackSpeed: Number(e.target.value),
              }))}
              className="bg-slate-700 border-slate-600 rounded px-2 py-1 text-xs"
            >
              <option value={1}>1x</option>
              <option value={60}>60x</option>
              <option value={300}>5m/s</option>
              <option value={3600}>1h/s</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => processData(initialData)}
              disabled={processing || initialData.length === 0}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${processing ? 'animate-spin' : ''}`} />
              Process
            </Button>
            
            <Button variant="outline" size="sm" disabled={!trail}>
              <Download className="w-4 h-4 mr-1" />
              Export
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GeoconsoleRadarDashboard;
