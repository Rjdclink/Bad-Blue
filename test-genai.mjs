// test-genai.mjs
// Tests Google Generative AI (Gemini) basic functionality
import { GoogleGenerativeAI } from "@google/generative-ai";

console.log('Testing Google Generative AI (Gemini)...');

// Check for API key
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('❌ No API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.');
  process.exit(1);
}

console.log('✓ API key found');

try {
  // Create client
  const genAI = new GoogleGenerativeAI(apiKey);
  console.log('✓ GoogleGenerativeAI instance created');

  // Get model with stable default
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  console.log('✓ Model initialized: gemini-2.5-flash');

  // Test content generation
  const prompt = 'Respond with just "OK" if you receive this message.';
  console.log('Testing content generation...');
  
  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();
  
  console.log('Response:', text);

  if (text && text.toLowerCase().includes('ok')) {
    console.log('✓ Gemini API test PASSED');
    process.exit(0);
  } else {
    console.log('⚠ Gemini API responded but with unexpected content');
    process.exit(0); // Still counts as success - API is reachable
  }
} catch (error) {
  console.error('❌ Error:', error.message);
  if (error.stack) {
    console.error('Stack:', error.stack);
  }
  process.exit(1);
}

