#!/usr/bin/env node
/**
 * Test script for Gemini AI integration
 * Run with: node test-genai.mjs
 * 
 * Prerequisites:
 * - GEMINI_API_KEY or GOOGLE_API_KEY environment variable must be set
 */

import { GoogleGenAI } from '@google/genai';

async function testGeminiBasic() {
  console.log('🔍 Testing Gemini API basic connectivity...\n');

  // Check for API key
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable is not set');
    process.exit(1);
  }

  console.log('✓ API key found');

  try {
    const client = new GoogleGenAI({ apiKey });

    console.log('Testing gemini-2.5-flash model...');
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Say "Hello from Gemini" and nothing else.',
      config: {
        temperature: 0,
        maxOutputTokens: 50,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    console.log(`Response: "${text.trim()}"`);
    console.log('\n✅ Gemini basic test passed');
    return true;
  } catch (error) {
    console.error('\n❌ Gemini basic test failed:', error.message);
    return false;
  }
}

// Run the test
testGeminiBasic()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
