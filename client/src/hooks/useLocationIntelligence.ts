import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

interface AnalyzeRequest {
  imagePaths?: string[];
  publicRecords?: Array<{
    latitude: number;
    longitude: number;
    source: string;
    timestamp?: string;
  }>;
}

interface LocationData {
  clustered: Array<{
    latitude: number;
    longitude: number;
    occurrences: number;
    confidence: number;
    sources: string[];
  }>;
  heatmapData: Array<[number, number, number]>;
  timeline: Array<{ timestamp: Date; latitude: number; longitude: number }>;
  stats: { totalPoints: number; sources: string[]; dateRange: any };
}

export const useLocationIntelligence = () => {
  const [data, setData] = useState<LocationData | null>(null);

  const analyze = useMutation({
    mutationFn: async (req: AnalyzeRequest) => {
      const res = await fetch('/api/location-intel/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error('Analysis failed');
      return res.json();
    },
    onSuccess: (result) => setData(result.data),
  });

  const markers = data?.clustered.map(c => ({
    pos: [c.latitude, c.longitude] as [number, number],
    popup: `
      <div style="min-width:200px">
        <h3>Location Intelligence</h3>
        <p><b>Coords:</b> ${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}</p>
        <p><b>Occurrences:</b> ${c.occurrences}</p>
        <p><b>Confidence:</b> ${(c.confidence * 100).toFixed(0)}%</p>
        <p><b>Sources:</b> ${c.sources.join(', ')}</p>
      </div>
    `,
  })) || [];

  return { data, markers, analyze: analyze.mutate, isLoading: analyze.isPending };
};
