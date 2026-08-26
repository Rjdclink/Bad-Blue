/**
 * Interface for optional external snapshot persistence.
 *
 * PostgreSQL is the authoritative durable store for application state in the
 * current production architecture. This interface is retained because the
 * persistence manager still calls it for optional backup metadata, but no
 * cloud-object-storage dependency is required or implied.
 */
export interface IPersistentStorage {
  save(key: string, data: any): Promise<void>;
  load<T>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
  exists(key: string): Promise<boolean>;
  saveAppConfig(config: any): Promise<void>;
  loadAppConfig<T>(): Promise<T | null>;
  saveWorkerState(state: any): Promise<void>;
  loadWorkerState<T>(): Promise<T | null>;
}

/**
 * Production implementation for the current PostgreSQL-primary deployment.
 *
 * Critical application data already persists in PostgreSQL. Optional external
 * snapshot metadata is intentionally disabled until a real external snapshot
 * backend is selected. Keeping this implementation explicit preserves existing
 * callers without pretending that Google Cloud Storage exists in production.
 */
class DatabasePrimaryPersistentStorage implements IPersistentStorage {
  private logSkipped(operation: string, key?: string): void {
    console.log(`ℹ️ External snapshot storage disabled; PostgreSQL remains authoritative - skipping ${operation}${key ? `: ${key}` : ''}`);
  }

  async save(key: string, _data: any): Promise<void> {
    this.logSkipped('snapshot save', key);
  }

  async load<T>(_key: string): Promise<T | null> {
    return null;
  }

  async delete(key: string): Promise<void> {
    this.logSkipped('snapshot delete', key);
  }

  async listKeys(): Promise<string[]> {
    return [];
  }

  async exists(_key: string): Promise<boolean> {
    return false;
  }

  async saveAppConfig(_config: any): Promise<void> {
    this.logSkipped('app-config snapshot save');
  }

  async loadAppConfig<T>(): Promise<T | null> {
    return null;
  }

  async saveWorkerState(_state: any): Promise<void> {
    this.logSkipped('worker-state snapshot save');
  }

  async loadWorkerState<T>(): Promise<T | null> {
    return null;
  }
}

console.log('✓ PostgreSQL-primary persistence configured; external snapshot storage disabled');
export const persistentStorage: IPersistentStorage = new DatabasePrimaryPersistentStorage();