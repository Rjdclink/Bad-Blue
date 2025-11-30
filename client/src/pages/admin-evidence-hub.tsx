import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Image as ImageIcon, X, Trash2, Edit, Video, File, AlertTriangle, UserX } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow, format } from "date-fns";
import { SEOHead } from "@/components/SEOHead";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface EvidenceAdmin {
  id: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  officerName: string | null;
  department: string | null;
  location: string | null;
  incidentDate: string | null;
  description: string | null;
  evidenceCategory: string | null;
  uploadedAt: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
}

export default function AdminEvidenceHub() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceAdmin | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<EvidenceAdmin>>({});

  const { data: evidence, isLoading } = useQuery<EvidenceAdmin[]>({
    queryKey: ['/api/admin/evidence-hub'],
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest('/api/admin/evidence-hub/bulk-delete', 'POST', { ids });
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evidence-hub'] });
      toast({
        title: "Evidence Deleted",
        description: `Successfully deleted ${ids.length} evidence submission${ids.length > 1 ? 's' : ''}`,
      });
      setSelectedIds(new Set());
      setDeleteDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete evidence",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<EvidenceAdmin> }) => {
      return await apiRequest(`/api/admin/evidence-hub/${id}`, 'PATCH', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evidence-hub'] });
      toast({
        title: "Evidence Updated",
        description: "Successfully updated evidence submission",
      });
      setEditDialogOpen(false);
      setSelectedEvidence(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update evidence",
        variant: "destructive",
      });
    },
  });

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === evidence?.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(evidence?.map(e => e.id) || []));
    }
  };

  const handleEdit = (ev: EvidenceAdmin) => {
    setSelectedEvidence(ev);
    setEditForm({
      officerName: ev.officerName || '',
      department: ev.department || '',
      location: ev.location || '',
      incidentDate: ev.incidentDate ? format(new Date(ev.incidentDate), 'yyyy-MM-dd') : '',
      description: ev.description || '',
      evidenceCategory: ev.evidenceCategory || 'misconduct',
    });
    setEditDialogOpen(true);
  };

  const getCategoryBadge = (category?: string | null) => {
    if (category === 'informant') {
      return <Badge variant="destructive" className="text-xs">Informant</Badge>;
    }
    if (category === 'corruption') {
      return <Badge variant="default" className="bg-orange-600 text-xs">Corruption</Badge>;
    }
    return <Badge variant="secondary" className="text-xs">Misconduct</Badge>;
  };

  const handleSaveEdit = () => {
    if (!selectedEvidence) return;
    
    updateMutation.mutate({
      id: selectedEvidence.id,
      data: editForm,
    });
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) {
      toast({
        title: "No Selection",
        description: "Please select evidence to delete",
        variant: "destructive",
      });
      return;
    }
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    deleteMutation.mutate(Array.from(selectedIds));
  };

  const getFileIcon = (type: string) => {
    if (type.includes('image')) return <ImageIcon className="w-5 h-5" />;
    if (type.includes('video')) return <Video className="w-5 h-5" />;
    return <File className="w-5 h-5" />;
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Admin: Corrupt Law Enforcement & Snitch Evidence Hub | BadBlue"
        description="Admin panel for managing corruption and informant evidence submissions"
        noIndex={true}
      />

      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-destructive" />
            <span className="font-semibold text-lg">Admin: Corruption & Snitch Evidence Hub</span>
          </div>
          <Link href="/home">
            <Button variant="ghost" data-testid="button-back-home">Back to Home</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Corrupt Law Enforcement & Snitch Evidence Management</h1>
              <p className="text-muted-foreground">
                Manage all corruption and informant evidence submissions
              </p>
            </div>
            <div className="flex gap-2">
              {evidence && evidence.length > 0 && (
                <Button
                  variant="outline"
                  onClick={toggleSelectAll}
                  data-testid="button-select-all"
                >
                  {selectedIds.size === evidence.length ? 'Deselect All' : 'Select All'}
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0}
                data-testid="button-bulk-delete"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected ({selectedIds.size})
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-4 text-muted-foreground">Loading evidence...</p>
          </div>
        ) : evidence && evidence.length > 0 ? (
          <div className="space-y-4">
            {evidence.map((ev) => (
              <Card
                key={ev.id}
                className="hover-elevate transition-all"
                data-testid={`card-evidence-${ev.id}`}
              >
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <Checkbox
                      checked={selectedIds.has(ev.id)}
                      onCheckedChange={() => toggleSelection(ev.id)}
                      data-testid={`checkbox-evidence-${ev.id}`}
                    />
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-xl mb-2 flex items-center gap-2">
                            {getFileIcon(ev.fileType)}
                            {ev.fileName}
                          </CardTitle>
                          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground mb-2">
                            <span>Uploaded by: {ev.userName || ev.userEmail || "Unknown"}</span>
                            <span>•</span>
                            <span>{formatDistanceToNow(new Date(ev.uploadedAt))} ago</span>
                          </div>
                          <div className="flex flex-wrap gap-2 text-sm mb-2">
                            {getCategoryBadge(ev.evidenceCategory)}
                            {ev.officerName && <Badge variant="outline">Subject: {ev.officerName}</Badge>}
                            {ev.department && <Badge variant="outline">{ev.department}</Badge>}
                            {ev.location && <Badge variant="outline">{ev.location}</Badge>}
                          </div>
                          {ev.description && (
                            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                              {ev.description}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(ev)}
                            data-testid={`button-edit-${ev.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => window.open(ev.fileUrl, '_blank')}
                            data-testid={`button-view-${ev.id}`}
                          >
                            <ImageIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No Evidence Submissions</h3>
              <p className="text-muted-foreground">
                No evidence has been shared with the community yet.
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Evidence Submission</DialogTitle>
          </DialogHeader>

          {selectedEvidence && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="officerName">Officer Name</Label>
                <Input
                  id="officerName"
                  value={editForm.officerName || ''}
                  onChange={(e) => setEditForm({ ...editForm, officerName: e.target.value })}
                  data-testid="input-officer-name"
                />
              </div>

              <div>
                <Label htmlFor="department">Department</Label>
                <Input
                  id="department"
                  value={editForm.department || ''}
                  onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                  data-testid="input-department"
                />
              </div>

              <div>
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={editForm.location || ''}
                  onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  data-testid="input-location"
                />
              </div>

              <div>
                <Label htmlFor="incidentDate">Incident Date</Label>
                <Input
                  id="incidentDate"
                  type="date"
                  value={editForm.incidentDate || ''}
                  onChange={(e) => setEditForm({ ...editForm, incidentDate: e.target.value })}
                  data-testid="input-incident-date"
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={4}
                  data-testid="textarea-description"
                />
              </div>

              <div>
                <Label htmlFor="evidenceCategory">Evidence Category</Label>
                <Select
                  value={editForm.evidenceCategory || 'misconduct'}
                  onValueChange={(value) => setEditForm({ ...editForm, evidenceCategory: value })}
                >
                  <SelectTrigger data-testid="select-evidence-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="misconduct">
                      <span className="flex items-center gap-2">General Misconduct</span>
                    </SelectItem>
                    <SelectItem value="corruption">
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3 text-orange-600" />
                        Corruption
                      </span>
                    </SelectItem>
                    <SelectItem value="informant">
                      <span className="flex items-center gap-2">
                        <UserX className="w-3 h-3 text-destructive" />
                        Informant/Snitch
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
          </DialogHeader>

          <p>
            Are you sure you want to delete {selectedIds.size} evidence submission{selectedIds.size > 1 ? 's' : ''}?
            This action cannot be undone.
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
