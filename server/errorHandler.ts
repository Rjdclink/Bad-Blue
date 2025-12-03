// Centralized Error Handler for BadBlue Platform
// Provides consistent error responses and logging across the application

import type { Request, Response, NextFunction } from 'express';

// Custom error class for application-specific errors
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public details?: any;

  constructor(message: string, statusCode: number, isOperational = true, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Predefined error types for common scenarios
export const ErrorTypes = {
  // Authentication & Authorization
  UNAUTHORIZED: (message = 'Please log in to access this feature') => new AppError(message, 401),
  FORBIDDEN: (message = 'You don\'t have permission to access this. Please contact support if you need help') => new AppError(message, 403),
  INVALID_CREDENTIALS: () => new AppError('Please check your login credentials and try again', 401),
  SESSION_EXPIRED: () => new AppError('Your session has expired. Please log in again to continue', 401),
  
  // Validation & Input
  VALIDATION_ERROR: (message: string, details?: any) => new AppError(message, 400, true, details),
  MISSING_REQUIRED_FIELDS: (fields: string[]) => 
    new AppError(`Please complete the following required fields: ${fields.join(', ')}`, 400, true, { fields }),
  INVALID_INPUT: (message = 'Please check the highlighted fields and correct any issues') => new AppError(message, 400),
  
  // Resource & Database
  NOT_FOUND: (resource = 'The requested content') => new AppError(`${resource} could not be found. Please try refreshing the page`, 404),
  DUPLICATE_ENTRY: (field: string) => new AppError(`This ${field} is already in use. Please try a different one`, 409),
  DATABASE_ERROR: (message = 'We\'re experiencing technical difficulties. Please try again in a few moments') => new AppError(message, 500, false),
  
  // Payment & Square
  PAYMENT_FAILED: (message = 'Payment could not be processed. Please check your card details and try again') => new AppError(message, 402),
  SQUARE_ERROR: (message: string) => new AppError(`Payment could not be processed: ${message}`, 402),
  INSUFFICIENT_FUNDS: () => new AppError('Your card has insufficient funds. Please try a different payment method', 402),
  
  // Rate Limiting & Security
  RATE_LIMIT_EXCEEDED: (retryAfter?: number) => 
    new AppError(`Too many attempts. Please wait ${retryAfter ? Math.ceil(retryAfter / 60) + ' minutes' : 'a few moments'} before trying again`, 429, true, { retryAfter }),
  SUSPICIOUS_ACTIVITY: () => new AppError('Unusual activity detected. Please contact support if you need assistance', 403),
  
  // AI & External Services
  AI_SERVICE_ERROR: (service: string) => new AppError(`Our ${service} assistant is temporarily unavailable. Please try again in a few moments`, 503),
  EXTERNAL_API_ERROR: (api: string) => new AppError(`Connection issue. Please check your internet and try again`, 503),
  QUOTA_EXCEEDED: (service: string) => new AppError(`Service limit reached. Please try again later or contact support`, 503),
  
  // File & Storage
  FILE_TOO_LARGE: (maxSize: string) => new AppError(`Your file is too large. Please choose a file smaller than ${maxSize}`, 413),
  INVALID_FILE_TYPE: (allowedTypes: string[]) => 
    new AppError(`Please upload one of these file types: ${allowedTypes.join(', ')}`, 415),
  STORAGE_ERROR: () => new AppError('We couldn\'t save your file. Please try again or contact support if the problem persists', 500, false),
  
  // Server & System
  INTERNAL_ERROR: () => new AppError('We\'re experiencing technical difficulties. Please try again in a few moments', 500, false),
  SERVICE_UNAVAILABLE: () => new AppError('Service is temporarily unavailable. Please try again in a few moments', 503),
  MAINTENANCE_MODE: () => new AppError('We\'re performing scheduled maintenance. Please check back in a few minutes', 503),
};

// Error logger for production monitoring
function logError(error: AppError | Error, req: Request) {
  const errorLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: (req as any).user?.id || null,
    error: {
      message: error.message,
      stack: error.stack,
      statusCode: error instanceof AppError ? error.statusCode : 500,
      isOperational: error instanceof AppError ? error.isOperational : false,
      details: error instanceof AppError ? error.details : undefined,
    }
  };

  // Log to console in development, could send to monitoring service in production
  if (process.env.NODE_ENV !== 'production' || !(error instanceof AppError && error.isOperational)) {
    console.error('[ERROR]', JSON.stringify(errorLog, null, 2));
  }
}

// Main error handling middleware
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  // Log the error
  logError(err, req);

  // Handle Square API errors
  if ((err as any).name === 'ApiError' || (err as any).errors) {
    const squareError = err as any;
    const errorMessage = squareError.errors?.[0]?.detail || squareError.message || 'Payment processing failed';
    return res.status(402).json({
      error: 'Payment Error',
      message: 'Payment could not be processed. Please check your card details and try again',
      details: process.env.NODE_ENV !== 'production' ? errorMessage : undefined,
      code: squareError.errors?.[0]?.code,
    });
  }

  // Handle Zod validation errors
  if (err.name === 'ZodError') {
    const zodError = err as any;
    return res.status(400).json({
      error: 'Validation Error',
      message: 'Please check the highlighted fields and correct any issues',
      details: zodError.errors,
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Session Expired',
      message: 'Your session has expired. Please log in again to continue',
    });
  }

  // Handle multer file upload errors
  if (err.name === 'MulterError') {
    const multerError = err as any;
    let message = 'There was a problem uploading your file. Please try again';
    let statusCode = 400;
    
    if (multerError.code === 'LIMIT_FILE_SIZE') {
      message = 'Your file is too large. Please choose a smaller file';
      statusCode = 413;
    } else if (multerError.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Please upload only the requested file types';
    }
    
    return res.status(statusCode).json({
      error: 'Upload Error',
      message,
      code: multerError.code,
    });
  }

  // Handle our custom AppError
  if (err instanceof AppError) {
    const response: any = {
      error: err.message,
      statusCode: err.statusCode,
    };

    // Include details in development or for operational errors
    if (process.env.NODE_ENV !== 'production' || err.isOperational) {
      response.details = err.details;
    }

    return res.status(err.statusCode).json(response);
  }

  // Handle database errors
  if (err.message?.includes('duplicate key') || err.message?.includes('unique constraint')) {
    return res.status(409).json({
      error: 'Already Exists',
      message: 'This information is already in our system. Please try with different details',
    });
  }

  if (err.message?.includes('foreign key') || err.message?.includes('constraint')) {
    return res.status(400).json({
      error: 'Invalid Selection',
      message: 'Please check your selections and try again',
    });
  }

  // Default error response for unhandled errors
  const isDevelopment = process.env.NODE_ENV !== 'production';
  res.status(500).json({
    error: 'Technical Difficulty',
    message: isDevelopment ? err.message : 'We\'re experiencing technical difficulties. Please try again in a few moments',
    ...(isDevelopment && { stack: err.stack }),
  });
}

// Async error wrapper to catch errors in async route handlers
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Middleware to handle 404 errors
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: 'Page Not Found',
    message: 'The page you\'re looking for doesn\'t exist. Please check the URL or go back to the home page',
  });
}

// Validation middleware factory
export function validateRequest(schema: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}