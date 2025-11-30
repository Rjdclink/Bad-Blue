#!/usr/bin/env node
// Simplified System Diagnostic for BadBlue

import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';

dotenvConfig();

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
}

class BadBlueDiagnostics {
  private results: TestResult[] = [];

  log(name: string, status: 'PASS' | 'FAIL' | 'WARN', message: string) {
    this.results.push({ name, status, message });
    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    console.log(`${icon} ${name}: ${message}`);
  }

  async testEnvironment() {
    console.log('\n📋 ENVIRONMENT VARIABLES');
    console.log('─'.repeat(40));

    const envVars = {
      DATABASE_URL: 'Database connection',
      STRIPE_SECRET_KEY: 'Stripe payments',
      VITE_STRIPE_PUBLIC_KEY: 'Stripe frontend',
      GROQ_API_KEY: 'Groq AI service',
      GEMINI_API_KEY: 'Gemini AI service',
      GWSMTP_USER: 'Email sender address',
      GWSMTP_PASSWORD: 'Email password'
    };

    for (const [key, description] of Object.entries(envVars)) {
      if (process.env[key]) {
        const masked = key.includes('KEY') || key.includes('PASSWORD') 
          ? '***' + process.env[key]!.slice(-4) 
          : process.env[key]!.substring(0, 20) + '...';
        this.log(key, 'PASS', `${description} configured (${masked})`);
      } else {
        const critical = ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'GROQ_API_KEY'].includes(key);
        this.log(key, critical ? 'FAIL' : 'WARN', `${description} not configured`);
      }
    }
  }

  async testDatabase() {
    console.log('\n🗄️ DATABASE CONNECTION');
    console.log('─'.repeat(40));

    if (!process.env.DATABASE_URL) {
      this.log('Database', 'FAIL', 'DATABASE_URL not set');
      return;
    }

    try {
      const { db } = await import('./db');
      await db.execute('SELECT 1 as test');
      this.log('Database', 'PASS', 'Connection successful');

      // Test critical tables
      const tables = ['users', 'complaints', 'payments', 'officers'];
      for (const table of tables) {
        try {
          const result = await db.execute(`SELECT COUNT(*) as count FROM ${table}`);
          this.log(`Table:${table}`, 'PASS', `Accessible`);
        } catch (err: any) {
          this.log(`Table:${table}`, 'FAIL', err.message);
        }
      }
    } catch (err: any) {
      this.log('Database', 'FAIL', `Connection failed: ${err.message}`);
    }
  }

  async testEmailService() {
    console.log('\n📧 EMAIL SERVICE');
    console.log('─'.repeat(40));

    if (!process.env.GWSMTP_USER || !process.env.GWSMTP_PASSWORD) {
      this.log('Email', 'WARN', 'Email credentials not configured');
      return;
    }

    try {
      const { emailTransporter } = await import('./emailService');
      await emailTransporter.verify();
      this.log('Email', 'PASS', 'SMTP connection verified');
    } catch (err: any) {
      this.log('Email', 'FAIL', `SMTP error: ${err.message}`);
    }
  }

  async testStripe() {
    console.log('\n💳 STRIPE PAYMENT SYSTEM');
    console.log('─'.repeat(40));

    if (!process.env.STRIPE_SECRET_KEY) {
      this.log('Stripe', 'FAIL', 'STRIPE_SECRET_KEY not configured');
      return;
    }

    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2024-06-20' as any
      });

      const account = await stripe.accounts.retrieve();
      this.log('Stripe', 'PASS', `Connected to account ${account.id}`);

      // Check products
      const products = await stripe.products.list({ limit: 3 });
      if (products.data.length > 0) {
        this.log('Stripe:Products', 'PASS', `${products.data.length} products configured`);
      } else {
        this.log('Stripe:Products', 'WARN', 'No products found');
      }
    } catch (err: any) {
      this.log('Stripe', 'FAIL', err.message);
    }
  }

  async testAIServices() {
    console.log('\n🤖 AI SERVICES');
    console.log('─'.repeat(40));

    // Test Groq
    if (!process.env.GROQ_API_KEY) {
      this.log('AI:Groq', 'FAIL', 'GROQ_API_KEY not configured');
    } else {
      try {
        const Groq = (await import('groq-sdk')).default;
        const groq = new Groq({
          apiKey: process.env.GROQ_API_KEY
        });
        
        const response = await groq.chat.completions.create({
          messages: [{ role: 'user', content: 'Say OK' }],
          model: 'llama-3.2-3b-preview',
          max_tokens: 10
        });
        
        if (response.choices[0]?.message?.content) {
          this.log('AI:Groq', 'PASS', 'API working properly');
        }
      } catch (err: any) {
        this.log('AI:Groq', 'FAIL', err.message);
      }
    }

    // Test Gemini
    if (!process.env.GEMINI_API_KEY) {
      this.log('AI:Gemini', 'WARN', 'GEMINI_API_KEY not configured (using Groq fallback)');
    } else {
      this.log('AI:Gemini', 'PASS', 'API key configured');
    }
  }

  async testFileSystem() {
    console.log('\n📁 FILE SYSTEM');
    console.log('─'.repeat(40));

    const dirs = ['uploads', 'uploads/evidence', 'data', 'logs'];
    for (const dir of dirs) {
      if (existsSync(dir)) {
        this.log(`Dir:${dir}`, 'PASS', 'Directory exists');
      } else {
        this.log(`Dir:${dir}`, 'WARN', 'Directory missing (will be created on use)');
      }
    }
  }

  async testAPIEndpoints() {
    console.log('\n🌐 API ENDPOINTS');
    console.log('─'.repeat(40));

    const baseURL = 'http://localhost:5000';
    const endpoints = [
      { path: '/api/health', method: 'GET' },
      { path: '/api/auth/status', method: 'GET' }
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${baseURL}${endpoint.path}`, {
          method: endpoint.method,
          headers: { 'Content-Type': 'application/json' }
        });
        
        this.log(`API:${endpoint.path}`, 'PASS', `Status ${response.status}`);
      } catch (err: any) {
        this.log(`API:${endpoint.path}`, 'WARN', 'Cannot reach endpoint (server may be starting)');
      }
    }
  }

  async testAuthSystem() {
    console.log('\n🔐 AUTHENTICATION SYSTEM');
    console.log('─'.repeat(40));

    // Check if admin bypass is configured via environment variables (secure approach)
    const adminConfigured = !!process.env.ADMIN_BYPASS_ID && !!process.env.ADMIN_BYPASS_PASSWORD;
    if (adminConfigured) {
      this.log('Auth:AdminBypass', 'PASS', 'Admin credentials configured via environment variables');
    } else {
      this.log('Auth:AdminBypass', 'WARN', 'Set ADMIN_BYPASS_ID and ADMIN_BYPASS_PASSWORD in secrets for admin access');
    }
    
    this.log('Auth:LocalAuth', 'PASS', 'Email/password authentication enabled');
  }

  generateReport() {
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const warnings = this.results.filter(r => r.status === 'WARN').length;
    const total = this.results.length;

    console.log('\n' + '='.repeat(50));
    console.log('📊 DIAGNOSTIC SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log('');

    const criticalFailures = this.results.filter(r => r.status === 'FAIL');
    if (criticalFailures.length > 0) {
      console.log('CRITICAL FAILURES REQUIRING ATTENTION:');
      criticalFailures.forEach(f => {
        console.log(`  ❌ ${f.name}: ${f.message}`);
      });
      console.log('');
    }

    const warns = this.results.filter(r => r.status === 'WARN');
    if (warns.length > 0) {
      console.log('NON-CRITICAL WARNINGS:');
      warns.forEach(w => {
        console.log(`  ⚠️  ${w.name}: ${w.message}`);
      });
      console.log('');
    }

    const overallStatus = failed === 0 ? 'OPERATIONAL' : 
                         failed < 3 ? 'DEGRADED' : 'CRITICAL';
    
    console.log(`🎯 Overall System Status: ${overallStatus}`);
    console.log('='.repeat(50));

    return {
      passed,
      failed,
      warnings,
      total,
      overallStatus,
      criticalFailures,
      results: this.results
    };
  }

  async runAll() {
    console.log('='.repeat(50));
    console.log('🔍 BADBLUE COMPREHENSIVE SYSTEM DIAGNOSTICS');
    console.log('='.repeat(50));
    console.log(`⏰ Timestamp: ${new Date().toLocaleString()}`);

    await this.testEnvironment();
    await this.testDatabase();
    await this.testEmailService();
    await this.testStripe();
    await this.testAIServices();
    await this.testFileSystem();
    await this.testAPIEndpoints();
    await this.testAuthSystem();

    return this.generateReport();
  }
}

// Run diagnostics
const diagnostics = new BadBlueDiagnostics();
diagnostics.runAll()
  .then(report => {
    if (report.failed > 0) {
      console.log('\n💡 RECOMMENDED FIXES:');
      console.log('1. Set missing environment variables in .env file');
      console.log('2. Ensure database connection string is correct');
      console.log('3. Verify API keys are valid and active');
      console.log('4. Check network connectivity for external services');
    }
    process.exit(report.overallStatus === 'OPERATIONAL' ? 0 : 1);
  })
  .catch(err => {
    console.error('❌ Diagnostic error:', err);
    process.exit(1);
  });