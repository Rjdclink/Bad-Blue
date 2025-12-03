// Test Google Gemini API with new @google/genai SDK
import { GoogleGenAI } from "@google/genai";

console.log('Testing Google GenAI SDK...');

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.error('❌ No API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY');
  process.exit(1);
}

try {
  console.log('Creating GoogleGenAI client...');
  const client = new GoogleGenAI({ apiKey });
  
  console.log('Sending test request...');
  const response = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: "Respond with just 'OK' if working" }] }]
  });
  
  const text = response.text || '';
  console.log('✅ Response:', text);
  console.log('✅ Gemini API is working correctly with new SDK');
  process.exit(0);
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
