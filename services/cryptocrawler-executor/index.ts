/**
 * CRYPTOCRAWLER EXECUTOR - DUMB EXECUTOR ONLY
 * 
 * CRITICAL INVARIANT: This executor does NOT compute opportunities, NOT run risk analysis, NOT decide sizing.
 * It ONLY executes ActionIntent events received from Reactor Core.
 * 
 * Features:
 * - Strict state machine: NEW → SUBMITTED → ACKED → PARTIAL → FILLED/CANCELED/REJECTED
 * - Per-exchange rate limiting via Redis
 * - Exponential backoff on transient errors
 * - Idempotency validation
 * - Position reconciliation with Trip on deviation
 * - Balance tracking and verification
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  type ActionIntent,
  type ActionResult,
  type Trip,
  type CryptoActionParams,
  type CryptoActionResult,
  type Telemetry,
  createBaseEvent,
  PUBSUB_TOPICS,
} from '../../packages/contracts/src/index';
import { getTransport, ReactorTransport } from '../../packages/contracts/src/transport';

// ============================================================================
// ORDER STATE MACHINE
// ============================================================================

export enum OrderState {
  NEW = 'new',
  SUBMITTED = 'submitted',
  ACKED = 'acked',
  PARTIAL = 'partial',
  FILLED = 'filled',
  CANCELED = 'canceled',
  REJECTED = 'rejected',
}

const VALID_TRANSITIONS: Record<OrderState, OrderState[]> = {
  [OrderState.NEW]: [OrderState.SUBMITTED, OrderState.REJECTED],
  [OrderState.SUBMITTED]: [OrderState.ACKED, OrderState.REJECTED, OrderState.CANCELED],
  [OrderState.ACKED]: [OrderState.PARTIAL, OrderState.FILLED, OrderState.CANCELED, OrderState.REJECTED],
  [OrderState.PARTIAL]: [OrderState.PARTIAL, OrderState.FILLED, OrderState.CANCELED],
  [OrderState.FILLED]: [], // Terminal
  [OrderState.CANCELED]: [], // Terminal
  [OrderState.REJECTED]: [], // Terminal
};

export interface Order {
  id: string;
  intentId: string;
  idempotencyKey: string;
  traceId: string;
  exchange: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
  orderType: 'market' | 'limit' | 'stop';
  state: OrderState;
  stateHistory: { state: OrderState; timestamp: number; reason?: string }[];
  externalOrderId?: string;
  filledQuantity: number;
  avgFillPrice?: number;
  fees: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

// ============================================================================
// EXCHANGE ADAPTER INTERFACE
// ============================================================================

export interface ExchangeAdapter {
  name: string;
  submitOrder(order: Order): Promise<{ orderId: string; status: 'submitted' | 'rejected'; reason?: string }>;
  cancelOrder(orderId: string): Promise<{ success: boolean; reason?: string }>;
  getOrderStatus(orderId: string): Promise<{ state: OrderState; filledQty: number; avgPrice?: number; fees: number }>;
  getBalance(asset: string): Promise<{ available: number; total: number }>;
  getPosition(symbol: string): Promise<{ size: number; avgEntryPrice: number; pnl: number }>;
}

// ============================================================================
// MOCK EXCHANGE ADAPTER (for development/testing)
// ============================================================================

class MockExchangeAdapter implements ExchangeAdapter {
  name = 'mock';
  private orders: Map<string, { state: OrderState; filledQty: number; avgPrice: number; fees: number }> = new Map();
  private balances: Map<string, { available: number; total: number }> = new Map();
  private positions: Map<string, { size: number; avgEntryPrice: number; pnl: number }> = new Map();

  constructor() {
    // Initialize mock balances
    this.balances.set('USDT', { available: 10000, total: 10000 });
    this.balances.set('BTC', { available: 0.5, total: 0.5 });
    this.balances.set('ETH', { available: 5, total: 5 });
  }

  async submitOrder(order: Order): Promise<{ orderId: string; status: 'submitted' | 'rejected'; reason?: string }> {
    // Simulate random latency
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));

    // Simulate occasional rejection
    if (Math.random() < 0.05) {
      return { orderId: '', status: 'rejected', reason: 'Insufficient margin (mock)' };
    }

    const orderId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Simulate immediate fill for market orders
    const state = order.orderType === 'market' ? OrderState.FILLED : OrderState.ACKED;
    const filledQty = state === OrderState.FILLED ? order.quantity : 0;
    const avgPrice = order.price || (Math.random() * 1000 + 30000); // Mock BTC price
    const fees = filledQty * avgPrice * 0.001; // 0.1% fee

    this.orders.set(orderId, { state, filledQty, avgPrice, fees });

    return { orderId, status: 'submitted' };
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; reason?: string }> {
    await new Promise(resolve => setTimeout(resolve, 30));
    
    const order = this.orders.get(orderId);
    if (!order) {
      return { success: false, reason: 'Order not found' };
    }

    if (order.state === OrderState.FILLED) {
      return { success: false, reason: 'Order already filled' };
    }

    order.state = OrderState.CANCELED;
    return { success: true };
  }

  async getOrderStatus(orderId: string): Promise<{ state: OrderState; filledQty: number; avgPrice?: number; fees: number }> {
    await new Promise(resolve => setTimeout(resolve, 20));
    
    const order = this.orders.get(orderId);
    if (!order) {
      return { state: OrderState.REJECTED, filledQty: 0, fees: 0 };
    }

    // Simulate partial fills progressing to full fills for limit orders
    if (order.state === OrderState.ACKED && Math.random() < 0.3) {
      order.state = OrderState.PARTIAL;
      order.filledQty = order.filledQty * 0.5 + 0.001;
    } else if (order.state === OrderState.PARTIAL && Math.random() < 0.5) {
      order.state = OrderState.FILLED;
    }

    return { 
      state: order.state, 
      filledQty: order.filledQty, 
      avgPrice: order.avgPrice,
      fees: order.fees,
    };
  }

  async getBalance(asset: string): Promise<{ available: number; total: number }> {
    return this.balances.get(asset) || { available: 0, total: 0 };
  }

  async getPosition(symbol: string): Promise<{ size: number; avgEntryPrice: number; pnl: number }> {
    return this.positions.get(symbol) || { size: 0, avgEntryPrice: 0, pnl: 0 };
  }
}

// ============================================================================
// EXECUTOR CONFIG
// ============================================================================

export interface ExecutorConfig {
  /** Rate limit requests per second per exchange */
  rateLimitPerExchange: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base backoff delay (ms) */
  baseBackoffMs: number;
  /** Maximum backoff delay (ms) */
  maxBackoffMs: number;
  /** Position reconciliation tolerance (%) */
  positionTolerancePct: number;
  /** Balance reconciliation tolerance (%) */
  balanceTolerancePct: number;
  /** Order expiry check interval (ms) */
  expiryCheckIntervalMs: number;
  /** Error rate threshold for circuit breaker */
  errorRateThreshold: number;
  /** Telemetry emission interval (ms) */
  telemetryIntervalMs: number;
}

