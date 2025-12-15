/**
 * Geoconsole Command Center
 * 
 * Military-grade location intelligence interface
 * Clean, automatic, highly user-friendly design
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  Crosshair,
  Radar,
  Target,
  Clock,
  Activity,
  Shield,
  Eye,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Upload,
  Download,
  Settings,
  AlertTriangle,
  CheckCircle,
  Radio,
  Wifi,
  Satellite,
  MapPin,
  TrendingUp,
  FileText,
  RefreshCw,
  Power,
  Circle,
} from 'lucide-react';

// Military color scheme
const COLORS = {
  primary: '#00ff88',    // Tactical green
  secondary: '#00d4ff',  // Cyan
  warning: '#ffaa00',    // Amber
  danger: '#ff4444',     // Red
  muted: '#4a5568',      // Gray
  bg: '#0a0f1a',         // Deep navy
  panel: '#111827',      // Panel bg
  border: '#1e3a5f',     // Border blue
};

interface SystemStatus {
  operational: boolean;
  activeTasks: number;
  cacheHitRate: number;
  lastUpdate: Date;
}

interface LocationPoint {
  lat: number;
  lng: number;
  timestamp: Date;
  source: string;
  confidence: number;
}

export default function GeoconsoleCommandCenter() {
  // System state
  const [systemActive, setSystemActive] = useState(true);
  const [autoTrack, setAutoTrack] = useState(true);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [currentTarget, setCurrentTarget] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Timeline state
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelinePosition] = useState(100);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Data state
  const [locationHistory, setLocationHistory] = useState<LocationPoint[]>([]);
  const [predictions, setPredictions] = useState<LocationPoint[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  
  // Processing state
  const [processing, setProcessing] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [progressValue, setProgressValue] = useState(0);

  // Auto-fetch system status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/geoconsole/status');
        const data = await res.json();
        if (data.success) {
          setStatus({
            operational: data.data.status === 'operational',
            activeTasks: data.data.orchestration?.activeTasks || 0,
            cacheHitRate: data.data.orchestration?.cacheHitRate || 0,
            lastUpdate: new Date(),
          });
        }
      } catch (err) {
        console.error('Status fetch failed:', err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // Auto-track simulation
  useEffect(() => {
    if (!autoTrack || !systemActive) return;
    
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    
    return () => clearInterval(interval);
  }, [autoTrack, systemActive]);

  // Quick target acquisition
  const acquireTarget = useCallback(async () => {
    if (!searchQuery.trim()) return;
    
    setProcessing(true);
    setProgressStage('ACQUIRING TARGET');
    setProgressValue(0);
    setCurrentTarget(searchQuery);

    // REAL-WORLD MODE: do not simulate “acquisition” or fabricate coordinates.
    // This screen can only operate on explicit coordinate inputs (GPS/EXIF/manual).
    try {
      setProgressStage('VALIDATING GEOCONSOLE STATUS');
      setProgressValue(40);

      const res = await fetch('/api/geoconsole/status', { credentials: 'include' });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || `Geoconsole status check failed (${res.status})`);
      }

      setProgressStage('READY FOR COORDINATE INPUT');
      setProgressValue(100);
      setAlerts([
        'Geoconsole operational',
        'Provide GPS/EXIF/manual coordinates to build a trail and futurecast',
      ]);
      setLocationHistory([]);
      setPredictions([]);
    } catch (e: any) {
      setAlerts([`Acquisition blocked: ${e?.message || 'Geoconsole unavailable'}`]);
      setLocationHistory([]);
      setPredictions([]);
    } finally {
      setProcessing(false);
    }
  }, [searchQuery]);

  // Format coordinates
  const formatCoord = (val: number, isLat: boolean) => {
    const dir = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
    return `${Math.abs(val).toFixed(6)}° ${dir}`;
  };

  // Format time
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour12: false });
  };

  const currentLocation = locationHistory[locationHistory.length - 1];

  return (
    <div 
      className="min-h-screen p-4 font-mono"
      style={{ backgroundColor: COLORS.bg }}
    >
      {/* Top Status Bar */}
      <div 
        className="flex items-center justify-between px-4 py-2 mb-4 rounded border"
        style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}
      >
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full animate-pulse"
              style={{ backgroundColor: systemActive ? COLORS.primary : COLORS.danger }}
            />
            <span className="text-xs uppercase tracking-wider" style={{ color: COLORS.primary }}>
              {systemActive ? 'SYSTEM ACTIVE' : 'SYSTEM OFFLINE'}
            </span>
          </div>
          
          <div className="flex items-center gap-2 text-xs" style={{ color: COLORS.muted }}>
            <Clock className="w-3 h-3" />
            <span>{formatTime(currentTime)}</span>
          </div>
          
          {status && (
            <div className="flex items-center gap-4 text-xs">
              <span style={{ color: COLORS.secondary }}>
                TASKS: {status.activeTasks}
              </span>
              <span style={{ color: COLORS.secondary }}>
                CACHE: {(status.cacheHitRate * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: COLORS.muted }}>AUTO-TRACK</span>
            <Switch 
              checked={autoTrack} 
              onCheckedChange={setAutoTrack}
              className="data-[state=checked]:bg-green-600"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSystemActive(!systemActive)}
            className="h-8"
            style={{ color: systemActive ? COLORS.primary : COLORS.danger }}
          >
            <Power className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left Panel - Target Acquisition */}
        <div className="col-span-3 space-y-4">
          {/* Search/Acquire */}
          <Card style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}>
            <CardHeader className="py-3">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2" style={{ color: COLORS.primary }}>
                <Crosshair className="w-4 h-4" />
                TARGET ACQUISITION
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && acquireTarget()}
                  placeholder="Enter target identifier..."
                  className="bg-black/50 border-slate-600 text-white pr-10"
                  style={{ borderColor: COLORS.border }}
                />
                <Target 
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" 
                  style={{ color: COLORS.muted }}
                />
              </div>
              
              <Button
                onClick={acquireTarget}
                disabled={processing || !searchQuery.trim()}
                className="w-full uppercase tracking-wider"
                style={{ 
                  backgroundColor: processing ? COLORS.muted : COLORS.primary,
                  color: COLORS.bg
                }}
              >
                {processing ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    {progressStage}
                  </>
                ) : (
                  <>
                    <Radar className="w-4 h-4 mr-2" />
                    ACQUIRE TARGET
                  </>
                )}
              </Button>
              
              {processing && (
                <div className="space-y-1">
                  <Progress value={progressValue} className="h-1" />
                  <p className="text-xs text-center" style={{ color: COLORS.secondary }}>
                    {progressValue}%
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Current Target */}
          {currentTarget && (
            <Card style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2" style={{ color: COLORS.secondary }}>
                  <Target className="w-4 h-4" />
                  ACTIVE TARGET
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div 
                  className="p-3 rounded text-center"
                  style={{ backgroundColor: 'rgba(0,255,136,0.1)', border: `1px solid ${COLORS.primary}` }}
                >
                  <p className="text-lg font-bold" style={{ color: COLORS.primary }}>
                    {currentTarget}
                  </p>
                  {currentLocation && (
                    <div className="mt-2 text-xs" style={{ color: COLORS.muted }}>
                      <p>{formatCoord(currentLocation.lat, true)}</p>
                      <p>{formatCoord(currentLocation.lng, false)}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Data Sources */}
          <Card style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}>
            <CardHeader className="py-3">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2" style={{ color: COLORS.secondary }}>
                <Radio className="w-4 h-4" />
                DATA SOURCES
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { icon: Satellite, name: 'GPS', status: true },
                { icon: Wifi, name: 'Wi-Fi', status: true },
                { icon: Radio, name: 'Bluetooth', status: false },
                { icon: MapPin, name: 'EXIF', status: true },
                { icon: Eye, name: 'Public Cams', status: true },
                { icon: FileText, name: 'Records', status: true },
              ].map((source, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between p-2 rounded"
                  style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
                >
                  <div className="flex items-center gap-2">
                    <source.icon className="w-3 h-3" style={{ color: COLORS.muted }} />
                    <span className="text-xs uppercase" style={{ color: COLORS.muted }}>
                      {source.name}
                    </span>
                  </div>
                  <Circle 
                    className="w-2 h-2" 
                    fill={source.status ? COLORS.primary : COLORS.danger}
                    style={{ color: source.status ? COLORS.primary : COLORS.danger }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Center - Map Display */}
        <div className="col-span-6 space-y-4">
          {/* Main Display */}
          <Card 
            className="h-[500px] relative overflow-hidden"
            style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}
          >
            {/* Grid overlay effect */}
            <div 
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: `
                  linear-gradient(${COLORS.primary} 1px, transparent 1px),
                  linear-gradient(90deg, ${COLORS.primary} 1px, transparent 1px)
                `,
                backgroundSize: '50px 50px',
              }}
            />
            
            {/* Radar sweep effect */}
            {systemActive && (
              <div 
                className="absolute top-1/2 left-1/2 w-[400px] h-[400px] -translate-x-1/2 -translate-y-1/2"
                style={{
                  background: `conic-gradient(from 0deg, transparent 0deg, ${COLORS.primary}22 30deg, transparent 60deg)`,
                  animation: 'spin 4s linear infinite',
                }}
              />
            )}
            
            {/* Center crosshair */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <Crosshair 
                className="w-16 h-16 opacity-50" 
                style={{ color: COLORS.primary }}
              />
            </div>
            
            {/* Location points visualization */}
            {locationHistory.length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                {locationHistory.slice(-10).map((point, idx) => (
                  <div
                    key={idx}
                    className="absolute w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: COLORS.primary,
                      opacity: 0.3 + (idx * 0.07),
                      left: `${50 + (point.lng + 74.006) * 1000}%`,
                      top: `${50 - (point.lat - 40.7128) * 1000}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  />
                ))}
                {/* Current position marker */}
                {currentLocation && (
                  <div 
                    className="absolute w-4 h-4 rounded-full animate-pulse"
                    style={{
                      backgroundColor: COLORS.primary,
                      boxShadow: `0 0 20px ${COLORS.primary}`,
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                    }}
                  />
                )}
              </div>
            )}
            
            {/* Coordinates overlay */}
            {currentLocation && (
              <div 
                className="absolute bottom-4 left-4 p-3 rounded"
                style={{ backgroundColor: 'rgba(0,0,0,0.8)', border: `1px solid ${COLORS.border}` }}
              >
                <p className="text-xs" style={{ color: COLORS.muted }}>COORDINATES</p>
                <p className="font-bold" style={{ color: COLORS.primary }}>
                  {formatCoord(currentLocation.lat, true)}
                </p>
                <p className="font-bold" style={{ color: COLORS.primary }}>
                  {formatCoord(currentLocation.lng, false)}
                </p>
                <p className="text-xs mt-1" style={{ color: COLORS.secondary }}>
                  CONF: {(currentLocation.confidence * 100).toFixed(0)}%
                </p>
              </div>
            )}
            
            {/* Status overlay */}
            <div 
              className="absolute top-4 right-4 p-2 rounded text-xs uppercase"
              style={{ 
                backgroundColor: 'rgba(0,0,0,0.8)', 
                border: `1px solid ${COLORS.border}`,
                color: COLORS.secondary
              }}
            >
              {processing ? 'SCANNING' : locationHistory.length > 0 ? 'TRACKING' : 'STANDBY'}
            </div>
          </Card>

          {/* Timeline Control */}
          <Card style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}>
            <CardContent className="py-3">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" style={{ color: COLORS.muted }}>
                    <SkipBack className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={() => setIsPlaying(!isPlaying)}
                    style={{ color: COLORS.primary }}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" style={{ color: COLORS.muted }}>
                    <SkipForward className="w-4 h-4" />
                  </Button>
                </div>
                
                <div className="flex-1">
                  <div 
                    className="h-2 rounded-full relative cursor-pointer"
                    style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                  >
                    <div 
                      className="h-full rounded-full"
                      style={{ 
                        width: `${timelinePosition}%`,
                        backgroundColor: COLORS.primary,
                      }}
                    />
                    {/* Future zone */}
                    <div 
                      className="absolute right-0 top-0 h-full rounded-r-full"
                      style={{ 
                        width: '20%',
                        backgroundColor: `${COLORS.secondary}33`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-xs" style={{ color: COLORS.muted }}>
                    <span>-72H</span>
                    <span style={{ color: COLORS.primary }}>NOW</span>
                    <span style={{ color: COLORS.secondary }}>+6H</span>
                  </div>
                </div>
                
                <div className="text-right">
                  <p className="text-xs" style={{ color: COLORS.muted }}>HISTORY</p>
                  <p className="font-bold" style={{ color: COLORS.primary }}>
                    {locationHistory.length} PTS
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Panel - Intel & Predictions */}
        <div className="col-span-3 space-y-4">
          {/* Alerts */}
          <Card style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}>
            <CardHeader className="py-3">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2" style={{ color: COLORS.warning }}>
                <AlertTriangle className="w-4 h-4" />
                SYSTEM ALERTS
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {alerts.length > 0 ? alerts.map((alert, idx) => (
                  <div 
                    key={idx}
                    className="flex items-center gap-2 p-2 rounded text-xs"
                    style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
                  >
                    <CheckCircle className="w-3 h-3" style={{ color: COLORS.primary }} />
                    <span style={{ color: COLORS.muted }}>{alert}</span>
                  </div>
                )) : (
                  <p className="text-xs text-center py-4" style={{ color: COLORS.muted }}>
                    No active alerts
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Predictions */}
          <Card style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}>
            <CardHeader className="py-3">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2" style={{ color: COLORS.secondary }}>
                <TrendingUp className="w-4 h-4" />
                6-HOUR FUTURECAST
              </CardTitle>
            </CardHeader>
            <CardContent>
              {predictions.length > 0 ? (
                <div className="space-y-2">
                  {predictions.map((pred, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between p-2 rounded text-xs"
                      style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
                    >
                      <div>
                        <p style={{ color: COLORS.muted }}>
                          +{idx + 1}H
                        </p>
                        <p className="font-mono" style={{ color: COLORS.secondary }}>
                          {pred.lat.toFixed(4)}, {pred.lng.toFixed(4)}
                        </p>
                      </div>
                      <div 
                        className="px-2 py-1 rounded text-xs"
                        style={{ 
                          backgroundColor: `${COLORS.secondary}22`,
                          color: COLORS.secondary
                        }}
                      >
                        {(pred.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-center py-4" style={{ color: COLORS.muted }}>
                  Acquire target to generate predictions
                </p>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}>
            <CardHeader className="py-3">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2" style={{ color: COLORS.primary }}>
                <Activity className="w-4 h-4" />
                INTEL SUMMARY
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'DATA PTS', value: locationHistory.length, color: COLORS.primary },
                  { label: 'SOURCES', value: new Set(locationHistory.map(l => l.source)).size, color: COLORS.secondary },
                  { label: 'PREDICT', value: predictions.length, color: COLORS.warning },
                  { label: 'CONF %', value: locationHistory.length > 0 
                    ? Math.round(locationHistory.reduce((s, l) => s + l.confidence, 0) / locationHistory.length * 100)
                    : 0, color: COLORS.primary },
                ].map((stat, idx) => (
                  <div 
                    key={idx}
                    className="p-2 rounded text-center"
                    style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
                  >
                    <p className="text-xs" style={{ color: COLORS.muted }}>{stat.label}</p>
                    <p className="text-xl font-bold" style={{ color: stat.color }}>
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border }}>
            <CardContent className="py-3 space-y-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full justify-start text-xs uppercase"
                style={{ borderColor: COLORS.border, color: COLORS.muted }}
              >
                <Download className="w-3 h-3 mr-2" />
                Export Report
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full justify-start text-xs uppercase"
                style={{ borderColor: COLORS.border, color: COLORS.muted }}
              >
                <Upload className="w-3 h-3 mr-2" />
                Import Data
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full justify-start text-xs uppercase"
                style={{ borderColor: COLORS.border, color: COLORS.muted }}
              >
                <Settings className="w-3 h-3 mr-2" />
                Settings
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom Status */}
      <div 
        className="mt-4 px-4 py-2 rounded flex items-center justify-between text-xs"
        style={{ backgroundColor: COLORS.panel, borderColor: COLORS.border, border: `1px solid ${COLORS.border}` }}
      >
        <div className="flex items-center gap-4">
          <span style={{ color: COLORS.muted }}>
            GEOCONSOLE v2.0 | MILITARY GRADE LOCATION INTELLIGENCE
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span style={{ color: COLORS.muted }}>
            RAM ONLY • NO LOGS • SECURE
          </span>
          <Shield className="w-3 h-3" style={{ color: COLORS.primary }} />
        </div>
      </div>

      {/* CSS for animations */}
      <style>{`
        @keyframes spin {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
