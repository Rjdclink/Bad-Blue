/**
 * Monte Carlo 3D Overlay System
 * 
 * RENDER-ONLY Monte Carlo uncertainty visualization with:
 * - Confidence Volume (p90–p95 ellipsoid/isosurface)
 * - Trajectory Cone (widening cone along predicted path)
 * - Risk Halo (heat field where variance spikes)
 * - Feasibility Envelope (cluster-tight region indicator)
 * 
 * NO control feedback - visualization only
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { 
  Layers, 
  Eye, 
  EyeOff, 
  Activity, 
  AlertTriangle,
  TrendingUp,
  Circle
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

export interface MonteCarloSample {
  x: number;
  y: number;
  z: number;
  timestamp: number;
  confidence: number;
  variance: number;
}

export interface MonteCarloDistribution {
  samples: MonteCarloSample[];
  p50: MonteCarloSample[];
  p90: MonteCarloSample[];
  p95: MonteCarloSample[];
  riskDensity: number[][];
  confidenceVolume: {
    center: [number, number, number];
    radiusX: number;
    radiusY: number;
    radiusZ: number;
  };
}

export interface MonteCarloOverlayProps {
  distribution: MonteCarloDistribution | null;
  isActive: boolean;
  onToggle?: (active: boolean) => void;
}

interface LayerConfig {
  confidenceVolume: boolean;
  trajectoryCone: boolean;
  riskHalo: boolean;
  feasibilityEnvelope: boolean;
}

// ============================================================================
// MONTE CARLO OVERLAY COMPONENT
// ============================================================================

export const MonteCarloOverlay3D: React.FC<MonteCarloOverlayProps> = ({
  distribution,
  isActive,
  onToggle,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  
  const [layers, setLayers] = useState<LayerConfig>({
    confidenceVolume: true,
    trajectoryCone: true,
    riskHalo: true,
    feasibilityEnvelope: true,
  });
  
  const [percentile, setPercentile] = useState(90); // p50–p95
  const [timeIndex, setTimeIndex] = useState(0);
  const [opacity, setOpacity] = useState(0.7);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; confidence: number; variance: number } | null>(null);

  // ============================================================================
  // RENDERING ENGINE
  // ============================================================================

  const renderOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !distribution || !isActive) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = opacity;

    // Calculate current data slice based on time index
    const currentSlice = getCurrentSlice(distribution, timeIndex);

    // Render each layer if enabled
    if (layers.confidenceVolume) {
      renderConfidenceVolume(ctx, currentSlice, percentile);
    }

    if (layers.trajectoryCone) {
      renderTrajectoryCone(ctx, currentSlice);
    }

    if (layers.riskHalo) {
      renderRiskHalo(ctx, distribution.riskDensity);
    }

    if (layers.feasibilityEnvelope) {
      renderFeasibilityEnvelope(ctx, currentSlice);
    }

    ctx.globalAlpha = 1;
  }, [distribution, isActive, layers, percentile, timeIndex, opacity]);

  // ============================================================================
  // LAYER RENDERERS
  // ============================================================================

  const renderConfidenceVolume = (
    ctx: CanvasRenderingContext2D,
    slice: MonteCarloSample[],
    pValue: number
  ) => {
    if (slice.length === 0) return;

    // Filter samples by percentile
    const threshold = pValue / 100;
    const filteredSamples = slice.filter(s => s.confidence >= threshold);

    if (filteredSamples.length === 0) return;

    // Calculate ellipsoid bounds
    const xCoords = filteredSamples.map(s => s.x);
    const yCoords = filteredSamples.map(s => s.y);
    
    const centerX = xCoords.reduce((a, b) => a + b, 0) / xCoords.length;
    const centerY = yCoords.reduce((a, b) => a + b, 0) / yCoords.length;
    
    const radiusX = Math.sqrt(
      xCoords.reduce((sum, x) => sum + Math.pow(x - centerX, 2), 0) / xCoords.length
    );
    const radiusY = Math.sqrt(
      yCoords.reduce((sum, y) => sum + Math.pow(y - centerY, 2), 0) / yCoords.length
    );

    // Draw ellipse
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
    
    // Gradient fill
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(radiusX, radiusY));
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)'); // blue center
    gradient.addColorStop(0.5, 'rgba(59, 130, 246, 0.2)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.05)');
    
    ctx.fillStyle = gradient;
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const renderTrajectoryCone = (
    ctx: CanvasRenderingContext2D,
    slice: MonteCarloSample[]
  ) => {
    if (slice.length < 2) return;

    // Sort by timestamp
    const sorted = [...slice].sort((a, b) => a.timestamp - b.timestamp);

    // Draw widening cone
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      
      // Width increases with time/distance
      const width = 5 + (i / sorted.length) * 20;
      
      // Draw cone segment
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      
      const alpha = Math.max(0.1, 1 - (i / sorted.length));
      ctx.strokeStyle = `rgba(168, 85, 247, ${alpha})`; // purple
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  };

  const renderRiskHalo = (
    ctx: CanvasRenderingContext2D,
    riskDensity: number[][]
  ) => {
    const cellWidth = ctx.canvas.width / riskDensity[0].length;
    const cellHeight = ctx.canvas.height / riskDensity.length;

    for (let i = 0; i < riskDensity.length; i++) {
      for (let j = 0; j < riskDensity[i].length; j++) {
        const risk = riskDensity[i][j];
        if (risk < 0.1) continue; // Skip low-risk cells

        const x = j * cellWidth;
        const y = i * cellHeight;

        // Heat map coloring
        const color = getHeatColor(risk);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
    }
  };

  const renderFeasibilityEnvelope = (
    ctx: CanvasRenderingContext2D,
    slice: MonteCarloSample[]
  ) => {
    if (slice.length === 0) return;

    // Find cluster-tight regions (high density areas)
    const clusters = findClusters(slice);

    clusters.forEach(cluster => {
      const { center, radius, density } = cluster;

      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);

      const alpha = Math.min(0.6, density);
      ctx.fillStyle = `rgba(34, 197, 94, ${alpha})`; // green
      ctx.fill();

      ctx.strokeStyle = `rgba(34, 197, 94, ${alpha + 0.2})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  };

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  const getCurrentSlice = (
    dist: MonteCarloDistribution,
    index: number
  ): MonteCarloSample[] => {
    // Return samples at current time index
    const maxTime = Math.max(...dist.samples.map(s => s.timestamp));
    const minTime = Math.min(...dist.samples.map(s => s.timestamp));
    const timeRange = maxTime - minTime;
    const targetTime = minTime + (index / 100) * timeRange;

    return dist.samples.filter(
      s => Math.abs(s.timestamp - targetTime) < timeRange * 0.05
    );
  };

  const getHeatColor = (value: number): string => {
    // Red-yellow-green heat map
    if (value > 0.7) return `rgba(239, 68, 68, ${value * 0.5})`; // red
    if (value > 0.4) return `rgba(234, 179, 8, ${value * 0.5})`; // yellow
    return `rgba(34, 197, 94, ${value * 0.5})`; // green
  };

  const findClusters = (
    samples: MonteCarloSample[]
  ): Array<{ center: { x: number; y: number }; radius: number; density: number }> => {
    // Simple clustering by spatial proximity
    const clusters: Array<{ center: { x: number; y: number }; radius: number; density: number }> = [];
    const visited = new Set<number>();
    const threshold = 50; // pixels

    for (let i = 0; i < samples.length; i++) {
      if (visited.has(i)) continue;

      const cluster = [samples[i]];
      visited.add(i);

      for (let j = i + 1; j < samples.length; j++) {
        if (visited.has(j)) continue;

        const dist = Math.sqrt(
          Math.pow(samples[i].x - samples[j].x, 2) +
          Math.pow(samples[i].y - samples[j].y, 2)
        );

        if (dist < threshold) {
          cluster.push(samples[j]);
          visited.add(j);
        }
      }

      if (cluster.length > 3) {
        const centerX = cluster.reduce((sum, s) => sum + s.x, 0) / cluster.length;
        const centerY = cluster.reduce((sum, s) => sum + s.y, 0) / cluster.length;
        const radius = Math.sqrt(
          cluster.reduce((sum, s) => sum + Math.pow(s.x - centerX, 2) + Math.pow(s.y - centerY, 2), 0) / cluster.length
        );

        clusters.push({
          center: { x: centerX, y: centerY },
          radius: radius * 1.5,
          density: cluster.length / samples.length,
        });
      }
    }

    return clusters;
  };

  // ============================================================================
  // MOUSE INTERACTION
  // ============================================================================

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!distribution) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find nearest sample
    const slice = getCurrentSlice(distribution, timeIndex);
    let nearest: MonteCarloSample | null = null;
    let minDist = Infinity;

    for (const sample of slice) {
      const dist = Math.sqrt(Math.pow(sample.x - x, 2) + Math.pow(sample.y - y, 2));
      if (dist < minDist && dist < 30) {
        minDist = dist;
        nearest = sample;
      }
    }

    if (nearest) {
      setHoveredPoint({
        x: nearest.x,
        y: nearest.y,
        confidence: nearest.confidence,
        variance: nearest.variance,
      });
    } else {
      setHoveredPoint(null);
    }
  }, [distribution, timeIndex]);

  // ============================================================================
  // EFFECTS
  // ============================================================================

  useEffect(() => {
    renderOverlay();
  }, [renderOverlay]);

  useEffect(() => {
    // Animation loop for smooth updates
    const animate = () => {
      renderOverlay();
      animationRef.current = requestAnimationFrame(animate);
    };

    if (isActive && distribution) {
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, distribution, renderOverlay]);

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!isActive) {
    return (
      <div className="absolute top-4 right-4 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onToggle?.(true)}
          className="bg-purple-500/20 border-purple-500/50 text-purple-300 hover:bg-purple-500/30"
        >
          <Activity className="w-4 h-4 mr-2" />
          Enable Monte Carlo
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      {/* Canvas Overlay */}
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="absolute inset-0 w-full h-full pointer-events-auto"
        onMouseMove={handleMouseMove}
        style={{ mixBlendMode: 'screen' }}
      />

      {/* Control Panel */}
      <div className="absolute top-4 right-4 bg-slate-900/95 rounded-lg p-4 border border-purple-500/50 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-400" />
            <span className="text-sm font-semibold text-purple-300">Monte Carlo Overlay</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggle?.(false)}
            className="h-6 w-6 text-slate-400 hover:text-slate-200"
          >
            <EyeOff className="w-4 h-4" />
          </Button>
        </div>

        {/* Layer Toggles */}
        <div className="space-y-2 mb-4">
          <div className="text-xs text-slate-400 mb-2">Layers</div>
          {Object.entries(layers).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                {key === 'confidenceVolume' && <Circle className="w-3 h-3 text-blue-400" />}
                {key === 'trajectoryCone' && <TrendingUp className="w-3 h-3 text-purple-400" />}
                {key === 'riskHalo' && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                {key === 'feasibilityEnvelope' && <Eye className="w-3 h-3 text-green-400" />}
                <span className="text-slate-300 capitalize">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </span>
              </div>
              <Switch
                checked={value}
                onCheckedChange={(checked) =>
                  setLayers(prev => ({ ...prev, [key]: checked }))
                }
                className="scale-75"
              />
            </div>
          ))}
        </div>

        {/* Percentile Control */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-400">Percentile</span>
            <Badge variant="outline" className="bg-purple-500/20 text-purple-300 border-purple-500/30">
              p{percentile}
            </Badge>
          </div>
          <Slider
            value={[percentile]}
            min={50}
            max={95}
            step={5}
            onValueChange={([value]) => setPercentile(value)}
            className="cursor-pointer"
          />
        </div>

        {/* Time Scrubber */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-400">Time Index</span>
            <span className="text-slate-300">{timeIndex}%</span>
          </div>
          <Slider
            value={[timeIndex]}
            min={0}
            max={100}
            step={1}
            onValueChange={([value]) => setTimeIndex(value)}
            className="cursor-pointer"
          />
        </div>

        {/* Opacity Control */}
        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-400">Opacity</span>
            <span className="text-slate-300">{Math.round(opacity * 100)}%</span>
          </div>
          <Slider
            value={[opacity * 100]}
            min={10}
            max={100}
            step={10}
            onValueChange={([value]) => setOpacity(value / 100)}
            className="cursor-pointer"
          />
        </div>

        {/* Hover Info */}
        {hoveredPoint && (
          <div className="mt-4 pt-4 border-t border-slate-700/50">
            <div className="text-xs text-slate-400 mb-2">Cursor Point</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Confidence:</span>
                <span className="text-cyan-400 font-mono">
                  {(hoveredPoint.confidence * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Variance:</span>
                <span className="text-amber-400 font-mono">
                  {hoveredPoint.variance.toFixed(3)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-slate-900/95 rounded-lg p-3 border border-slate-700/50 pointer-events-auto">
        <div className="text-xs text-slate-400 mb-2">Legend</div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-400/50" />
            <span className="text-slate-300">Confidence Volume</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-purple-400/50" />
            <span className="text-slate-300">Trajectory Cone</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-400/50" />
            <span className="text-slate-300">Risk Halo</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-400/50" />
            <span className="text-slate-300">Feasibility Envelope</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonteCarloOverlay3D;
