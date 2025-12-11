/**
 * Geoconsole Report Screen
 * 
 * UI for POST /api/geoconsole/report
 * Generate comprehensive location intelligence reports
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
  FileText,
  Download,
  MapPin,
  Activity,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Loader2,
  TrendingUp,
  Navigation,
} from 'lucide-react';

interface IntelligenceReport {
  id: string;
  generatedAt: string;
  subject: string;
  timeRange: { start: string; end: string };
  summary: {
    totalLocations: number;
    uniqueLocations: number;
    totalDistance: number;
    averageSpeed: number;
    dataQuality: number;
  };
  frequentLocations: any[];
  motionPattern: any;
  anomalies: any[];
  dataSources: any[];
}

export default function GeoconsoleReportScreen() {
  const [sessionId, setSessionId] = useState('');
  const [subject, setSubject] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<IntelligenceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateReport = useCallback(async () => {
    if (!sessionId || !subject) {
      setError('Session ID and Subject are required');
      return;
    }

    setGenerating(true);
    setProgress(0);
    setError(null);
    setReport(null);

    try {
      setProgress(30);

      const requestBody: any = {
        sessionId,
        subject,
      };

      if (startDate && endDate) {
        requestBody.timeRange = {
          start: new Date(startDate).toISOString(),
          end: new Date(endDate).toISOString(),
        };
      }

      const response = await fetch('/api/geoconsole/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      setProgress(80);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Report generation failed');
      }

      setReport(data.data);
      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report generation failed');
    } finally {
      setGenerating(false);
    }
  }, [sessionId, subject, startDate, endDate]);

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `intelligence-report-${report.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Intelligence Report</h1>
            <p className="text-slate-400 mt-1">
              POST /api/geoconsole/report - Location analysis & insights
            </p>
          </div>
          <Badge variant="outline" className="bg-purple-500/20 text-purple-400">
            <FileText className="w-4 h-4 mr-2" />
            Report Generator
          </Badge>
        </div>

        {/* Input Section */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Report Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300">Session ID *</Label>
                <Input
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  placeholder="Enter session ID from process step"
                  className="bg-slate-700 border-slate-600 text-white mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Session ID returned from /process endpoint
                </p>
              </div>
              <div>
                <Label className="text-slate-300">Subject Name *</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Report subject identifier"
                  className="bg-slate-700 border-slate-600 text-white mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300">Start Date (optional)</Label>
                <Input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300">End Date (optional)</Label>
                <Input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white mt-1"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button
                onClick={generateReport}
                disabled={generating || !sessionId || !subject}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Generate Report
                  </>
                )}
              </Button>
            </div>

            {generating && (
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

        {/* Report Results */}
        {report && (
          <>
            {/* Summary Card */}
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    Location Intelligence Report
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={downloadReport}>
                    <Download className="w-4 h-4 mr-2" />
                    Download JSON
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Report Header */}
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400">Report ID:</span>
                      <span className="ml-2 font-mono">{report.id}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Subject:</span>
                      <span className="ml-2">{report.subject}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Generated:</span>
                      <span className="ml-2">{new Date(report.generatedAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-5 gap-4">
                  <div className="bg-slate-700/50 rounded-lg p-4 text-center">
                    <MapPin className="w-6 h-6 mx-auto mb-2 text-blue-400" />
                    <p className="text-2xl font-bold text-blue-400">
                      {report.summary.totalLocations}
                    </p>
                    <p className="text-xs text-slate-400">Total Locations</p>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-4 text-center">
                    <Navigation className="w-6 h-6 mx-auto mb-2 text-green-400" />
                    <p className="text-2xl font-bold text-green-400">
                      {report.summary.uniqueLocations}
                    </p>
                    <p className="text-xs text-slate-400">Unique Locations</p>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-4 text-center">
                    <TrendingUp className="w-6 h-6 mx-auto mb-2 text-purple-400" />
                    <p className="text-2xl font-bold text-purple-400">
                      {(report.summary.totalDistance / 1000).toFixed(1)} km
                    </p>
                    <p className="text-xs text-slate-400">Total Distance</p>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-4 text-center">
                    <Activity className="w-6 h-6 mx-auto mb-2 text-orange-400" />
                    <p className="text-2xl font-bold text-orange-400">
                      {(report.summary.averageSpeed * 3.6).toFixed(1)} km/h
                    </p>
                    <p className="text-xs text-slate-400">Avg Speed</p>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-4 text-center">
                    <CheckCircle className="w-6 h-6 mx-auto mb-2 text-cyan-400" />
                    <p className="text-2xl font-bold text-cyan-400">
                      {(report.summary.dataQuality * 100).toFixed(0)}%
                    </p>
                    <p className="text-xs text-slate-400">Data Quality</p>
                  </div>
                </div>

                {/* Frequent Locations */}
                {report.frequentLocations.length > 0 && (
                  <div className="bg-slate-700/50 rounded-lg p-4">
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      Frequent Locations ({report.frequentLocations.length})
                    </h4>
                    <div className="space-y-2">
                      {report.frequentLocations.slice(0, 5).map((loc: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm bg-slate-600/50 rounded p-2">
                          <div>
                            <span className="font-mono">
                              {loc.position.latitude.toFixed(4)}, {loc.position.longitude.toFixed(4)}
                            </span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-slate-400">
                              {loc.visitCount} visits
                            </span>
                            <Badge variant="outline">
                              {Math.round(loc.totalDuration / 60)} min total
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anomalies */}
                {report.anomalies.length > 0 && (
                  <div className="bg-slate-700/50 rounded-lg p-4">
                    <h4 className="font-medium mb-3 flex items-center gap-2 text-yellow-400">
                      <AlertTriangle className="w-4 h-4" />
                      Anomalies Detected ({report.anomalies.length})
                    </h4>
                    <div className="space-y-2">
                      {report.anomalies.map((anomaly: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm bg-yellow-900/20 rounded p-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={
                              anomaly.severity === 'high' ? 'border-red-500 text-red-400' :
                              anomaly.severity === 'medium' ? 'border-yellow-500 text-yellow-400' :
                              'border-slate-500 text-slate-400'
                            }>
                              {anomaly.severity}
                            </Badge>
                            <span>{anomaly.description}</span>
                          </div>
                          <span className="text-slate-400 text-xs">
                            {new Date(anomaly.timestamp).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Motion Pattern */}
                {report.motionPattern && (
                  <div className="bg-slate-700/50 rounded-lg p-4">
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      Motion Pattern Analysis
                    </h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-slate-400">Primary Mode:</span>
                        <Badge className="ml-2">{report.motionPattern.primaryMode}</Badge>
                      </div>
                      <div>
                        <span className="text-slate-400">Active Periods:</span>
                        <span className="ml-2">{report.motionPattern.activityPeriods?.length || 0}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Data Sources */}
                {report.dataSources.length > 0 && (
                  <div className="bg-slate-700/50 rounded-lg p-4">
                    <h4 className="font-medium mb-3">Data Sources</h4>
                    <div className="flex flex-wrap gap-2">
                      {report.dataSources.map((src: any, idx: number) => (
                        <Badge key={idx} variant="outline">
                          {src.source}: {src.pointCount} pts ({(src.averageConfidence * 100).toFixed(0)}% conf)
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Raw JSON */}
                <div>
                  <Label className="text-slate-300">Raw Response</Label>
                  <Textarea
                    value={JSON.stringify(report, null, 2)}
                    readOnly
                    className="bg-slate-700 border-slate-600 text-slate-300 font-mono text-xs h-48 mt-1"
                  />
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
