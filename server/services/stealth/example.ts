/**
 * StealthInfrastructure Usage Example
 * 
 * This demonstrates how to use the PANTHEON Stealth Infrastructure
 * for privacy-preserving intelligence gathering.
 */

import { StealthInfrastructure } from './StealthInfrastructure';

async function demonstrateStealthInfrastructure() {
  console.log('🔒 PANTHEON Stealth Infrastructure Demo\n');

  // Initialize the stealth infrastructure
  const stealth = new StealthInfrastructure();
  
  console.log('Initializing stealth infrastructure...');
  await stealth.initialize();
  
  // Get initial metrics
  console.log('\n📊 Initial Metrics:');
  let metrics = stealth.getMetrics();
  console.log(`- VPN: ${metrics.vpn.connected ? 'Connected' : 'Disconnected'} (${metrics.vpn.provider || 'None'})`);
  console.log(`- Tor Instances: ${metrics.tor.instances}`);
  console.log(`- Healthy Proxies: ${metrics.proxies.healthy}/${metrics.proxies.total}`);
  console.log(`- Success Rate: ${metrics.success.rate.toFixed(1)}%`);

  // Test LOW risk connection (VPN only)
  console.log('\n🔐 Testing LOW risk connection (VPN only)...');
  try {
    const lowConn = await stealth.connect('https://api.ipify.org?format=json', 'low');
    console.log(`✓ Connected via: ${lowConn.route.join(' → ')}`);
    console.log(`  Latency: ${lowConn.latency}ms`);
    console.log(`  IP: ${lowConn.ip || 'N/A'}`);
  } catch (error) {
    console.log('✗ Connection failed:', error instanceof Error ? error.message : error);
  }

  // Test MEDIUM risk connection (VPN + Tor)
  console.log('\n🔐 Testing MEDIUM risk connection (VPN + Tor)...');
  try {
    const medConn = await stealth.connect('https://api.ipify.org?format=json', 'medium');
    console.log(`✓ Connected via: ${medConn.route.join(' → ')}`);
    console.log(`  Latency: ${medConn.latency}ms`);
    console.log(`  IP: ${medConn.ip || 'N/A'}`);
  } catch (error) {
    console.log('✗ Connection failed:', error instanceof Error ? error.message : error);
  }

  // Test HIGH risk connection (VPN + Tor + ProxyChain)
  console.log('\n🔐 Testing HIGH risk connection (VPN + Tor + ProxyChain)...');
  try {
    const highConn = await stealth.connect('https://api.ipify.org?format=json', 'high');
    console.log(`✓ Connected via: ${highConn.route.join(' → ')}`);
    console.log(`  Latency: ${highConn.latency}ms`);
    console.log(`  IP: ${highConn.ip || 'N/A'}`);
  } catch (error) {
    console.log('✗ Connection failed:', error instanceof Error ? error.message : error);
  }

  // Rotate identity
  console.log('\n🔄 Rotating identity...');
  await stealth.rotateIdentity();
  console.log('✓ Identity rotated');

  // Get final metrics
  console.log('\n📊 Final Metrics:');
  metrics = stealth.getMetrics();
  console.log(`- Performance (avg latency):`);
  console.log(`  • LOW risk: ${metrics.performance.lowRisk.toFixed(0)}ms`);
  console.log(`  • MEDIUM risk: ${metrics.performance.mediumRisk.toFixed(0)}ms`);
  console.log(`  • HIGH risk: ${metrics.performance.highRisk.toFixed(0)}ms`);
  console.log(`- Success Rate: ${metrics.success.rate.toFixed(1)}% (${metrics.success.total - metrics.success.failed}/${metrics.success.total})`);
  console.log(`- Tor Circuits Used: ${metrics.tor.circuits}`);

  console.log('\n✅ Demo complete!');
}

// Run the demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateStealthInfrastructure().catch(error => {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  });
}

export { demonstrateStealthInfrastructure };
