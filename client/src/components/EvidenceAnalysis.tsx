/**
 * Smart Evidence Analysis Tool
 * 
 * Analyzes uploaded evidence using AI to:
 * - Extract key information
 * - Identify legal issues
 * - Assess evidentiary value
 * - Provide strategic recommendations
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Upload, FileText, Image, Video, AlertCircle, CheckCircle2, Scale } from "lucide-react";
import { FileUpload } from "@/components/FileUpload";

interface EvidenceAnalysisProps {
  lawType: string;
  lawTypeName: string;
}

export default function EvidenceAnalysis({ lawType, lawTypeName }: EvidenceAnalysisProps) {
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  
  return (
    <div className="space-y-6">
      {/* Main Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-600" />
            Smart Evidence Upload & Analysis
          </CardTitle>
          <CardDescription>
            Upload documents, photos, videos, or audio files. Our AI will analyze them for legal relevance
            to your {lawTypeName.toLowerCase()} case.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FileUpload
            associatedWith="document"
            lawType={lawType}
            onFilesUploaded={(files) => {
              setUploadedFiles(prev => [...prev, ...files.map(f => f.id)]);
            }}
          />
        </CardContent>
      </Card>

      {/* AI Analysis Capabilities */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            AI Evidence Analysis Capabilities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Document Analysis
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Extract text from PDFs and images (OCR)</li>
                <li>• Identify key dates, parties, and events</li>
                <li>• Detect contractual obligations and breaches</li>
                <li>• Find relevant case law citations</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Image className="w-4 h-4" />
                Visual Evidence Analysis
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Identify people, objects, and locations</li>
                <li>• Extract timestamps and metadata</li>
                <li>• Detect potential tampering or editing</li>
                <li>• Assess clarity and admissibility</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Video className="w-4 h-4" />
                Audio/Video Processing
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Transcribe speech to text</li>
                <li>• Identify speakers and voices</li>
                <li>• Extract key statements and admissions</li>
                <li>• Timeline reconstruction</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Scale className="w-4 h-4" />
                Legal Issue Spotting
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1 pl-6">
                <li>• Identify potential claims and defenses</li>
                <li>• Assess evidentiary value and admissibility</li>
                <li>• Detect contradictions and corroboration</li>
                <li>• Generate evidence summary for attorney review</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accepted File Types */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Accepted File Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="text-xs">📄 PDF</Badge>
            <Badge variant="outline" className="text-xs">📝 Word (DOC/DOCX)</Badge>
            <Badge variant="outline" className="text-xs">🖼️ Images (JPG, PNG, GIF)</Badge>
            <Badge variant="outline" className="text-xs">🎥 Video (MP4, MOV, AVI)</Badge>
            <Badge variant="outline" className="text-xs">🎵 Audio (MP3, WAV, M4A)</Badge>
            <Badge variant="outline" className="text-xs">📊 Spreadsheets (XLS, CSV)</Badge>
            <Badge variant="outline" className="text-xs">💬 Text (TXT)</Badge>
            <Badge variant="outline" className="text-xs">📧 Email (EML, MSG)</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Best Practices */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-amber-800 dark:text-amber-400">
            <AlertCircle className="w-4 h-4" />
            Best Practices for Evidence Upload
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-2 text-amber-900 dark:text-amber-300">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Upload original, unedited files when possible</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Ensure files are clear and legible (minimum 300 DPI for scanned documents)</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Include metadata and context where available</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Organize files by category (contracts, correspondence, photos, etc.)</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Keep originals secured - upload copies for analysis</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Privacy Notice */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900">
        <CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">
            <strong>Privacy & Security:</strong> All uploaded evidence is encrypted and stored securely.
            Files are only accessible to you and are processed by AI models that don't retain data.
            We recommend consulting with an attorney before uploading highly sensitive materials.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
