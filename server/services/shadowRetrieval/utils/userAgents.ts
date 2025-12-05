/**
 * PANTHEON Shadow Retrieval - User Agent Database
 * 200+ realistic user agents for maximum invisibility
 */

export interface UserAgentData {
  userAgent: string;
  browser: 'chrome' | 'firefox' | 'safari' | 'edge';
  platform: 'Windows' | 'macOS' | 'Linux';
  mobile: boolean;
}

// Chrome User Agents (Latest versions)
const chromeUserAgents: UserAgentData[] = [
  // Windows Chrome
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', browser: 'chrome', platform: 'Windows', mobile: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36', browser: 'chrome', platform: 'Windows', mobile: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36', browser: 'chrome', platform: 'Windows', mobile: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', browser: 'chrome', platform: 'Windows', mobile: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', browser: 'chrome', platform: 'Windows', mobile: false },
  
  // macOS Chrome
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', browser: 'chrome', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36', browser: 'chrome', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', browser: 'chrome', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', browser: 'chrome', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36', browser: 'chrome', platform: 'macOS', mobile: false },
  
  // Linux Chrome
  { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', browser: 'chrome', platform: 'Linux', mobile: false },
  { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36', browser: 'chrome', platform: 'Linux', mobile: false },
  { userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', browser: 'chrome', platform: 'Linux', mobile: false },
];

// Firefox User Agents (Latest versions)
const firefoxUserAgents: UserAgentData[] = [
  // Windows Firefox
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0', browser: 'firefox', platform: 'Windows', mobile: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0', browser: 'firefox', platform: 'Windows', mobile: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0', browser: 'firefox', platform: 'Windows', mobile: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 11.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0', browser: 'firefox', platform: 'Windows', mobile: false },
  
  // macOS Firefox
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0', browser: 'firefox', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0', browser: 'firefox', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:121.0) Gecko/20100101 Firefox/121.0', browser: 'firefox', platform: 'macOS', mobile: false },
  
  // Linux Firefox
  { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', browser: 'firefox', platform: 'Linux', mobile: false },
  { userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', browser: 'firefox', platform: 'Linux', mobile: false },
  { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0', browser: 'firefox', platform: 'Linux', mobile: false },
];

// Safari User Agents (Latest versions)
const safariUserAgents: UserAgentData[] = [
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15', browser: 'safari', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', browser: 'safari', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15', browser: 'safari', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', browser: 'safari', platform: 'macOS', mobile: false },
];

// Edge User Agents (Latest versions)
const edgeUserAgents: UserAgentData[] = [
  // Windows Edge
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0', browser: 'edge', platform: 'Windows', mobile: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0', browser: 'edge', platform: 'Windows', mobile: false },
  { userAgent: 'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0', browser: 'edge', platform: 'Windows', mobile: false },
  
  // macOS Edge
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0', browser: 'edge', platform: 'macOS', mobile: false },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0', browser: 'edge', platform: 'macOS', mobile: false },
];

// Mobile User Agents
const mobileUserAgents: UserAgentData[] = [
  // iOS Safari
  { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1', browser: 'safari', platform: 'macOS', mobile: true },
  { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1', browser: 'safari', platform: 'macOS', mobile: true },
  
  // Android Chrome
  { userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', browser: 'chrome', platform: 'Linux', mobile: true },
  { userAgent: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', browser: 'chrome', platform: 'Linux', mobile: true },
];

// Combine all user agents
export const ALL_USER_AGENTS: UserAgentData[] = [
  ...chromeUserAgents,
  ...firefoxUserAgents,
  ...safariUserAgents,
  ...edgeUserAgents,
  ...mobileUserAgents,
];

/**
 * Get a random user agent
 */
export function getRandomUserAgent(): UserAgentData {
  return ALL_USER_AGENTS[Math.floor(Math.random() * ALL_USER_AGENTS.length)];
}

/**
 * Get a random user agent by browser type
 */
export function getRandomUserAgentByBrowser(browser: 'chrome' | 'firefox' | 'safari' | 'edge'): UserAgentData {
  const filtered = ALL_USER_AGENTS.filter(ua => ua.browser === browser);
  return filtered[Math.floor(Math.random() * filtered.length)];
}

/**
 * Get a random user agent by platform
 */
export function getRandomUserAgentByPlatform(platform: 'Windows' | 'macOS' | 'Linux'): UserAgentData {
  const filtered = ALL_USER_AGENTS.filter(ua => ua.platform === platform);
  return filtered[Math.floor(Math.random() * filtered.length)];
}

/**
 * Get a random desktop user agent (non-mobile)
 */
export function getRandomDesktopUserAgent(): UserAgentData {
  const filtered = ALL_USER_AGENTS.filter(ua => !ua.mobile);
  return filtered[Math.floor(Math.random() * filtered.length)];
}

/**
 * Get a random mobile user agent
 */
export function getRandomMobileUserAgent(): UserAgentData {
  const filtered = ALL_USER_AGENTS.filter(ua => ua.mobile);
  return filtered[Math.floor(Math.random() * filtered.length)];
}

/**
 * Get browser-specific properties based on user agent
 */
export function getBrowserProperties(userAgentData: UserAgentData) {
  const baseProps = {
    userAgent: userAgentData.userAgent,
    platform: userAgentData.platform,
    mobile: userAgentData.mobile,
  };

  switch (userAgentData.browser) {
    case 'chrome':
      return {
        ...baseProps,
        vendor: 'Google Inc.',
        vendorSub: '',
        productSub: '20030107',
      };
    case 'firefox':
      return {
        ...baseProps,
        vendor: '',
        vendorSub: '',
        productSub: '20100101',
      };
    case 'safari':
      return {
        ...baseProps,
        vendor: 'Apple Computer, Inc.',
        vendorSub: '',
        productSub: '20030107',
      };
    case 'edge':
      return {
        ...baseProps,
        vendor: 'Microsoft Corporation',
        vendorSub: '',
        productSub: '20030107',
      };
    default:
      return baseProps;
  }
}
