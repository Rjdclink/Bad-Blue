import os from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { QuantiResourceSnapshot } from './types.js';

type CpuTotals = { idle: number; total: number };

function readCpuTotals(): CpuTotals {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

export class QuantiResourceProfiler {
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
  private previousCpu: CpuTotals = readCpuTotals();
  private previousElu = performance.eventLoopUtilization();
  private closed = false;

  constructor() {
    this.eventLoopDelay.enable();
  }

  snapshot(): QuantiResourceSnapshot {
    const nowCpu = readCpuTotals();
    const idleDelta = Math.max(0, nowCpu.idle - this.previousCpu.idle);
    const totalDelta = Math.max(0, nowCpu.total - this.previousCpu.total);
    this.previousCpu = nowCpu;

    const elu = performance.eventLoopUtilization(this.previousElu);
    this.previousElu = performance.eventLoopUtilization();

    const memory = process.memoryUsage();
    const load = os.loadavg();
    const cpuUtilizationPercent = totalDelta > 0
      ? Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta)))
      : null;
    const eventLoopDelayP95Ms = this.eventLoopDelay.count > 0
      ? this.eventLoopDelay.percentile(95) / 1e6
      : 0;

    return {
      timestamp: Date.now(),
      logicalCpus: os.cpus().length,
      availableParallelism: Math.max(1, os.availableParallelism?.() || os.cpus().length),
      loadAverage1m: load[0] || 0,
      loadAverage5m: load[1] || 0,
      loadAverage15m: load[2] || 0,
      cpuUtilizationPercent,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalMemoryBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      eventLoopUtilization: Math.max(0, Math.min(1, elu.utilization || 0)),
      eventLoopDelayP95Ms: Number.isFinite(eventLoopDelayP95Ms) ? eventLoopDelayP95Ms : 0,
    };
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.eventLoopDelay.disable();
  }
}
