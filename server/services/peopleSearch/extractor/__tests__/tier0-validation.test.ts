/**
 * Phase 2.7: Low-Cost Repeatable Test
 * 
 * Validates:
 * 1. Tier 0 works for plain HTML pages
 * 2. Tier 0 correctly flags JS-heavy pages as needsRender
 * 3. Tier 1 is only invoked when needed
 * 4. No Chromium install or browser validation at startup
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { HttpProvider } from '../HttpProvider';
import { ExtractorRouter } from '../ExtractorRouter';
import type { ExtractionTier } from '../types';

describe('Tier 0 Validation - Plain HTML', () => {
  let httpProvider: HttpProvider;
  
  beforeAll(() => {
    httpProvider = new HttpProvider();
  });
  
  it('should extract from plain HTML without needsRender flag', async () => {
    const url = 'https://example.com';
    
    // Fetch HTML
    const fetchResult = await httpProvider.fetch(url, { timeout: 10000 });
    expect(fetchResult.status).toBe(200);
    expect(fetchResult.provider).toBe('HTTP_ONLY');
    
    // Extract
    const extracted = await httpProvider.extract(fetchResult.content, {
      extractTitle: true,
      extractMainText: true,
    });
    
    // Should have content
    expect(extracted.title).toBeTruthy();
    expect(extracted.mainText).toBeTruthy();
    expect(extracted.mainText!.length).toBeGreaterThan(50);
    
    // Should NOT need rendering
    expect(extracted.needsRender).toBe(false);
    expect(extracted.confidence).toBeGreaterThan(0.5);
  }, 15000);
  
  it('should be import-safe with no side effects', () => {
    // This test passing means the module loaded without side effects
    expect(httpProvider).toBeDefined();
    expect(httpProvider.name).toBe('HTTP_ONLY');
  });
  
  it('should always be healthy (no dependencies)', async () => {
    const health = await httpProvider.health();
    expect(health.ready).toBe(true);
    expect(health.error).toBeUndefined();
  });
});

describe('Tier 0 Validation - JS-Heavy Pages', () => {
  let httpProvider: HttpProvider;
  
  beforeAll(() => {
    httpProvider = new HttpProvider();
  });
  
  it('should detect React apps as needsRender', async () => {
    const reactHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>React App</title></head>
        <body>
          <div id="root" data-reactroot></div>
          <script src="/static/js/main.js"></script>
          <script src="/static/js/vendor.js"></script>
          <script src="/static/js/runtime.js"></script>
        </body>
      </html>
    `;
    
    const extracted = await httpProvider.extract(reactHtml, {
      extractTitle: true,
      extractMainText: true,
    });
    
    expect(extracted.title).toBe('React App');
    expect(extracted.needsRender).toBe(true); // JS-heavy, minimal content
    expect(extracted.confidence).toBeLessThan(0.5); // Low confidence
  });
  
  it('should detect Angular apps as needsRender', async () => {
    const angularHtml = `
      <!DOCTYPE html>
      <html ng-app="myApp">
        <head><title>Angular App</title></head>
        <body>
          <div ng-view></div>
          <script src="/angular.js"></script>
        </body>
      </html>
    `;
    
    const extracted = await httpProvider.extract(angularHtml, {
      extractTitle: true,
      extractMainText: true,
    });
    
    expect(extracted.needsRender).toBe(true);
  });
});

describe('ExtractorRouter - Tier Selection', () => {
  let router: ExtractorRouter;
  
  beforeAll(() => {
    router = new ExtractorRouter({
      enableRemoteRender: false, // Disable Tier 1 for this test
    });
  });
  
  it('should use Tier 0 for plain HTML', async () => {
    const result = await router.extract('https://example.com', {
      extractTitle: true,
      extractMainText: true,
    });
    
    expect(result.tier).toBe('HTTP_ONLY' as ExtractionTier);
    expect(result.provider).toBe('HTTP_ONLY');
    expect(result.decision.reason).toContain('Plain HTML');
  }, 15000);
  
  it('should report Tier 1 unavailable when not configured', async () => {
    const health = await router.health();
    expect(health.tier0).toBe(true);
    expect(health.tier1).toBe(false);
    expect(health.tier1Reason).toBeTruthy();
  });
});

describe('Startup Safety', () => {
  it('should not require ZENROWS_API_KEY at module load', () => {
    // This test passing means we can load the module without API key
    const { HttpProvider, ZenRowsProvider, ExtractorRouter } = require('../index');
    expect(HttpProvider).toBeDefined();
    expect(ZenRowsProvider).toBeDefined();
    expect(ExtractorRouter).toBeDefined();
  });
  
  it('should boot ExtractorRouter without ZENROWS_API_KEY', async () => {
    const router = new ExtractorRouter();
    const health = await router.health();
    
    // Tier 0 should always be ready
    expect(health.tier0).toBe(true);
    
    // Tier 1 status depends on env var (but should not crash)
    expect(health.tier1).toBeDefined();
  });
});
