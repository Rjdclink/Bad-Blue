import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, MapPin, Building2, Share2, CheckCircle2, X } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";

const signatureSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  typedSignature: z.string().min(2, "Typed signature is required"),
  drawnSignature: z.string().optional(),
  consent: z.boolean().refine((val) => val === true, {
    message: "You must affirm this is your name and signature",
  }),
});

type SignatureFormData = z.infer<typeof signatureSchema>;

export default function PetitionDetail() {
  const [match, params] = useRoute("/petition/:slug");
  const { toast } = useToast();
  const [hasSigned, setHasSigned] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null);

  const slug = params?.slug;

  const { data: petition, isLoading } = useQuery({
    queryKey: ['/api/petition-public', slug],
    enabled: !!slug,
  });

  const form = useForm<SignatureFormData>({
    resolver: zodResolver(signatureSchema),
    defaultValues: {
      fullName: "",
      typedSignature: "",
      drawnSignature: "",
      consent: false,
    },
  });

  // Canvas drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.nativeEvent.offsetX;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.nativeEvent.offsetY;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.nativeEvent.offsetX;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.nativeEvent.offsetY;

    ctx.lineTo(x, y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL();
      setSignatureData(dataUrl);
      form.setValue('drawnSignature', dataUrl);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData(null);
    form.setValue('drawnSignature', '');
  };

  const signPetitionMutation = useMutation({
    mutationFn: async (data: SignatureFormData) => {
      const res = await apiRequest(`/api/petition/${slug}/sign`, 'POST', data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/petition-public', slug] });
      setHasSigned(true);
      form.reset();
      clearCanvas();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to sign petition",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: SignatureFormData) => {
    await signPetitionMutation.mutateAsync(data);
  };

  const shareOnFacebook = () => {
    const url = window.location.href;
    const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    window.open(facebookUrl, '_blank', 'width=600,height=400');
  };

  const createOnChangeOrg = () => {
    const title = encodeURIComponent(`Demand Resignation: Officer ${petition.officerName}`);
    const description = encodeURIComponent(petition.offenseDescriptionRedrafted || petition.offenseDescriptionOriginal);
    const changeOrgUrl = `https://www.change.org/start-a-petition?title=${title}&description=${description}`;
    window.open(changeOrgUrl, '_blank');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="h-48 bg-muted animate-pulse rounded" />
            <div className="h-64 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!petition) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="max-w-4xl mx-auto">
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground text-lg">Officer resignation petition not found</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  const location = [petition.city, petition.county, petition.state].filter(Boolean).join(", ");
  const petitionTitle = `Officer Resignation Petition: Officer ${petition.officerName}`;
  const petitionDescription = `Demand the resignation of Officer ${petition.officerName} from ${petition.department}. ${petition.signatureCount} signatures so far.`;

  return (
    <>
      <SEOHead
        title={petitionTitle}
        description={petitionDescription}
        ogTitle={petitionTitle}
        ogDescription={petitionDescription}
        ogType="website"
      />
      
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Petition Header */}
            <Card className="border-destructive/20 bg-destructive/5">
              <CardHeader>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-3xl mb-3" data-testid="title-petition">
                      Officer Resignation Petition
                    </CardTitle>
                    <CardDescription className="text-base space-y-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 flex-shrink-0" />
                        <span className="font-semibold" data-testid="text-officer-name">
                          Officer {petition.officerName}
                        </span>
                      </div>
                      <div data-testid="text-department">{petition.department}</div>
                      {location && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 flex-shrink-0" />
                          <span data-testid="text-location">{location}</span>
                        </div>
                      )}
                    </CardDescription>
                  </div>
                  <Badge variant="default" className="text-2xl px-6 py-3 whitespace-nowrap" data-testid="badge-signature-count">
                    <Users className="h-6 w-6 mr-2" />
                    {petition.signatureCount || 0}
                  </Badge>
                </div>
              </CardHeader>
            </Card>

            {/* Offense Description */}
            <Card>
              <CardHeader>
                <CardTitle>Incident Description</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {petition.offenseDescriptionRedrafted && (
                  <div className="space-y-2">
                    <p className="text-foreground whitespace-pre-wrap leading-relaxed" data-testid="text-offense-redrafted">
                      {petition.offenseDescriptionRedrafted}
                    </p>
                  </div>
                )}
                
                {petition.offenseDescriptionOriginal && petition.offenseDescriptionRedrafted && (
                  <>
                    <Separator />
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground mb-2">
                        View original submission
                      </summary>
                      <p className="text-muted-foreground whitespace-pre-wrap mt-2" data-testid="text-offense-original">
                        {petition.offenseDescriptionOriginal}
                      </p>
                    </details>
                  </>
                )}

                {petition.additionalText && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm text-muted-foreground">Additional Information</h4>
                      <p className="text-foreground whitespace-pre-wrap" data-testid="text-additional">
                        {petition.additionalText}
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Thank You Message (shown after signing) */}
            {hasSigned ? (
              <Card className="border-green-500/20 bg-green-500/5">
                <CardContent className="py-8 text-center space-y-4">
                  <CheckCircle2 className="h-20 w-20 mx-auto text-green-500" />
                  <div>
                    <p className="text-xl font-semibold mb-2" data-testid="text-thank-you">
                      Thank you for signing. Your signature has been recorded.
                    </p>
                    <p className="text-muted-foreground mb-4">
                      Share this petition to amplify the call for accountability
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      onClick={shareOnFacebook}
                      size="lg"
                      className="bg-[#1877f2] hover:bg-[#166fe5]"
                      data-testid="button-facebook-share"
                    >
                      <Share2 className="h-5 w-5 mr-2" />
                      Share on Facebook
                    </Button>
                    <Button
                      onClick={createOnChangeOrg}
                      size="lg"
                      variant="outline"
                      data-testid="button-change-org"
                    >
                      <Share2 className="h-5 w-5 mr-2" />
                      Create on Change.org
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              /* Signature Form */
              <Card>
                <CardHeader>
                  <CardTitle>Sign This Petition</CardTitle>
                  <CardDescription>
                    Add your signature to demand accountability
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <FormField
                        control={form.control}
                        name="fullName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Full Name *</FormLabel>
                            <FormControl>
                              <Input placeholder="John Smith" {...field} data-testid="input-full-name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="typedSignature"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Typed Signature *</FormLabel>
                            <FormControl>
                              <Input placeholder="John Smith" {...field} data-testid="input-typed-signature" />
                            </FormControl>
                            <FormDescription>Type your name as your signature</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Drawn Signature Canvas */}
                      <div className="space-y-2">
                        <FormLabel>Drawn Signature (Optional)</FormLabel>
                        <div className="border-2 border-dashed rounded-lg p-2 bg-white">
                          <canvas
                            ref={canvasRef}
                            width={600}
                            height={150}
                            className="w-full cursor-crosshair touch-none"
                            onMouseDown={startDrawing}
                            onMouseMove={draw}
                            onMouseUp={stopDrawing}
                            onMouseLeave={stopDrawing}
                            onTouchStart={startDrawing}
                            onTouchMove={draw}
                            onTouchEnd={stopDrawing}
                            data-testid="canvas-signature"
                          />
                        </div>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={clearCanvas}
                            data-testid="button-clear-signature"
                          >
                            <X className="h-4 w-4 mr-1" />
                            Clear
                          </Button>
                        </div>
                        <FormDescription className="text-xs">
                          Draw your signature using mouse, touchpad, or touch screen
                        </FormDescription>
                      </div>

                      <FormField
                        control={form.control}
                        name="consent"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                data-testid="checkbox-consent"
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>
                                I affirm this is my name and signature for this petition *
                              </FormLabel>
                              <FormMessage />
                            </div>
                          </FormItem>
                        )}
                      />

                      <Button
                        type="submit"
                        disabled={signPetitionMutation.isPending}
                        className="w-full"
                        size="lg"
                        data-testid="button-sign-petition"
                      >
                        {signPetitionMutation.isPending ? "Signing..." : "Sign Petition"}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            )}

            {/* Bottom Link */}
            {petition.bottomLink && (
              <Card className="bg-muted/50">
                <CardContent className="py-4 text-center">
                  <a
                    href={petition.bottomLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-medium"
                    data-testid="link-bottom"
                  >
                    {petition.bottomLink}
                  </a>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
