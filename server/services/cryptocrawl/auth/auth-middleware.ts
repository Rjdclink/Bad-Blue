import {Request, Response, NextFunction} from 'express';
import {validateToken} from './auth-controller';

// Middleware for protected routes
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  
  const token = authHeader.substring(7);
  const result = validateToken(token);
  
  if (!result.valid) {
    return res.status(401).json({
      success: false,
      message: result.expired ? 'Session expired, please login again' : 'Invalid token'
    });
  }
  
  // Attach user to request
  (req as any).user = {email: result.email};
  next();
}
