import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface Snapshot {
  url: string;
  hash: string;
  content: Buffer;
  timestamp: Date;
  metadata: {
    statusCode: number;
    headers: Record<string, string>;
    contentType: string;
  };
}

interface SnapshotDiff {
  changed: boolean;
  previousHash?: string;
  newHash: string;
  timestamp: Date;
}

export class SnapshotEngine {
  private snapshots = new Map<string, Snapshot>();

  async createSnapshot(url: string, content: string, metadata: any): Promise<Snapshot> {
    const hash = this.calculateHash(content);
    const compressed = await gzip(Buffer.from(content));

    const snapshot: Snapshot = {
      url,
      hash,
      content: compressed,
      timestamp: new Date(),
      metadata,
    };

    this.snapshots.set(url, snapshot);
    return snapshot;
  }

  async getSnapshot(url: string): Promise<string | null> {
    const snapshot = this.snapshots.get(url);
    if (!snapshot) return null;

    const decompressed = await gunzip(snapshot.content);
    return decompressed.toString();
  }

  async detectChanges(url: string, newContent: string): Promise<SnapshotDiff> {
    const newHash = this.calculateHash(newContent);
    const existing = this.snapshots.get(url);

    return {
      changed: !existing || existing.hash !== newHash,
      previousHash: existing?.hash,
      newHash,
      timestamp: new Date(),
    };
  }

  hasSnapshot(url: string): boolean {
    return this.snapshots.has(url);
  }

  deleteSnapshot(url: string): boolean {
    return this.snapshots.delete(url);
  }

  clearOldSnapshots(olderThanDays: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    
    let deleted = 0;
    for (const [url, snapshot] of this.snapshots) {
      if (snapshot.timestamp < cutoff) {
        this.snapshots.delete(url);
        deleted++;
      }
    }
    return deleted;
  }

  private calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  getStats() {
    return {
      totalSnapshots: this.snapshots.size,
      totalSize: Array.from(this.snapshots.values())
        .reduce((sum, s) => sum + s.content.length, 0),
      oldestSnapshot: this.getOldestSnapshotDate(),
      newestSnapshot: this.getNewestSnapshotDate(),
    };
  }

  private getOldestSnapshotDate(): Date | null {
    const dates = Array.from(this.snapshots.values()).map(s => s.timestamp);
    return dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
  }

  private getNewestSnapshotDate(): Date | null {
    const dates = Array.from(this.snapshots.values()).map(s => s.timestamp);
    return dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;
  }
}

export const snapshotEngine = new SnapshotEngine();
