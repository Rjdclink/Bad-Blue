/**
 * Six-Crawler Initiative - Example Usage and Demonstrations
 * 
 * This file demonstrates how to use the Six-Crawler Initiative for
 * authorized security stress-testing within simulated environments.
 */

import {
  SixCrawlerInitiative,
  MirrorCrawler,
  KeyCrawler,
  ChewerCrawler,
  ComputationalCrawler,
  USCCrawler,
  WooCrawler,
} from './SixCrawlerInitiative';

// ============================================================================
// EXAMPLE 1: Full Initiative Operation
// ============================================================================

export async function example1_FullInitiativeOperation() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EXAMPLE 1: Full Initiative Operation');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Initialize the Six-Crawler Initiative
  const initiative = new SixCrawlerInitiative({
    authorizedMode: true, // REQUIRED
    enableDualState: true,
    enableIdentityFlow: true,
    ingestionThroughput: 100, // MB/s
    computationalDepth: 5,
    coordinationLatency: 10, // ms
    enableCooperativeEngagement: true,
  });

  // Set up event listeners
  initiative.on('insight:generated', (insight) => {
    console.log(`[INSIGHT] ${insight.severity.toUpperCase()}: ${insight.description}`);
  });

  initiative.on('intelligence:routed', ({ from, to }) => {
    console.log(`[INTELLIGENCE] Routed from ${from} to ${to}`);
  });

  // Start the initiative
  await initiative.start();

  // Simulate a security stress test
  const mockEnvironmentState = {
    cpu: 75,
    memory: 60,
    network: { connections: 1500 },
    processes: Array(150).fill({ name: 'process', status: 'running' }),
    services: ['api-gateway', 'auth-service', 'database'],
    databases: ['postgres-primary', 'redis-cache'],
    apis: ['payment-api', 'user-api'],
    encryption: true,
    authStrength: 'strong',
    firewall: true,
    exposedPorts: [80, 443, 22],
  };

  const mockPrincipals = [
    'user:admin',
    'user:developer',
    'service:api-gateway',
    'service:background-worker',
  ];

  const mockAuthLogs = [
    { type: 'auth_success', entity: 'user:admin', timestamp: Date.now() - 3600000 },
    { type: 'auth_failure', entity: 'user:attacker', timestamp: Date.now() - 1800000 },
    { type: 'auth_success', entity: 'service:api-gateway', timestamp: Date.now() - 900000 },
    { type: 'auth_failure', entity: 'user:attacker', timestamp: Date.now() - 600000 },
  ];

  const mockAccessLogs = [
    { type: 'access_granted', entity: 'user:admin', resource: '/admin', timestamp: Date.now() - 3600000 },
    { type: 'access_denied', entity: 'user:developer', resource: '/admin', timestamp: Date.now() - 2400000 },
    { type: 'access_granted', entity: 'service:api-gateway', resource: '/api', timestamp: Date.now() - 1200000 },
  ];

  // Execute integrated operation
  const results = await initiative.executeOperation({
    environmentId: 'production-mirror',
    principals: mockPrincipals,
    dataFeeds: [
      { source: 'auth-logs', data: mockAuthLogs },
      { source: 'access-logs', data: mockAccessLogs },
    ],
  });

  // Display results
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  OPERATION RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Environment State:');
  console.log(`  Stability Score: ${results.environmentState.stabilityScore.toFixed(2)}`);
  console.log(`  Observation Depth: ${results.environmentState.observationDepth.toFixed(2)}`);
  console.log('');
  console.log(`Identity Flows Mapped: ${results.identityFlows.length}`);
  results.identityFlows.forEach(flow => {
    console.log(`  ${flow.principalId}: ${flow.policyGaps.length} policy gaps detected`);
  });
  console.log('');
  console.log(`Data Digests: ${results.dataDigests.length}`);
  results.dataDigests.forEach(digest => {
    console.log(`  ${digest.source}: ${digest.volumeProcessed.toFixed(2)} MB processed`);
  });
  console.log('');
  console.log('Computational Analysis:');
  console.log(`  Correlations Found: ${results.analysis.correlations.length}`);
  console.log(`  Emergent Behaviors: ${results.analysis.emergentBehaviors.length}`);
  console.log(`  Failure States Modeled: ${results.analysis.failureStates.length}`);
  console.log('');
  console.log(`Total Security Insights: ${results.insights.length}`);
  console.log('');

  // Get critical insights
  const criticalInsights = initiative.getInsightsBySeverity('critical');
  if (criticalInsights.length > 0) {
    console.log('⚠️  CRITICAL INSIGHTS:');
    criticalInsights.forEach(insight => {
      console.log(`  - ${insight.description}`);
    });
    console.log('');
  }

  // Get system status
  const status = initiative.getStatus();
  console.log('System Status:');
  console.log(`  Running: ${status.running}`);
  console.log(`  Uptime: ${(status.uptime / 1000).toFixed(2)}s`);
  console.log(`  Total Insights: ${status.insightCount}`);
  console.log('');
  console.log('Crawler Health:');
  Object.entries(status.crawlers).forEach(([name, metrics]) => {
    console.log(`  ${name}: ${metrics.health} (${metrics.tasksProcessed} tasks, ${metrics.insightsGenerated} insights)`);
  });
  console.log('');

  // Stop the initiative
  await initiative.stop();
}

