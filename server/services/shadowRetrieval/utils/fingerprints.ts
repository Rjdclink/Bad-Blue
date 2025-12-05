/**
 * PANTHEON Shadow Retrieval - Browser Fingerprint Randomization
 * Generate realistic browser fingerprints to avoid detection
 */

import type { BrowserProfile } from '../types';

/**
 * Generate a random canvas fingerprint
 */
export function generateCanvasFingerprint(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a random WebGL fingerprint
 */
export function generateWebGLFingerprint(): string {
  const vendors = [
    'Google Inc. (Intel)',
    'Google Inc. (NVIDIA)',
    'Google Inc. (AMD)',
    'ANGLE (Intel, Intel(R) HD Graphics)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX)',
    'ANGLE (AMD, AMD Radeon)',
  ];
  
  const renderers = [
    'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (AMD, AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0)',
    'Intel Inc. - Mesa Intel(R) UHD Graphics 630 (CML GT2)',
    'NVIDIA Corporation - GeForce GTX 1660 Ti/PCIe/SSE2',
  ];
  
  return `${vendors[Math.floor(Math.random() * vendors.length)]} ~ ${renderers[Math.floor(Math.random() * renderers.length)]}`;
}

/**
 * Generate random viewport dimensions
 */
export function generateViewport(): { width: number; height: number } {
  const commonViewports = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 },
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
    { width: 1280, height: 1024 },
  ];
  
  return commonViewports[Math.floor(Math.random() * commonViewports.length)];
}

/**
 * Generate random screen dimensions
 */
export function generateScreen(): { width: number; height: number; colorDepth: number; pixelDepth: number } {
  const commonScreens = [
    { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    { width: 1366, height: 768, colorDepth: 24, pixelDepth: 24 },
    { width: 1536, height: 864, colorDepth: 24, pixelDepth: 24 },
    { width: 1440, height: 900, colorDepth: 24, pixelDepth: 24 },
    { width: 2560, height: 1440, colorDepth: 24, pixelDepth: 24 },
    { width: 1600, height: 900, colorDepth: 24, pixelDepth: 24 },
    { width: 3840, height: 2160, colorDepth: 24, pixelDepth: 24 }, // 4K
  ];
  
  return commonScreens[Math.floor(Math.random() * commonScreens.length)];
}

/**
 * Generate random language preferences
 */
export function generateLanguages(): string[] {
  const languageSets = [
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['en-US', 'en', 'es'],
    ['en-US', 'en', 'fr'],
    ['en-GB', 'en', 'de'],
    ['en-CA', 'en', 'fr-CA'],
    ['en-AU', 'en'],
  ];
  
  return languageSets[Math.floor(Math.random() * languageSets.length)];
}

/**
 * Generate random timezone
 */
export function generateTimezone(): string {
  const timezones = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Toronto',
    'America/Vancouver',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Australia/Sydney',
  ];
  
  return timezones[Math.floor(Math.random() * timezones.length)];
}

/**
 * Generate random hardware concurrency (CPU cores)
 */
export function generateHardwareConcurrency(): number {
  const commonCores = [2, 4, 6, 8, 12, 16];
  return commonCores[Math.floor(Math.random() * commonCores.length)];
}

/**
 * Generate random device memory (in GB)
 */
export function generateDeviceMemory(): number {
  const commonMemory = [2, 4, 8, 16, 32];
  return commonMemory[Math.floor(Math.random() * commonMemory.length)];
}

/**
 * Generate a complete browser profile with randomized fingerprints
 */
export function generateBrowserProfile(
  userAgent: string,
  platform: string
): BrowserProfile {
  return {
    userAgent,
    viewport: generateViewport(),
    platform,
    languages: generateLanguages(),
    timezone: generateTimezone(),
    webgl: generateWebGLFingerprint(),
    canvas: generateCanvasFingerprint(),
    screen: generateScreen(),
    hardwareConcurrency: generateHardwareConcurrency(),
    deviceMemory: generateDeviceMemory(),
    doNotTrack: Math.random() > 0.7 ? '1' : null,
  };
}

/**
 * Generate fonts list based on platform
 */
export function generateFontsList(platform: string): string[] {
  const commonFonts = [
    'Arial',
    'Helvetica',
    'Times New Roman',
    'Courier New',
    'Verdana',
    'Georgia',
    'Palatino',
    'Garamond',
    'Bookman',
    'Comic Sans MS',
    'Trebuchet MS',
    'Impact',
  ];
  
  const windowsFonts = [
    ...commonFonts,
    'Calibri',
    'Cambria',
    'Consolas',
    'Segoe UI',
    'Tahoma',
  ];
  
  const macFonts = [
    ...commonFonts,
    'Helvetica Neue',
    'San Francisco',
    'Lucida Grande',
    'Geneva',
    'Monaco',
    'Apple Symbols',
  ];
  
  const linuxFonts = [
    ...commonFonts,
    'Ubuntu',
    'Liberation Sans',
    'DejaVu Sans',
    'Droid Sans',
  ];
  
  switch (platform) {
    case 'Windows':
      return windowsFonts;
    case 'macOS':
      return macFonts;
    case 'Linux':
      return linuxFonts;
    default:
      return commonFonts;
  }
}

/**
 * Generate plugins list based on browser
 */
export function generatePluginsList(browser: string): string[] {
  if (browser === 'chrome' || browser === 'edge') {
    return [
      'PDF Viewer',
      'Chrome PDF Viewer',
      'Chromium PDF Viewer',
      'Native Client',
    ];
  } else if (browser === 'firefox') {
    return [
      'PDF Viewer',
      'Firefox PDF Viewer',
    ];
  } else if (browser === 'safari') {
    return [
      'PDF',
      'WebKit built-in PDF',
    ];
  }
  
  return [];
}

/**
 * Calculate entropy of a fingerprint (higher = more unique)
 */
export function calculateFingerprintEntropy(profile: BrowserProfile): number {
  let entropy = 0;
  
  // User agent entropy
  entropy += 5;
  
  // Screen resolution entropy
  entropy += 4.5;
  
  // Timezone entropy
  entropy += 3.5;
  
  // Language entropy
  entropy += 3;
  
  // Canvas fingerprint entropy
  entropy += 8;
  
  // WebGL entropy
  entropy += 7;
  
  // Hardware concurrency entropy
  entropy += 2;
  
  return entropy;
}

/**
 * Validate if a browser profile looks realistic
 */
export function validateBrowserProfile(profile: BrowserProfile): boolean {
  // Check if viewport is smaller than screen
  if (profile.viewport.width > profile.screen.width || 
      profile.viewport.height > profile.screen.height) {
    return false;
  }
  
  // Check if hardware concurrency is reasonable
  if (profile.hardwareConcurrency < 1 || profile.hardwareConcurrency > 128) {
    return false;
  }
  
  // Check if device memory is reasonable
  if (profile.deviceMemory && (profile.deviceMemory < 1 || profile.deviceMemory > 256)) {
    return false;
  }
  
  // Check if languages array is not empty
  if (profile.languages.length === 0) {
    return false;
  }
  
  return true;
}
