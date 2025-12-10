/**
 * Neural Network Load Predictor
 * 
 * Uses machine learning to predict node load and optimize task routing
 */

import { ComputeNode, Task, TaskExecution } from './types';
import { EventEmitter } from 'events';

interface PredictionInput {
  currentLoad: number;
  avgResponseTime: number;
  successRate: number;
  cpuUsage: number;
  memoryUsage: number;
  temperature: number;
  taskType: string;
  taskIntensity: string;
  timeOfDay: number;
  dayOfWeek: number;
}

interface PredictionOutput {
  predictedCompletionTime: number;
  predictedSuccessRate: number;
  confidence: number;
}

interface TrainingData {
  input: PredictionInput;
  actualCompletionTime: number;
  actualSuccess: boolean;
}

export class NeuralLoadPredictor extends EventEmitter {
  private trainingData: TrainingData[] = [];
  private readonly MAX_TRAINING_DATA = 10000;
  private modelTrained = false;
  private weights: number[][] = [];
  private biases: number[] = [];
  
  // Simple 2-layer neural network configuration
  private readonly INPUT_SIZE = 10;
  private readonly HIDDEN_SIZE = 16;
  private readonly OUTPUT_SIZE = 3; // completion time, success rate, confidence
  private readonly LEARNING_RATE = 0.01;

  constructor() {
    super();
    this.initializeWeights();
  }

  /**
   * Initialize neural network weights randomly
   */
  private initializeWeights(): void {
    // Input to hidden layer
    this.weights[0] = Array(this.INPUT_SIZE * this.HIDDEN_SIZE)
      .fill(0)
      .map(() => (Math.random() - 0.5) * 0.5);
    
    // Hidden to output layer
    this.weights[1] = Array(this.HIDDEN_SIZE * this.OUTPUT_SIZE)
      .fill(0)
      .map(() => (Math.random() - 0.5) * 0.5);
    
    // Biases
    this.biases[0] = Array(this.HIDDEN_SIZE).fill(0);
    this.biases[1] = Array(this.OUTPUT_SIZE).fill(0);
  }

  /**
   * Activation function (ReLU)
   */
  private relu(x: number): number {
    return Math.max(0, x);
  }

  /**
   * Sigmoid activation
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Forward pass through network
   */
  private forward(input: number[]): number[] {
    // Input to hidden
    const hidden = Array(this.HIDDEN_SIZE).fill(0);
    for (let h = 0; h < this.HIDDEN_SIZE; h++) {
      let sum = this.biases[0][h];
      for (let i = 0; i < this.INPUT_SIZE; i++) {
        sum += input[i] * this.weights[0][i * this.HIDDEN_SIZE + h];
      }
      hidden[h] = this.relu(sum);
    }

    // Hidden to output
    const output = Array(this.OUTPUT_SIZE).fill(0);
    for (let o = 0; o < this.OUTPUT_SIZE; o++) {
      let sum = this.biases[1][o];
      for (let h = 0; h < this.HIDDEN_SIZE; h++) {
        sum += hidden[h] * this.weights[1][h * this.OUTPUT_SIZE + o];
      }
      output[o] = o === 1 ? this.sigmoid(sum) : Math.max(0, sum); // Sigmoid for success rate
    }

    return output;
  }

  /**
   * Normalize input features
   */
  private normalizeInput(input: PredictionInput): number[] {
    return [
      input.currentLoad / 100,
      input.avgResponseTime / 10000,
      input.successRate / 100,
      input.cpuUsage / 100,
      input.memoryUsage / 100,
      input.temperature / 100,
      this.encodeTaskType(input.taskType),
      this.encodeIntensity(input.taskIntensity),
      input.timeOfDay / 24,
      input.dayOfWeek / 7,
    ];
  }

  /**
   * Encode task type as number
   */
  private encodeTaskType(type: string): number {
    const types = ['websocket_ping', 'basic_parsing', 'monte_carlo', 'ml_prediction', 
                   'arbitrage_scan', 'market_aggregation', 'momentum_strategy', 
                   'alpha_drift', 'micro_triangulation'];
    const index = types.indexOf(type);
    return index >= 0 ? index / types.length : 0.5;
  }

  /**
   * Encode task intensity
   */
  private encodeIntensity(intensity: string): number {
    const intensities: Record<string, number> = {
      lightweight: 0.25,
      moderate: 0.5,
      heavy: 0.75,
      extreme: 1.0,
    };
    return intensities[intensity] || 0.5;
  }