// ============================================================================
// EXAMPLE 2: Individual Crawler Usage - The Mirror
// ============================================================================

export async function example2_MirrorCrawler() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EXAMPLE 2: The Mirror - Dual-State Rendering');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const mirror = new MirrorCrawler({
    enableDualState: true,
    enableIdentityFlow: false,
    ingestionThroughput: 100,
    computationalDepth: 5,
    coordinationLatency: 10,
    enableCooperativeEngagement: false,
    authorizedMode: true,
  });

  mirror.on('insight', (insight) => {
    console.log(`[Mirror Insight] ${insight.type}:`, insight.data);
  });

  await mirror.start();

  // Simulate environment observation
  const environmentState = {
    cpu: 92, // High CPU - should trigger anomaly
    memory: 45,
    errorRate: 0.02,
    network: { connections: 500 },
    processes: Array(80).fill({ name: 'process' }),
    unauthorized_access: true, // Should trigger critical anomaly
    encryption: false, // Security vulnerability
    exposedPorts: [22, 80, 443, 3306, 5432], // Many exposed ports
  };

  const state = await mirror.renderDualState('env-test', environmentState);

  console.log('Dual-State Rendering Complete:');
  console.log('');
  console.log('Normalized View (What operators see):');
  console.log(JSON.stringify(state.normalizedView, null, 2));
  console.log('');
  console.log('Analytical Overlay (What analysts see):');
  console.log(JSON.stringify(state.analyticalOverlay, null, 2));
  console.log('');
  console.log(`Stability Score: ${state.stabilityScore.toFixed(2)}`);
  console.log(`Observation Depth: ${state.observationDepth.toFixed(2)}`);
  console.log('');

  await mirror.stop();
}

// ============================================================================
// EXAMPLE 3: Individual Crawler Usage - The Key
// ============================================================================

export async function example3_KeyCrawler() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EXAMPLE 3: The Key - Identity Flow Analysis');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const key = new KeyCrawler({
    enableDualState: false,
    enableIdentityFlow: true,
    ingestionThroughput: 100,
    computationalDepth: 5,
    coordinationLatency: 10,
    enableCooperativeEngagement: false,
    authorizedMode: true,
  });

  key.on('insight', (insight) => {
    console.log(`[Key Insight] ${insight.type}:`, insight.data);
  });

  await key.start();

  // Simulate identity context with security gaps
  const identityContext = {
    roles: ['admin', 'developer', 'auditor'],
    groups: ['engineering', 'security'],
    permissions: ['read', 'write', 'delete', 'admin:*'],
    wildcardPermissions: true, // Policy gap
    mfaEnabled: false, // Security gap
    sensitiveAccess: true, // Combined with no MFA = critical gap
    created: Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 year ago
    lastRotation: Date.now() - 180 * 24 * 60 * 60 * 1000, // 6 months ago
    lastUsed: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days ago - stale
    trustedBy: ['service:api-gateway', 'service:admin-portal'],
    inheritance: { depth: 7 }, // Deep inheritance = policy gap
  };

  const flow = await key.mapIdentityFlow('user:admin', identityContext);

  console.log('Identity Flow Analysis Complete:');
  console.log('');
  console.log(`Principal: ${flow.principalId}`);
  console.log(`Flow Path: ${flow.flowPath.join(' → ')}`);
  console.log('');
  console.log('Trust Relationships:');
  flow.trustRelationships.forEach(rel => {
    console.log(`  ${rel.from} → ${rel.to} (strength: ${rel.strength.toFixed(2)})`);
  });
  console.log('');
  console.log(`Policy Gaps Detected: ${flow.policyGaps.length}`);
  flow.policyGaps.forEach(gap => {
    console.log(`  ⚠️  ${gap}`);
  });
  console.log('');
  console.log('Credential Lifecycle:');
  flow.credentialLifecycle.forEach(event => {
    console.log(`  ${new Date(event.timestamp).toISOString()}: ${event.event}`);
  });
  console.log('');

  await key.stop();
}

