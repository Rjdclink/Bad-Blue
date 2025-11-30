import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Save, Calendar, Users, TrendingUp } from "lucide-react";
import { formatDistanceToNow, format, startOfToday, isToday } from "date-fns";
import { SEOHead } from "@/components/SEOHead";

const editPetitionSchema = z.object({
  officerName: z.string().min(2, "Officer name is required"),
  department: z.string().min(2, "Department is required"),
  city: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  offenseDescriptionOriginal: z.string().min(10, "Original offense description is required"),
  offenseDescriptionRedrafted: z.string().optional(),
  additionalText: z.string().optional(),
  bottomLink: z.string().url().optional().or(z.literal("")),
});

type EditPetitionFormData = z.infer<typeof editPetitionSchema>;

interface Petition {
  id: number;
  slug: string;
  officerName: string;
  department: string;
  city: string | null;
  county: string | null;
  state: string | null;
  offenseDescriptionOriginal: string;
  offenseDescriptionRedrafted: string | null;
  additionalText: string | null;
  bottomLink: string | null;
  submitterName: string;
  signatureCount: number;
  createdAt: Date;
  updatedAt: Date | null;
  lastCompiledAt: Date | null;
}

interface Signature {
  id: number;
  fullName: string;
  typedSignature: string;
  drawnSignature: string | null;
  signedAt: Date;
}

