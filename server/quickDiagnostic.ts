// Full System Diagnostic Test Suite for BadBlue
// Tests all critical components and reports status

import { db } from './db';
import { emailTransporter } from './emailService';
import { getGroqClient } from './groq';
import { callGemini } from './gemini';
import { getSquareClient, getSquareLocationId } from './squareClient';
import { config as dotenvConfig } from 'dotenv';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

dotenvConfig();

interface DiagnosticResult {
  component: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: any;
}

class SystemDiagnostics {
  private results: DiagnosticResult[] = [];

  private addResult(component: string, status: 'PASS' | 'FAIL' | 'WARN', message: string, details?: any) {
    this.results.push({ component, status, message, details });
    console.log(`[${status}] ${component}: ${message}`);
  }

  // Test 1: Environment Variables
  async testEnvironmentVariables() {
    const requiredVars = [
      { name: 'DATABASE_URL', critical: true },
      { name: 'GWSMTP_USER', critical: false },
      { name: 'GWSMTP_PASSWORD', critical: false },
      { name: 'SQUARE_ACCESS_TOKEN', critical: true },
      { name: 'SQUARE_LOCATION_ID', critical: true },
      { name: 'GROQ_API_KEY', critical: true },
      { name: 'GEMINI_API_KEY', critical: false }
    ];

    for (const envVar of requiredVars) {
      if (process.env[envVar.name]) {
        this.addResult(
          `ENV:${envVar.name}`,
          'PASS',
          'Environment variable is set'
        );
      } else {
        this.addResult(
          `ENV:${envVar.name}`,
          envVar.critical ? 'FAIL' : 'WARN',
          `Environment variable is ${envVar.critical ? 'REQUIRED but' : ''} not set`
        );
      }
    }
  }

