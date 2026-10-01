/**
 * F.M.I. - Forensic Media Intelligence Component
 *
 * Uploads evidence, immediately runs the server-owned extraction/analysis path,
 * and hands completed evidence context back to LEXARA case analysis.
 */

import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  FileText,
  Image,
  Video,
  Music,
  CheckCircle2,
  AlertCircle,
  Scale,
  Search,
  Brain,
  Shield,
  Link2,
  TrendingUp,
  AlertTriangle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDropzone } from "react-dropzone";

interface FMIAnalysisProps {
  lawType: string;
  lawTypeName: string;
  state?: string;
  caseContext?: string;
  onAnalysisComplete?: (results: any) => void;
}

interface FMIFile {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  fmiAnalysisStatus: 'pending' | 'processing' | 'completed' | 'failed';
  evidenceStrength?: string;
  admissibilityAssessment?: string;
  keyFindings?: string[];
}

interface FMIUploadResponse {
  success: boolean;
  file: FMIFile;
  error?: string;
}

export default function FMIAnalysis({
  lawType,
  lawTypeName,
  state,
  caseContext,
  onAnalysisComplete,
}: FMIAnalysisProps) {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [combinedReview, setCombinedReview] = useState<any | null>(null);
  const completedAnalysesRef = useRef<any[]>([]);

  const { data: fmiFiles, refetch: refetchFiles } = useQuery<FMIFile[]>({
    queryKey: ['/api/fmi/files'],
    queryFn: async () => {
      const response = await apiRequest('/api/fmi/files', 'GET');
      if (!response.ok) throw new Error('Failed to fetch F.M.I. files');
      const data = await response.json();
      return data.files || [];
    }
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File): Promise<FMIUploadResponse> => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('lawType', lawType || 'general');
      formData.append('associatedWith', 'consultation');

      const response = await fetch('/api/fmi/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(errorData.error || 'F.M.I. upload failed');
      }

      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "F.M.I. Upload Successful",
        description: `${data.file.name} uploaded. Running forensic extraction and analysis now.`,
      });
      void refetchFiles();
    },
    onError: (error: Error) => {
      toast({
        title: "Media Analyzer Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (payload: {
      fileId: string;
      lawType: string;
      state: string;
      caseContext?: string;
    }) => {
      const response = await apiRequest('/api/fmi/analyze', 'POST', payload);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || body?.message || 'F.M.I. analysis failed');
      }
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "F.M.I. Analysis Complete",
        description: "Evidence content was extracted and analyzed successfully.",
      });
      void refetchFiles();

      if (data?.analysis) {
        completedAnalysesRef.current = [
          ...completedAnalysesRef.current,
          data.analysis,
        ].slice(-12);
        onAnalysisComplete?.(completedAnalysesRef.current);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "F.M.I. Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
      void refetchFiles();
    },
  });

  const reviewSetMutation = useMutation({
    mutationFn: async (payload: { fileIds?: string[]; documents?: any[]; lawType: string; state: string; question?: string }) => {
      const response = await apiRequest('/api/fmi/review-set', 'POST', payload);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'F.M.I. combined document review failed');
      }
      return await response.json();
    },
    onError: (error: Error) => {
      toast({
        title: 'Combined Document Review Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const supportedAccept = {
    'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/gif': ['.gif'],
    'image/webp': ['.webp'], 'image/bmp': ['.bmp'], 'image/tiff': ['.tif', '.tiff'],
    'application/pdf': ['.pdf'], 'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'text/plain': ['.txt'], 'text/csv': ['.csv'], 'message/rfc822': ['.eml'],
    'video/mp4': ['.mp4'], 'video/quicktime': ['.mov'], 'video/x-msvideo': ['.avi'],
    'video/mpeg': ['.mpeg', '.mpg'], 'video/webm': ['.webm'],
    'audio/mpeg': ['.mp3'], 'audio/wav': ['.wav'], 'audio/ogg': ['.ogg'],
    'audio/mp4': ['.m4a', '.mp4'], 'audio/x-m4a': ['.m4a'],
  } as const;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: supportedAccept,
    onDropRejected: (rejections) => {
      const first = rejections[0];
      const code = first?.errors?.[0]?.code;
      const message = code === 'file-too-large'
        ? 'That file exceeds the 100 MB Media Analyzer limit.'
        : code === 'file-invalid-type'
          ? 'That file type is not supported by Media Analyzer.'
          : first?.errors?.[0]?.message || 'The selected media could not be accepted.';
      toast({ title: 'Media Analyzer Upload Failed', description: message, variant: 'destructive' });
    },
    onDrop: async (acceptedFiles) => {
      if (!state) {
        toast({
          title: 'Select a jurisdiction first',
          description: 'F.M.I. needs the case jurisdiction before it can analyze legal significance.',
          variant: 'destructive',
        });
        return;
      }

      const completedFileIds: string[] = [];
      const batchReviewInputs: any[] = [];
      for (const file of acceptedFiles) {
        try {
          setUploadProgress(30);
          const uploaded = await uploadMutation.mutateAsync(file);
          setUploadProgress(65);

          if (!uploaded?.file?.id) {
            throw new Error('F.M.I. upload completed without an evidence file ID');
          }

          const analyzed = await analyzeMutation.mutateAsync({
            fileId: uploaded.file.id,
            lawType: lawType || 'general',
            state,
            caseContext: caseContext?.trim() || undefined,
          });
          completedFileIds.push(uploaded.file.id);
          if (analyzed?.reviewInput) batchReviewInputs.push(analyzed.reviewInput);
          setUploadProgress(100);
        } catch {
          // The mutations surface the actionable error. Continue so one bad file
          // does not prevent other accepted evidence from being processed.
        } finally {
          window.setTimeout(() => setUploadProgress(0), 250);
        }
      }

      if (completedFileIds.length >= 2) {
        try {
          setUploadProgress(90);
          const useEphemeralReview = batchReviewInputs.some(input => input?.persistence !== 'persistent');
          const combined = await reviewSetMutation.mutateAsync({
            fileIds: completedFileIds,
            documents: useEphemeralReview && batchReviewInputs.length >= 2
              ? batchReviewInputs.slice(0, 8)
              : undefined,
            lawType: lawType || 'general',
            state,
            question: caseContext?.trim() || undefined,
          });
          setCombinedReview({
            review: combined.review,
            sources: combined.sources,
            fileCount: combined.fileCount,
          });
          onAnalysisComplete?.({
            documents: completedAnalysesRef.current,
            documentSetReview: combined.review,
            sources: combined.sources,
          });
          toast({
            title: 'Combined Document Review Complete',
            description: combined.fileCount < completedFileIds.length
              ? `Compared ${combined.fileCount} files together in this review pass; the remaining files were still analyzed individually.`
              : `Compared ${combined.fileCount} uploaded files together.`,
          });
          setUploadProgress(100);
        } finally {
          window.setTimeout(() => setUploadProgress(0), 250);
        }
      }
    },
    multiple: true,
    maxSize: 100 * 1024 * 1024,
  });

  const getFileIcon = (type: string) => {
    if (type.includes('image')) return <Image className="w-5 h-5 text-blue-600" />;
    if (type.includes('video')) return <Video className="w-5 h-5 text-purple-600" />;
    if (type.includes('audio')) return <Music className="w-5 h-5 text-green-600" />;
    return <FileText className="w-5 h-5 text-gray-600" />;
  };

  const getStrengthColor = (strength?: string) => {
    if (!strength) return 'secondary';
    switch (strength) {
      case 'compelling': return 'default';
      case 'strong': return 'default';
      case 'moderate': return 'secondary';
      case 'weak': return 'outline';
      default: return 'secondary';
    }
  };

  const busy = uploadMutation.isPending || analyzeMutation.isPending || reviewSetMutation.isPending;

  return (
    <div className="space-y-6">
      <Card className="border-2 border-primary/20 bg-gradient-to-br from-slate-950 to-slate-900 text-white overflow-hidden relative">
        <div className="absolute inset-0 opacity-10">
          <img
            src="/images/615D.avif"
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-900/90 to-slate-950/95" />
        </div>

        <CardHeader className="space-y-1 relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-lg">
              <Brain className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Media Analyzer</CardTitle>
              <CardDescription className="text-gray-300">
                Evidence extraction and legal-context analysis for {lawTypeName.toLowerCase()} matters
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative z-10">
          <div
            {...getRootProps()}
            aria-disabled={!state || busy}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center
              transition-all duration-200
              ${!state || busy
                ? 'cursor-not-allowed border-gray-700 bg-slate-900/70 opacity-70'
                : isDragActive
                  ? 'cursor-pointer border-primary bg-primary/10'
                  : 'cursor-pointer border-gray-600 hover:border-primary/50 bg-slate-900/50'
              }
            `}
          >
            <input {...getInputProps()} disabled={!state || busy} />
            <Upload className="w-12 h-12 mx-auto mb-4 text-primary" />
            <p className="text-lg font-semibold mb-2">
              {!state
                ? 'Select the case jurisdiction before uploading evidence'
                : busy
                  ? 'F.M.I. is processing evidence…'
                  : isDragActive
                    ? 'Drop files for F.M.I. analysis'
: 'Click Here to Upload & Analyze Media'}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              Supported media is extracted from the actual stored file, then analyzed in the selected legal context.
            </p>
            <Button
              type="button"
              disabled={!state || busy}
              className="min-h-12 bg-amber-400 px-5 font-bold text-slate-950 hover:bg-amber-300 border border-amber-500"
            >
              <Upload className="w-5 h-5 mr-2" />
              Click Here to Upload & Analyze Media
            </Button>

            {uploadProgress > 0 && (
              <div className="mt-4">
                <Progress value={uploadProgress} className="h-2" />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">📄 Documents</Badge>
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">🖼️ Images</Badge>
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">🎥 Video</Badge>
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">🎵 Audio</Badge>
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">📧 Email</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            F.M.I. Intelligence Capabilities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Search className="w-4 h-4 text-blue-600" />
                Content Extraction
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Document and image text extraction</li>
                <li>• Audio/video transcription and salient timestamps</li>
                <li>• Names, dates, locations, quotations, and event extraction</li>
                <li>• Timeline-oriented evidence structuring</li>
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Scale className="w-4 h-4 text-purple-600" />
                Legal Context
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Evidence classification and relevance type</li>
                <li>• Hearsay and authentication flags</li>
                <li>• Chain-of-custody and expert-witness flags</li>
                <li>• Jurisdiction-aware evidentiary-rule analysis</li>
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Link2 className="w-4 h-4 text-green-600" />
                LEXARA Handoff
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Completed evidence analysis feeds full case analysis</li>
                <li>• Multiple uploaded analyses remain available in the current case context</li>
                <li>• Evidence remains separate from controlling legal authority</li>
                <li>• Extracted content is treated as untrusted evidence, not instructions</li>
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                Accuracy Boundaries
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Unreadable or inaudible content must remain marked uncertain</li>
                <li>• F.M.I. output is evidence analysis, not proof of credibility</li>
                <li>• Failed extraction is marked failed rather than completed</li>
                <li>• File ownership is enforced server-side before analysis</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {combinedReview?.review && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Link2 className="w-5 h-5 text-primary" />
              Combined Evidence Review
            </CardTitle>
            <CardDescription>
              Cross-file comparison of {Number(combinedReview.fileCount || 0)} uploaded evidence files
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {combinedReview.review.summary && (
              <p className="leading-relaxed">{String(combinedReview.review.summary)}</p>
            )}
            {Array.isArray(combinedReview.review.keyFindings) && combinedReview.review.keyFindings.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold">Key cross-file findings</h4>
                <ul className="space-y-1 text-muted-foreground">
                  {combinedReview.review.keyFindings.slice(0, 8).map((item: any, index: number) => (
                    <li key={index}>• {String(item?.text || item)}</li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(combinedReview.review.contradictions) && combinedReview.review.contradictions.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold">Potential contradictions</h4>
                <ul className="space-y-1 text-muted-foreground">
                  {combinedReview.review.contradictions.slice(0, 8).map((item: any, index: number) => (
                    <li key={index}>• {String(item?.text || item)}</li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(combinedReview.sources) && combinedReview.sources.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Sources: {combinedReview.sources.map((source: any) => String(source?.fileName || '')).filter(Boolean).join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {fmiFiles && fmiFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">F.M.I. Evidence Repository</CardTitle>
            <CardDescription>
              {fmiFiles.length} evidence file{fmiFiles.length !== 1 ? 's' : ''} in your F.M.I. repository
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {fmiFiles.map((file) => (
                <div
                  key={file.id}
                  className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${selectedFile === file.id ? 'bg-accent/70' : 'hover:bg-accent/50'} cursor-pointer`}
                  onClick={() => setSelectedFile(file.id)}
                >
                  <div className="flex items-center gap-3 flex-1">
                    {getFileIcon(file.type)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB • Uploaded {new Date(file.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {file.fmiAnalysisStatus === 'completed' && (
                      <>
                        {file.evidenceStrength && (
                          <Badge variant={getStrengthColor(file.evidenceStrength)} className="text-xs">
                            <TrendingUp className="w-3 h-3 mr-1" />
                            {file.evidenceStrength}
                          </Badge>
                        )}
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      </>
                    )}
                    {file.fmiAnalysisStatus === 'pending' && (
                      <Badge variant="outline" className="text-xs">Pending</Badge>
                    )}
                    {file.fmiAnalysisStatus === 'processing' && (
                      <Badge variant="secondary" className="text-xs">Processing</Badge>
                    )}
                    {file.fmiAnalysisStatus === 'failed' && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Failed
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Brain className="w-5 h-5 text-primary mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">F.M.I. Integration with LEXARA</p>
              <p className="text-xs text-muted-foreground">
                Successfully analyzed evidence is supplied to LEXARA as bounded evidence context for the current case. It is not treated as controlling law or as independently verified truth.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