export default function PetitionEdit() {
  const [match, params] = useRoute("/petition-edit/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("details");

  const petitionId = params?.id ? parseInt(params.id) : null;

  const { data: petition, isLoading: petitionLoading } = useQuery<Petition>({
    queryKey: ['/api/petition-admin', petitionId],
    enabled: !!petitionId,
  });

  const { data: signatures, isLoading: signaturesLoading } = useQuery<Signature[]>({
    queryKey: ['/api/petition-signatures', petitionId],
    enabled: !!petitionId,
  });

  const form = useForm<EditPetitionFormData>({
    resolver: zodResolver(editPetitionSchema),
    values: petition ? {
      officerName: petition.officerName,
      department: petition.department,
      city: petition.city || "",
      county: petition.county || "",
      state: petition.state || "",
      offenseDescriptionOriginal: petition.offenseDescriptionOriginal,
      offenseDescriptionRedrafted: petition.offenseDescriptionRedrafted || "",
      additionalText: petition.additionalText || "",
      bottomLink: petition.bottomLink || "",
    } : undefined,
  });

  const updatePetitionMutation = useMutation({
    mutationFn: async (data: EditPetitionFormData) => {
      const res = await apiRequest(`/api/petition-admin/${petitionId}`, 'PATCH', data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/petition-admin', petitionId] });
      queryClient.invalidateQueries({ queryKey: ['/api/petitions-admin'] });
      toast({
        title: "Success",
        description: "Petition updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update petition",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: EditPetitionFormData) => {
    await updatePetitionMutation.mutateAsync(data);
  };

  // Calculate analytics
  const signaturesToday = signatures?.filter(sig => 
    isToday(new Date(sig.signedAt))
  ).length || 0;

  if (petitionLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="h-12 bg-muted animate-pulse rounded" />
            <div className="h-96 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!petition) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="max-w-6xl mx-auto">
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground text-lg">Petition not found</p>
                <Button
                  onClick={() => setLocation('/admin-petitions')}
                  className="mt-4"
                  variant="outline"
                  data-testid="button-back-to-list"
                >
                  Back to Petitions
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <SEOHead
        title={`Edit Petition: Officer ${petition.officerName}`}
        description="Manage petition details and view signatures"
        noIndex={true}
      />
      
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <Button
                variant="ghost"
                onClick={() => setLocation('/admin-petitions')}
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Petitions
              </Button>
              <div className="flex items-center gap-2">
                <Badge variant="outline" data-testid="badge-total-signatures">
                  <Users className="h-4 w-4 mr-1" />
                  {petition.signatureCount} Total
                </Badge>
              </div>
            </div>

            <div>
              <h1 className="text-3xl font-bold" data-testid="title-petition-edit">
                Manage Petition: Officer {petition.officerName}
              </h1>
              <p className="text-muted-foreground mt-1">
                Edit petition details and view all signatures
              </p>
            </div>

            {/* Analytics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Signatures
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold" data-testid="stat-total-signatures">
                    {petition.signatureCount}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Signatures Today
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold" data-testid="stat-signatures-today">
                    {signaturesToday}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Last Compiled
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-semibold" data-testid="stat-last-compiled">
                    {petition.lastCompiledAt 
                      ? formatDistanceToNow(new Date(petition.lastCompiledAt), { addSuffix: true })
                      : "Never"
                    }
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="details" data-testid="tab-details">Petition Details</TabsTrigger>
                <TabsTrigger value="signatures" data-testid="tab-signatures">
                  Signatures ({signatures?.length || 0})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Edit Petition Information</CardTitle>
                    <CardDescription>
                      Update petition details and descriptions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="officerName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Officer Name *</FormLabel>
                                <FormControl>
                                  <Input {...field} data-testid="input-officer-name" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="department"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Department *</FormLabel>
                                <FormControl>
                                  <Input {...field} data-testid="input-department" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <FormField
                            control={form.control}
                            name="city"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>City</FormLabel>
                                <FormControl>
                                  <Input {...field} data-testid="input-city" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="county"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>County</FormLabel>
                                <FormControl>
                                  <Input {...field} data-testid="input-county" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="state"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>State</FormLabel>
                                <FormControl>
                                  <Input {...field} data-testid="input-state" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <Separator />

                        <FormField
                          control={form.control}
                          name="offenseDescriptionOriginal"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Original Offense Description *</FormLabel>
                              <FormControl>
                                <Textarea 
                                  {...field} 
                                  rows={6}
                                  data-testid="textarea-offense-original"
                                />
                              </FormControl>
                              <FormDescription>
                                The original description submitted by the user
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="offenseDescriptionRedrafted"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>AI Redrafted Description</FormLabel>
                              <FormControl>
                                <Textarea 
                                  {...field} 
                                  rows={6}
                                  data-testid="textarea-offense-redrafted"
                                />
                              </FormControl>
                              <FormDescription>
                                The AI-improved version shown to the public
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="additionalText"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Additional Information</FormLabel>
                              <FormControl>
                                <Textarea 
                                  {...field} 
                                  rows={4}
                                  data-testid="textarea-additional"
                                />
                              </FormControl>
                              <FormDescription>
                                Extra context or information to display
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="bottomLink"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Bottom Link (URL)</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="https://example.com"
                                  data-testid="input-bottom-link"
                                />
                              </FormControl>
                              <FormDescription>
                                Optional link displayed at the bottom of petition page
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <Button
                          type="submit"
                          disabled={updatePetitionMutation.isPending}
                          data-testid="button-save"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          {updatePetitionMutation.isPending ? "Saving..." : "Save Changes"}
                        </Button>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="signatures" className="space-y-4">
                {signaturesLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-24 bg-muted animate-pulse rounded" />
                    ))}
                  </div>
                ) : !signatures || signatures.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-muted-foreground text-lg">No signatures yet</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {signatures.map((signature, index) => (
                      <Card key={signature.id} data-testid={`signature-${signature.id}`}>
                        <CardContent className="py-4">
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline">#{signatures.length - index}</Badge>
                                <span className="font-semibold text-lg">
                                  {signature.fullName}
                                </span>
                              </div>
                              <div className="text-sm text-muted-foreground space-y-1">
                                <div>Typed: {signature.typedSignature}</div>
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-3 w-3" />
                                  {format(new Date(signature.signedAt), "MMM d, yyyy 'at' h:mm a")}
                                  <span className="text-xs">
                                    ({formatDistanceToNow(new Date(signature.signedAt))} ago)
                                  </span>
                                </div>
                              </div>
                            </div>
                            {signature.drawnSignature && (
                              <div className="text-sm text-muted-foreground">
                                <Badge variant="secondary">Has drawn signature</Badge>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </>
  );
}
