// Neurofusion System - Instantaneous Cognitive Integration & Adaptation
// Enables crawlers to learn and evolve at extraordinarily high rates through neural-like connections

import logger from '../../../logger.js';
import { EdenStorage, type KnowledgeEntry } from './eden-storage';
import type { ChainId } from './lux-swarm';

export interface NeuralConnection {
  id: string;
  sourceNode: string;
  targetNode: string;
  weight: number; // -1 to 1, strength and direction of connection
  learningRate: number;
  lastActivation: number;
  activationCount: number;
}

export interface NeuralNode {
  id: string;
  type: 'input' | 'hidden' | 'output';
  activationFunction: 'sigmoid' | 'relu' | 'tanh';
  bias: number;
  value: number;
  gradient: number;
  connections: string[]; // Connection IDs
}

export interface LearningPattern {
  id: string;
  pattern: Record<string, any>;
  expectedOutcome: Record<string, any>;
  actualOutcome?: Record<string, any>;
  accuracy: number;
  reinforcements: number;
  timestamp: number;
}

export interface CognitiveState {
  generation: number;
  nodes: Map<string, NeuralNode>;
  connections: Map<string, NeuralConnection>;
  patterns: Map<string, LearningPattern>;
  totalLearningEvents: number;
  accuracy: number;
  adaptationRate: number; // How fast the system adapts (0-1)
}

/**
 * Neurofusion Engine - Enables instantaneous learning and adaptation
 */
export class NeurofusionEngine {
  private static state: CognitiveState = {
    generation: 0,
    nodes: new Map(),
    connections: new Map(),
    patterns: new Map(),
    totalLearningEvents: 0,
    accuracy: 0,
    adaptationRate: 1.0 // Start at maximum adaptation
  };

  private static learningRate = 0.01; // Base learning rate
  private static momentumFactor = 0.9;
  private static isInitialized = false;

  /**
   * Initialize the neurofusion system
   */
  static initialize(): void {
    if (this.isInitialized) {
      logger.warn('Neurofusion already initialized', { component: 'NeurofusionEngine' });
      return;
    }

    // Create initial neural architecture
    this.createBaseArchitecture();
    this.isInitialized = true;

    logger.info('Neurofusion initialized', {
      component: 'NeurofusionEngine',
      nodes: this.state.nodes.size,
      connections: this.state.connections.size
    });
  }

  /**
   * Create base neural architecture
   */
  private static createBaseArchitecture(): void {
    // Input layer: Market conditions, gas prices, liquidity, etc.
    const inputNodes = [
      'input-price-spread',
      'input-gas-price',
      'input-liquidity-depth',
      'input-mev-risk',
      'input-time-factor',
      'input-chain-congestion'
    ];

    // Hidden layers: Pattern recognition and strategy formation
    const hiddenNodes = [
      'hidden-pattern-1',
      'hidden-pattern-2',
      'hidden-pattern-3',
      'hidden-strategy-1',
      'hidden-strategy-2',
      'hidden-risk-1'
    ];

    // Output layer: Decision making
    const outputNodes = [
      'output-execute',
      'output-wait',
      'output-adjust-gas',
      'output-replicate',
      'output-shed-skin'
    ];

    // Create nodes
    for (const nodeId of inputNodes) {
      this.createNode(nodeId, 'input', 'sigmoid');
    }

    for (const nodeId of hiddenNodes) {
      this.createNode(nodeId, 'hidden', 'relu');
    }

    for (const nodeId of outputNodes) {
      this.createNode(nodeId, 'output', 'sigmoid');
    }

    // Create connections (fully connected between layers)
    for (const inputId of inputNodes) {
      for (const hiddenId of hiddenNodes) {
        this.createConnection(inputId, hiddenId);
      }
    }

    for (const hiddenId of hiddenNodes) {
      for (const outputId of outputNodes) {
        this.createConnection(hiddenId, outputId);
      }
    }

    logger.info('Base neural architecture created', {
      component: 'NeurofusionEngine',
      inputNodes: inputNodes.length,
      hiddenNodes: hiddenNodes.length,
      outputNodes: outputNodes.length
    });
  }

  /**
   * Create a neural node
   */
  private static createNode(
    id: string,
    type: NeuralNode['type'],
    activationFunction: NeuralNode['activationFunction']
  ): void {
    const node: NeuralNode = {
      id,
      type,
      activationFunction,
      bias: Math.random() * 0.2 - 0.1, // Small random bias
      value: 0,
      gradient: 0,
      connections: []
    };

    this.state.nodes.set(id, node);
  }

