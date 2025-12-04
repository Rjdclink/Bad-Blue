#!/usr/bin/env node

/**
 * Favicon Generation Script
 * 
 * This script generates favicon files from the LegalWhat Icon for search engine results display.
 * 
 * Prerequisites:
 * npm install sharp --save-dev
 * 
 * Usage:
 * node scripts/generate-favicons.js
 */

const fs = require('fs');
const path = require('path');

const INPUT_IMAGE = path.join(__dirname, '..', 'public', 'images', 'Legal What Icon.png');
const OUTPUT_DIR = path.join(__dirname, '..', 'public');

const sizes = [
  { size: 16, name: 'favicon-16x16.png' },
  { size: 32, name: 'favicon-32x32.png' },
  { size: 48, name: 'favicon-48x48.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192x192.png' },
  { size: 512, name: 'icon-512x512.png' },
];

// Check if sharp is installed
let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  console.error('❌ Error: sharp package is not installed.');
  console.error('Please install it with: npm install sharp --save-dev');
  console.error('\nAlternatively, you can:');
  console.error('1. Use an online tool like https://realfavicongenerator.net/');
  console.error('2. Upload: public/images/Legal What Icon.png');
  console.error('3. Download and extract favicons to public/ directory');
  process.exit(1);
}

// Check if input image exists
if (!fs.existsSync(INPUT_IMAGE)) {
  console.error(`❌ Error: Input image not found at ${INPUT_IMAGE}`);
  process.exit(1);
}

console.log('🎨 Generating favicons from LegalWhat Icon...\n');

// Generate all favicon sizes
Promise.all(
  sizes.map(({ size, name }) => {
    const outputPath = path.join(OUTPUT_DIR, name);
    
    return sharp(INPUT_IMAGE)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(outputPath)
      .then(() => {
        console.log(`✅ Generated ${name} (${size}x${size})`);
      })
      .catch(err => {
        console.error(`❌ Error generating ${name}:`, err.message);
        throw err;
      });
  })
).then(() => {
  console.log('\n✨ All favicons generated successfully!');
  console.log('\nGenerated files:');
  sizes.forEach(({ name }) => console.log(`  - public/${name}`));
  console.log('\n📝 These favicons will be used for:');
  console.log('  - Browser tabs (favicon-16x16.png, favicon-32x32.png)');
  console.log('  - Search engine results display');
  console.log('  - iOS home screen (apple-touch-icon.png)');
  console.log('  - Android home screen (icon-192x192.png, icon-512x512.png)');
  console.log('\n🔍 To test:');
  console.log('  1. Clear browser cache');
  console.log('  2. Visit the site');
  console.log('  3. Check favicon appears in browser tab');
  console.log('  4. Add to home screen on mobile devices');
}).catch(err => {
  console.error('\n❌ Failed to generate favicons:', err.message);
  process.exit(1);
});