  // Test 2: Database Connection
  async testDatabase() {
    try {
      // Test basic connection
      await db.execute('SELECT 1 as test');
      this.addResult('Database:Connection', 'PASS', 'Database is connected');

      // Test table access - using actual Drizzle schema table names
      const tables = [
        'users',
        'officer_profiles',
        'complaints',
        'lawsuit_filings',
        'petitions',
        'user_subscriptions',
        'public_evidence'
      ];

      for (const table of tables) {
        try {
          await db.execute(`SELECT COUNT(*) FROM ${table}`);
          this.addResult(`Database:Table:${table}`, 'PASS', `Table ${table} is accessible`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.addResult(`Database:Table:${table}`, 'FAIL', `Cannot access table: ${message}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.addResult('Database:Connection', 'FAIL', `Database connection failed: ${message}`);
    }
  }

  // Test 3: Email Service
  async testEmailService() {
    try {
      if (!process.env.GWSMTP_USER || !process.env.GWSMTP_PASSWORD) {
        this.addResult('Email:Config', 'WARN', 'Email credentials not configured');
        return;
      }

      // Verify SMTP connection
      await emailTransporter.verify();
      this.addResult('Email:SMTP', 'PASS', 'SMTP connection verified');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.addResult('Email:SMTP', 'FAIL', `Email service error: ${message}`);
    }
  }

  // Test 4: AI Services
  async testAIServices() {
    // Test Groq
    try {
      if (!process.env.GROQ_API_KEY) {
        this.addResult('AI:Groq', 'FAIL', 'GROQ_API_KEY not configured');
      } else {
        const groq = getGroqClient();
        const response = await groq.chat.completions.create({
          messages: [{ role: 'user', content: 'Respond with OK' }],
          model: 'llama-3.1-8b-instant',
          max_tokens: 10
        });
        if (response.choices[0]?.message?.content) {
          this.addResult('AI:Groq', 'PASS', 'Groq API is working');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.addResult('AI:Groq', 'FAIL', `Groq API error: ${message}`);
    }

    // Test Gemini
    try {
      if (!process.env.GEMINI_API_KEY) {
        this.addResult('AI:Gemini', 'WARN', 'GEMINI_API_KEY not configured');
      } else {
        const result = await callGemini('Respond with OK', {}, 10);
        if (result && result.includes('OK')) {
          this.addResult('AI:Gemini', 'PASS', 'Gemini API is working');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.addResult('AI:Gemini', 'WARN', `Gemini API error (using Groq fallback): ${message}`);
    }
  }

  // Test 5: Stripe Payment System
  async testStripePayments() {
    try {
      const accessToken = process.env.SQUARE_ENVIRONMENT === 'production' 
        ? process.env.SQUARE_ACCESS_TOKEN 
        : process.env.SQUARE_SANDBOX_ACCESS_TOKEN;
        
      if (!accessToken) {
        this.addResult('Payment:Square', 'FAIL', 'Square access token not configured');
        return;
      }

      const square = getSquareClient();

      // Test API connection
      const locationsResponse = await square.locations.list();
      const locations = locationsResponse.locations || [];
      this.addResult('Payment:Square', 'PASS', `Connected to Square (${locations.length} locations)`);

      // Check location
      try {
        const locationId = getSquareLocationId();
        const locationResponse = await square.locations.get({ locationId: locationId });
        const location = locationResponse.location;
        if (location) {
          this.addResult('Payment:Location', 'PASS', `Square location configured: ${location.name}`);
        }
      } catch (e) {
        this.addResult('Payment:Location', 'WARN', 'Square location not found');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorMsg = (err as any).errors?.[0]?.detail || message;
      this.addResult('Payment:Square', 'FAIL', `Square error: ${errorMsg}`);
    }
  }

  // Test 6: File Storage
  async testFileStorage() {
    const directories = [
      'uploads',
      'uploads/evidence',
      'uploads/temp',
      'data',
      'logs'
    ];

    for (const dir of directories) {
      const fullPath = join(process.cwd(), dir);
      if (existsSync(fullPath)) {
        this.addResult(`Storage:${dir}`, 'PASS', `Directory exists: ${dir}`);
      } else {
        try {
          mkdirSync(fullPath, { recursive: true });
          this.addResult(`Storage:${dir}`, 'PASS', `Directory created: ${dir}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.addResult(`Storage:${dir}`, 'FAIL', `Cannot create directory: ${message}`);
        }
      }
    }
  }

  // Test 7: Authentication System
  async testAuthSystem() {
    // Check if admin bypass is configured via environment variables (both required)
    const adminIdConfigured = !!process.env.ADMIN_BYPASS_ID;
    const adminPassConfigured = !!process.env.ADMIN_BYPASS_PASSWORD;
    if (adminIdConfigured && adminPassConfigured) {
      this.addResult('Auth:AdminBypass', 'PASS', 'Admin bypass credentials configured via environment');
    } else if (adminIdConfigured || adminPassConfigured) {
      this.addResult('Auth:AdminBypass', 'WARN', 'Admin bypass partially configured - set BOTH ADMIN_BYPASS_ID and ADMIN_BYPASS_PASSWORD');
    } else {
      this.addResult('Auth:AdminBypass', 'PASS', 'Admin bypass disabled (no hardcoded credentials - secure mode)');
    }

    // Test session store
    try {
      if (process.env.DATABASE_URL) {
        this.addResult('Auth:Sessions', 'PASS', 'Database session store configured');
      } else {
        this.addResult('Auth:Sessions', 'WARN', 'Using in-memory session store (not for production)');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.addResult('Auth:Sessions', 'WARN', `Session store issue: ${message}`);
    }
  }

  // Test 8: API Endpoints - using actual registered routes
  async testAPIEndpoints() {
    const baseURL = process.env.BASE_URL || 'http://localhost:5000';
    const criticalEndpoints = [
      { path: '/api/health', method: 'GET', critical: true },
      { path: '/api/auth/user', method: 'GET', critical: true },
      { path: '/api/maintenance-status', method: 'GET', critical: false },
      { path: '/api/support-email', method: 'GET', critical: false }
    ];

    for (const endpoint of criticalEndpoints) {
      try {
        const response = await fetch(`${baseURL}${endpoint.path}`, {
          method: endpoint.method,
          headers: { 'Content-Type': 'application/json' },
          body: endpoint.method === 'POST' ? '{}' : undefined
        });

        if (response.ok || response.status === 401) {
          this.addResult(
            `API:${endpoint.path}`,
            'PASS',
            `Endpoint responding (${response.status})`
          );
        } else {
          this.addResult(
            `API:${endpoint.path}`,
            endpoint.critical ? 'FAIL' : 'WARN',
            `Endpoint error: ${response.status}`
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.addResult(
          `API:${endpoint.path}`,
          endpoint.critical ? 'FAIL' : 'WARN',
          `Cannot reach endpoint: ${message}`
        );
      }
    }
  }

  // Generate summary report
  generateReport() {
    const summary = {
      totalTests: this.results.length,
      passed: this.results.filter(r => r.status === 'PASS').length,
      failed: this.results.filter(r => r.status === 'FAIL').length,
      warnings: this.results.filter(r => r.status === 'WARN').length
    };

    const criticalFailures = this.results
      .filter(r => r.status === 'FAIL')
      .map(r => `${r.component}: ${r.message}`);

    const warnings = this.results
      .filter(r => r.status === 'WARN')
      .map(r => `${r.component}: ${r.message}`);

    return {
      summary,
      criticalFailures,
      warnings,
      fullResults: this.results,
      overallStatus: criticalFailures.length === 0 ? 'OPERATIONAL' : 'DEGRADED'
    };
  }

  // Run all tests
  async runFullDiagnostics() {
    console.log('='.repeat(60));
    console.log('BADBLUE SYSTEM DIAGNOSTICS - FULL SCAN');
    console.log('='.repeat(60));
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('');

    await this.testEnvironmentVariables();
    console.log('');

    await this.testDatabase();
    console.log('');

    await this.testEmailService();
    console.log('');

    await this.testAIServices();
    console.log('');

    await this.testStripePayments();
    console.log('');

    await this.testFileStorage();
    console.log('');

    await this.testAuthSystem();
    console.log('');

    await this.testAPIEndpoints();
    console.log('');

    const report = this.generateReport();

    console.log('='.repeat(60));
    console.log('DIAGNOSTIC SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${report.summary.totalTests}`);
    console.log(`✅ Passed: ${report.summary.passed}`);
    console.log(`❌ Failed: ${report.summary.failed}`);
    console.log(`⚠️  Warnings: ${report.summary.warnings}`);
    console.log(`Overall Status: ${report.overallStatus}`);
    console.log('');

    if (report.criticalFailures.length > 0) {
      console.log('CRITICAL FAILURES:');
      report.criticalFailures.forEach(f => console.log(`  ❌ ${f}`));
      console.log('');
    }

    if (report.warnings.length > 0) {
      console.log('WARNINGS:');
      report.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
      console.log('');
    }

    console.log('='.repeat(60));

    return report;
  }
}

// Export for API endpoint
export async function runSystemDiagnostics() {
  const diagnostics = new SystemDiagnostics();
  return await diagnostics.runFullDiagnostics();
}

// Run diagnostics if executed directly (ESM compatible)
const isMainModule = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('quickDiagnostic.ts');

if (isMainModule) {
  runSystemDiagnostics()
    .then(report => {
      process.exit(report.overallStatus === 'OPERATIONAL' ? 0 : 1);
    })
    .catch(err => {
      console.error('Diagnostic error:', err);
      process.exit(1);
    });
}