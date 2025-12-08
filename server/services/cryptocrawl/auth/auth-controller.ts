import express from 'express';
import crypto from 'crypto';

const router = express.Router();

// HARDCODED CREDENTIALS (as specified by user)
const VALID_CREDENTIALS = {
  email: 'cryptocrawler@gmail.com',
  password: 'CRYPTOCRAWLER'
};

// Simple token generation (JWT-like but simpler for this use case)
function generateToken(email: string): string {
  const payload = {
    email,
    iat: Date.now(),
    exp: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  // Use JWT_SECRET from env if available, otherwise use default
  // NOTE: In production, set JWT_SECRET env variable for enhanced security
  const secret = process.env.JWT_SECRET || 'cryptocrawl-secret-key-2024';
  const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return `${data}.${signature}`;
}

// Validate token
function validateToken(token: string): {valid: boolean, email?: string, expired?: boolean} {
  try {
    const [data, signature] = token.split('.');
    // Use same secret as generateToken
    // NOTE: In production, set JWT_SECRET env variable for enhanced security
    const secret = process.env.JWT_SECRET || 'cryptocrawl-secret-key-2024';
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex');
    
    if (signature !== expectedSig) {
      return {valid: false};
    }
    
    const payload = JSON.parse(Buffer.from(data, 'base64').toString());
    
    if (payload.exp < Date.now()) {
      return {valid: false, expired: true};
    }
    
    return {valid: true, email: payload.email};
  } catch {
    return {valid: false};
  }
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const {email, password} = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }
  
  // Check credentials (case-insensitive email, case-sensitive password)
  if (email.toLowerCase() === VALID_CREDENTIALS.email.toLowerCase() && 
      password === VALID_CREDENTIALS.password) {
    const token = generateToken(email);
    
    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        email: VALID_CREDENTIALS.email
      }
    });
  }
  
  return res.status(401).json({
    success: false,
    message: 'Invalid email or password'
  });
});

// POST /api/auth/verify - Verify token is still valid
router.post('/verify', (req, res) => {
  const {token} = req.body;
  
  if (!token) {
    return res.status(400).json({valid: false, message: 'Token required'});
  }
  
  const result = validateToken(token);
  
  if (result.valid) {
    return res.json({valid: true, email: result.email});
  }
  
  return res.status(401).json({
    valid: false,
    message: result.expired ? 'Token expired' : 'Invalid token'
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  // Client-side logout (clear localStorage)
  res.json({success: true, message: 'Logged out'});
});

// Export validateToken for use in middleware
export {router as authRouter, validateToken};