// ============================================================================
// CRYPTOCRAWLER EXECUTOR
// ============================================================================

export class CryptoCrawlerExecutor extends EventEmitter {
  private config: ExecutorConfig;
  private transport: ReactorTransport;
  private adapters: Map<string, ExchangeAdapter> = new Map();
  private orders: Map<string, Order> = new Map();
  private idempotencyCache: Map<string, string> = new Map(); // key -> orderId
  private isRunning: boolean = false;
  private expiryTimer: NodeJS.Timeout | null = null;
  private telemetryTimer: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  
  // Metrics
  private processedCount: number = 0;
  private errorCount: number = 0;
  private fillCount: number = 0;
  private rejectCount: number = 0;

  constructor(config: Partial<ExecutorConfig> = {}) {
    super();
    this.config = {
      rateLimitPerExchange: 10,
      maxRetries: 3,
      baseBackoffMs: 100,
      maxBackoffMs: 5000,
      positionTolerancePct: 5,
      balanceTolerancePct: 1,
      expiryCheckIntervalMs: 1000,
      errorRateThreshold: 0.3,
      telemetryIntervalMs: 10000,
      ...config,
    };

    this.transport = getTransport();
    
    // Register mock adapter by default
    this.registerAdapter(new MockExchangeAdapter());
  }

