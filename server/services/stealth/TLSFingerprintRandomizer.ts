interface TLSProfile {
  name: string;
  ciphers: string[];
  minVersion: string;
  maxVersion: string;
}

const BROWSER_TLS_PROFILES: TLSProfile[] = [
  {
    name: 'Chrome 120',
    ciphers: [
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
    ],
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
  },
  {
    name: 'Firefox 121',
    ciphers: [
      'TLS_AES_128_GCM_SHA256',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
    ],
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
  },
  {
    name: 'Safari 17',
    ciphers: [
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES256-GCM-SHA384',
    ],
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
  },
];

export class TLSFingerprintRandomizer {
  private currentProfile?: TLSProfile;

  getRandomProfile(): TLSProfile {
    const profile = BROWSER_TLS_PROFILES[Math.floor(Math.random() * BROWSER_TLS_PROFILES.length)];
    this.currentProfile = profile;
    console.log(`[TLS] Using ${profile.name} fingerprint`);
    return profile;
  }

  generateTLSOptions() {
    const profile = this.getRandomProfile();
    
    return {
      ciphers: profile.ciphers.join(':'),
      minVersion: profile.minVersion,
      maxVersion: profile.maxVersion,
      honorCipherOrder: true,
      ecdhCurve: 'prime256v1:secp384r1:secp521r1',
      sessionTimeout: 300,
    };
  }

  getCurrentProfile(): TLSProfile | undefined {
    return this.currentProfile;
  }

  getStats() {
    return {
      currentProfile: this.currentProfile?.name || 'None',
      availableProfiles: BROWSER_TLS_PROFILES.length,
    };
  }
}

export const tlsFingerprintRandomizer = new TLSFingerprintRandomizer();
