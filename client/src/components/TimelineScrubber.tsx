import React from 'react';

interface TimelineProps {
  data: Array<{ timestamp: Date; latitude: number; longitude: number }>;
  onSelect: (index: number) => void;
}

export const TimelineScrubber: React.FC<TimelineProps> = ({ data, onSelect }) => {
  if (!data.length) return null;

  const min = data[0].timestamp.getTime();
  const max = data[data.length - 1].timestamp.getTime();

  return (
    <div style={{ padding: 20 }}>
      <input
        type="range"
        min={0}
        max={data.length - 1}
        onChange={(e) => onSelect(+e.target.value)}
        style={{ width: '100%' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
        <span>{new Date(min).toLocaleDateString()}</span>
        <span>{new Date(max).toLocaleDateString()}</span>
      </div>
    </div>
  );
};
