/**
 * F.M.I. - Forensic Media Intelligence Component
 * 
 * Unified interface for forensic media upload and intelligence analysis.
 * Design based on 615D.avif - professional forensic technology aesthetic.
 * 
 * Features:
 * - Drag-and-drop + button upload
 * - All media type support (documents, images, video, audio)
 * - Real-time analysis status
 * - Structured intelligence results display
 * - Legal relevance tagging
 * - Evidence strength indicators
 * - Contradiction/corroboration flags
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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

export default function FMIAnalysis({ lawType, lawTypeName, onAnalysisComplete }: FMIAnalysisProps) {
  const { toast } = useToast();
  const [uploadedFiles, setUploadedFiles] = useState<FMIFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  // Query for user's F.M.I. files
  const { data: fmiFiles, refetch: refetchFiles } = useQuery<FMIFile[]>({
    queryKey: ['/api/fmi/files'],
    queryFn: async () => {
      const response = await apiRequest('/api/fmi/files', 'GET');
      if (!response.ok) throw new Error('Failed to fetch F.M.I. files');
      const data = await response.json();
      return data.files || [];
    }
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('lawType', lawType);
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
        description: `${data.file.name} uploaded and queued for forensic analysis`,
      });
      setUploadedFiles(prev => [...prev, data.file]);
      refetchFiles();
      setUploadProgress(0);
    },
    onError: (error: Error) => {
      toast({
        title: "F.M.I. Upload Failed",
        description: error.message,
        variant: "destructive",
      });
      setUploadProgress(0);
    },
  });

  // Analyze mutation
  const analyzeMutation = useMutation({
    mutationFn: async (fileData: any) => {
      const response = await apiRequest('/api/fmi/analyze', 'POST', fileData);
      if (!response.ok) throw new Error('F.M.I. analysis failed');
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "F.M.I. Analysis Complete",
        description: "Forensic intelligence extraction completed successfully",
      });
      refetchFiles();
      if (onAnalysisComplete) {
        onAnalysisComplete(data.analysis);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "F.M.I. Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Dropzone configuration
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: async (acceptedFiles) => {
      for (const file of acceptedFiles) {
        setUploadProgress(50);
        await uploadMutation.mutateAsync(file);
      }
    },
    multiple: true,
    maxSize: 100 * 1024 * 1024, // 100MB
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

  return (
    <div className="space-y-6">
      {/* Main F.M.I. Upload Card - Forensic Technology Aesthetic with 615D.avif Background */}
      <Card className="border-2 border-primary/20 bg-gradient-to-br from-slate-950 to-slate-900 text-white overflow-hidden relative">
        {/* Background Image with Overlay */}
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
              <CardTitle className="text-xl">F.M.I. — Forensic Media Intelligence</CardTitle>
              <CardDescription className="text-gray-300">
                Advanced evidence analysis system for {lawTypeName.toLowerCase()} cases
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative z-10">
          {/* Upload Zone */}
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
              transition-all duration-200
              ${isDragActive 
                ? 'border-primary bg-primary/10' 
                : 'border-gray-600 hover:border-primary/50 bg-slate-900/50'
              }
            `}
          >
            <input {...getInputProps()} />
            <Upload className="w-12 h-12 mx-auto mb-4 text-primary" />
            <p className="text-lg font-semibold mb-2">
              {isDragActive ? 'Drop files for F.M.I. analysis' : 'Upload Evidence to F.M.I.'}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              Drag & drop files here, or click to select
            </p>
            <Button variant="outline" className="text-white border-gray-600 hover:bg-primary/20">
              <Upload className="w-4 h-4 mr-2" />
              Select Files
            </Button>
            
            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="mt-4">
                <Progress value={uploadProgress} className="h-2" />
              </div>
            )}
          </div>

          {/* Supported File Types */}
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">
              📄 Documents
            </Badge>
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">
              🖼️ Images
            </Badge>
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">
              🎥 Video
            </Badge>
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">
              🎵 Audio
            </Badge>
            <Badge variant="outline" className="text-xs bg-slate-800 text-white border-gray-600">
              📧 Email
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* F.M.I. Capabilities Card */}
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
                <li>• OCR for documents and images</li>
                <li>• Speech-to-text for audio/video</li>
                <li>• Metadata and EXIF extraction</li>
                <li>• Timeline reconstruction</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Scale className="w-4 h-4 text-purple-600" />
                Legal Analysis
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Legal relevance tagging</li>
                <li>• Admissibility assessment</li>
                <li>• Element satisfaction analysis</li>
                <li>• Evidentiary rules application</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Link2 className="w-4 h-4 text-green-600" />
                Case Linking
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• People, dates, locations</li>
                <li>• Event correlation</li>
                <li>• Document cross-referencing</li>
                <li>• Witness statement linking</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                Contradiction Detection
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Factual inconsistencies</li>
                <li>• Temporal conflicts</li>
                <li>• Corroboration analysis</li>
                <li>• Credibility assessment</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Uploaded Files List */}
      {fmiFiles && fmiFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">F.M.I. Evidence Repository</CardTitle>
            <CardDescription>
              {fmiFiles.length} file{fmiFiles.length !== 1 ? 's' : ''} analyzed by F.M.I.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {fmiFiles.map((file) => (
                <div 
                  key={file.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
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
                    {file.fmiAnalysisStatus === 'failed' && (
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* F.M.I. Integration Notice */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Brain className="w-5 h-5 text-primary mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">F.M.I. Integration with LEXARA</p>
              <p className="text-xs text-muted-foreground">
                All evidence analyzed by F.M.I. is automatically integrated with LEXARA (Legal Expert AI Resource Advisor) 
                for comprehensive case strategy and legal analysis.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
