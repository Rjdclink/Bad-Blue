/**
 * Motion Trail Renderer
 * 
 * Renders animated motion trails with weather-radar-style effects
 * Supports heat trails, probability clouds, and speed-based coloring
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { SPEED_THRESHOLDS, SPEED_COLORS } from '@shared/geoconsoleTypes';

// Extended TrailPoint for rendering (includes opacity for fade effect)
interface RenderTrailPoint {
  latitude: number;
  longitude: number;
  timestamp: Date;
  speed?: number;
  confidence: number;
  interpolated: boolean;
  opacity?: number;
}

interface MotionTrailRendererProps {
  points: RenderTrailPoint[];
  currentTime: Date;
  showHeatTrail?: boolean;
  showProbabilityCloud?: boolean;
  trailFadeDuration?: number; // seconds
  animationSpeed?: number;
  colorScheme?: 'speed' | 'time' | 'confidence';
}

// Speed thresholds with colors for rendering
const SPEED_COLOR_MAP = {
  stationary: { color: SPEED_COLORS.stationary, threshold: SPEED_THRESHOLDS.stationary },
  walking: { color: SPEED_COLORS.walking, threshold: SPEED_THRESHOLDS.walking },
  running: { color: SPEED_COLORS.running, threshold: SPEED_THRESHOLDS.running },
  cycling: { color: SPEED_COLORS.cycling, threshold: SPEED_THRESHOLDS.cycling },
  driving: { color: SPEED_COLORS.driving, threshold: Infinity },
};

export const MotionTrailRenderer: React.FC<MotionTrailRendererProps> = ({
  points,
  currentTime,
  showHeatTrail = true,
  showProbabilityCloud = false,
  trailFadeDuration = 3600, // 1 hour
  animationSpeed = 1,
  colorScheme = 'speed',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  // Calculate visible points based on current time
  const visiblePoints = useMemo(() => {
    const currentMs = currentTime.getTime();
    const fadeMs = trailFadeDuration * 1000;
    
    return points
      .filter(p => {
        const pointMs = new Date(p.timestamp).getTime();
        return pointMs <= currentMs && currentMs - pointMs <= fadeMs;
      })
      .map(p => ({
        ...p,
        opacity: 1 - (currentMs - new Date(p.timestamp).getTime()) / fadeMs,
      }));
  }, [points, currentTime, trailFadeDuration]);

  // Get color based on speed
  const getSpeedColor = (speed: number = 0): string => {
    if (speed < SPEED_COLOR_MAP.stationary.threshold) return SPEED_COLOR_MAP.stationary.color;
    if (speed < SPEED_COLOR_MAP.walking.threshold) return SPEED_COLOR_MAP.walking.color;
    if (speed < SPEED_COLOR_MAP.running.threshold) return SPEED_COLOR_MAP.running.color;
    if (speed < SPEED_COLOR_MAP.cycling.threshold) return SPEED_COLOR_MAP.cycling.color;
    return SPEED_COLOR_MAP.driving.color;
  };

  // Get color based on time (rainbow gradient)
  const getTimeColor = (ratio: number): string => {
    const hue = (1 - ratio) * 240; // Blue to red
    return `hsl(${hue}, 80%, 50%)`;
  };

  // Get color based on confidence
  const getConfidenceColor = (confidence: number): string => {
    const hue = confidence * 120; // Red to green
    return `hsl(${hue}, 80%, 50%)`;
  };

  // Render trail on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (visiblePoints.length < 2) return;

    // Calculate bounds for coordinate transformation
    const lats = visiblePoints.map(p => p.latitude);
    const lngs = visiblePoints.map(p => p.longitude);
    const bounds = {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };

    // Add padding
    const padding = 50;
    const latRange = bounds.maxLat - bounds.minLat || 0.01;
    const lngRange = bounds.maxLng - bounds.minLng || 0.01;

    // Transform coordinates to canvas space
    const toCanvas = (lat: number, lng: number): { x: number; y: number } => ({
      x: padding + ((lng - bounds.minLng) / lngRange) * (canvas.width - 2 * padding),
      y: padding + ((bounds.maxLat - lat) / latRange) * (canvas.height - 2 * padding),
    });

    // Draw heat trail (glow effect)
    if (showHeatTrail) {
      for (let i = 1; i < visiblePoints.length; i++) {
        const p1 = visiblePoints[i - 1];
        const p2 = visiblePoints[i];
        const c1 = toCanvas(p1.latitude, p1.longitude);
        const c2 = toCanvas(p2.latitude, p2.longitude);

        const opacity = (p1.opacity + p2.opacity) / 2;
        
        // Outer glow
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.strokeStyle = `rgba(59, 130, 246, ${opacity * 0.2})`;
        ctx.lineWidth = 20;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Middle glow
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.strokeStyle = `rgba(59, 130, 246, ${opacity * 0.4})`;
        ctx.lineWidth = 10;
        ctx.stroke();
      }
    }

    // Draw main trail line
    ctx.beginPath();
    const firstPoint = toCanvas(visiblePoints[0].latitude, visiblePoints[0].longitude);
    ctx.moveTo(firstPoint.x, firstPoint.y);

    for (let i = 1; i < visiblePoints.length; i++) {
      const point = visiblePoints[i];
      const prevPoint = visiblePoints[i - 1];
      const c = toCanvas(point.latitude, point.longitude);
      
      // Get color based on scheme
      let color: string;
      switch (colorScheme) {
        case 'speed':
          color = getSpeedColor(point.speed);
          break;
        case 'time':
          color = getTimeColor(i / visiblePoints.length);
          break;
        case 'confidence':
          color = getConfidenceColor(point.confidence);
          break;
        default:
          color = '#3b82f6';
      }

      // Draw segment
      const prevC = toCanvas(prevPoint.latitude, prevPoint.longitude);
      ctx.beginPath();
      ctx.moveTo(prevC.x, prevC.y);
      ctx.lineTo(c.x, c.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = point.opacity;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Draw probability cloud for interpolated points
    if (showProbabilityCloud) {
      const interpolatedPoints = visiblePoints.filter(p => p.interpolated);
      for (const point of interpolatedPoints) {
        const c = toCanvas(point.latitude, point.longitude);
        const radius = 20 * (1 - point.confidence);
        
        const gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
        gradient.addColorStop(0, `rgba(147, 51, 234, ${point.opacity * 0.3})`);
        gradient.addColorStop(1, 'rgba(147, 51, 234, 0)');
        
        ctx.beginPath();
        ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    }

    // Draw current position marker
    if (visiblePoints.length > 0) {
      const currentPoint = visiblePoints[visiblePoints.length - 1];
      const c = toCanvas(currentPoint.latitude, currentPoint.longitude);
      
      // Outer ring
      ctx.beginPath();
      ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Inner dot
      ctx.beginPath();
      ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
      
      // Pulse animation
      ctx.beginPath();
      ctx.arc(c.x, c.y, 20, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

  }, [visiblePoints, showHeatTrail, showProbabilityCloud, colorScheme]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="w-full h-full"
        style={{ background: 'transparent' }}
      />
      
      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-slate-800/80 rounded-lg p-3 backdrop-blur-sm">
        <p className="text-xs text-slate-400 mb-2">Speed Legend</p>
        <div className="flex flex-col gap-1">
          {Object.entries(SPEED_COLOR_MAP).map(([key, { color }]) => (
            <div key={key} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-slate-300 capitalize">{key}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="absolute top-4 right-4 bg-slate-800/80 rounded-lg p-3 backdrop-blur-sm">
        <p className="text-xs text-slate-400">Visible Points</p>
        <p className="text-lg font-bold text-white">{visiblePoints.length}</p>
        <p className="text-xs text-slate-400 mt-1">Interpolated</p>
        <p className="text-sm font-medium text-purple-400">
          {visiblePoints.filter(p => p.interpolated).length}
        </p>
      </div>
    </div>
  );
};

export default MotionTrailRenderer;
