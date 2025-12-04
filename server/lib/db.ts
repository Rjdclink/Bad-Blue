/**
 * Database Helper for Subscription System
 * Provides query and client helpers wrapping the existing pool
 */
import { pool } from '../db';

/**
 * Execute a parameterized query with logging
 * @param text SQL query string
 * @param params Query parameters
 * @returns Query result
 */
export async function query(text: string, params?: any[]) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text: text.substring(0, 100), duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Get a client from the pool for transaction support
 * Remember to call client.release() when done
 * @returns Database client
 */
export async function getClient() {
  const client = await pool.connect();
  return client;
}

export default { query, getClient };
