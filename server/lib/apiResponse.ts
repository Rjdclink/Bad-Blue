/**
 * Standardized API Response Utilities
 * 
 * Ensures consistent response format across all endpoints:
 * - success (with data)
 * - no_results (with reason)
 * - invalid_request (with field errors)
 * - upstream_blocked (403/429/999/etc)
 * - system_error (with correlation id)
 */

import { Response } from 'express';
import crypto from 'crypto';

export type ApiResponseType = 
  | 'success'
  | 'no_results'
  | 'invalid_request'
  | 'upstream_blocked'
  | 'upstream_unavailable'
  | 'system_error';

export interface ApiResponse<T = any> {
  type: ApiResponseType;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
    fields?: Record<string, string>;
    upstreamStatus?: number;
    upstreamCodes?: number[];
  };
  meta?: {
    correlationId: string;
    timestamp: string;
    processingTimeMs?: number;
  };
}

/**
 * Generate correlation ID for request tracking
 */
export function generateCorrelationId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Send success response with data
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  correlationId?: string,
  processingTimeMs?: number
): void {
  const response: ApiResponse<T> = {
    type: 'success',
    success: true,
    data,
    meta: {
      correlationId: correlationId || generateCorrelationId(),
      timestamp: new Date().toISOString(),
      processingTimeMs,
    },
  };
  res.status(200).json(response);
}

/**
 * Send no results response (not an error, just empty)
 */
export function sendNoResults(
  res: Response,
  reason: string,
  correlationId?: string
): void {
  const response: ApiResponse = {
    type: 'no_results',
    success: true,
    data: null,
    error: {
      code: 'NO_RESULTS',
      message: reason,
    },
    meta: {
      correlationId: correlationId || generateCorrelationId(),
      timestamp: new Date().toISOString(),
    },
  };
  res.status(200).json(response);
}

/**
 * Send validation error response
 */
export function sendValidationError(
  res: Response,
  message: string,
  fields?: Record<string, string>,
  correlationId?: string
): void {
  const response: ApiResponse = {
    type: 'invalid_request',
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message,
      fields,
    },
    meta: {
      correlationId: correlationId || generateCorrelationId(),
      timestamp: new Date().toISOString(),
    },
  };
  res.status(400).json(response);
}

/**
 * Send upstream blocked response (rate limit, forbidden, etc)
 */
export function sendUpstreamBlocked(
  res: Response,
  message: string,
  upstreamStatus: number,
  upstreamCodes?: number[],
  correlationId?: string
): void {
  const response: ApiResponse = {
    type: 'upstream_blocked',
    success: false,
    error: {
      code: 'UPSTREAM_BLOCKED',
      message,
      upstreamStatus,
      upstreamCodes,
    },
    meta: {
      correlationId: correlationId || generateCorrelationId(),
      timestamp: new Date().toISOString(),
    },
  };
  res.status(502).json(response);
}

/**
 * Send upstream unavailable response (no providers available)
 */
export function sendUpstreamUnavailable(
  res: Response,
  message: string,
  details?: any,
  correlationId?: string
): void {
  const response: ApiResponse = {
    type: 'upstream_unavailable',
    success: false,
    error: {
      code: 'UPSTREAM_UNAVAILABLE',
      message,
      details,
    },
    meta: {
      correlationId: correlationId || generateCorrelationId(),
      timestamp: new Date().toISOString(),
    },
  };
  res.status(503).json(response);
}

/**
 * Send system error response
 */
export function sendSystemError(
  res: Response,
  message: string,
  details?: any,
  correlationId?: string
): void {
  const response: ApiResponse = {
    type: 'system_error',
    success: false,
    error: {
      code: 'SYSTEM_ERROR',
      message,
      details,
    },
    meta: {
      correlationId: correlationId || generateCorrelationId(),
      timestamp: new Date().toISOString(),
    },
  };
  res.status(500).json(response);
}
