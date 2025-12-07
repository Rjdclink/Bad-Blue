import { 
  calculateDistance, 
  clusterLocations, 
  generateHeatmap, 
  searchWithinRadius,
  type GPSCoordinates 
} from '../gpsIntelligence';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

export class GPSIntelligenceTestSuite {
  private results: TestResult[] = [];

  async testHaversineDistance(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Test distance between New York and Los Angeles (approx 3936 km)
      const distance = calculateDistance(40.7128, -74.0060, 34.0522, -118.2437);
      const expectedDistance = 3936000; // meters
      const tolerance = 50000; // 50km tolerance
      
      const passed = Math.abs(distance - expectedDistance) < tolerance;
      
      return {
        testName: 'should calculate distance between two points using Haversine formula',
        passed,
        details: passed 
          ? `Distance: ${Math.round(distance / 1000)}km (expected ~3936km)` 
          : `Expected ~${expectedDistance / 1000}km, got ${Math.round(distance / 1000)}km`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should calculate distance between two points using Haversine formula',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testClusteringDBSCAN(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Create test points: 5 points in NYC area, 3 points in LA area
      const points: GPSCoordinates[] = [
        { latitude: 40.7128, longitude: -74.0060 }, // NYC
        { latitude: 40.7129, longitude: -74.0061 }, // NYC nearby (~14m)
        { latitude: 40.7130, longitude: -74.0062 }, // NYC nearby (~14m)
        { latitude: 40.7200, longitude: -74.0100 }, // NYC nearby (~1km)
        { latitude: 40.7210, longitude: -74.0110 }, // NYC nearby (~1.1km)
        { latitude: 34.0522, longitude: -118.2437 }, // LA (3935km away)
        { latitude: 34.0523, longitude: -118.2438 }, // LA nearby (~14m)
        { latitude: 34.0524, longitude: -118.2439 }, // LA nearby (~14m)
      ];
      
      // Use 5000m epsilon to cluster points within 5km, min 3 points
      const clusters = clusterLocations(points, 5000, 3);
      
      // Should form 1 or 2 clusters (NYC and possibly LA)
      const passed = clusters.length >= 1 && clusters.length <= 2 && 
                     clusters[0].pointCount >= 3;
      
      return {
        testName: 'should cluster GPS points using DBSCAN algorithm',
        passed,
        details: passed 
          ? `Found ${clusters.length} cluster(s) with ${clusters.map(c => c.pointCount).join(', ')} points` 
          : `Expected 1-2 clusters with at least 3 points, got ${clusters.length} clusters`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should cluster GPS points using DBSCAN algorithm',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testHeatmapGeneration(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Use very close points that will definitely cluster with default 100m epsilon
      const points: GPSCoordinates[] = [
        { latitude: 40.7128, longitude: -74.0060 },
        { latitude: 40.7129, longitude: -74.0061 }, // ~14m away
        { latitude: 40.7127, longitude: -74.0059 }, // ~14m away
      ];
      
      const heatmap = generateHeatmap(points);
      
      // Check that heatmap is valid
      const passed = heatmap.totalPoints === 3 &&
                     heatmap.clusters.length > 0 &&
                     heatmap.boundingBox.north > heatmap.boundingBox.south &&
                     heatmap.boundingBox.north !== 0;
      
      return {
        testName: 'should generate heatmap from GPS points',
        passed,
        details: passed 
          ? `Heatmap: ${heatmap.totalPoints} points, ${heatmap.clusters.length} clusters` 
          : `Failed. Clusters: ${heatmap.clusters.length}. Box: N=${heatmap.boundingBox.north}, S=${heatmap.boundingBox.south}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should generate heatmap from GPS points',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testEmptyHeatmap(): Promise<TestResult> {
    const start = Date.now();
    try {
      const heatmap = generateHeatmap([]);
      
      const passed = heatmap.totalPoints === 0 &&
                     heatmap.clusters.length === 0;
      
      return {
        testName: 'should handle empty point array for heatmap',
        passed,
        details: passed 
          ? `Empty heatmap handled correctly` 
          : `Failed to handle empty array`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should handle empty point array for heatmap',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testRadiusSearch(): Promise<TestResult> {
    const start = Date.now();
    try {
      const points: GPSCoordinates[] = [
        { latitude: 40.7128, longitude: -74.0060 }, // NYC
        { latitude: 40.7500, longitude: -74.0000 }, // ~4km away
        { latitude: 34.0522, longitude: -118.2437 }, // LA (far away)
      ];
      
      // Search within 5km of NYC
      const results = searchWithinRadius(points, 40.7128, -74.0060, 5000);
      
      // Should find 2 points within 5km
      const passed = results.length === 2;
      
      return {
        testName: 'should search points within radius (geofencing)',
        passed,
        details: passed 
          ? `Found ${results.length} points within 5km radius` 
          : `Expected 2 points, found ${results.length}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should search points within radius (geofencing)',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testFrequencyScore(): Promise<TestResult> {
    const start = Date.now();
    try {
      const points: GPSCoordinates[] = [
        { latitude: 40.7128, longitude: -74.0060 },
        { latitude: 40.7129, longitude: -74.0061 },
        { latitude: 40.7130, longitude: -74.0062 },
        { latitude: 40.7131, longitude: -74.0063 },
        { latitude: 40.7132, longitude: -74.0064 },
      ];
      
      const clusters = clusterLocations(points, 200, 2);
      
      // Should have frequency score calculated
      const passed = clusters.length > 0 && 
                     clusters[0].frequencyScore > 0 &&
                     clusters[0].frequencyScore !== Infinity;
      
      return {
        testName: 'should calculate frequency score for clusters',
        passed,
        details: passed 
          ? `Frequency score: ${clusters[0].frequencyScore.toFixed(4)}` 
          : `Invalid frequency score calculation`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should calculate frequency score for clusters',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async runAllTests(): Promise<TestResult[]> {
    console.log('\n🧪 Running GPS Intelligence Test Suite...\n');
    
    this.results = [
      await this.testHaversineDistance(),
      await this.testClusteringDBSCAN(),
      await this.testHeatmapGeneration(),
      await this.testEmptyHeatmap(),
      await this.testRadiusSearch(),
      await this.testFrequencyScore(),
    ];

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    
    console.log(`\n📊 Test Results: ${passed}/${total} passed\n`);
    
    this.results.forEach(result => {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.testName}`);
      console.log(`   ${result.details} (${result.duration}ms)\n`);
    });

    return this.results;
  }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const suite = new GPSIntelligenceTestSuite();
  suite.runAllTests()
    .then(results => {
      const allPassed = results.every(r => r.passed);
      process.exit(allPassed ? 0 : 1);
    })
    .catch(error => {
      console.error('Test suite failed:', error);
      process.exit(1);
    });
}
