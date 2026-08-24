import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  MultiProviderRpcManager,
  attachWebSocketTransportGuards,
  type WebSocketTransportLike,
} from '../api/blockchain-providers.js';

class FakeSocket extends EventEmitter implements WebSocketTransportLike {
  terminateCount = 0;
  terminate(): void { this.terminateCount += 1; }
}

class FakeRpcProvider {
  readonly chainId = 1;
  fail = false;

  async getNetwork(): Promise<{ chainId: number }> {
    if (this.fail) throw new Error('HTTP unavailable');
    return { chainId: this.chainId };
  }

  async getBlockNumber(): Promise<number> {
    if (this.fail) throw new Error('HTTP unavailable');
    return 100;
  }

  async getFeeData(): Promise<Record<string, unknown>> {
    if (this.fail) throw new Error('HTTP unavailable');
    return {};
  }
}

class FakeWebSocketProvider extends EventEmitter {
  readonly ready = Promise.resolve(this);
  readonly _websocket = new FakeSocket();

  destroy(): void {
    this.removeAllListeners();
    this._websocket.removeAllListeners();
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function makeManager(cooldownMs = 5): Promise<{
  manager: MultiProviderRpcManager;
  http: Map<string, FakeRpcProvider>;
  sockets: Map<string, FakeWebSocketProvider[]>;
}> {
  const http = new Map<string, FakeRpcProvider>();
  const sockets = new Map<string, FakeWebSocketProvider[]>();
  const manager = new MultiProviderRpcManager({
    cooldownMs,
    operationTimeoutMs: 100,
    discoverConfiguredProviders: false,
    httpProviderFactory: url => {
      const provider = http.get(url) || new FakeRpcProvider();
      http.set(url, provider);
      return provider as any;
    },
    websocketProviderFactory: url => {
      const provider = new FakeWebSocketProvider();
      const providers = sockets.get(url) || [];
      providers.push(provider);
      sockets.set(url, providers);
      return provider as any;
    },
  });
  return { manager, http, sockets };
}

async function register(manager: MultiProviderRpcManager, provider: string, url: string, options?: { websocket?: string; pending?: boolean }): Promise<void> {
  await manager.registerProvider({
    provider,
    chain: 'ethereum',
    httpUrl: url,
    websocketUrl: options?.websocket,
    priority: provider === 'Alchemy' ? 10 : 5,
    capabilities: ['json_rpc', 'network', 'blocks', 'transactions', 'receipts', 'gas', 'logs', 'contract_calls', ...(options?.websocket ? ['subscriptions' as const] : []), ...(options?.pending ? ['pending_transactions' as const] : [])],
  });
}

async function verifyHttpFailoverAndProvenance(): Promise<void> {
  const { manager, http } = await makeManager();
  await register(manager, 'Alchemy', 'http://alchemy');
  await register(manager, 'Infura', 'http://infura');
  http.get('http://alchemy')!.fail = true;

  const response = await manager.execute('ethereum', 'blocks', provider => provider.getBlockNumber());
  assert.equal(response.result, 100);
  assert.equal(response.provenance.provider, 'Infura');
  assert.equal(response.provenance.transport, 'http');
  await manager.destroy();
}

async function verifyWebSocketMigrationAndStaleCallbackSuppression(): Promise<void> {
  const { manager, sockets } = await makeManager();
  await register(manager, 'Alchemy', 'http://alchemy', { websocket: 'ws://alchemy' });
  await register(manager, 'Infura', 'http://infura', { websocket: 'ws://infura' });
  const blocks: number[] = [];
  const subscription = await manager.subscribe('ethereum', 'blocks', value => {
    if (typeof value === 'number') blocks.push(value);
  });
  assert.equal(subscription.provider, 'Alchemy');
  sockets.get('ws://alchemy')![0].emit('block', 1);
  assert.deepEqual(blocks, [1]);

  sockets.get('ws://alchemy')![0]._websocket.emit('error', new Error('malformed frame'));
  const alchemyHealth = manager.getHealth('ethereum').find(observation => observation.provider === 'Alchemy');
  assert.equal(alchemyHealth?.http.state, 'healthy');
  assert.notEqual(alchemyHealth?.websocket.state, 'healthy');
  await wait(1100);
  assert.equal(subscription.provider, 'Infura');
  assert.equal(subscription.generation, 2);
  sockets.get('ws://alchemy')![0].emit('block', 2);
  sockets.get('ws://infura')![0].emit('block', 3);
  assert.deepEqual(blocks, [1, 3]);

  await subscription.unsubscribe();
  await manager.destroy();
}

async function verifyHttpFailureDoesNotDropHealthyWebSocket(): Promise<void> {
  const { manager, http, sockets } = await makeManager();
  await register(manager, 'Alchemy', 'http://alchemy', { websocket: 'ws://alchemy' });
  await register(manager, 'Infura', 'http://infura', { websocket: 'ws://infura' });
  const blocks: number[] = [];
  const subscription = await manager.subscribe('ethereum', 'blocks', value => {
    if (typeof value === 'number') blocks.push(value);
  });

  http.get('http://alchemy')!.fail = true;
  await manager.execute('ethereum', 'blocks', provider => provider.getBlockNumber());
  sockets.get('ws://alchemy')![0].emit('block', 4);
  assert.deepEqual(blocks, [4]);
  assert.notEqual(manager.getHealth('ethereum').find(observation => observation.provider === 'Alchemy')?.http.state, 'healthy');
  assert.equal(subscription.provider, 'Alchemy');

  await subscription.unsubscribe();
  await manager.destroy();
}

async function verifyPendingCapabilityAndCooldownRecovery(): Promise<void> {
  const { manager, http, sockets } = await makeManager();
  await register(manager, 'QuickNode', 'http://quicknode');
  const pending = await manager.subscribe('ethereum', 'pending_transactions', () => undefined);
  assert.equal(pending.state, 'unavailable');
  assert.equal(sockets.size, 0);

  http.get('http://quicknode')!.fail = true;
  await assert.rejects(() => manager.execute('ethereum', 'blocks', provider => provider.getBlockNumber()));
  http.get('http://quicknode')!.fail = false;
  await wait(10);
  const recovered = await manager.execute('ethereum', 'blocks', provider => provider.getBlockNumber());
  assert.equal(recovered.provenance.provider, 'QuickNode');
  await manager.destroy();
}

function verifyTransportGuard(): void {
  const socket = new FakeSocket();
  let failures = 0;
  let closes = 0;
  const cleanup = attachWebSocketTransportGuards(socket, {
    onFailure: () => { failures += 1; },
    onClose: () => { closes += 1; },
  });
  socket.emit('error', new RangeError('Invalid WebSocket frame: invalid payload length 126'));
  socket.emit('error', new Error('second transport error'));
  socket.emit('close');
  assert.equal(failures, 1);
  assert.equal(closes, 0);
  cleanup();
  assert.equal(socket.listenerCount('error'), 0);
  assert.equal(socket.listenerCount('close'), 0);
}

async function verifyRecoveredWebSocketDoesNotDuplicateSubscription(): Promise<void> {
  const { manager, sockets } = await makeManager(5);
  await register(manager, 'Alchemy', 'http://alchemy', { websocket: 'ws://alchemy' });
  await register(manager, 'Infura', 'http://infura', { websocket: 'ws://infura' });
  const blocks: number[] = [];
  const subscription = await manager.subscribe('ethereum', 'blocks', value => {
    if (typeof value === 'number') blocks.push(value);
  });

  sockets.get('ws://alchemy')![0]._websocket.emit('error', new Error('connection lost'));
  await wait(1200);
  assert.equal(subscription.provider, 'Infura');

  await wait(4200);
  const alchemyConnections = sockets.get('ws://alchemy') || [];
  assert.equal(alchemyConnections.length, 2);
  assert.equal(manager.getHealth('ethereum').find(observation => observation.provider === 'Alchemy')?.websocket.state, 'healthy');

  alchemyConnections[0].emit('block', 5);
  sockets.get('ws://infura')![0].emit('block', 6);
  assert.deepEqual(blocks, [6]);

  await subscription.unsubscribe();
  await manager.destroy();
}

verifyTransportGuard();
await verifyHttpFailoverAndProvenance();
await verifyWebSocketMigrationAndStaleCallbackSuppression();
await verifyHttpFailureDoesNotDropHealthyWebSocket();
await verifyPendingCapabilityAndCooldownRecovery();
await verifyRecoveredWebSocketDoesNotDuplicateSubscription();
console.log('Provider failover matrix passed');
