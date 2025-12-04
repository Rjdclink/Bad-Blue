// Quick test for Gemini and SMTP services
import { GoogleGenAI } from '@google/genai';
import nodemailer from 'nodemailer';

console.log('Testing services...\n');

// Test Gemini
console.log('1. Testing Gemini API...');
try {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  console.log('   API Key present:', !!apiKey);
  
  const genAI = new GoogleGenAI(apiKey);
  console.log('   GoogleGenAI instantiated');
  
  // Check if getGenerativeModel exists
  console.log('   getGenerativeModel exists:', typeof genAI.getGenerativeModel);
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  console.log('   Model created');
  
  const result = await model.generateContent('Say "Hello"');
  const text = result.response.text();
  console.log('   ✅ Gemini working! Response:', text.substring(0, 50));
} catch (error) {
  console.log('   ❌ Gemini error:', error.message);
}

// Test SMTP
console.log('\n2. Testing SMTP...');
try {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.GWSMTP_USER,
      pass: process.env.GWSMTP_PASS,
    },
  });
  
  console.log('   User:', process.env.GWSMTP_USER);
  console.log('   Pass:', process.env.GWSMTP_PASS ? '***configured***' : 'missing');
  
  await transporter.verify();
  console.log('   ✅ SMTP authentication successful!');
} catch (error) {
  console.log('   ❌ SMTP error:', error.message);
  console.log('\n   Note: Gmail requires an App Password if 2FA is enabled.');
  console.log('   To fix: Go to Google Account > Security > 2-Step Verification > App passwords');
  console.log('   Generate an app password for "Mail" and use that instead.');
}