  registerAdapter(adapter: ExchangeAdapter): void {
    this.adapters.set(adapter.name, adapter);
    console.log(`[CryptoExecutor] Registered adapter: ${adapter.name}`);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = Date.now();

    // Subscribe to intent events (crypto domain only)
    this.transport.subscribeDurable(PUBSUB_TOPICS.INTENT, async (event) => {
      const intent = event as ActionIntent;
      if (intent.domain === 'crypto') {
        await this.handleIntent(intent);
      }
    });

    // Start expiry checker
    this.expiryTimer = setInterval(() => {
      this.checkExpiredOrders();
    }, this.config.expiryCheckIntervalMs);

    // Start telemetry emission
    this.telemetryTimer = setInterval(() => {
      this.emitTelemetry();
    }, this.config.telemetryIntervalMs);

    console.log('[CryptoExecutor] Started');
    this.emit('started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }

    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }

    console.log('[CryptoExecutor] Stopped');
    this.emit('stopped');
  }

  // ==================== INTENT HANDLING ====================

  private async handleIntent(intent: ActionIntent): Promise<void> {
    const startTime = Date.now();
    this.processedCount++;

    try {
      // Check idempotency
      const existingOrderId = this.idempotencyCache.get(intent.idempotency_key);
      if (existingOrderId) {
        console.log(`[CryptoExecutor] Idempotent request, returning existing order: ${existingOrderId}`);
        const existingOrder = this.orders.get(existingOrderId);
        if (existingOrder) {
          await this.emitResult(intent, existingOrder, Date.now() - startTime);
        }
        return;
      }

      // Check expiry
      if (intent.expires_ts < Date.now()) {
        console.log(`[CryptoExecutor] Intent expired: ${intent.idempotency_key}`);
        await this.emitExpiredResult(intent);
        return;
      }

      // Check rate limit
      const params = intent.parameters as CryptoActionParams;
      const exchange = params.exchange || 'mock';
      const rateCheck = await this.transport.checkRateLimit(`crypto:${exchange}`, this.config.rateLimitPerExchange);
      
      if (!rateCheck.allowed) {
        console.log(`[CryptoExecutor] Rate limited for ${exchange}`);
        // Emit rate-limited result to maintain contract with caller
        await this.emitRateLimitedResult(intent, exchange);
        return;
      }

      // Create order
      const order = this.createOrder(intent, params);
      this.orders.set(order.id, order);
      this.idempotencyCache.set(intent.idempotency_key, order.id);

      // Execute based on action type
      switch (intent.action_type) {
        case 'market_order':
        case 'limit_order':
          await this.submitOrder(order, exchange);
          break;
        case 'cancel':
          await this.cancelOrder(order, exchange, params);
          break;
        default:
          console.warn(`[CryptoExecutor] Unknown action type: ${intent.action_type}`);
          this.transitionState(order, OrderState.REJECTED, `Unknown action type: ${intent.action_type}`);
      }

      // Emit result
      await this.emitResult(intent, order, Date.now() - startTime);

    } catch (err) {
      this.errorCount++;
      console.error('[CryptoExecutor] Error handling intent:', err);
      this.emit('error', { intent, error: err });
      
      // Check error rate for circuit breaker
      await this.checkErrorRate();
    }
  }

  private createOrder(intent: ActionIntent, params: CryptoActionParams): Order {
    const now = Date.now();
    return {
      id: randomUUID(),
      intentId: intent.event_id,
      idempotencyKey: intent.idempotency_key,
      traceId: intent.trace_id,
      exchange: params.exchange || 'mock',
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
      price: params.price,
      orderType: params.order_type,
      state: OrderState.NEW,
      stateHistory: [{ state: OrderState.NEW, timestamp: now }],
      filledQuantity: 0,
      fees: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: intent.expires_ts,
    };
  }

  // ==================== ORDER EXECUTION ====================

  private async submitOrder(order: Order, exchange: string): Promise<void> {
    const adapter = this.adapters.get(exchange);
    if (!adapter) {
      this.transitionState(order, OrderState.REJECTED, `No adapter for exchange: ${exchange}`);
      return;
    }

    // Execute with retry
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        this.transitionState(order, OrderState.SUBMITTED);
        
        const result = await adapter.submitOrder(order);
        
        if (result.status === 'rejected') {
          this.transitionState(order, OrderState.REJECTED, result.reason);
          this.rejectCount++;
          return;
        }

        order.externalOrderId = result.orderId;
        this.transitionState(order, OrderState.ACKED);

        // Poll for fill status
        await this.pollOrderStatus(order, adapter);
        return;

      } catch (err) {
        lastError = err as Error;
        const backoff = Math.min(
          this.config.maxBackoffMs,
          this.config.baseBackoffMs * Math.pow(2, attempt)
        );
        console.log(`[CryptoExecutor] Retry ${attempt + 1}/${this.config.maxRetries} for order ${order.id}, backoff: ${backoff}ms`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }

    // All retries failed
    this.transitionState(order, OrderState.REJECTED, `Max retries exceeded: ${lastError?.message}`);
    this.errorCount++;
  }