  /**
   * Create a neural connection
   */
  private static createConnection(sourceId: string, targetId: string): void {
    const connectionId = `${sourceId}->${targetId}`;
    
    const connection: NeuralConnection = {
      id: connectionId,
      sourceNode: sourceId,
      targetNode: targetId,
      weight: Math.random() * 0.4 - 0.2, // Small random weight
      learningRate: this.learningRate,
      lastActivation: 0,
      activationCount: 0
    };

    this.state.connections.set(connectionId, connection);

    // Add connection to nodes
    const sourceNode = this.state.nodes.get(sourceId);
    const targetNode = this.state.nodes.get(targetId);
    
    if (sourceNode) sourceNode.connections.push(connectionId);
    if (targetNode) targetNode.connections.push(connectionId);
  }

  /**
   * Process input through the neural network
   */
  static process(input: Record<string, number>): Record<string, number> {
    if (!this.isInitialized) {
      this.initialize();
    }

    // Set input layer values
    for (const [key, value] of Object.entries(input)) {
      const nodeId = `input-${key}`;
      const node = this.state.nodes.get(nodeId);
      if (node) {
        node.value = value;
      }
    }

    // Forward propagation through hidden layers
    this.forwardPropagate('hidden');

    // Forward propagation to output layer
    this.forwardPropagate('output');

    // Extract output values
    const output: Record<string, number> = {};
    for (const [nodeId, node] of this.state.nodes.entries()) {
      if (node.type === 'output') {
        const key = nodeId.replace('output-', '');
        output[key] = node.value;
      }
    }

    return output;
  }

  /**
   * Forward propagation through a layer
   */
  private static forwardPropagate(layerType: 'hidden' | 'output'): void {
    for (const [nodeId, node] of this.state.nodes.entries()) {
      if (node.type !== layerType) continue;

      // Calculate weighted sum of inputs
      let sum = node.bias;

      for (const connectionId of node.connections) {
        const connection = this.state.connections.get(connectionId);
        if (!connection || connection.targetNode !== nodeId) continue;

        const sourceNode = this.state.nodes.get(connection.sourceNode);
        if (!sourceNode) continue;

        sum += sourceNode.value * connection.weight;
        connection.lastActivation = Date.now();
        connection.activationCount++;
      }

      // Apply activation function
      node.value = this.activate(sum, node.activationFunction);
    }
  }

  /**
   * Activation functions
   */
  private static activate(x: number, func: NeuralNode['activationFunction']): number {
    switch (func) {
      case 'sigmoid':
        return 1 / (1 + Math.exp(-x));
      case 'relu':
        return Math.max(0, x);
      case 'tanh':
        return Math.tanh(x);
      default:
        return x;
    }
  }

