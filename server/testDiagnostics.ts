// BadBlue - Comprehensive Service Diagnostics
// Tests all external services with actual API calls
// MIGRATED to @google/genai SDK (Nov 30, 2025) - @google/generative-ai is deprecated

import { db } from './db';
import { sql } from 'drizzle-orm';
import { getSquareClient, getSquareLocationId } from './squareClient';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from '@google/genai';

interface TestResult {
  service: string;
  status: '✓' | '✗' | '⚠';
  message: string;
  responseTime?: number;
  error?: string;
  details?: any;
}

export async function runComprehensiveDiagnostics(): Promise<{
  timestamp: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  services: TestResult[];
  recommendations: string[];
}> {
  const results: TestResult[] = [];
  const recommendations: string[] = [];
  const startTime = Date.now();

  // 1. DATABASE TEST
  console.log('[DIAGNOSTICS] Testing database connection...');
  try {
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1 as test`);
    const dbTime = Date.now() - dbStart;

    results.push({
      service: 'PostgreSQL Database',
      status: '✓',
      message: 'Database connection working',
      responseTime: dbTime,
      details: { latency: `${dbTime}ms` }
    });
  } catch (error: any) {
    results.push({
      service: 'PostgreSQL Database',
      status: '✗',
      message: 'Database connection failed',
      error: error.message
    });
    recommendations.push('Check DATABASE_URL environment variable and database server status');
  }

  // 2. SQUARE API TEST
  console.log('[DIAGNOSTICS] Testing Square API...');
  const accessToken = process.env.SQUARE_ENVIRONMENT === 'production' 
    ? process.env.SQUARE_ACCESS_TOKEN 
    : process.env.SQUARE_SANDBOX_ACCESS_TOKEN;
    
  if (!accessToken) {
    results.push({
      service: 'Square Payment API',
      status: '✗',
      message: 'Square access token not configured',
      error: 'Missing environment variable'
    });
    recommendations.push('Set SQUARE_ACCESS_TOKEN or SQUARE_SANDBOX_ACCESS_TOKEN in environment variables');
  } else {
    try {
      const squareStart = Date.now();
      const square = getSquareClient();
      const locationsResponse = await square.locations.list();
      const locations = locationsResponse.locations || [];
      const squareTime = Date.now() - squareStart;

      results.push({
        service: 'Square Payment API',
        status: '✓',
        message: `Square API connected successfully (${locations.length} locations)`,
        responseTime: squareTime,
        details: {
          locationCount: locations.length,
          environment: process.env.SQUARE_ENVIRONMENT || 'sandbox'
        }
      });
    } catch (error: any) {
      const errorMsg = error.errors?.[0]?.detail || error.message || 'Unknown error';
      if (errorMsg?.includes('rate limit')) {
        results.push({
          service: 'Square Payment API',
          status: '⚠',
          message: 'Square API rate limited',
          error: 'Rate limit exceeded - wait before retrying'
        });
      } else {
        results.push({
          service: 'Square Payment API',
          status: '✗',
          message: 'Square API connection failed',
          error: errorMsg
        });
        recommendations.push('Verify Square API key is valid and has proper permissions');
      }
    }
  }

  // 3. EMAIL SMTP TEST
  console.log('[DIAGNOSTICS] Testing SMTP email service...');
  // Check for GWSMTP_PASSWORD first (App Password format), then fall back to GWSMTP_PASS
  const password = process.env.GWSMTP_PASSWORD
    ? process.env.GWSMTP_PASSWORD.replace(/\s/g, '') // Remove spaces from App Password
    : process.env.GWSMTP_PASS;

  if (!process.env.GWSMTP_USER || !password) {
    results.push({
      service: 'Email Service (SMTP)',
      status: '✗',
      message: 'SMTP credentials not configured',
      error: 'Missing GWSMTP_USER or GWSMTP_PASSWORD/GWSMTP_PASS'
    });
    recommendations.push('Set GWSMTP_USER and GWSMTP_PASSWORD (or GWSMTP_PASS) in environment variables');
  } else {
    try {
      const emailStart = Date.now();
      const transporter = nodemailer.createTransport({
        host: process.env.GWSMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.GWSMTP_PORT || '465'),
        secure: true,
        auth: {
          user: process.env.GWSMTP_USER,
          pass: password,
        },
      });

      await transporter.verify();
      const emailTime = Date.now() - emailStart;

      results.push({
        service: 'Email Service (SMTP)',
        status: '✓',
        message: 'SMTP connection verified',
        responseTime: emailTime,
        details: {
          host: process.env.GWSMTP_HOST || 'smtp.gmail.com',
          user: process.env.GWSMTP_USER
        }
      });
    } catch (error: any) {
      results.push({
        service: 'Email Service (SMTP)',
        status: '✗',
        message: 'SMTP connection failed',
        error: error.message
      });
      recommendations.push('Check SMTP credentials and ensure 2FA/App passwords are configured if using Gmail');
    }
  }

  // 4. GOOGLE GEMINI API TEST (using new @google/genai SDK)
  console.log('[DIAGNOSTICS] Testing Google Gemini API...');
  if (!process.env.GEMINI_API_KEY) {
    results.push({
      service: 'Google Gemini AI',
      status: '✗',
      message: 'GEMINI_API_KEY not configured',
      error: 'Missing environment variable'
    });
    recommendations.push('Set GEMINI_API_KEY in environment variables');
  } else {
    try {
      const geminiStart = Date.now();
      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

      const result = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'Respond with just "OK" if working' }] }],
        config: { temperature: 0.0 }
      });
      const text = result.text || '';
      const geminiTime = Date.now() - geminiStart;

      if (text && text.length > 0) {
        results.push({
          service: 'Google Gemini AI',
          status: '✓',
          message: 'Gemini API working correctly',
          responseTime: geminiTime,
          details: {
            model: 'gemini-2.5-flash',
            responseLength: text.length
          }
        });
      } else {
        results.push({
          service: 'Google Gemini AI',
          status: '⚠',
          message: 'Gemini API connected but no response',
          responseTime: geminiTime
        });
      }
    } catch (error: any) {
      if (error.message?.includes('quota') || error.message?.includes('limit')) {
        results.push({
          service: 'Google Gemini AI',
          status: '⚠',
          message: 'Gemini API quota/rate limited',
          error: 'Quota exceeded - wait before retrying'
        });
        recommendations.push('Check Gemini API quota and consider upgrading plan if needed');
      } else {
        results.push({
          service: 'Google Gemini AI',
          status: '✗',
          message: 'Gemini API test failed',
          error: error.message
        });
        recommendations.push('Verify Gemini API key is valid and has proper permissions');
      }
    }
  }

  // 5. GROQ API TEST (using direct HTTP calls)
  console.log('[DIAGNOSTICS] Testing Groq API...');
  if (!process.env.GROQ_API_KEY) {
    results.push({
      service: 'Groq AI (Fallback)',
      status: '✗',
      message: 'GROQ_API_KEY not configured',
      error: 'Missing environment variable'
    });
    recommendations.push('Set GROQ_API_KEY in environment variables');
  } else {
    try {
      const groqStart = Date.now();

      // Use direct HTTP call to Groq API (OpenAI-compatible endpoint)
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Respond with just "OK" if working' }],
          temperature: 0,
          max_tokens: 10,
        }),
      });

      const groqTime = Date.now() - groqStart;

      if (!response.ok) {
        const errorText = await response.text();
        if (errorText.includes('rate limit')) {
          results.push({
            service: 'Groq AI (Fallback)',
            status: '⚠',
            message: 'Groq API rate limited',
            error: 'Rate limit exceeded - wait before retrying'
          });
          recommendations.push('Groq API is rate limited. Consider spacing out requests');
        } else {
          results.push({
            service: 'Groq AI (Fallback)',
            status: '✗',
            message: 'Groq API request failed',
            error: errorText.substring(0, 100)
          });
        }
      } else {
        const data = await response.json();
        const responseText = data.choices?.[0]?.message?.content;

        if (responseText) {
          results.push({
            service: 'Groq AI (Fallback)',
            status: '✓',
            message: 'Groq API working correctly',
            responseTime: groqTime,
            details: {
              model: 'llama-3.3-70b-versatile',
              responseLength: responseText.length
            }
          });
        } else {
          results.push({
            service: 'Groq AI (Fallback)',
            status: '⚠',
            message: 'Groq API connected but no response',
            responseTime: groqTime
          });
        }
      }
    } catch (error: any) {
      results.push({
        service: 'Groq AI (Fallback)',
        status: '✗',
        message: 'Groq API test failed',
        error: error.message
      });
      recommendations.push('Verify Groq API key is valid and network is accessible');
    }
  }

  // 6. OBJECT STORAGE TEST
  console.log('[DIAGNOSTICS] Testing object storage configuration...');
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;

  if (!bucketId || !publicPaths || !privateDir) {
    results.push({
      service: 'Object Storage',
      status: '⚠',
      message: 'Object storage partially configured',
      details: {
        hasBucket: !!bucketId,
        hasPublicPaths: !!publicPaths,
        hasPrivateDir: !!privateDir
      }
    });
    if (!bucketId) recommendations.push('Configure DEFAULT_OBJECT_STORAGE_BUCKET_ID for object storage');
  } else {
    results.push({
      service: 'Object Storage',
      status: '✓',
      message: 'Object storage configured',
      details: {
        bucketId: bucketId.substring(0, 20) + '...',
        publicPaths,
        privateDir
      }
    });
  }

  // 7. AUTHENTICATION TEST (Bypass Account)
  console.log('[DIAGNOSTICS] Testing authentication system...');
  try {
    // Check if the bypass user exists
    const bypassUser = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM users
      WHERE id = 'payment-bypass'
    `);

    const hasSession = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32;

    results.push({
      service: 'Authentication System',
      status: hasSession ? '✓' : '⚠',
      message: hasSession
        ? 'Authentication system configured'
        : 'Session secret is short or missing',
      details: {
        sessionSecretConfigured: !!process.env.SESSION_SECRET,
        bypassUserExists: Boolean(bypassUser.rows?.[0] && (bypassUser.rows[0] as { count: number }).count > 0)
      }
    });

    if (!hasSession) {
      recommendations.push('Ensure SESSION_SECRET is set and at least 32 characters long');
    }
  } catch (error: any) {
    results.push({
      service: 'Authentication System',
      status: '✗',
      message: 'Authentication system test failed',
      error: error.message
    });
  }

  // Calculate summary
  const totalTime = Date.now() - startTime;
  const passed = results.filter(r => r.status === '✓').length;
  const failed = results.filter(r => r.status === '✗').length;
  const warnings = results.filter(r => r.status === '⚠').length;

  // Add overall recommendation if issues found
  if (failed > 0) {
    recommendations.unshift(`⚠️ ${failed} service(s) are failing and need immediate attention`);
  }
  if (warnings > 0) {
    recommendations.push(`ℹ️ ${warnings} service(s) have warnings that should be reviewed`);
  }
  if (failed === 0 && warnings === 0) {
    recommendations.push('✅ All services are operational!');
  }

  return {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed,
      warnings
    },
    services: results,
    recommendations
  };
}