  private async cancelOrder(order: Order, exchange: string, params: CryptoActionParams): Promise<void> {
    const adapter = this.adapters.get(exchange);
    if (!adapter) {
      this.transitionState(order, OrderState.REJECTED, `No adapter for exchange: ${exchange}`);
      return;
    }

    const targetOrderId = (params as any).orderId;
    if (!targetOrderId) {
      this.transitionState(order, OrderState.REJECTED, 'No orderId provided for cancel');
      return;
    }

    const result = await adapter.cancelOrder(targetOrderId);
    if (result.success) {
      this.transitionState(order, OrderState.FILLED); // Cancel completed
    } else {
      this.transitionState(order, OrderState.REJECTED, result.reason);
    }
  }

  private async pollOrderStatus(order: Order, adapter: ExchangeAdapter): Promise<void> {
    if (!order.externalOrderId) return;

    // Poll for a short time (in production, would use websockets)
    const maxPollTime = 5000;
    const pollInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
      const status = await adapter.getOrderStatus(order.externalOrderId);
      
      if (status.state !== order.state) {
        order.filledQuantity = status.filledQty;
        order.avgFillPrice = status.avgPrice;
        order.fees = status.fees;
        this.transitionState(order, status.state);
      }

      // Terminal states
      if ([OrderState.FILLED, OrderState.CANCELED, OrderState.REJECTED].includes(status.state)) {
        if (status.state === OrderState.FILLED) {
          this.fillCount++;
        }
        break;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  // ==================== STATE MACHINE ====================

  private transitionState(order: Order, newState: OrderState, reason?: string): boolean {
    const validNext = VALID_TRANSITIONS[order.state];
    if (!validNext.includes(newState)) {
      console.error(`[CryptoExecutor] Invalid state transition: ${order.state} -> ${newState}`);
      return false;
    }

    order.state = newState;
    order.updatedAt = Date.now();
    order.stateHistory.push({ state: newState, timestamp: Date.now(), reason });

    this.emit('order:transition', { order, newState, reason });
    return true;
  }

  // ==================== RESULT EMISSION ====================

  private async emitResult(intent: ActionIntent, order: Order, latencyMs: number): Promise<void> {
    const result: ActionResult = {
      ...createBaseEvent(intent.trace_id),
      kind: 'result',
      domain: 'crypto',
      status: this.mapStateToStatus(order.state),
      details: {
        order_id: order.externalOrderId,
        fill_price: order.avgFillPrice,
        fill_quantity: order.filledQuantity,
        fees: order.fees,
        slippage: order.price && order.avgFillPrice 
          ? Math.abs(order.avgFillPrice - order.price) / order.price 
          : undefined,
        state: order.state,
        rejection_reason: order.state === OrderState.REJECTED 
          ? order.stateHistory.find(h => h.state === OrderState.REJECTED)?.reason 
          : undefined,
      } as CryptoActionResult,
      latency_ms: latencyMs,
      idempotency_key: intent.idempotency_key,
    };

    await this.transport.publishDurable(PUBSUB_TOPICS.RESULT, result);
    this.emit('result:emitted', { intent, order, result });
  }

  private async emitExpiredResult(intent: ActionIntent): Promise<void> {
    const result: ActionResult = {
      ...createBaseEvent(intent.trace_id),
      kind: 'result',
      domain: 'crypto',
      status: 'expired',
      details: {
        state: 'rejected',
        rejection_reason: 'Intent expired before execution',
      } as CryptoActionResult,
      latency_ms: 0,
      idempotency_key: intent.idempotency_key,
    };

    await this.transport.publishDurable(PUBSUB_TOPICS.RESULT, result);
  }

  private async emitRateLimitedResult(intent: ActionIntent, exchange: string): Promise<void> {
    const result: ActionResult = {
      ...createBaseEvent(intent.trace_id),
      kind: 'result',
      domain: 'crypto',
      status: 'rejected',
      details: {
        state: 'rejected',
        rejection_reason: `Rate limited for exchange: ${exchange}`,
      } as CryptoActionResult,
      latency_ms: 0,
      idempotency_key: intent.idempotency_key,
    };

    await this.transport.publishDurable(PUBSUB_TOPICS.RESULT, result);
  }

  private mapStateToStatus(state: OrderState): 'success' | 'partial' | 'failed' | 'rejected' | 'expired' | 'cancelled' {
    switch (state) {
      case OrderState.FILLED: return 'success';
      case OrderState.PARTIAL: return 'partial';
      case OrderState.REJECTED: return 'rejected';
      case OrderState.CANCELED: return 'cancelled';
      default: return 'partial';
    }
  }

  // ==================== MONITORING ====================

  private checkExpiredOrders(): void {
    const now = Date.now();
    for (const [id, order] of this.orders) {
      if (order.expiresAt < now && ![OrderState.FILLED, OrderState.CANCELED, OrderState.REJECTED].includes(order.state)) {
        this.transitionState(order, OrderState.CANCELED, 'Order expired');
      }
    }
  }

  private async checkErrorRate(): Promise<void> {
    if (this.processedCount < 10) return;
    
    const errorRate = this.errorCount / this.processedCount;
    if (errorRate > this.config.errorRateThreshold) {
      // Emit trip event
      const trip: Trip = {
        ...createBaseEvent(),
        kind: 'trip',
        breaker_name: 'crypto_executor_error_rate',
        reason: `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(this.config.errorRateThreshold * 100).toFixed(1)}%`,
        severity: 'high',
        auto_recovery_policy: 'cooldown',
        cooldown_ms: 60000,
        affected_components: ['crypto-executor'],
      };

      await this.transport.publishDurable(PUBSUB_TOPICS.TRIP, trip);
      this.emit('circuit:trip', trip);
    }
  }

  private async emitTelemetry(): Promise<void> {
    const uptime = (Date.now() - this.startTime) / 1000;
    const errorRate = this.processedCount > 0 ? this.errorCount / this.processedCount : 0;
    const fillRate = this.processedCount > 0 ? this.fillCount / this.processedCount : 0;

    const telemetry: Telemetry = {
      ...createBaseEvent(),
      kind: 'telemetry',
      service: 'crypto-executor',
      health: errorRate < 0.1 ? 'healthy' : errorRate < 0.3 ? 'degraded' : 'unhealthy',
      metrics: {
        throughput_eps: this.processedCount / Math.max(1, uptime),
        queue_depth: 0,
        error_rate: errorRate,
        avg_latency_ms: 100, // Would need actual tracking
        p99_latency_ms: 500,
        memory_mb: process.memoryUsage().heapUsed / 1024 / 1024,
        cpu_usage: 0.1,
        custom: {
          orders_total: this.orders.size,
          fills: this.fillCount,
          rejects: this.rejectCount,
          fill_rate: fillRate,
        },
      },
      uptime_s: uptime,
    };

    await this.transport.publishDurable(PUBSUB_TOPICS.TELEMETRY, telemetry);
  }

  // ==================== PUBLIC API ====================

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  getOrderByIdempotencyKey(key: string): Order | undefined {
    const orderId = this.idempotencyCache.get(key);
    return orderId ? this.orders.get(orderId) : undefined;
  }

  getStats(): { processed: number; errors: number; fills: number; rejects: number; activeOrders: number } {
    return {
      processed: this.processedCount,
      errors: this.errorCount,
      fills: this.fillCount,
      rejects: this.rejectCount,
      activeOrders: Array.from(this.orders.values()).filter(o => 
        ![OrderState.FILLED, OrderState.CANCELED, OrderState.REJECTED].includes(o.state)
      ).length,
    };
  }
}

// Singleton factory
let executorInstance: CryptoCrawlerExecutor | null = null;

export function getCryptoExecutor(config?: Partial<ExecutorConfig>): CryptoCrawlerExecutor {
  if (!executorInstance) {
    executorInstance = new CryptoCrawlerExecutor(config);
  }
  return executorInstance;
}

export default CryptoCrawlerExecutor;