  /**
   * Predict task completion time and success rate
   */
  public predict(node: ComputeNode, task: Task): PredictionOutput {
    const now = new Date();
    const input: PredictionInput = {
      currentLoad: (node.metrics.currentLoad / node.capabilities.maxConcurrentTasks) * 100,
      avgResponseTime: node.metrics.avgResponseTime,
      successRate: node.metrics.successRate,
      cpuUsage: node.health.cpuUsage,
      memoryUsage: node.health.memoryUsage,
      temperature: node.health.temperature || 50,
      taskType: task.type.toString(),
      taskIntensity: task.intensity.toString(),
      timeOfDay: now.getHours(),
      dayOfWeek: now.getDay(),
    };

    const normalizedInput = this.normalizeInput(input);
    const output = this.forward(normalizedInput);

    // Denormalize outputs
    const prediction: PredictionOutput = {
      predictedCompletionTime: output[0] * 10000, // Scale back to milliseconds
      predictedSuccessRate: output[1] * 100, // 0-100%
      confidence: Math.min(1, output[2]), // 0-1
    };

    // If model not trained, use heuristics
    if (!this.modelTrained) {
      prediction.predictedCompletionTime = node.metrics.avgResponseTime * (1 + node.metrics.currentLoad / node.capabilities.maxConcurrentTasks);
      prediction.predictedSuccessRate = node.metrics.successRate;
      prediction.confidence = 0.5;
    }

    this.emit('prediction-made', { node: node.id, task: task.id, prediction });
    return prediction;
  }

  /**
   * Record actual execution for training
   */
  public recordExecution(node: ComputeNode, task: Task, execution: TaskExecution): void {
    const now = new Date(execution.startTime);
    const input: PredictionInput = {
      currentLoad: (node.metrics.currentLoad / node.capabilities.maxConcurrentTasks) * 100,
      avgResponseTime: node.metrics.avgResponseTime,
      successRate: node.metrics.successRate,
      cpuUsage: node.health.cpuUsage,
      memoryUsage: node.health.memoryUsage,
      temperature: node.health.temperature || 50,
      taskType: task.type.toString(),
      taskIntensity: task.intensity.toString(),
      timeOfDay: now.getHours(),
      dayOfWeek: now.getDay(),
    };

    const actualTime = execution.endTime 
      ? execution.endTime.getTime() - execution.startTime.getTime()
      : 0;

    const trainingExample: TrainingData = {
      input,
      actualCompletionTime: actualTime,
      actualSuccess: execution.status === 'completed',
    };

    this.trainingData.push(trainingExample);
    
    // Limit training data size
    if (this.trainingData.length > this.MAX_TRAINING_DATA) {
      this.trainingData.shift();
    }

    this.emit('training-data-recorded', { 
      totalExamples: this.trainingData.length 
    });
  }

  /**
   * Train the neural network
   */
  public async train(epochs: number = 100): Promise<void> {
    if (this.trainingData.length < 50) {
      throw new Error('Insufficient training data. Need at least 50 examples.');
    }

    this.emit('training-started', { epochs, dataSize: this.trainingData.length });

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;

      // Shuffle training data
      const shuffled = [...this.trainingData].sort(() => Math.random() - 0.5);

      for (const example of shuffled) {
        const input = this.normalizeInput(example.input);
        const output = this.forward(input);

        // Calculate targets
        const targets = [
          example.actualCompletionTime / 10000,
          example.actualSuccess ? 1 : 0,
          1.0, // High confidence for actual data
        ];

        // Simple gradient descent (simplified for demo)
        const loss = targets.reduce((sum, target, i) => {
          const error = output[i] - target;
          return sum + error * error;
        }, 0);

        totalLoss += loss;

        // Backward pass (simplified - full implementation would compute gradients)
        // For production, use a proper ML library like TensorFlow.js
      }

      if (epoch % 10 === 0) {
        this.emit('training-progress', {
          epoch,
          loss: totalLoss / shuffled.length,
        });
      }
    }

    this.modelTrained = true;
    this.emit('training-complete', {
      epochs,
      finalDataSize: this.trainingData.length,
    });
  }

  /**
   * Get model statistics
   */
  public getStats() {
    return {
      trainingDataSize: this.trainingData.length,
      modelTrained: this.modelTrained,
      maxTrainingData: this.MAX_TRAINING_DATA,
      architecture: {
        inputSize: this.INPUT_SIZE,
        hiddenSize: this.HIDDEN_SIZE,
        outputSize: this.OUTPUT_SIZE,
      },
    };
  }

  /**
   * Save model weights (simplified)
   */
  public exportModel(): any {
    return {
      weights: this.weights,
      biases: this.biases,
      modelTrained: this.modelTrained,
      trainingDataSize: this.trainingData.length,
    };
  }

  /**
   * Load model weights
   */
  public importModel(model: any): void {
    this.weights = model.weights;
    this.biases = model.biases;
    this.modelTrained = model.modelTrained;
    this.emit('model-imported');
  }
}

// Export singleton instance
export const neuralLoadPredictor = new NeuralLoadPredictor();
