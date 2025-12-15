import React, { useState } from 'react';
import { LocationHeatmap } from '../components/LocationHeatmap';
import { TimelineScrubber } from '../components/TimelineScrubber';
import { useLocationIntelligence } from '../hooks/useLocationIntelligence';

export default function LocationIntelPage() {
  const { data, markers, analyze, isLoading } = useLocationIntelligence();
  const [timelineIndex, setTimelineIndex] = useState(0);

  // PRODUCTION: Real-world analysis only - no hardcoded demo coordinates
  const isProduction = import.meta.env.PROD || import.meta.env.MODE === 'production';
  
  const handleAnalyze = () => {
    if (isProduction) {
      // PRODUCTION: Analyze with empty initial data - will fetch real data from API
      analyze({
        imagePaths: [],
        publicRecords: [],
      });
    } else {
      // DEV: Still no hardcoded locations - must provide real data
      console.warn('[LocationIntel] Analysis requires real coordinate data');
      analyze({
        imagePaths: [],
        publicRecords: [],
      });
    }
  };

  const timelineMarkers = data?.timeline[timelineIndex]
    ? [{ pos: [data.timeline[timelineIndex].latitude, data.timeline[timelineIndex].longitude] as [number, number], popup: 'Timeline point' }]
    : [];

  return (
    <div style={{ padding: 20 }}>
      <h1>📍 Location Intelligence Dashboard</h1>
      
      <button onClick={handleAnalyze} disabled={isLoading} style={{ marginBottom: 20, padding: '10px 20px' }}>
        {isLoading ? 'Analyzing...' : 'Analyze Locations'}
      </button>

      {data && (
        <>
          <div style={{ marginBottom: 20 }}>
            <h3>Statistics</h3>
            <p>Total Points: {data.stats.totalPoints}</p>
            <p>Sources: {data.stats.sources.join(', ')}</p>
          </div>

          <LocationHeatmap
            data={data.heatmapData}
            markers={markers}
            config={{ radius: 25, blur: 15 }}
          />

          {data.timeline.length > 0 && (
            <>
              <h3 style={{ marginTop: 20 }}>Timeline</h3>
              <TimelineScrubber data={data.timeline} onSelect={setTimelineIndex} />
              <LocationHeatmap
                data={[]}
                markers={timelineMarkers}
                center={[data.timeline[timelineIndex].latitude, data.timeline[timelineIndex].longitude]}
                zoom={14}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
