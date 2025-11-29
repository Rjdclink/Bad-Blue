#!/usr/bin/env node
/**
 * test-genai.mjs - Minimal Gemini API connectivity test
 * 
 * Usage: node test-genai.mjs
 * 
 * Requires: GEMINI_API_KEY environment variable
 */

import { GoogleGenAI } from '@google/genai';

// Stable model order for fallback
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-latest',
  'gemini-1.5-pro-latest',
];

async function testGeminiConnectivity() {
  console.log('🔍 Testing Gemini API connectivity...\n');

  // Check for API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY environment variable is not set');
    console.error('   Set it with: export GEMINI_API_KEY=your_api_key');
    process.exit(1);
  }

  console.log('✓ GEMINI_API_KEY is configured');

  // Initialize client
  const client = new GoogleGenAI({ apiKey });
  let successModel = null;

  // Test each model in fallback order
  for (const modelName of GEMINI_MODELS) {
    console.log(`\n🧪 Testing model: ${modelName}...`);
    
    try {
      const response = await client.models.generateContent({
        model: modelName,
        config: {
          temperature: 0.1,
          maxOutputTokens: 50,
        },
        contents: 'Reply with exactly: OK',
      });

      const text = response.text?.trim() || '';
      
      if (text) {
        console.log(`✓ Model ${modelName} responded: "${text}"`);
        successModel = modelName;
        break; // Success - stop testing
      } else {
        console.log(`⚠️ Model ${modelName} returned empty response`);
      }
    } catch (error) {
      console.log(`⚠️ Model ${modelName} failed: ${error.message}`);
    }
  }

  console.log('\n' + '─'.repeat(50));
  
  if (successModel) {
    console.log(`\n✅ Gemini API connectivity test PASSED`);
    console.log(`   Working model: ${successModel}`);
    console.log(`   Fallback chain: ${GEMINI_MODELS.join(' → ')}`);
    process.exit(0);
  } else {
    console.error(`\n❌ Gemini API connectivity test FAILED`);
    console.error(`   All models failed: ${GEMINI_MODELS.join(', ')}`);
    console.error(`   Check your API key and network connectivity`);
    process.exit(1);
  }
}

// Run the test
testGeminiConnectivity().catch((error) => {
  console.error('❌ Test failed with error:', error.message);
  process.exit(1);
});
