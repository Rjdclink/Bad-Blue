import express from 'express';
import {Request, Response} from 'express';

const router = express.Router();

// Session-based validation - checks if user is authenticated via platform
function validateSession(req: Request): {valid: boolean, userId?: number} {
  if (req.session?.userId) {
    return {valid: true, userId: req.session.userId};
  }
  return {valid: false};
}

// GET /api/auth/crypto/verify - Verify platform session for CryptoCrawl access
router.get('/crypto/verify', (req: Request, res: Response) => {
  const result = validateSession(req);
  
  if (result.valid) {
    return res.json({
      valid: true,
      authenticated: true,
      userId: result.userId
    });
  }
  
  return res.status(401).json({
    valid: false,
    authenticated: false,
    message: 'Authentication required'
  });
});

// Export validateSession for use in middleware
export {router as authRouter, validateSession};
