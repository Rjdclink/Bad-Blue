/**
 * Monte Carlo Overlay - Render-Only Visualization Layers
 * 
 * CORE PRINCIPLES:
 * - Render-only: no control feedback
 * - Displays uncertainty overlays on 3D map
 * - Toggleable layers with opacity control
 * - Percentile slider (p50 ↔ p95)
 * - Time scrubber animation
 * - Hover readout for confidence/variance
 * 
 * LAYERS:
 * - Confidence Volume: p90-p95 ellipsoid/isosurface
 * - Trajectory Cone: widening cone along predicted path
 * - Risk Halo: heat field where variance spikes
 * - Feasibility Envelope: cluster-tight region indicator
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Activity, Layers, Target, Radio, Crosshair,
  TrendingUp, AlertTriangle, Zap, Eye, EyeOff,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

export interface MonteCarloSample {
  id: string;
  latitude: number;
  longitude: number;
  timestamp: number;
  weight: number;
  trajectory?: { lat: number; lng: number }[];
}

export interface MonteCarloOverlayState {
  particles: MonteCarloSample[];
  centroid: { lat: number; lng: number };
  standardDev: { lat: number; lng: number };
  confidenceBounds: {
    p50: { lat: number; lng: number; radius: number };
    p75: { lat: number; lng: number; radius: number };
    p90: { lat: number; lng: number; radius: number };
    p95: { lat: number; lng: number; radius: number };
  };
  trajectoryCone: {
    origin: { lat: number; lng: number };
    endpoints: { lat: number; lng: number; confidence: number }[];
    widthDegrees: number;
  };
  riskHalo: {
    center: { lat: number; lng: number };
    variance: number;
    intensity: number; // 0-1
  }[];
  feasibilityEnvelope: {
    polygon: { lat: number; lng: number }[];
    confidence: number;
  };
  calibration: {
    latencyP50: number;
    latencyP90: number;
    latencyP95: number;
    slippageP50: number;
    slippageP90: number;
    slippageP95: number;
    fillRate: number;
    failRate: number;
    regime: 'low' | 'medium' | 'high';
  };
  metrics: {
    effectiveSampleSize: number;
    particleCount: number;
    cyclesCompleted: number;
    lastUpdate: Date;
  };
}

export interface MonteCarloOverlayProps {
  state: MonteCarloOverlayState | null;
  isActive: boolean;
  onLayerToggle?: (layer: keyof MonteCarloLayerConfig, enabled: boolean) => void;
  onPercentileChange?: (percentile: number) => void;
  onTimeChange?: (time: number) => void;
}

export interface MonteCarloLayerConfig {
  confidenceVolume: boolean;
  trajectoryCone: boolean;
  riskHalo: boolean;
  feasibilityEnvelope: boolean;
  particles: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_LAYER_CONFIG: MonteCarloLayerConfig = {
  confidenceVolume: true,
  trajectoryCone: true,
  riskHalo: true,
  feasibilityEnvelope: true,
  particles: false, // Hidden by default for performance
};

const PERCENTILE_OPTIONS = [50, 75, 90, 95];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatLatLng = (lat: number, lng: number): string => 
  `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

const formatPercent = (value: number): string => 
  `${(value * 100).toFixed(1)}%`;

const formatMs = (ms: number): string => 
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;

const getRegimeColor = (regime: 'low' | 'medium' | 'high'): string => {
  switch (regime) {
    case 'low': return 'text-green-400 bg-green-500/20';
    case 'medium': return 'text-amber-400 bg-amber-500/20';
    case 'high': return 'text-red-400 bg-red-500/20';
  }
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface LayerToggleProps {
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  color?: string;
}

const LayerToggle: React.FC<LayerToggleProps> = ({ 
  label, icon, enabled, onChange, color = 'cyan' 
}) => (
  <div className="flex items-center justify-between py-1.5">
    <div className="flex items-center gap-2">
      <div className={`text-${color}-400`}>{icon}</div>
      <span className="text-xs text-slate-300">{label}</span>
    </div>
    <Switch 
      checked={enabled} 
      onCheckedChange={onChange} 
      className="scale-75"
    />
  </div>
);

interface MetricCardProps {
  label: string;
  value: string | number;
  color?: string;
  icon?: React.ReactNode;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, color = 'cyan', icon }) => (
  <div className="bg-slate-800/50 rounded-lg p-2">
    <div className="flex items-center gap-1 mb-1">
      {icon}
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
    </div>
    <span className={`text-sm font-bold text-${color}-400`}>{value}</span>
  </div>
);

interface CalibrationDisplayProps {
  calibration: MonteCarloOverlayState['calibration'];
}

const CalibrationDisplay: React.FC<CalibrationDisplayProps> = ({ calibration }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium text-slate-300">Calibration</span>
      <Badge 
        variant="outline" 
        className={`text-[10px] ${getRegimeColor(calibration.regime)}`}
      >
        {calibration.regime.toUpperCase()} REGIME
      </Badge>
    </div>
    
    <div className="grid grid-cols-3 gap-1">
      <div className="text-center">
        <p className="text-[10px] text-slate-500">p50</p>
        <p className="text-xs font-mono text-green-400">{formatMs(calibration.latencyP50)}</p>
      </div>
      <div className="text-center">
        <p className="text-[10px] text-slate-500">p90</p>
        <p className="text-xs font-mono text-amber-400">{formatMs(calibration.latencyP90)}</p>
      </div>
      <div className="text-center">
        <p className="text-[10px] text-slate-500">p95</p>
        <p className="text-xs font-mono text-red-400">{formatMs(calibration.latencyP95)}</p>
      </div>
    </div>
    
    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/50">
      <div>
        <p className="text-[10px] text-slate-500">Fill Rate</p>
        <p className="text-xs font-mono text-cyan-400">{formatPercent(calibration.fillRate)}</p>
      </div>
      <div>
        <p className="text-[10px] text-slate-500">Fail Rate</p>
        <p className="text-xs font-mono text-red-400">{formatPercent(calibration.failRate)}</p>
      </div>
    </div>
  </div>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const MonteCarloOverlay: React.FC<MonteCarloOverlayProps> = ({
  state,
  isActive,
  onLayerToggle,
  onPercentileChange,
  onTimeChange,
}) => {
  const [layerConfig, setLayerConfig] = useState<MonteCarloLayerConfig>(DEFAULT_LAYER_CONFIG);
  const [percentile, setPercentile] = useState(90);
  const [opacity, setOpacity] = useState(70);
  const [timePosition, setTimePosition] = useState(100); // 0-100, 100 = now
  const [showPanel, setShowPanel] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<{ lat: number; lng: number; confidence: number } | null>(null);

  // Handle layer toggle
  const handleLayerToggle = useCallback((layer: keyof MonteCarloLayerConfig, enabled: boolean) => {
    setLayerConfig(prev => ({ ...prev, [layer]: enabled }));
    onLayerToggle?.(layer, enabled);
  }, [onLayerToggle]);

  // Handle percentile change
  const handlePercentileChange = useCallback((value: number[]) => {
    const newPercentile = PERCENTILE_OPTIONS.reduce((prev, curr) =>
      Math.abs(curr - value[0]) < Math.abs(prev - value[0]) ? curr : prev
    );
    setPercentile(newPercentile);
    onPercentileChange?.(newPercentile);
  }, [onPercentileChange]);

  // Handle time scrubber
  const handleTimeChange = useCallback((value: number[]) => {
    setTimePosition(value[0]);
    onTimeChange?.(value[0]);
  }, [onTimeChange]);

  // Confidence bounds for current percentile
  const currentBounds = useMemo(() => {
    if (!state) return null;
    switch (percentile) {
      case 50: return state.confidenceBounds.p50;
      case 75: return state.confidenceBounds.p75;
      case 90: return state.confidenceBounds.p90;
      case 95: return state.confidenceBounds.p95;
      default: return state.confidenceBounds.p90;
    }
  }, [state, percentile]);

  if (!showPanel) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="absolute top-4 right-4 bg-slate-900/90 border-slate-700/50 text-slate-300 z-[1000]"
        onClick={() => setShowPanel(true)}
      >
        <Layers className="w-4 h-4 mr-1" />
        Monte Carlo
      </Button>
    );
  }

  return (
    <div className="absolute top-4 right-4 w-72 bg-slate-900/95 backdrop-blur-md rounded-lg border border-slate-700/50 shadow-2xl z-[1000]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Activity className={`w-4 h-4 ${isActive ? 'text-green-400 animate-pulse' : 'text-slate-500'}`} />
          <span className="text-sm font-medium text-slate-200">Monte Carlo Overlay</span>
        </div>
        <div className="flex items-center gap-1">
          <Badge 
            variant="outline" 
            className={`text-[10px] ${isActive ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}`}
          >
            {isActive ? 'ACTIVE' : 'IDLE'}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-slate-400 hover:text-slate-200"
            onClick={() => setShowPanel(false)}
          >
            <EyeOff className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Layer Controls */}
      <div className="px-3 py-2 border-b border-slate-700/50">
        <div className="flex items-center gap-2 mb-2">
          <Layers className="w-3 h-3 text-cyan-400" />
          <span className="text-xs font-medium text-slate-300">Render Layers</span>
        </div>
        
        <LayerToggle
          label="Confidence Volume"
          icon={<Target className="w-3 h-3" />}
          enabled={layerConfig.confidenceVolume}
          onChange={(v) => handleLayerToggle('confidenceVolume', v)}
          color="cyan"
        />
        <LayerToggle
          label="Trajectory Cone"
          icon={<TrendingUp className="w-3 h-3" />}
          enabled={layerConfig.trajectoryCone}
          onChange={(v) => handleLayerToggle('trajectoryCone', v)}
          color="purple"
        />
        <LayerToggle
          label="Risk Halo"
          icon={<AlertTriangle className="w-3 h-3" />}
          enabled={layerConfig.riskHalo}
          onChange={(v) => handleLayerToggle('riskHalo', v)}
          color="amber"
        />
        <LayerToggle
          label="Feasibility Envelope"
          icon={<Zap className="w-3 h-3" />}
          enabled={layerConfig.feasibilityEnvelope}
          onChange={(v) => handleLayerToggle('feasibilityEnvelope', v)}
          color="green"
        />
        <LayerToggle
          label="Particles"
          icon={<Radio className="w-3 h-3" />}
          enabled={layerConfig.particles}
          onChange={(v) => handleLayerToggle('particles', v)}
          color="blue"
        />
      </div>

      {/* Percentile Slider */}
      <div className="px-3 py-2 border-b border-slate-700/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400">Percentile</span>
          <span className="text-xs font-mono text-cyan-400">p{percentile}</span>
        </div>
        <Slider
          value={[percentile]}
          min={50}
          max={95}
          step={1}
          onValueChange={handlePercentileChange}
          className="cursor-pointer"
        />
        <div className="flex justify-between mt-1 text-[10px] text-slate-500">
          <span>p50</span>
          <span>p75</span>
          <span>p90</span>
          <span>p95</span>
        </div>
      </div>

      {/* Opacity Slider */}
      <div className="px-3 py-2 border-b border-slate-700/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400">Opacity</span>
          <span className="text-xs font-mono text-slate-300">{opacity}%</span>
        </div>
        <Slider
          value={[opacity]}
          min={10}
          max={100}
          step={5}
          onValueChange={([v]) => setOpacity(v)}
          className="cursor-pointer"
        />
      </div>

      {/* Time Scrubber */}
      <div className="px-3 py-2 border-b border-slate-700/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400">Time Position</span>
          <span className="text-xs font-mono text-cyan-400">{timePosition}%</span>
        </div>
        <Slider
          value={[timePosition]}
          min={0}
          max={100}
          step={1}
          onValueChange={handleTimeChange}
          className="cursor-pointer"
        />
      </div>

      {/* Confidence Stats */}
      {state && currentBounds && (
        <div className="px-3 py-2 border-b border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <Crosshair className="w-3 h-3 text-cyan-400" />
            <span className="text-xs font-medium text-slate-300">Confidence Bounds</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard 
              label="Center" 
              value={formatLatLng(currentBounds.lat, currentBounds.lng)} 
              icon={<Target className="w-3 h-3 text-cyan-400" />}
            />
            <MetricCard 
              label="Radius" 
              value={`${currentBounds.radius.toFixed(0)}m`} 
              icon={<Radio className="w-3 h-3 text-purple-400" />}
              color="purple"
            />
          </div>
        </div>
      )}

      {/* Calibration Data */}
      {state?.calibration && (
        <div className="px-3 py-2 border-b border-slate-700/50">
          <CalibrationDisplay calibration={state.calibration} />
        </div>
      )}

      {/* Metrics */}
      {state?.metrics && (
        <div className="px-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            <MetricCard
              label="Particles"
              value={state.metrics.particleCount.toLocaleString()}
              icon={<Radio className="w-3 h-3 text-blue-400" />}
              color="blue"
            />
            <MetricCard
              label="ESS"
              value={state.metrics.effectiveSampleSize.toFixed(0)}
              icon={<Activity className="w-3 h-3 text-green-400" />}
              color="green"
            />
          </div>
          
          {/* Hover readout */}
          {hoveredPoint && (
            <div className="mt-2 p-2 bg-slate-800/80 rounded border border-slate-700/50">
              <p className="text-[10px] text-slate-500 mb-1">Cursor Position</p>
              <p className="text-xs font-mono text-cyan-400">
                {formatLatLng(hoveredPoint.lat, hoveredPoint.lng)}
              </p>
              <p className="text-xs text-slate-400">
                Confidence: {formatPercent(hoveredPoint.confidence)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MONTE CARLO PASS/FAIL CHECKER
// ============================================================================

export interface RealWorldValidation {
  lastAttempts: number;
  latencyWithinP95: number;
  slippageWithinP95: number;
  fillRatesMatch: boolean;
  passStatus: 'PASS' | 'FAIL';
  details: string[];
}

export function validateRealWorldPerformance(
  realized: {
    latencies: number[];
    slippages: number[];
    fills: number;
    partials: number;
    fails: number;
  },
  predicted: MonteCarloOverlayState['calibration']
): RealWorldValidation {
  const details: string[] = [];
  
  // Calculate realized percentiles
  const sortedLatencies = [...realized.latencies].sort((a, b) => a - b);
  const sortedSlippages = [...realized.slippages].sort((a, b) => a - b);
  
  // Count within predicted bounds
  const latencyWithin = realized.latencies.filter(l => l <= predicted.latencyP95).length;
  const slippageWithin = realized.slippages.filter(s => s <= predicted.slippageP95).length;
  
  const latencyRate = latencyWithin / realized.latencies.length;
  const slippageRate = slippageWithin / realized.slippages.length;
  
  // Fill rate check
  const totalAttempts = realized.fills + realized.partials + realized.fails;
  const realizedFillRate = totalAttempts > 0 ? realized.fills / totalAttempts : 0;
  const fillRatesMatch = Math.abs(realizedFillRate - predicted.fillRate) < 0.1; // 10% tolerance
  
  // Determine pass/fail
  const latencyPass = latencyRate >= 0.9;
  const slippagePass = slippageRate >= 0.9;
  
  if (!latencyPass) {
    details.push(`Latency: ${(latencyRate * 100).toFixed(1)}% within p95 (need ≥90%)`);
  }
  if (!slippagePass) {
    details.push(`Slippage: ${(slippageRate * 100).toFixed(1)}% within p95 (need ≥90%)`);
  }
  if (!fillRatesMatch) {
    details.push(`Fill rate mismatch: ${(realizedFillRate * 100).toFixed(1)}% vs predicted ${(predicted.fillRate * 100).toFixed(1)}%`);
  }
  
  const passStatus = latencyPass && slippagePass && fillRatesMatch ? 'PASS' : 'FAIL';
  
  return {
    lastAttempts: realized.latencies.length,
    latencyWithinP95: latencyRate,
    slippageWithinP95: slippageRate,
    fillRatesMatch,
    passStatus,
    details,
  };
}

// ============================================================================
// DEFAULT STATE GENERATOR (for demo/testing)
// ============================================================================

export function generateDefaultMonteCarloState(
  center: { lat: number; lng: number } = { lat: 40.7128, lng: -74.0060 }
): MonteCarloOverlayState {
  const particles: MonteCarloSample[] = [];
  const numParticles = 100;
  
  for (let i = 0; i < numParticles; i++) {
    const latOffset = (Math.random() - 0.5) * 0.02;
    const lngOffset = (Math.random() - 0.5) * 0.02;
    particles.push({
      id: `p_${i}`,
      latitude: center.lat + latOffset,
      longitude: center.lng + lngOffset,
      timestamp: Date.now(),
      weight: Math.random(),
    });
  }
  
  return {
    particles,
    centroid: center,
    standardDev: { lat: 0.005, lng: 0.005 },
    confidenceBounds: {
      p50: { ...center, radius: 200 },
      p75: { ...center, radius: 350 },
      p90: { ...center, radius: 500 },
      p95: { ...center, radius: 650 },
    },
    trajectoryCone: {
      origin: center,
      endpoints: [
        { lat: center.lat + 0.01, lng: center.lng + 0.005, confidence: 0.9 },
        { lat: center.lat + 0.02, lng: center.lng + 0.01, confidence: 0.75 },
        { lat: center.lat + 0.03, lng: center.lng + 0.015, confidence: 0.5 },
      ],
      widthDegrees: 0.01,
    },
    riskHalo: [
      { center: { lat: center.lat + 0.005, lng: center.lng - 0.005 }, variance: 0.8, intensity: 0.7 },
    ],
    feasibilityEnvelope: {
      polygon: [
        { lat: center.lat - 0.01, lng: center.lng - 0.01 },
        { lat: center.lat - 0.01, lng: center.lng + 0.01 },
        { lat: center.lat + 0.01, lng: center.lng + 0.01 },
        { lat: center.lat + 0.01, lng: center.lng - 0.01 },
      ],
      confidence: 0.95,
    },
    calibration: {
      latencyP50: 45,
      latencyP90: 120,
      latencyP95: 180,
      slippageP50: 2,
      slippageP90: 8,
      slippageP95: 15,
      fillRate: 0.92,
      failRate: 0.03,
      regime: 'medium',
    },
    metrics: {
      effectiveSampleSize: 4500,
      particleCount: 5000,
      cyclesCompleted: 12,
      lastUpdate: new Date(),
    },
  };
}

export default MonteCarloOverlay;
