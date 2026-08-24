import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachWebSocketTransportGuards, type WebSocketTransportLike } from '../api/blockchain-providers.js';

class FakeSocket extends EventEmitter implements WebSocketTransportLike {
  terminateCount = 0;
  terminate(): void { this.terminateCount++; }
}

function verifyMalformedFrameIsContained(): void {
  const socket = new FakeSocket();
  let failures = 0;
  let closes = 0;
  const cleanup = attachWebSocketTransportGuards(socket, {
    onFailure: () => { failures++; },
    onClose: () => { closes++; },
  });

  socket.emit('error', new RangeError('Invalid WebSocket frame: invalid payload length 126'));
  socket.emit('error', new Error('second transport error'));
  socket.emit('close');

  assert.equal(failures, 1);
  assert.equal(closes, 1);
  cleanup();
}

function verifyOpenAndCleanup(): void {
  const socket = new FakeSocket();
  let opened = 0;
  const cleanup = attachWebSocketTransportGuards(socket, {
    onOpen: () => { opened++; },
    onFailure: () => undefined,
  });
  socket.emit('open');
  assert.equal(opened, 1);
  cleanup();
  assert.equal(socket.listenerCount('error'), 0);
  assert.equal(socket.listenerCount('close'), 0);
}

verifyMalformedFrameIsContained();
verifyOpenAndCleanup();
console.log('Provider failover transport checks passed');