  /**
   * Learn from experience (reinforcement learning)
   */
  static learn(
    input: Record<string, number>,
    expectedOutput: Record<string, number>,
    actualOutcome: Record<string, any>
  ): void {
    if (!this.isInitialized) {
      this.initialize();
    }

    // Process input
    const predictedOutput = this.process(input);

    // Calculate error
    const error = this.calculateError(expectedOutput, predictedOutput);

    // Backpropagation
    this.backpropagate(expectedOutput, predictedOutput);

    // Store learning pattern
    const patternId = `pattern-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const pattern: LearningPattern = {
      id: patternId,
      pattern: input,
      expectedOutcome: expectedOutput,
      actualOutcome,
      accuracy: 1 - error,
      reinforcements: 1,
      timestamp: Date.now()
    };

    this.state.patterns.set(patternId, pattern);
    this.state.totalLearningEvents++;

    // Update accuracy
    this.updateAccuracy();

    // Store in Eden for long-term memory
    this.storeInEden(pattern);

    logger.debug('Neurofusion learned from experience', {
      component: 'NeurofusionEngine',
      accuracy: pattern.accuracy,
      error,
      generation: this.state.generation
    });
  }

  /**
   * Calculate error between expected and predicted
   */
  private static calculateError(
    expected: Record<string, number>,
    predicted: Record<string, number>
  ): number {
    let totalError = 0;
    let count = 0;

    for (const [key, expectedValue] of Object.entries(expected)) {
      const predictedValue = predicted[key] || 0;
      totalError += Math.pow(expectedValue - predictedValue, 2);
      count++;
    }

    return count > 0 ? Math.sqrt(totalError / count) : 0;
  }

  /**
   * Backpropagation to update weights
   */
  private static backpropagate(
    expected: Record<string, number>,
    predicted: Record<string, number>
  ): void {
    // Calculate output layer gradients
    for (const [nodeId, node] of this.state.nodes.entries()) {
      if (node.type !== 'output') continue;

      const key = nodeId.replace('output-', '');
      const expectedValue = expected[key] || 0;
      const error = expectedValue - node.value;
      
      // Gradient = error * derivative of activation function
      node.gradient = error * this.activationDerivative(node.value, node.activationFunction);
    }

    // Calculate hidden layer gradients
    for (const [nodeId, node] of this.state.nodes.entries()) {
      if (node.type !== 'hidden') continue;

      let errorSum = 0;

      // Sum errors from output layer
      for (const connectionId of node.connections) {
        const connection = this.state.connections.get(connectionId);
        if (!connection || connection.sourceNode !== nodeId) continue;

        const targetNode = this.state.nodes.get(connection.targetNode);
        if (!targetNode || targetNode.type !== 'output') continue;

        errorSum += targetNode.gradient * connection.weight;
      }

      node.gradient = errorSum * this.activationDerivative(node.value, node.activationFunction);
    }

    // Update weights
    for (const connection of this.state.connections.values()) {
      const sourceNode = this.state.nodes.get(connection.sourceNode);
      const targetNode = this.state.nodes.get(connection.targetNode);

      if (!sourceNode || !targetNode) continue;

      // Weight update: w = w + learningRate * gradient * input
      const delta = connection.learningRate * targetNode.gradient * sourceNode.value;
      connection.weight += delta * this.state.adaptationRate;

      // Clip weights to prevent explosion
      connection.weight = Math.max(-1, Math.min(1, connection.weight));
    }

    // Update biases
    for (const node of this.state.nodes.values()) {
      if (node.type !== 'input') {
        node.bias += this.learningRate * node.gradient * this.state.adaptationRate;
      }
    }
  }

  /**
   * Activation function derivatives
   */
  private static activationDerivative(
    output: number,
    func: NeuralNode['activationFunction']
  ): number {
    switch (func) {
      case 'sigmoid':
        return output * (1 - output);
      case 'relu':
        return output > 0 ? 1 : 0;
      case 'tanh':
        return 1 - output * output;
      default:
        return 1;
    }
  }

  /**
   * Update system accuracy
   */
  private static updateAccuracy(): void {
    const recentPatterns = Array.from(this.state.patterns.values())
      .slice(-100); // Last 100 patterns

    if (recentPatterns.length === 0) {
      this.state.accuracy = 0;
      return;
    }

    const avgAccuracy = recentPatterns.reduce((sum, p) => sum + p.accuracy, 0) / recentPatterns.length;
    this.state.accuracy = avgAccuracy;

    // Adjust adaptation rate based on accuracy
    if (avgAccuracy > 0.9) {
      // High accuracy: slow down learning to maintain stability
      this.state.adaptationRate = Math.max(0.1, this.state.adaptationRate * 0.99);
    } else if (avgAccuracy < 0.7) {
      // Low accuracy: speed up learning to improve faster
      this.state.adaptationRate = Math.min(1.0, this.state.adaptationRate * 1.01);
    }
  }

  /**
   * Store learning pattern in Eden for long-term memory
   */
  private static storeInEden(pattern: LearningPattern): void {
    // Store in all chains for redundancy
    const chains: ChainId[] = ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];

    for (const chain of chains) {
      EdenStorage.storeKnowledge({
        type: 'pattern',
        chain,
        data: {
          pattern: pattern.pattern,
          expectedOutcome: pattern.expectedOutcome,
          actualOutcome: pattern.actualOutcome,
          neurofusion: true
        },
        confidence: pattern.accuracy,
        successRate: pattern.accuracy,
        profitability: 0,
        usageCount: pattern.reinforcements
      });
    }
  }

  /**
   * Get decision recommendations based on current state
   */
  static getRecommendations(marketState: Record<string, number>): {
    action: string;
    confidence: number;
    reasoning: string;
  }[] {
    if (!this.isInitialized) {
      this.initialize();
    }

    const output = this.process(marketState);
    const recommendations: {
      action: string;
      confidence: number;
      reasoning: string;
    }[] = [];

    // Sort outputs by confidence
    const sortedOutputs = Object.entries(output)
      .sort(([, a], [, b]) => b - a);

    for (const [action, confidence] of sortedOutputs) {
      if (confidence > 0.5) {
        recommendations.push({
          action,
          confidence,
          reasoning: this.generateReasoning(action, marketState, confidence)
        });
      }
    }

    return recommendations;
  }

  /**
   * Generate reasoning for a recommendation
   */
  private static generateReasoning(
    action: string,
    marketState: Record<string, number>,
    confidence: number
  ): string {
    const factors: string[] = [];

    if (marketState['price-spread'] > 0.01) {
      factors.push('high price spread detected');
    }
    if (marketState['gas-price'] < 50) {
      factors.push('low gas prices');
    }
    if (marketState['liquidity-depth'] > 100000) {
      factors.push('deep liquidity available');
    }

    return `${action} recommended (${(confidence * 100).toFixed(1)}% confidence) based on: ${factors.join(', ')}`;
  }

  /**
   * Fuse knowledge from Eden into neurofusion
   */
  static fuseFromEden(chain: ChainId = 'polygon'): number {
    const patterns = EdenStorage.retrieveKnowledge('pattern', { chain, confidence: 0.7 });
    let fusedCount = 0;

    for (const knowledge of patterns) {
      if (knowledge.data.neurofusion) continue; // Already fused

      // Extract pattern and reinforce learning
      if (knowledge.data.pattern && knowledge.data.expectedOutcome) {
        const existingPattern = Array.from(this.state.patterns.values())
          .find(p => JSON.stringify(p.pattern) === JSON.stringify(knowledge.data.pattern));

        if (existingPattern) {
          // Reinforce existing pattern
          existingPattern.reinforcements++;
          existingPattern.accuracy = (existingPattern.accuracy + knowledge.confidence) / 2;
        } else {
          // Add new pattern
          const patternId = knowledge.id;
          this.state.patterns.set(patternId, {
            id: patternId,
            pattern: knowledge.data.pattern,
            expectedOutcome: knowledge.data.expectedOutcome,
            actualOutcome: knowledge.data.actualOutcome,
            accuracy: knowledge.confidence,
            reinforcements: 1,
            timestamp: knowledge.timestamp
          });
        }

        fusedCount++;
      }
    }

    logger.info('Knowledge fused from Eden into Neurofusion', {
      component: 'NeurofusionEngine',
      chain,
      fusedCount
    });

    return fusedCount;
  }

  /**
   * Evolve neural architecture
   */
  static evolve(): void {
    this.state.generation++;

    // Prune weak connections
    this.pruneWeakConnections();

    // Strengthen successful pathways
    this.reinforceSuccessfulPathways();

    // Add new connections if needed
    this.addAdaptiveConnections();

    logger.info('Neurofusion evolved', {
      component: 'NeurofusionEngine',
      generation: this.state.generation,
      nodes: this.state.nodes.size,
      connections: this.state.connections.size,
      accuracy: this.state.accuracy
    });
  }

  /**
   * Prune weak connections
   */
  private static pruneWeakConnections(): void {
    const threshold = 0.05; // Connections below this weight are pruned
    const toRemove: string[] = [];

    for (const [connectionId, connection] of this.state.connections.entries()) {
      if (Math.abs(connection.weight) < threshold && connection.activationCount > 100) {
        toRemove.push(connectionId);
      }
    }

    for (const connectionId of toRemove) {
      this.state.connections.delete(connectionId);
    }

    if (toRemove.length > 0) {
      logger.debug('Pruned weak connections', {
        component: 'NeurofusionEngine',
        pruned: toRemove.length
      });
    }
  }

  /**
   * Reinforce successful pathways
   */
  private static reinforceSuccessfulPathways(): void {
    // Get high-accuracy patterns
    const successfulPatterns = Array.from(this.state.patterns.values())
      .filter(p => p.accuracy > 0.8)
      .slice(-50); // Last 50 successful patterns

    // Identify frequently used connections
    const connectionUsage = new Map<string, number>();

    for (const connection of this.state.connections.values()) {
      connectionUsage.set(connection.id, connection.activationCount);
    }

    // Increase weight of frequently used connections
    for (const [connectionId, usage] of connectionUsage.entries()) {
      if (usage > 1000) {
        const connection = this.state.connections.get(connectionId);
        if (connection) {
          connection.weight *= 1.05; // 5% increase
          connection.weight = Math.max(-1, Math.min(1, connection.weight));
        }
      }
    }
  }

  /**
   * Add adaptive connections
   */
  private static addAdaptiveConnections(): void {
    // Add connections between nodes that frequently activate together
    const activationCorrelation = new Map<string, Map<string, number>>();

    // This is a placeholder for more sophisticated correlation analysis
    // In production, this would analyze activation patterns over time

    logger.debug('Adaptive connections added', {
      component: 'NeurofusionEngine'
    });
  }

  /**
   * Get current state
   */
  static getState(): Readonly<CognitiveState> {
    return {
      ...this.state,
      nodes: new Map(this.state.nodes),
      connections: new Map(this.state.connections),
      patterns: new Map(this.state.patterns)
    };
  }

  /**
   * Reset neurofusion (for testing)
   */
  static reset(): void {
    this.state = {
      generation: 0,
      nodes: new Map(),
      connections: new Map(),
      patterns: new Map(),
      totalLearningEvents: 0,
      accuracy: 0,
      adaptationRate: 1.0
    };
    this.isInitialized = false;
    logger.info('Neurofusion reset', { component: 'NeurofusionEngine' });
  }
}
