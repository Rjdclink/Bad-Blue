
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEOHead } from "@/components/SEOHead";
import { 
  AlertTriangle, 
  Image as ImageIcon, 
  Video, 
  File, 
  Calendar, 
  MapPin, 
  User, 
  Upload,
  FileText,
  FileAudio,
  Eye,
  UserX
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface PublicEvidence {
  id: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  officerName?: string | null;
  department?: string | null;
  location?: string | null;
  incidentDate?: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  description?: string | null;
  evidenceCategory?: string | null;
}

export default function EvidenceHub() {
  const { user } = useAuth();
  const [filterType, setFilterType] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const { data: evidence, isLoading } = useQuery<PublicEvidence[]>({
    queryKey: ['/api/evidence-hub', filterType, filterCategory],
    queryFn: async () => {
      const response = await fetch(`/api/evidence-hub?type=${filterType}&category=${filterCategory}`);
      if (!response.ok) throw new Error('Failed to fetch evidence');
      return response.json();
    }
  });

  const getFileIcon = (type: string) => {
    if (type.includes('image')) return <ImageIcon className="w-5 h-5" />;
    if (type.includes('video')) return <Video className="w-5 h-5" />;
    if (type.includes('audio')) return <FileAudio className="w-5 h-5" />;
    if (type.includes('pdf') || type.includes('document')) return <FileText className="w-5 h-5" />;
    return <File className="w-5 h-5" />;
  };

  const getCategoryBadge = (category?: string | null) => {
    if (category === 'informant') {
      return <Badge variant="destructive" className="text-xs"><UserX className="w-3 h-3 mr-1" />Informant</Badge>;
    }
    if (category === 'corruption') {
      return <Badge variant="default" className="bg-orange-600 text-xs"><AlertTriangle className="w-3 h-3 mr-1" />Corruption</Badge>;
    }
    return <Badge variant="secondary" className="text-xs">Misconduct</Badge>;
  };

  const evidenceHubSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "Corrupt Law Enforcement & Informant Hub",
    "description": "Community platform for uploading and sharing evidence of law enforcement corruption, misconduct, and informant documents. All media types accepted including photos, videos, audio recordings, and documents.",
    "provider": {
      "@type": "Organization",
      "name": "BadBlue"
    },
    "serviceType": "Corruption & Informant Evidence Repository",
    "areaServed": {
      "@type": "Country",
      "name": "United States"
    }
  };

  const breadcrumbs = [
    { name: "Corrupt Law Enforcement & Informant Hub", url: "https://bad-blue.com/evidence-hub" }
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Corrupt Law Enforcement & Informant Hub | BadBlue"
        description="Community platform for uploading evidence of law enforcement corruption and informant documents. All media types accepted."
        keywords="police corruption evidence, law enforcement misconduct evidence, police brutality video, body camera footage, police abuse documentation, informant documents, snitch evidence, police misconduct photos, officer corruption proof, police accountability evidence"
        canonicalUrl="https://bad-blue.com/evidence-hub"
        structuredData={evidenceHubSchema}
        breadcrumbs={breadcrumbs}
        pageType="service"
      />
      
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-destructive" />
            <span className="font-semibold text-lg" data-testid="text-hub-title">Corrupt Law Enforcement & Informant Hub</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => window.location.href = "/home"} data-testid="button-back-home">
              Back to Home
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3" data-testid="text-page-title">
            <AlertTriangle className="w-8 h-8 text-destructive" />
            Corrupt Law Enforcement & Informant Hub
          </h1>
          <p className="text-muted-foreground text-lg">
            Upload and share evidence of law enforcement wrongdoings and informant documents. 
            All media types accepted. Your identity remains protected.
          </p>
        </div>

        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <Eye className="w-5 h-5 text-destructive mt-0.5" />
            <div>
              <h3 className="font-semibold text-destructive">Public Evidence Repository</h3>
              <p className="text-sm text-muted-foreground">
                All uploaded evidence is publicly viewable to promote transparency and accountability.
                Upload documents, photos, videos, audio recordings, and any other media exposing corruption or informant activity.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div className="flex flex-wrap gap-2">
            <span className="text-sm font-medium text-muted-foreground py-2">Category:</span>
            <Button
              variant={filterCategory === "all" ? "default" : "outline"}
              onClick={() => setFilterCategory("all")}
              size="sm"
              data-testid="filter-category-all"
            >
              All
            </Button>
            <Button
              variant={filterCategory === "corruption" ? "default" : "outline"}
              onClick={() => setFilterCategory("corruption")}
              size="sm"
              className={filterCategory === "corruption" ? "bg-orange-600" : ""}
              data-testid="filter-category-corruption"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Corruption
            </Button>
            <Button
              variant={filterCategory === "informant" ? "destructive" : "outline"}
              onClick={() => setFilterCategory("informant")}
              size="sm"
              data-testid="filter-category-informant"
            >
              <UserX className="w-4 h-4 mr-2" />
              Informant/Snitch
            </Button>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <span className="text-sm font-medium text-muted-foreground py-2">Media Type:</span>
            <Button
              variant={filterType === "all" ? "default" : "outline"}
              onClick={() => setFilterType("all")}
              size="sm"
              data-testid="filter-type-all"
            >
              All Types
            </Button>
            <Button
              variant={filterType === "image" ? "default" : "outline"}
              onClick={() => setFilterType("image")}
              size="sm"
              data-testid="filter-type-image"
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              Photos
            </Button>
            <Button
              variant={filterType === "video" ? "default" : "outline"}
              onClick={() => setFilterType("video")}
              size="sm"
              data-testid="filter-type-video"
            >
              <Video className="w-4 h-4 mr-2" />
              Videos
            </Button>
            <Button
              variant={filterType === "audio" ? "default" : "outline"}
              onClick={() => setFilterType("audio")}
              size="sm"
              data-testid="filter-type-audio"
            >
              <FileAudio className="w-4 h-4 mr-2" />
              Audio
            </Button>
            <Button
              variant={filterType === "document" ? "default" : "outline"}
              onClick={() => setFilterType("document")}
              size="sm"
              data-testid="filter-type-document"
            >
              <FileText className="w-4 h-4 mr-2" />
              Documents
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-4 text-muted-foreground">Loading evidence...</p>
          </div>
        ) : evidence && evidence.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {evidence.map((item) => (
              <Card key={item.id} className="overflow-hidden hover-elevate" data-testid={`card-evidence-${item.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getFileIcon(item.fileType)}
                      <CardTitle className="text-lg truncate">{item.fileName}</CardTitle>
                    </div>
                    {getCategoryBadge(item.evidenceCategory)}
                  </div>
                  {item.description && (
                    <CardDescription>{item.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    {item.officerName && (
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span><strong>Subject:</strong> {item.officerName}</span>
                      </div>
                    )}
                    {item.department && (
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                        <span>{item.department}</span>
                      </div>
                    )}
                    {item.location && (
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span>{item.location}</span>
                      </div>
                    )}
                    {item.incidentDate && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span>{new Date(item.incidentDate).toLocaleDateString()}</span>
                      </div>
                    )}
                    <div className="pt-2">
                      <Badge variant="secondary" className="text-xs">
                        Uploaded {new Date(item.uploadedAt).toLocaleDateString()}
                      </Badge>
                    </div>
                  </div>
                  <Button 
                    className="w-full mt-4" 
                    onClick={() => window.open(item.fileUrl, '_blank')}
                    data-testid={`button-view-evidence-${item.id}`}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    View Evidence
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Upload className="w-16 h-16 mx-auto mb-4 text-destructive/60" />
              <h3 className="text-lg font-semibold mb-2">No Evidence Uploaded Yet</h3>
              <p className="text-muted-foreground mb-4">
                Be the first to expose corruption or informant activity in your community.
              </p>
              <div className="bg-muted/50 rounded-lg p-4 text-left max-w-md mx-auto">
                <h4 className="font-medium mb-2">Accepted Evidence Types:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Photos & Screenshots</li>
                  <li className="flex items-center gap-2"><Video className="w-4 h-4" /> Video Recordings</li>
                  <li className="flex items-center gap-2"><FileAudio className="w-4 h-4" /> Audio Recordings</li>
                  <li className="flex items-center gap-2"><FileText className="w-4 h-4" /> Documents & PDFs</li>
                  <li className="flex items-center gap-2"><File className="w-4 h-4" /> Any Other Media</li>
                </ul>
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                When filing a complaint or lawsuit, select "Share with Corrupt Law Enforcement & Informant Hub" to make your evidence publicly available.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
