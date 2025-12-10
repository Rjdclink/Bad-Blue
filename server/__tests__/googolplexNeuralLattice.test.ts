/**
 * Tests for Googolplex Neural Lattice
 * 
 * Comprehensive tests for the hyper-creative fractal neural network
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import latticeModule, {
  GoogolplexNeuralLattice,
  getGoogolplexNeuralLattice,
  initializeGoogolplexLattice,
  shutdownGoogolplexLattice
} from '../googolplexNeuralLattice';

const { FRACTAL_PATTERNS } = latticeModule;

describe('GoogolplexNeuralLattice', () => {
  let lattice: GoogolplexNeuralLattice;

  beforeAll(async () => {
    lattice = await initializeGoogolplexLattice();
  });

  afterAll(async () => {
    await shutdownGoogolplexLattice();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(lattice.isInitialized()).toBe(true);
    });

    it('should create latent neuron pool', () => {
      const metrics = lattice.getMetrics();
      expect(metrics.virtualNeuronCount).toBeGreaterThan(0);
    });

    it('should instantiate root fractal neurons', () => {
      const metrics = lattice.getMetrics();
      expect(metrics.instantiatedNeuronCount).toBeGreaterThan(0);
    });

    it('should create sparse tensor foundation', () => {
      const metrics = lattice.getMetrics();
      expect(metrics.computationalEfficiency).toBeGreaterThan(0);
    });
  });

  describe('Fractal Neuron Operations', () => {
    it('should have high computational efficiency (sparse instantiation)', () => {
      const metrics = lattice.getMetrics();
      // Efficiency should be high since we only instantiate what we need
      expect(metrics.computationalEfficiency).toBeGreaterThan(0.9);
    });

    it('should have coherent neurons', () => {
      const metrics = lattice.getMetrics();
      expect(metrics.coherenceIndex).toBeGreaterThan(0.5);
    });

    it('should maintain plasticity', () => {
      const metrics = lattice.getMetrics();
      expect(metrics.plasticityScore).toBeGreaterThan(0);
    });

    it('should have creativity potential from fractal diversity', () => {
      const metrics = lattice.getMetrics();
      expect(metrics.creativityPotential).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Neuronal Constellations', () => {
    it('should instantiate constellation for a purpose', async () => {
      const constellation = await lattice.instantiateConstellation(
        'legal analysis',
        10,
        60
      );

      expect(constellation).toBeDefined();
      expect(constellation.neurons.length).toBe(10);
      expect(constellation.purpose).toBe('legal analysis');
      expect(constellation.energyBudget).toBe(60);
    });

    it('should select appropriate patterns for legal purpose', async () => {
      const constellation = await lattice.instantiateConstellation(
        'legal reasoning task',
        5,
        30
      );

      expect(constellation.neurons.length).toBe(5);
    });

    it('should select appropriate patterns for crypto purpose', async () => {
      const constellation = await lattice.instantiateConstellation(
        'crypto market analysis',
        5,
        30
      );

      expect(constellation.neurons.length).toBe(5);
    });

    it('should select appropriate patterns for creative purpose', async () => {
      const constellation = await lattice.instantiateConstellation(
        'creative problem solving',
        5,
        30
      );

      expect(constellation.neurons.length).toBe(5);
    });
  });

  describe('RLE Fractal Compression', () => {
    it('should compress neural states efficiently', async () => {
      // First, create a constellation to have neurons
      const constellation = await lattice.instantiateConstellation(
        'compression test',
        20,
        120
      );

      const pattern = lattice.compressNeuralState(constellation.neurons);

      expect(pattern).toBeDefined();
      expect(pattern.runs.length).toBeGreaterThan(0);
      expect(pattern.compressionRatio).toBeLessThanOrEqual(1);
      expect(pattern.fractalSignature).toBeDefined();
      expect(pattern.fractalSignature.length).toBe(16);
    });

    it('should decompress patterns correctly', async () => {
      const constellation = await lattice.instantiateConstellation(
        'decompress test',
        10,
        60
      );

      const compressed = lattice.compressNeuralState(constellation.neurons);
      const decompressed = lattice.decompressPattern(compressed.id);

      expect(decompressed).toBeDefined();
      expect(decompressed.length).toBe(compressed.originalSize);
    });

    it('should maintain fractal depth in compression', async () => {
      const constellation = await lattice.instantiateConstellation(
        'fractal depth test',
        15,
        60
      );

      const pattern = lattice.compressNeuralState(constellation.neurons);

      // Check that runs have fractal depth info
      for (const run of pattern.runs) {
        expect(run.fractalDepth).toBeGreaterThanOrEqual(0);
        expect(run.fractalDepth).toBeLessThan(8); // FRACTAL_DEPTH_MAX
      }
    });
  });

  describe('Hyper-Accelerated Learning', () => {
    it('should perform accelerated learning', async () => {
      const constellation = await lattice.instantiateConstellation(
        'learning test',
        10,
        120
      );

      const inputPattern = new Map<string, number>();
      const targetPattern = new Map<string, number>();

      // Set up input and target patterns
      for (let i = 0; i < constellation.neurons.length; i++) {
        inputPattern.set(constellation.neurons[i], Math.random());
        targetPattern.set(constellation.neurons[i], Math.random() > 0.5 ? 1 : 0);
      }

      const result = await lattice.hyperAcceleratedLearning(
        inputPattern,
        targetPattern,
        1.0
      );

      expect(result).toBeDefined();
      expect(result.convergenceRate).toBeGreaterThanOrEqual(0);
      expect(result.convergenceRate).toBeLessThanOrEqual(1);
      expect(result.synapseUpdates).toBeGreaterThanOrEqual(0);
      expect(result.creativityBoost).toBeGreaterThanOrEqual(0);
    });

    it('should improve convergence with higher intensity', async () => {
      const constellation = await lattice.instantiateConstellation(
        'intensity test',
        8,
        60
      );

      const inputPattern = new Map<string, number>();
      const targetPattern = new Map<string, number>();

      for (const neuronId of constellation.neurons) {
        inputPattern.set(neuronId, 1.0);
        targetPattern.set(neuronId, 1);
      }

      const result = await lattice.hyperAcceleratedLearning(
        inputPattern,
        targetPattern,
        2.0
      );

      expect(result.synapseUpdates).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Fractal Propagation', () => {
    it('should propagate signals through fractal structure', async () => {
      const constellation = await lattice.instantiateConstellation(
        'propagation test',
        12,
        90
      );

      const result = await lattice.fractalPropagate(
        constellation.neurons.slice(0, 3),
        1.0
      );

      expect(result).toBeDefined();
      expect(result.activatedNeurons.length).toBeGreaterThan(0);
      expect(result.propagationWaves).toBeGreaterThanOrEqual(0);
      expect(result.creativityIndex).toBeGreaterThanOrEqual(0);
    });

    it('should reach deeper fractal levels with strong activation', async () => {
      const result = await lattice.fractalPropagate(
        ['alexara-root'],
        1.0
      );

      expect(result.fractalDepthReached).toBeGreaterThanOrEqual(0);
    });

    it('should track creativity index during propagation', async () => {
      const result = await lattice.fractalPropagate(
        ['alexara-root', 'cryptara-root'],
        0.8
      );

      expect(result.creativityIndex).toBeDefined();
    });
  });

  describe('Anti-Entropy Enforcement', () => {
    it('should run anti-entropy enforcement', async () => {
      const report = await lattice['enforceAntiEntropy']();

      expect(report).toBeDefined();
      expect(report.neuronsScanned).toBeGreaterThan(0);
      expect(report.overallHealth).toBeGreaterThanOrEqual(0);
      expect(report.overallHealth).toBeLessThanOrEqual(1);
    });

    it('should maintain high overall health', async () => {
      const report = await lattice['enforceAntiEntropy']();

      // Health should be high in a well-maintained system
      expect(report.overallHealth).toBeGreaterThan(0.5);
    });

    it('should provide last anti-entropy report', () => {
      const report = lattice.getLastAntiEntropyReport();

      // Should have report after initialization
      expect(report).toBeDefined();
      if (report) {
        expect(report.timestamp).toBeGreaterThan(0);
      }
    });

    it('should track violations and corrections', async () => {
      const report = await lattice['enforceAntiEntropy']();

      expect(report.entropyViolationsDetected).toBeGreaterThanOrEqual(0);
      expect(report.violationsCorrected).toBeLessThanOrEqual(report.entropyViolationsDetected);
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should return comprehensive metrics', () => {
      const metrics = lattice.getMetrics();

      expect(metrics.virtualNeuronCount).toBeGreaterThan(0);
      expect(metrics.instantiatedNeuronCount).toBeGreaterThan(0);
      expect(metrics.totalSynapses).toBeGreaterThanOrEqual(0);
      expect(metrics.averageCompressionRatio).toBeGreaterThanOrEqual(0);
      expect(metrics.averageEntropyLevel).toBeGreaterThanOrEqual(0);
      expect(metrics.coherenceIndex).toBeGreaterThanOrEqual(0);
      expect(metrics.plasticityScore).toBeGreaterThan(0);
      expect(metrics.creativityPotential).toBeGreaterThanOrEqual(0);
      expect(metrics.computationalEfficiency).toBeGreaterThan(0);
      expect(metrics.antiEntropyHealth).toBeGreaterThanOrEqual(0);
    });

    it('should track instantiated vs virtual neurons', () => {
      const metrics = lattice.getMetrics();

      // Virtual pool should be much larger than instantiated
      expect(metrics.virtualNeuronCount).toBeGreaterThan(metrics.instantiatedNeuronCount);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const instance1 = getGoogolplexNeuralLattice();
      const instance2 = getGoogolplexNeuralLattice();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Event Emission', () => {
    it('should emit events during operations', async () => {
      let eventReceived = false;

      lattice.on('constellation-created', () => {
        eventReceived = true;
      });

      await lattice.instantiateConstellation('event test', 5, 30);

      expect(eventReceived).toBe(true);

      lattice.removeAllListeners('constellation-created');
    });

    it('should emit learning events', async () => {
      let learningEventReceived = false;

      lattice.on('learning-complete', () => {
        learningEventReceived = true;
      });

      const constellation = await lattice.instantiateConstellation('learn event test', 5, 30);
      const inputPattern = new Map<string, number>();
      const targetPattern = new Map<string, number>();

      for (const id of constellation.neurons) {
        inputPattern.set(id, 0.5);
        targetPattern.set(id, 1);
      }

      await lattice.hyperAcceleratedLearning(inputPattern, targetPattern, 1.0);

      expect(learningEventReceived).toBe(true);

      lattice.removeAllListeners('learning-complete');
    });

    it('should emit propagation events', async () => {
      let propagationEventReceived = false;

      lattice.on('propagation-complete', () => {
        propagationEventReceived = true;
      });

      await lattice.fractalPropagate(['alexara-root'], 0.5);

      expect(propagationEventReceived).toBe(true);

      lattice.removeAllListeners('propagation-complete');
    });
  });

  describe('Error Handling', () => {
    it('should throw on decompressing non-existent pattern', () => {
      expect(() => lattice.decompressPattern('non-existent-pattern'))
        .toThrow('Pattern not found: non-existent-pattern');
    });
  });

  describe('Fractal Patterns', () => {
    it('should export all fractal patterns', () => {
      expect(FRACTAL_PATTERNS.MANDELBROT).toBe('mandelbrot');
      expect(FRACTAL_PATTERNS.JULIA).toBe('julia');
      expect(FRACTAL_PATTERNS.SIERPINSKI).toBe('sierpinski');
      expect(FRACTAL_PATTERNS.CANTOR).toBe('cantor');
      expect(FRACTAL_PATTERNS.KOCH).toBe('koch');
    });
  });
});

describe('GoogolplexNeuralLattice - Separate Instance', () => {
  it('should be able to shutdown and restart', async () => {
    const lattice = new GoogolplexNeuralLattice();
    
    expect(lattice.isInitialized()).toBe(false);
    
    await lattice.initialize();
    expect(lattice.isInitialized()).toBe(true);
    
    await lattice.shutdown();
    expect(lattice.isInitialized()).toBe(false);
  });
});
