interface BrowserProfile {
  name: string;
  userAgent: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  accept: string;
  acceptLanguage: string;
  acceptEncoding: string;
}

const BROWSER_PROFILES: BrowserProfile[] = [
  {
    name: 'Chrome 120 Windows',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptEncoding: 'gzip, deflate, br',
  },
  {
    name: 'Chrome 120 macOS',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptEncoding: 'gzip, deflate, br',
  },
  {
    name: 'Firefox 121 Windows',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    secChUa: '',
    secChUaMobile: '',
    secChUaPlatform: '',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.5',
    acceptEncoding: 'gzip, deflate, br',
  },
  {
    name: 'Safari 17 macOS',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    secChUa: '',
    secChUaMobile: '',
    secChUaPlatform: '',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptEncoding: 'gzip, deflate, br',
  },
];

interface HeadersConfig {
  url: string;
  referer?: string;
  method?: string;
}

export class HeadersPolyfill {
  private currentProfile?: BrowserProfile;

  getRandomProfile(): BrowserProfile {
    const profile = BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
    this.currentProfile = profile;
    console.log(`[Headers] Using ${profile.name} profile`);
    return profile;
  }

  generateAuthenticHeaders(config: HeadersConfig): Record<string, string> {
    const profile = this.currentProfile || this.getRandomProfile();
    const isChrome = profile.name.includes('Chrome');
    
    const headers: Record<string, string> = {
      'user-agent': profile.userAgent,
      'accept': profile.accept,
      'accept-language': profile.acceptLanguage,
      'accept-encoding': profile.acceptEncoding,
      'cache-control': 'max-age=0',
      'upgrade-insecure-requests': '1',
      'connection': 'keep-alive',
    };

    // Chrome-specific sec-ch-ua headers
    if (isChrome && profile.secChUa) {
      headers['sec-ch-ua'] = profile.secChUa;
      headers['sec-ch-ua-mobile'] = profile.secChUaMobile;
      headers['sec-ch-ua-platform'] = profile.secChUaPlatform;
    }

    // sec-fetch headers (modern browsers)
    if (config.method === 'GET' || !config.method) {
      headers['sec-fetch-dest'] = 'document';
      headers['sec-fetch-mode'] = 'navigate';
      headers['sec-fetch-site'] = config.referer ? 'same-origin' : 'none';
      headers['sec-fetch-user'] = '?1';
    }

    // Referer if provided
    if (config.referer) {
      headers['referer'] = config.referer;
    }

    return headers;
  }

  getCurrentProfile(): BrowserProfile | undefined {
    return this.currentProfile;
  }

  rotateProfile(): BrowserProfile {
    return this.getRandomProfile();
  }

  getStats() {
    return {
      currentProfile: this.currentProfile?.name || 'None',
      availableProfiles: BROWSER_PROFILES.length,
      browser: this.currentProfile?.name.split(' ')[0] || 'None',
    };
  }
}

export const headersPolyfill = new HeadersPolyfill();
