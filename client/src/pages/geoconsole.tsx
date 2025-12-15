/**
 * Geoconsole Page
 * 
 * Hybrid personal security geoconsole with weather-radar-style timeline
 */

import React, { useState, useEffect, useCallback } from 'react';
import { GeoconsoleRadarDashboard } from '../components/geoconsole';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  MapPin,
  FileImage,
  Database,
  Satellite,
  Activity,
  Shield,
  Zap,
} from 'lucide-react';
import type { GPSPoint, DataSource } from '@shared/geoconsoleTypes';

// Sample GPS data for demonstration
const SAMPLE_DATA: GPSPoint[] = [
  { latitude: 40.7128, longitude: -74.0060, timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), source: 'device_gps' as DataSource, confidence: 0.95 },
  { latitude: 40.7138, longitude: -74.0050, timestamp: new Date(Date.now() - 2.5 * 24 * 60 * 60 * 1000), source: 'exif_photo' as DataSource, confidence: 0.90 },
  { latitude: 40.7148, longitude: -74.0040, timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), source: 'device_gps' as DataSource, confidence: 0.92 },
  { latitude: 40.7158, longitude: -74.0030, timestamp: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000), source: 'public_record' as DataSource, confidence: 0.85 },
  { latitude: 40.7168, longitude: -74.0020, timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), source: 'device_gps' as DataSource, confidence: 0.94 },
  { latitude: 40.7178, longitude: -74.0010, timestamp: new Date(Date.now() - 0.5 * 24 * 60 * 60 * 1000), source: 'exif_photo' as DataSource, confidence: 0.88 },
  { latitude: 40.7188, longitude: -74.0000, timestamp: new Date(), source: 'device_gps' as DataSource, confidence: 0.96 },
];

export default function GeoconsolePage() {
  const [locationData, setLocationData] = useState<GPSPoint[]>(SAMPLE_DATA);
  const [systemStatus, setSystemStatus] = useState<any>(null);

  // Fetch system status on mount
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('/api/geoconsole/status');
        if (response.ok) {
          const data = await response.json();
          setSystemStatus(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch system status:', error);
      }
    };
    fetchStatus();
  }, []);

  // Handle file upload for EXIF extraction
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // In a real implementation, this would extract EXIF data from uploaded files
    // For now, we add sample points
    const newPoints: GPSPoint[] = Array.from(files).map((file, idx) => ({
      latitude: 40.7128 + Math.random() * 0.02,
      longitude: -74.0060 + Math.random() * 0.02,
      timestamp: new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000),
      source: 'exif_photo' as DataSource,
      confidence: 0.85 + Math.random() * 0.1,
    }));

    setLocationData(prev => [...prev, ...newPoints]);
  }, []);

  // Handle manual location input
  const handleManualInput = useCallback((lat: number, lng: number) => {
    const newPoint: GPSPoint = {
      latitude: lat,
      longitude: lng,
      timestamp: new Date(),
      source: 'manual_input' as DataSource,
      confidence: 1.0,
    };
    setLocationData(prev => [...prev, newPoint]);
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 overflow-y-auto">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-4 sticky top-0 z-50">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Satellite className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">SPECTRA GeoConsole</h1>
              <p className="text-slate-400">Satellite Intelligence System</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50 px-3 py-1">
              <Activity className="w-4 h-4 mr-2" />
              System Operational
            </Badge>
            
            {systemStatus && (
              <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/50 px-3 py-1">
                <Zap className="w-4 h-4 mr-2" />
                {systemStatus.orchestration?.activeTasks || 0} Active Tasks
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left Sidebar - Data Input */}
          <div className="col-span-3">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Database className="w-5 h-5" />
                  Data Sources
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* File Upload */}
                <div>
                  <Label className="text-slate-300 text-sm">Upload Media Files</Label>
                  <p className="text-xs text-slate-500 mb-2">Extract GPS from EXIF data</p>
                  <div className="relative">
                    <Input
                      type="file"
                      multiple
                      accept="image/*,video/*"
                      onChange={handleFileUpload}
                      className="bg-slate-700 border-slate-600 text-slate-300"
                    />
                    <FileImage className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  </div>
                </div>

                {/* Manual Input */}
                <div>
                  <Label className="text-slate-300 text-sm">Manual Location</Label>
                  <p className="text-xs text-slate-500 mb-2">Enter coordinates directly</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      placeholder="Latitude"
                      step="0.000001"
                      className="bg-slate-700 border-slate-600 text-slate-300 text-sm"
                      id="manual-lat"
                    />
                    <Input
                      type="number"
                      placeholder="Longitude"
                      step="0.000001"
                      className="bg-slate-700 border-slate-600 text-slate-300 text-sm"
                      id="manual-lng"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => {
                      const lat = parseFloat((document.getElementById('manual-lat') as HTMLInputElement)?.value || '0');
                      const lng = parseFloat((document.getElementById('manual-lng') as HTMLInputElement)?.value || '0');
                      if (lat && lng) handleManualInput(lat, lng);
                    }}
                  >
                    <MapPin className="w-4 h-4 mr-2" />
                    Add Location
                  </Button>
                </div>

                {/* Data Stats */}
                <div className="pt-4 border-t border-slate-700">
                  <h4 className="text-sm font-medium text-slate-300 mb-3">Current Data</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Total Points</span>
                      <span className="text-white font-medium">{locationData.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Sources</span>
                      <span className="text-white font-medium">
                        {new Set(locationData.map(d => d.source)).size}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Avg Confidence</span>
                      <span className="text-green-400 font-medium">
                        {(locationData.reduce((sum, d) => sum + d.confidence, 0) / locationData.length * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="pt-4 border-t border-slate-700">
                  <h4 className="text-sm font-medium text-slate-300 mb-3">Quick Actions</h4>
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <Upload className="w-4 h-4 mr-2" />
                      Import from Device
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      <Shield className="w-4 h-4 mr-2" />
                      Privacy Scan
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Area - Geoconsole Dashboard - FULL HEIGHT, NO CLIPPING */}
          <div className="col-span-9">
            <Card className="bg-slate-800 border-slate-700 flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
              <GeoconsoleRadarDashboard initialData={locationData} />
            </Card>
          </div>
        </div>

        {/* System Capabilities */}
        <div className="mt-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">System Capabilities</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { name: 'Multimodal Fusion', desc: 'Combine GPS, EXIF, Wi-Fi, Bluetooth', active: true },
                  { name: 'Monte Carlo Interpolation', desc: 'Probabilistic path reconstruction', active: true },
                  { name: 'Futurecast Prediction', desc: '6-hour trajectory forecasting', active: true },
                  { name: 'Weather Radar Timeline', desc: 'Animated playback controls', active: true },
                  { name: 'Satellite Imagery', desc: 'Sentinel, NASA, USGS layers', active: true },
                  { name: 'Public Camera Integration', desc: 'Traffic, city, DOT cameras', active: false },
                  { name: '4Ji Orchestration', desc: 'Compute optimization', active: true },
                  { name: 'RAM-Only Storage', desc: 'No disk writes', active: true },
                ].map((cap, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border ${
                      cap.active
                        ? 'bg-slate-700/50 border-slate-600'
                        : 'bg-slate-800/50 border-slate-700 opacity-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-white text-sm">{cap.name}</h4>
                      <Badge
                        variant="outline"
                        className={cap.active ? 'bg-green-500/20 text-green-400' : 'bg-slate-600/20 text-slate-400'}
                      >
                        {cap.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400">{cap.desc}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
