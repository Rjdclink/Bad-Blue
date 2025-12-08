import {Request, Response, NextFunction} from 'express';
import {validateSession} from './auth-controller';

// Middleware for protected routes - uses platform session authentication
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const result = validateSession(req);
  
  if (!result.valid) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      redirectTo: '/login'
    });
  }
  
  // Attach user to request
  (req as any).user = {userId: result.userId};
  next();
}