// ============================================================================
// EXAMPLE 4: Individual Crawler Usage - The Chewer & Computational
// ============================================================================

export async function example4_ChewerAndComputational() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EXAMPLE 4: The Chewer & Computational - Data Analysis');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const chewer = new ChewerCrawler({
    enableDualState: false,
    enableIdentityFlow: false,
    ingestionThroughput: 100,
    computationalDepth: 5,
    coordinationLatency: 10,
    enableCooperativeEngagement: false,
    authorizedMode: true,
  });

  const computational = new ComputationalCrawler({
    enableDualState: false,
    enableIdentityFlow: false,
    ingestionThroughput: 100,
    computationalDepth: 5,
    coordinationLatency: 10,
    enableCooperativeEngagement: false,
    authorizedMode: true,
  });

  // Wire them together
  chewer.on('insights_ready', ({ insights }) => {
    console.log(`[Chewer] Transferring ${insights.length} insights to Computational...`);
  });

  await chewer.start();
  await computational.start();

  // Generate a large dataset simulating logs
  const logData = [];
  for (let i = 0; i < 1000; i++) {
    const timestamp = Date.now() - Math.random() * 24 * 60 * 60 * 1000;
    logData.push({
      type: i % 10 === 0 ? 'error:500' : i % 20 === 0 ? 'unauthorized' : 'info',
      source: `service-${i % 5}`,
      entity: `entity-${i % 20}`,
      timestamp,
      behavior: i % 15 === 0 ? 'failure' : 'normal',
      domain: i % 3 === 0 ? 'auth' : i % 3 === 1 ? 'api' : 'database',
    });
  }

  // Chewer ingests data
  console.log('The Chewer: Ingesting defensive data...');
  const digest = await chewer.ingestData('system-logs', logData);

  console.log('');
  console.log('Data Digest:');
  console.log(`  Volume Processed: ${digest.volumeProcessed.toFixed(2)} MB`);
  console.log(`  Significant Patterns: ${digest.significantPatterns.length}`);
  console.log(`  Noise Reduction: ${(digest.noiseReduction * 100).toFixed(1)}%`);
  console.log(`  Insights Extracted: ${digest.insightsExtracted}`);
  console.log('');
  console.log('Top Patterns:');
  digest.significantPatterns.slice(0, 10).forEach(pattern => {
    console.log(`  ${pattern.pattern}: ${pattern.frequency} occurrences`);
  });
  console.log('');

  // Computational analyzes patterns
  console.log('The Computational: Analyzing patterns...');
  const analysis = await computational.analyzePatterns(logData);

  console.log('');
  console.log('Computational Analysis:');
  console.log('');
  console.log(`Correlations Found: ${analysis.correlations.length}`);
  analysis.correlations.slice(0, 5).forEach(corr => {
    console.log(`  ${corr.type}: ${corr.entities.join(', ')} (strength: ${corr.strength.toFixed(2)})`);
  });
  console.log('');
  console.log(`Emergent Behaviors: ${analysis.emergentBehaviors.length}`);
  analysis.emergentBehaviors.forEach(behavior => {
    console.log(`  ${behavior.behavior} (probability: ${behavior.probability.toFixed(2)})`);
  });
  console.log('');
  console.log(`Failure States Modeled: ${analysis.failureStates.length}`);
  analysis.failureStates.forEach(state => {
    console.log(`  ${state.state} (likelihood: ${state.likelihood.toFixed(2)}, impact: ${state.impact})`);
  });
  console.log('');
  console.log(`Cross-Domain Relationships: ${analysis.crossDomainRelationships.length}`);
  analysis.crossDomainRelationships.forEach(rel => {
    console.log(`  ${rel.domains.join(' ↔ ')}: ${rel.relationship}`);
  });
  console.log('');

  await chewer.stop();
  await computational.stop();
}

// ============================================================================
// EXAMPLE 5: Coordination with USC
// ============================================================================

