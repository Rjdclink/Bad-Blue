/**
 * Stage 2B: File Upload Component
 * Allows users to upload evidence files with law type associations
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, X, File, Image as ImageIcon, Video, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  lawType?: string;
  associatedWith?: string;
}

interface FileUploadProps {
  associatedWith?: 'consultation' | 'document' | 'evidence-analysis';
  lawType?: string;
  onFilesUploaded?: (files: UploadedFile[]) => void;
  onUploadComplete?: (fileId: string) => void;
  maxFiles?: number;
  maxSizeMB?: number;
}

export function FileUpload({ 
  associatedWith, 
  lawType, 
  onFilesUploaded,
  onUploadComplete,
  maxFiles = 10,
  maxSizeMB = 50 
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing files
  const { data: filesData, isLoading: isLoadingFiles } = useQuery<{ files: UploadedFile[] }>({
    queryKey: ['/api/upload/evidence', lawType, associatedWith],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (lawType) params.append('lawType', lawType);
      if (associatedWith) params.append('associatedWith', associatedWith);
      
      const response = await fetch(`/api/upload/evidence?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch files');
      return response.json();
    },
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      if (lawType) formData.append('lawType', lawType);
      if (associatedWith) formData.append('associatedWith', associatedWith);

      const response = await fetch('/api/upload/evidence', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/upload/evidence'] });
      toast({
        title: 'Upload successful',
        description: `${data.file.name} has been uploaded.`,
      });
      onFilesUploaded?.(filesData?.files || []);
    },
    onError: (error: Error) => {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const response = await fetch(`/api/upload/evidence/${fileId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete file');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/upload/evidence'] });
      toast({
        title: 'File deleted',
        description: 'File has been removed successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Delete failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;

    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    const currentFileCount = filesData?.files.length || 0;

    Array.from(files).forEach((file, index) => {
      // Check file count limit
      if (currentFileCount + index >= maxFiles) {
        toast({
          title: 'Too many files',
          description: `Maximum ${maxFiles} files allowed.`,
          variant: 'destructive',
        });
        return;
      }

      // Check file size
      if (file.size > maxSizeBytes) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds ${maxSizeMB}MB limit.`,
          variant: 'destructive',
        });
        return;
      }

      uploadMutation.mutate(file);
    });
  }, [maxFiles, maxSizeMB, filesData?.files.length, toast, uploadMutation]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleDelete = (fileId: string) => {
    if (confirm('Are you sure you want to delete this file?')) {
      deleteMutation.mutate(fileId);
    }
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
    if (fileType.startsWith('video/')) return <Video className="w-4 h-4" />;
    if (fileType === 'application/pdf' || fileType.includes('document')) {
      return <FileText className="w-4 h-4" />;
    }
    return <File className="w-4 h-4" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <Card
        className={`border-2 border-dashed transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center space-y-4 text-center">
            <div className="rounded-full bg-muted p-4">
              <Upload className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">
                Drop files here or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Images, videos, and documents up to {maxSizeMB}MB
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Select Files
                </>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleInputChange}
              accept="image/*,video/*,application/pdf,.doc,.docx"
            />
          </div>
        </CardContent>
      </Card>

      {/* Uploaded Files List */}
      {isLoadingFiles ? (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filesData?.files && filesData.files.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Uploaded Files ({filesData.files.length})</h3>
          <div className="space-y-2">
            {filesData.files.map((file) => (
              <Card key={file.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="text-muted-foreground">
                        {getFileIcon(file.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(file.size)} • {new Date(file.uploadedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(file.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center p-4 text-sm text-muted-foreground">
          No files uploaded yet
        </div>
      )}
    </div>
  );
}
