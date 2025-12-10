/**
 * Computational Beam Demo
 * 
 * Demonstrates the usage of the distributed computational beam architecture
 */

import { computationalBeam } from './index';
import { CrawlerStrategy, TaskType, TaskIntensity } from './types';
import { workloadRouter } from './workloadRouter';

async function demo() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   COMPUTATIONAL BEAM ARCHITECTURE - DEMONSTRATION');
  console.log('   Multi-Node, Multi-Provider, Distributed CPU-Amplification');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Step 1: Initialize the system
    console.log('📡 Step 1: Initializing Computational Beam System...');
    await computationalBeam.initialize();
    console.log('✅ System initialized and credentials validated\n');

    // Step 2: Display system status
    console.log('📊 Step 2: System Status');
    const status = computationalBeam.getSystemStatus();
    console.log(`   ├─ Credentials Valid: ${status.credentialsValid ? '✅' : '❌'}`);
    console.log(`   ├─ Active Nodes: ${status.activeNodes}/${status.totalNodes}`);
    console.log(`   ├─ System Stability: ${status.systemIntegrity.overallStability.toFixed(1)}%`);
    console.log(`   └─ Uptime: ${(status.uptime / 1000).toFixed(1)}s\n`);

    // Step 3: Execute various crawler strategies
    console.log('🤖 Step 3: Executing Crawler Strategies\n');

    // Momentum Strategy (Heavy compute)
    console.log('   💪 Executing MOMENTUM Strategy (Heavy)...');
    const momentumResult = await computationalBeam.executeCrawlerTask(
      CrawlerStrategy.MOMENTUM,
      { 
        symbol: 'BTC/USD',
        timeframe: '1h',
        indicators: ['RSI', 'MACD', 'EMA'],
      }
    );
    console.log(`   ✅ Completed: ${momentumResult.taskId}\n`);

    // Arbitrage Strategy (Moderate compute)
    console.log('   💱 Executing ARBITRAGE Strategy (Moderate)...');
    const arbitrageResult = await computationalBeam.executeCrawlerTask(
      CrawlerStrategy.ARBITRAGE,
      {
        exchanges: ['binance', 'coinbase', 'kraken'],
        pairs: ['BTC/USD', 'ETH/USD'],
      }
    );
    console.log(`   ✅ Completed: ${arbitrageResult.taskId}\n`);

    // ML Prediction Strategy (Extreme compute)
    console.log('   🧠 Executing PREDICTIVE_ML Strategy (Extreme)...');
    const mlResult = await computationalBeam.executeCrawlerTask(
      CrawlerStrategy.PREDICTIVE_ML,
      {
        model: 'lstm',
        features: ['price', 'volume', 'volatility'],
        lookback: 100,
      },
      {
        timeout: 60000, // 60 seconds
        fallbackStrategy: CrawlerStrategy.MOMENTUM,
      }
    );
    console.log(`   ✅ Completed: ${mlResult.taskId}\n`);

    // Step 4: Execute custom tasks
    console.log('⚙️  Step 4: Custom Task Routing\n');

    // Lightweight task
    console.log('   📡 Routing lightweight task to Antenna Layer...');
    const lightTask = workloadRouter.createTask(
      TaskType.WEBSOCKET_PING,
      { endpoint: 'wss://stream.binance.com:9443' }
    );
    const lightRouting = await workloadRouter.routeTask(lightTask);
    console.log(`   ✅ Routed to: ${lightRouting.selectedNode.provider} (${lightRouting.selectedNode.layer})`);
    console.log(`   📊 Confidence: ${(lightRouting.confidence * 100).toFixed(1)}%\n`);

    // Heavy task
    console.log('   💪 Routing heavy task to Beam Layer...');
    const heavyTask = workloadRouter.createTask(
      TaskType.MONTE_CARLO,
      { 
        iterations: 100000,
        variables: 10,
        simulations: 1000,
      },
      { intensity: TaskIntensity.EXTREME }
    );
    const heavyRouting = await workloadRouter.routeTask(heavyTask);
    console.log(`   ✅ Routed to: ${heavyRouting.selectedNode.provider} (${heavyRouting.selectedNode.layer})`);
    console.log(`   📊 Confidence: ${(heavyRouting.confidence * 100).toFixed(1)}%\n`);

    // Step 5: Show routing statistics
    console.log('📈 Step 5: Performance Metrics\n');
    const routingStats = workloadRouter.getRoutingStats();
    console.log('   Task Distribution:');
    Object.entries(routingStats.byLayer).forEach(([layer, count]) => {
      console.log(`   ├─ ${layer}: ${count} tasks`);
    });
    console.log(`   └─ Average Confidence: ${(routingStats.avgConfidence * 100).toFixed(1)}%\n`);

    // Step 6: Run comprehensive diagnostic
    console.log('🔍 Step 6: System Diagnostic\n');
    const diagnostic = await computationalBeam.runDiagnostic();
    
    console.log('   Antenna Layer:');
    console.log(`   ├─ Active Nodes: ${diagnostic.subsystems.antenna.activeNodes}`);
    console.log(`   ├─ Queued Tasks: ${diagnostic.subsystems.antenna.queuedTasks}`);
    console.log(`   └─ Active Tasks: ${diagnostic.subsystems.antenna.activeTasks}\n`);

    console.log('   Beam Layer:');
    console.log(`   ├─ Active Nodes: ${diagnostic.subsystems.beam.activeNodes}`);
    console.log(`   ├─ Queued Tasks: ${diagnostic.subsystems.beam.queuedTasks}`);
    console.log(`   └─ Executing Tasks: ${diagnostic.subsystems.beam.executingTasks}\n`);

    console.log('   Battery Layer (Optimization):');
    console.log(`   ├─ Cache Size: ${diagnostic.subsystems.battery.cache.totalCached}`);
    console.log(`   ├─ Cache Hits: ${diagnostic.subsystems.battery.cache.totalHits}`);
    console.log(`   ├─ Utilization: ${diagnostic.subsystems.battery.cache.utilizationPercent.toFixed(1)}%`);
    console.log(`   └─ Active Batches: ${diagnostic.subsystems.battery.batching.activeBatches}\n`);

    // Step 7: Monitor events
    console.log('👁️  Step 7: Event Monitoring (5 seconds)...\n');
    
    let eventCount = 0;
    const eventListener = (data: any) => {
      eventCount++;
      console.log(`   📢 Event: ${JSON.stringify(data).substring(0, 80)}...`);
    };

    computationalBeam.on('subsystem-event', eventListener);
    
    // Generate some activity
    for (let i = 0; i < 3; i++) {
      const task = workloadRouter.createTask(
        TaskType.BASIC_PARSING,
        { data: `Sample data ${i}` }
      );
      await workloadRouter.routeTask(task);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
    computationalBeam.removeListener('subsystem-event', eventListener);
    console.log(`   ℹ️  Captured ${eventCount} events\n`);

    // Step 8: Final status
    console.log('📊 Step 8: Final System Status\n');
    const finalStatus = computationalBeam.getSystemStatus();
    console.log(`   ├─ Total Completed Tasks: ${finalStatus.completedTasks}`);
    console.log(`   ├─ System Stability: ${finalStatus.systemIntegrity.overallStability.toFixed(1)}%`);
    console.log(`   ├─ Operational: ${computationalBeam.isOperational() ? '✅' : '❌'}`);
    console.log(`   └─ Uptime: ${(finalStatus.uptime / 1000).toFixed(1)}s\n`);

    // Step 9: Shutdown
    console.log('🛑 Step 9: Graceful Shutdown...');
    await computationalBeam.shutdown();
    console.log('✅ System shutdown complete\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('   🎉 DEMONSTRATION COMPLETED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Demo failed:', error);
    console.error('Error details:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run demo if executed directly
if (require.main === module) {
  demo()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { demo };
