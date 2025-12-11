/**
 * Geoconsole Process Screen
 * 
 * UI for POST /api/geoconsole/process
 * Process raw location inputs through the multimodal fusion pipeline
 */

import React, { useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload,
  Play,
  Trash2,
  Plus,
  MapPin,
  Clock,
  Activity,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';

const DATA_SOURCES = [
  'device_gps', 'exif_photo', 'exif_video', 'xmp_sidecar', 'json_sidecar',
  'wifi_handoff', 'bluetooth_proximity', 'accelerometer', 'browser_timestamp',
  'social_media', 'public_camera', 'traffic_cam', 'satellite_imagery',
  'public_record', 'manual_input'
];

interface GPSInput {
  id: string;
  latitude: string;
  longitude: string;
  altitude: string;
  accuracy: string;
  timestamp: string;
  source: string;
  confidence: string;
}

interface ProcessResult {
  fusedLocations: any[];
  trail: {
    id: string;
    pointCount: number;
    totalDistance: number;
    averageSpeed: number;
    segments: any[];
    stops: any[];
  };
  futurecast: any[];
}

export default function GeoconsoleProcessScreen() {
  const [inputs, setInputs] = useState<GPSInput[]>([createEmptyInput()]);
  const [sessionId, setSessionId] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function createEmptyInput(): GPSInput {
    return {
      id: crypto.randomUUID(),
      latitude: '',
      longitude: '',
      altitude: '',
      accuracy: '10',
      timestamp: new Date().toISOString().slice(0, 16),
      source: 'device_gps',
      confidence: '0.9',
    };
  }

  const addInput = () => {
    setInputs([...inputs, createEmptyInput()]);
  };

  const removeInput = (id: string) => {
    if (inputs.length > 1) {
      setInputs(inputs.filter(i => i.id !== id));
    }
  };

  const updateInput = (id: string, field: keyof GPSInput, value: string) => {
    setInputs(inputs.map(i => i.id === id ? { ...i, [field]: value } : i));
  };

  const processData = useCallback(async () => {
    setProcessing(true);
    setProgress(0);
    setError(null);
    setResult(null);

    try {
      // Validate and transform inputs
      const validInputs = inputs
        .filter(i => i.latitude && i.longitude)
        .map(i => ({
          latitude: parseFloat(i.latitude),
          longitude: parseFloat(i.longitude),
          altitude: i.altitude ? parseFloat(i.altitude) : undefined,
          accuracy: i.accuracy ? parseFloat(i.accuracy) : undefined,
          timestamp: new Date(i.timestamp).toISOString(),
          source: i.source,
          confidence: parseFloat(i.confidence),
        }));

      if (validInputs.length === 0) {
        throw new Error('At least one valid GPS point is required');
      }

      setProgress(20);

      const response = await fetch('/api/geoconsole/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: validInputs,
          sessionId: sessionId || undefined,
        }),
      });

      setProgress(80);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Processing failed');
      }

      setResult(data.data);
      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setProcessing(false);
    }
  }, [inputs, sessionId]);

  const loadSampleData = () => {
    const sampleInputs: GPSInput[] = [
      {
        id: crypto.randomUUID(),
        latitude: '40.7128',
        longitude: '-74.0060',
        altitude: '10',
        accuracy: '5',
        timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16),
        source: 'device_gps',
        confidence: '0.95',
      },
      {
        id: crypto.randomUUID(),
        latitude: '40.7580',
        longitude: '-73.9855',
        altitude: '15',
        accuracy: '8',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().slice(0, 16),
        source: 'exif_photo',
        confidence: '0.88',
      },
      {
        id: crypto.randomUUID(),
        latitude: '40.7484',
        longitude: '-73.9857',
        altitude: '12',
        accuracy: '6',
        timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString().slice(0, 16),
        source: 'device_gps',
        confidence: '0.92',
      },
    ];
    setInputs(sampleInputs);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Process Location Data</h1>
            <p className="text-slate-400 mt-1">
              POST /api/geoconsole/process - Multimodal fusion pipeline
            </p>
          </div>
          <Badge variant="outline" className="bg-blue-500/20 text-blue-400">
            <Activity className="w-4 h-4 mr-2" />
            Fusion Engine
          </Badge>
        </div>

        {/* Input Section */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                GPS Input Points
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadSampleData}>
                  Load Sample
                </Button>
                <Button variant="outline" size="sm" onClick={addInput}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Point
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Session ID */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300">Session ID (optional)</Label>
                <Input
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  placeholder="auto-generated if empty"
                  className="bg-slate-700 border-slate-600 text-white mt-1"
                />
              </div>
            </div>

            {/* GPS Points */}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {inputs.map((input, idx) => (
                <div
                  key={input.id}
                  className="grid grid-cols-8 gap-2 p-3 bg-slate-700/50 rounded-lg items-end"
                >
                  <div>
                    <Label className="text-xs text-slate-400">Latitude</Label>
                    <Input
                      type="number"
                      step="0.000001"
                      value={input.latitude}
                      onChange={(e) => updateInput(input.id, 'latitude', e.target.value)}
                      placeholder="40.7128"
                      className="bg-slate-600 border-slate-500 text-white text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Longitude</Label>
                    <Input
                      type="number"
                      step="0.000001"
                      value={input.longitude}
                      onChange={(e) => updateInput(input.id, 'longitude', e.target.value)}
                      placeholder="-74.0060"
                      className="bg-slate-600 border-slate-500 text-white text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Altitude</Label>
                    <Input
                      type="number"
                      value={input.altitude}
                      onChange={(e) => updateInput(input.id, 'altitude', e.target.value)}
                      placeholder="0"
                      className="bg-slate-600 border-slate-500 text-white text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Timestamp</Label>
                    <Input
                      type="datetime-local"
                      value={input.timestamp}
                      onChange={(e) => updateInput(input.id, 'timestamp', e.target.value)}
                      className="bg-slate-600 border-slate-500 text-white text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Source</Label>
                    <Select
                      value={input.source}
                      onValueChange={(v) => updateInput(input.id, 'source', v)}
                    >
                      <SelectTrigger className="bg-slate-600 border-slate-500 text-white text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATA_SOURCES.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Confidence</Label>
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={input.confidence}
                      onChange={(e) => updateInput(input.id, 'confidence', e.target.value)}
                      className="bg-slate-600 border-slate-500 text-white text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Accuracy (m)</Label>
                    <Input
                      type="number"
                      value={input.accuracy}
                      onChange={(e) => updateInput(input.id, 'accuracy', e.target.value)}
                      className="bg-slate-600 border-slate-500 text-white text-sm"
                    />
                  </div>
                  <div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeInput(input.id)}
                      disabled={inputs.length === 1}
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Process Button */}
            <div className="flex justify-end pt-4">
              <Button
                onClick={processData}
                disabled={processing}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Process Data
                  </>
                )}
              </Button>
            </div>

            {/* Progress */}
            {processing && (
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-slate-400 text-center">{progress}% complete</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error Display */}
        {error && (
          <Card className="bg-red-900/20 border-red-700">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-400" />
                Processing Results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <p className="text-sm text-slate-400">Fused Locations</p>
                  <p className="text-2xl font-bold text-blue-400">
                    {result.fusedLocations.length}
                  </p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <p className="text-sm text-slate-400">Trail Points</p>
                  <p className="text-2xl font-bold text-green-400">
                    {result.trail.pointCount}
                  </p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <p className="text-sm text-slate-400">Total Distance</p>
                  <p className="text-2xl font-bold text-purple-400">
                    {(result.trail.totalDistance / 1000).toFixed(2)} km
                  </p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <p className="text-sm text-slate-400">Avg Speed</p>
                  <p className="text-2xl font-bold text-orange-400">
                    {(result.trail.averageSpeed * 3.6).toFixed(1)} km/h
                  </p>
                </div>
              </div>

              {/* Trail Info */}
              <div className="bg-slate-700/50 rounded-lg p-4">
                <h4 className="font-medium mb-2">Trail Details</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">Trail ID:</span>
                    <span className="ml-2 font-mono">{result.trail.id}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Segments:</span>
                    <span className="ml-2">{result.trail.segments.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Stops:</span>
                    <span className="ml-2">{result.trail.stops.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Futurecast Points:</span>
                    <span className="ml-2">{result.futurecast.length}</span>
                  </div>
                </div>
              </div>

              {/* Raw JSON */}
              <div>
                <Label className="text-slate-300">Raw Response</Label>
                <Textarea
                  value={JSON.stringify(result, null, 2)}
                  readOnly
                  className="bg-slate-700 border-slate-600 text-slate-300 font-mono text-xs h-48 mt-1"
                />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
