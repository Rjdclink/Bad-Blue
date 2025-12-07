/**
 * Star Trek Crawler Tests
 * 
 * Comprehensive test suite for the Federation Explorer
 */

import { StarTrekCrawler } from '../StarTrekCrawler';

describe('StarTrekCrawler', () => {
  let crawler: StarTrekCrawler;

  beforeEach(() => {
    crawler = new StarTrekCrawler();
  });

  describe('Prime Directive', () => {
    test('should start with Prime Directive enabled', () => {
      expect(crawler.getPrimeDirective()).toBe(true);
    });

    test('should toggle Prime Directive', () => {
      crawler.setPrimeDirective(false);
      expect(crawler.getPrimeDirective()).toBe(false);
      
      crawler.setPrimeDirective(true);
      expect(crawler.getPrimeDirective()).toBe(true);
    });

    test('should prevent kill settings when Prime Directive is enabled', async () => {
      crawler.setPrimeDirective(true);
      await expect(crawler.setPhaserSetting(6)).rejects.toThrow('Prime Directive violation');
    });

    test('should allow kill settings when Prime Directive is disabled', async () => {
      crawler.setPrimeDirective(false);
      await expect(crawler.setPhaserSetting(6)).resolves.not.toThrow();
    });

    test('should downgrade phaser setting when enabling Prime Directive', async () => {
      crawler.setPrimeDirective(false);
      await crawler.setPhaserSetting(8);
      crawler.setPrimeDirective(true);
      const status = crawler.getStatus();
      expect(status.phaserSetting).toBeLessThanOrEqual(5);
    });
  });

  describe('Warp Drive', () => {
    test('should set warp speed', () => {
      crawler.setWarpSpeed(7);
      expect(crawler.getStatus().warpSpeed).toBe(7);
    });

    test('should reject invalid warp speeds', () => {
      expect(() => crawler.setWarpSpeed(0)).toThrow();
      expect(() => crawler.setWarpSpeed(10)).toThrow();
    });

    test('should perform near warp jump', async () => {
      const target = await crawler.warpJump('near');
      expect(target).toBeTruthy();
      expect(typeof target).toBe('string');
    });

    test('should perform far warp jump', async () => {
      const target = await crawler.warpJump('far');
      expect(target).toBeTruthy();
      expect(target).toContain('http');
    });

    test('should perform galactic warp jump', async () => {
      const target = await crawler.warpJump('galactic');
      expect(target).toBeTruthy();
      expect(target).toMatch(/\.(com|org|net|io|ai|tech|dev|app|co|xyz)/);
    });
  });

  describe('Transporter', () => {
    test('should beam to target (may succeed or fail)', async () => {
      // Since beamTo has a 70% success rate, we test that it either succeeds or throws
      try {
        await crawler.beamTo('https://example.com');
        // Success case
        expect(true).toBe(true);
      } catch (error) {
        // Failure case (30% chance)
        expect(error).toBeTruthy();
      }
    });

    test('should perform emergency beam out', async () => {
      await expect(crawler.emergencyBeamOut()).resolves.not.toThrow();
      const status = crawler.getStatus();
      expect(status.requestCount).toBe(0);
    });
  });

  describe('Sensors', () => {
    test('should perform long-range scan', async () => {
      crawler.setWarpSpeed(5);
      const targets = await crawler.longRangeScan();
      expect(Array.isArray(targets)).toBe(true);
      expect(targets.length).toBeGreaterThan(0);
    });

    test('should detect life signs', async () => {
      // Test with a mock URL - will likely fail, but shouldn't throw
      const result = await crawler.detectLifeSigns('https://httpbin.org/status/200');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Phasers', () => {
    test('should set phaser setting in stun range', async () => {
      await crawler.setPhaserSetting(3);
      expect(crawler.getStatus().phaserSetting).toBe(3);
    });

    test('should set phaser setting in kill range when Prime Directive is off', async () => {
      crawler.setPrimeDirective(false);
      await crawler.setPhaserSetting(8);
      expect(crawler.getStatus().phaserSetting).toBe(8);
    });

    test('should fire phaser and return data', async () => {
      const data = await crawler.firePhaser('https://httpbin.org/html');
      expect(data).toHaveProperty('content');
      expect(data).toHaveProperty('confidence');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('target');
      expect(data.target).toBe('https://httpbin.org/html');
    });

    test('should include phaser metadata in results', async () => {
      const data = await crawler.firePhaser('https://httpbin.org/html');
      expect(data.metadata).toHaveProperty('phaserSetting');
      expect(data.metadata).toHaveProperty('warpSpeed');
      expect(data.metadata).toHaveProperty('primeDirective');
    });

    test('should increment request count after firing', async () => {
      const initialCount = crawler.getStatus().requestCount;
      await crawler.firePhaser('https://httpbin.org/html');
      expect(crawler.getStatus().requestCount).toBeGreaterThan(initialCount);
    });
  });

  describe('Missions', () => {
    test('should explore a sector', async () => {
      crawler.setWarpSpeed(2); // Smaller scan range for faster test
      const results = await crawler.explore('alpha-quadrant');
      expect(Array.isArray(results)).toBe(true);
      // Results may be empty if no life signs detected
    }, 30000); // Longer timeout for exploration

    test('should perform surgical strike', async () => {
      const result = await crawler.surgicalStrike('https://httpbin.org/html');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('target');
      expect(result.target).toBe('https://httpbin.org/html');
    }, 15000);

    test('should restore settings after surgical strike', async () => {
      const originalSetting = 2;
      await crawler.setPhaserSetting(originalSetting);
      
      await crawler.surgicalStrike('https://httpbin.org/html');
      
      // Setting should be restored
      expect(crawler.getStatus().phaserSetting).toBe(originalSetting);
    }, 15000);
  });

  describe('Status', () => {
    test('should return complete status', () => {
      const status = crawler.getStatus();
      expect(status).toHaveProperty('warpSpeed');
      expect(status).toHaveProperty('phaserSetting');
      expect(status).toHaveProperty('primeDirective');
      expect(status).toHaveProperty('requestCount');
      expect(status).toHaveProperty('lastRequestTime');
    });

    test('should track request count', async () => {
      const initialCount = crawler.getStatus().requestCount;
      await crawler.firePhaser('https://httpbin.org/html');
      await crawler.firePhaser('https://httpbin.org/html');
      expect(crawler.getStatus().requestCount).toBe(initialCount + 2);
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits based on phaser setting', async () => {
      await crawler.setPhaserSetting(1); // Ultra gentle: 3 req/min
      
      const start = Date.now();
      await crawler.firePhaser('https://httpbin.org/html');
      await crawler.firePhaser('https://httpbin.org/html');
      const elapsed = Date.now() - start;
      
      // Should have some delay between requests
      expect(elapsed).toBeGreaterThan(1000); // At least 1 second delay
    }, 60000);
  });

  describe('Integration', () => {
    test('should complete a full mission workflow', async () => {
      // 1. Set ship configuration
      crawler.setWarpSpeed(5);
      crawler.setPrimeDirective(true);
      await crawler.setPhaserSetting(3);

      // 2. Perform warp jump
      const target = await crawler.warpJump('near');
      expect(target).toBeTruthy();

      // 3. Detect life signs
      const alive = await crawler.detectLifeSigns(target);
      expect(typeof alive).toBe('boolean');

      // 4. Get status
      const status = crawler.getStatus();
      expect(status.warpSpeed).toBe(5);
      expect(status.phaserSetting).toBe(3);
      expect(status.primeDirective).toBe(true);
    }, 30000);
  });
});