export async function example5_USCCoordination() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EXAMPLE 5: The USC - Ultra-Low-Latency Coordination');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const usc = new USCCrawler({
    enableDualState: false,
    enableIdentityFlow: false,
    ingestionThroughput: 100,
    computationalDepth: 5,
    coordinationLatency: 10,
    enableCooperativeEngagement: false,
    authorizedMode: true,
  });

  usc.on('task:execute', ({ taskId, crawler, priority }) => {
    console.log(`[USC] Executing task ${taskId.slice(0, 8)} on ${crawler} (priority: ${priority})`);
  });

  usc.on('intelligence:route', ({ from, to }) => {
    console.log(`[USC] Intelligence routed: ${from} → ${to}`);
  });

  await usc.start();

  // Queue some tasks
  console.log('Queueing tasks for coordination...');
  await usc.coordinateTask('mirror', { action: 'render_state' }, 8);
  await usc.coordinateTask('key', { action: 'map_identity' }, 7);
  await usc.coordinateTask('chewer', { action: 'ingest_logs' }, 6);
  await usc.coordinateTask('computational', { action: 'analyze_patterns' }, 9);
  await usc.coordinateTask('woo', { action: 'engage_interface' }, 5);

  // Let coordination happen
  await new Promise(resolve => setTimeout(resolve, 100));

  // Route intelligence
  console.log('');
  console.log('Routing intelligence between crawlers...');
  await usc.routeIntelligence('chewer', 'computational', { insights: [] });
  await usc.routeIntelligence('key', 'computational', { identityFlows: [] });
  await usc.routeIntelligence('mirror', 'woo', { environmentState: {} });

  // Synchronize crawlers
  console.log('');
  console.log('Synchronizing all crawlers...');
  await usc.synchronize(['mirror', 'key', 'chewer', 'computational', 'woo']);

  // Get coordination state
  const state = usc.getCoordinationState();
  console.log('');
  console.log('Coordination State:');
  console.log(`  Active Tasks: ${state.activeTaskCount}`);
  console.log(`  Queue Depth: ${state.queueDepth}`);
  console.log(`  Throughput: ${state.throughput.toFixed(2)} tasks/sec`);
  console.log(`  Latency: ${state.latency}ms`);
  console.log(`  Synchronization: ${state.synchronizationStatus}`);
  console.log('');

  await usc.stop();
}

// ============================================================================
// EXAMPLE 6: Cooperative Engagement with Woo
// ============================================================================

export async function example6_WooEngagement() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EXAMPLE 6: The Woo - Cooperative Interface Engagement');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const woo = new WooCrawler({
    enableDualState: false,
    enableIdentityFlow: false,
    ingestionThroughput: 100,
    computationalDepth: 5,
    coordinationLatency: 10,
    enableCooperativeEngagement: true,
    authorizedMode: true,
  });

  woo.on('insight', (insight) => {
    console.log(`[Woo Insight] ${insight.type}:`, insight.data);
  });

  await woo.start();

  // Prepare engagement context
  console.log('Preparing cooperative engagement context...');
  const context = await woo.prepareContext('api-gateway', [
    'observe_traffic_patterns',
    'analyze_authentication_flows',
    'map_service_dependencies',
  ]);

  console.log('');
  console.log('Engagement Context:');
  console.log(JSON.stringify(context, null, 2));
  console.log('');

  // Engage with interface
  console.log('Engaging with interface...');
  const interfaceContext = {
    authenticated: true,
    encrypted: true,
    verified: true,
    established: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90 days ago
    apiAccess: true,
    documentationProvided: true,
    responsiveness: 0.95,
    transparency: true,
    dataPointsShared: 150,
    dataPointsRequested: 100,
    interfaceType: 'api',
    documentation: true,
    averageResponseTime: 250,
    errorHandling: 'graceful',
  };

  const profile = await woo.engageInterface('api-gateway', interfaceContext);

  console.log('');
  console.log('Engagement Profile:');
  console.log(`  Interface: ${profile.interfaceId}`);
  console.log(`  Trust Level: ${profile.trustLevel.toFixed(2)}`);
  console.log(`  Cooperation Score: ${profile.cooperationScore.toFixed(2)}`);
  console.log(`  Voluntary Data Flow: ${profile.voluntaryDataFlow.toFixed(2)}`);
  console.log(`  Engagement Optimization: ${profile.engagementOptimization.toFixed(2)}`);
  console.log('');

  await woo.stop();
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

export async function runAllExamples() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   SIX-CRAWLER INITIATIVE - EXAMPLE DEMONSTRATIONS         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  
  try {
    await example1_FullInitiativeOperation();
    console.log('\n\n');
    
    await example2_MirrorCrawler();
    console.log('\n\n');
    
    await example3_KeyCrawler();
    console.log('\n\n');
    
    await example4_ChewerAndComputational();
    console.log('\n\n');
    
    await example5_USCCoordination();
    console.log('\n\n');
    
    await example6_WooEngagement();
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   ALL EXAMPLES COMPLETED SUCCESSFULLY                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run examples if executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}
