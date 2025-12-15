/**
 * Monte Carlo Simulation Hook
 * 
 * Generates Monte Carlo distributions for uncertainty visualization
 * Includes sampler, propagator, reducer, and scorer
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { GPSPoint } from '@shared/geoconsoleTypes';
import type { MonteCarloDistribution, MonteCarloSample } from '../components/geoconsole/MonteCarloOverlay3D';

interface MonteCarloConfig {
  iterations: number;
  noiseModel: 'gaussian' | 'uniform' | 'exponential';
  timeSlices: number;
  varianceThreshold: number;
}

const DEFAULT_CONFIG: MonteCarloConfig = {
  iterations: 1000,
  noiseModel: 'gaussian',
  timeSlices: 20,
  varianceThreshold: 0.1,
};

export function useMonteCarloSimulation(
  gpsPoints: GPSPoint[],
  config: Partial<MonteCarloConfig> = {}
) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const [distribution, setDistribution] = useState<MonteCarloDistribution | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [progress, setProgress] = useState(0);
  const workerRef = useRef<Worker | null>(null);

  // ============================================================================
  // MC CORE COMPONENTS
  // ============================================================================

  /**
   * Sampler: draws N realizations using noise models
   */
  const sampler = useCallback((
    point: GPSPoint,
    noiseModel: string,
    iterations: number
  ): MonteCarloSample[] => {
    const samples: MonteCarloSample[] = [];

    for (let i = 0; i < iterations; i++) {
      let dx = 0, dy = 0;

      switch (noiseModel) {
        case 'gaussian':
          dx = gaussianRandom() * (point.accuracy || 10);
          dy = gaussianRandom() * (point.accuracy || 10);
          break;
        case 'uniform':
          dx = (Math.random() - 0.5) * 2 * (point.accuracy || 10);
          dy = (Math.random() - 0.5) * 2 * (point.accuracy || 10);
          break;
        case 'exponential':
          dx = exponentialRandom() * (point.accuracy || 10);
          dy = exponentialRandom() * (point.accuracy || 10);
          break;
      }

      // Convert meters to approximate lat/lng (rough conversion)
      const latOffset = dy / 111320;
      const lngOffset = dx / (111320 * Math.cos(point.latitude * Math.PI / 180));

      samples.push({
        x: point.longitude + lngOffset,
        y: point.latitude + latOffset,
        z: point.altitude || 0,
        timestamp: typeof point.timestamp === 'string' 
          ? new Date(point.timestamp).getTime() 
          : point.timestamp.getTime(),
        confidence: point.confidence,
        variance: Math.sqrt(dx * dx + dy * dy),
      });
    }

    return samples;
  }, []);

  /**
   * Propagator: advances realizations across time slices
   */
  const propagator = useCallback((
    samples: MonteCarloSample[],
    timeSlices: number
  ): MonteCarloSample[] => {
    const propagated: MonteCarloSample[] = [];

    for (const sample of samples) {
      for (let t = 0; t < timeSlices; t++) {
        const timeFactor = t / timeSlices;
        
        // Add temporal drift
        const drift = gaussianRandom() * 0.0001 * timeFactor;
        
        propagated.push({
          ...sample,
          x: sample.x + drift,
          y: sample.y + drift,
          timestamp: sample.timestamp + (t * 300000), // 5-minute intervals
          confidence: sample.confidence * (1 - timeFactor * 0.3), // Decay confidence
          variance: sample.variance * (1 + timeFactor), // Increase variance
        });
      }
    }

    return propagated;
  }, []);

  /**
   * Reducer: aggregates p50/p90/p95 bounds
   */
  const reducer = useCallback((
    samples: MonteCarloSample[]
  ): { p50: MonteCarloSample[]; p90: MonteCarloSample[]; p95: MonteCarloSample[] } => {
    // Sort by confidence
    const sorted = [...samples].sort((a, b) => a.confidence - b.confidence);

    const p50Index = Math.floor(sorted.length * 0.50);
    const p90Index = Math.floor(sorted.length * 0.90);
    const p95Index = Math.floor(sorted.length * 0.95);

    return {
      p50: sorted.slice(0, p50Index),
      p90: sorted.slice(0, p90Index),
      p95: sorted.slice(0, p95Index),
    };
  }, []);

  /**
   * Scorer: confidence + risk density outputs
   */
  const scorer = useCallback((
    samples: MonteCarloSample[],
    gridSize: number = 50
  ): number[][] => {
    // Calculate bounds
    const xMin = Math.min(...samples.map(s => s.x));
    const xMax = Math.max(...samples.map(s => s.x));
    const yMin = Math.min(...samples.map(s => s.y));
    const yMax = Math.max(...samples.map(s => s.y));

    const xRange = xMax - xMin;
    const yRange = yMax - yMin;

    // Initialize risk density grid
    const riskDensity: number[][] = Array(gridSize)
      .fill(null)
      .map(() => Array(gridSize).fill(0));

    // Count samples in each cell
    for (const sample of samples) {
      const xIdx = Math.min(
        gridSize - 1,
        Math.floor(((sample.x - xMin) / xRange) * gridSize)
      );
      const yIdx = Math.min(
        gridSize - 1,
        Math.floor(((sample.y - yMin) / yRange) * gridSize)
      );

      if (xIdx >= 0 && yIdx >= 0) {
        // Weight by variance (higher variance = higher risk)
        riskDensity[yIdx][xIdx] += sample.variance / samples.length;
      }
    }

    // Normalize to [0, 1]
    const maxRisk = Math.max(...riskDensity.flat());
    if (maxRisk > 0) {
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          riskDensity[i][j] /= maxRisk;
        }
      }
    }

    return riskDensity;
  }, []);

  // ============================================================================
  // COMPUTE DISTRIBUTION
  // ============================================================================

  const computeDistribution = useCallback(async () => {
    if (gpsPoints.length === 0) {
      setDistribution(null);
      return;
    }

    setIsComputing(true);
    setProgress(0);

    try {
      // Sample all points
      let allSamples: MonteCarloSample[] = [];
      
      for (let i = 0; i < gpsPoints.length; i++) {
        const pointSamples = sampler(
          gpsPoints[i],
          fullConfig.noiseModel,
          fullConfig.iterations
        );
        allSamples = allSamples.concat(pointSamples);
        setProgress((i / gpsPoints.length) * 50);
      }

      // Propagate through time
      const propagated = propagator(allSamples, fullConfig.timeSlices);
      setProgress(70);

      // Reduce to percentiles
      const { p50, p90, p95 } = reducer(propagated);
      setProgress(85);

      // Score risk density
      const riskDensity = scorer(propagated);
      setProgress(95);

      // Calculate confidence volume
      const xCoords = propagated.map(s => s.x);
      const yCoords = propagated.map(s => s.y);
      const zCoords = propagated.map(s => s.z);

      const centerX = xCoords.reduce((a, b) => a + b, 0) / xCoords.length;
      const centerY = yCoords.reduce((a, b) => a + b, 0) / yCoords.length;
      const centerZ = zCoords.reduce((a, b) => a + b, 0) / zCoords.length;

      const radiusX = Math.sqrt(
        xCoords.reduce((sum, x) => sum + Math.pow(x - centerX, 2), 0) / xCoords.length
      );
      const radiusY = Math.sqrt(
        yCoords.reduce((sum, y) => sum + Math.pow(y - centerY, 2), 0) / yCoords.length
      );
      const radiusZ = Math.sqrt(
        zCoords.reduce((sum, z) => sum + Math.pow(z - centerZ, 2), 0) / zCoords.length
      );

      const finalDistribution: MonteCarloDistribution = {
        samples: propagated,
        p50: p50.map(normalizeSampleToCanvas),
        p90: p90.map(normalizeSampleToCanvas),
        p95: p95.map(normalizeSampleToCanvas),
        riskDensity,
        confidenceVolume: {
          center: [centerX, centerY, centerZ],
          radiusX,
          radiusY,
          radiusZ,
        },
      };

      setDistribution(finalDistribution);
      setProgress(100);
    } catch (error) {
      console.error('Monte Carlo computation error:', error);
      setDistribution(null);
    } finally {
      setIsComputing(false);
    }
  }, [gpsPoints, fullConfig, sampler, propagator, reducer, scorer]);

  // ============================================================================
  // HELPERS
  // ============================================================================

  const gaussianRandom = (): number => {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const exponentialRandom = (): number => {
    return -Math.log(1 - Math.random());
  };

  const normalizeSampleToCanvas = (sample: MonteCarloSample): MonteCarloSample => {
    // Normalize to canvas coordinates (0-800 x 0-600)
    // This is a simple projection - in production would use proper map projection
    return {
      ...sample,
      x: ((sample.x + 180) / 360) * 800,
      y: ((90 - sample.y) / 180) * 600,
    };
  };

  // ============================================================================
  // EFFECTS
  // ============================================================================

  useEffect(() => {
    computeDistribution();
  }, [computeDistribution]);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    distribution,
    isComputing,
    progress,
    recompute: computeDistribution,
    config: fullConfig,
  };
}

export default useMonteCarloSimulation;
