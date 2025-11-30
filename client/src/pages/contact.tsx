import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Shield, Mail, Send, CheckCircle2, FileText, Scale, Users, Search, Home as HomeIcon } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { SEOHead } from "@/components/SEOHead";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { SupportEmailFooter } from "@/components/SupportEmailFooter";

const contactFormSchema = z.object({
  type: z.enum(['support', 'contact', 'report']),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  subject: z.string().min(5, "Subject must be at least 5 characters"),
  message: z.string().min(20, "Message must be at least 20 characters"),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

export default function Contact() {
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      type: 'contact',
      name: '',
      email: '',
      subject: '',
      message: '',
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      return await apiRequest('/api/contact', 'POST', data);
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({
        title: "Message Sent!",
        description: "We've received your message and will get back to you soon.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send message. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ContactFormData) => {
    submitMutation.mutate(data);
  };

  // Inject ContactPage JSON-LD schema
  useEffect(() => {
    const contactPageSchema = {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      "name": "Contact BadBlue - Police Accountability Support",
      "description": "Contact BadBlue for help with police misconduct complaints, §1983 civil rights lawsuits, FOIA requests, and officer resignation petitions. Affordable legal tools, fully remote.",
      "url": "https://bad-blue.com/contact",
      "mainEntity": {
        "@type": "Organization",
        "name": "BadBlue",
        "description": "Legal accountability platform offering police misconduct complaints, officer resignation petitions, and §1983 civil rights lawsuit filings — cheaper than a civil rights attorney consult, fully remote.",
        "url": "https://bad-blue.com",
        "email": "contact.badblue@gmail.com",
        "contactPoint": {
          "@type": "ContactPoint",
          "contactType": "Customer Support",
          "email": "contact.badblue@gmail.com",
          "availableLanguage": ["English", "Spanish"]
        },
        "areaServed": {
          "@type": "Country",
          "name": "United States"
        }
      }
    };

    let script = document.querySelector('script#contact-page-schema');
    if (!script) {
      script = document.createElement("script");
      script.setAttribute("type", "application/ld+json");
      script.setAttribute("id", "contact-page-schema");
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(contactPageSchema);

    return () => {
      const existingScript = document.querySelector('script#contact-page-schema');
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Bad Blue — Contact + Support + Misconduct Filing Help"
        description="Contact BadBlue at contact.badblue@gmail.com for help with police misconduct complaints, §1983 civil rights lawsuits, FOIA requests, and petitions demanding officer resignation. Affordable alternative to attorneys, fully online — never leave home."
        canonicalUrl="https://bad-blue.com/contact"
        breadcrumbs={[
          { name: "Contact & Support", url: "https://bad-blue.com/contact" }
        ]}
      />
      
      {/* Header with Navigation */}
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 cursor-pointer hover-elevate px-2 py-1 rounded-md">
            <Shield className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg">BadBlue</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/landing" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <HomeIcon className="w-4 h-4" />
              Home
            </Link>
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Search className="w-4 h-4" />
              Officer Search
            </Link>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground">Terms</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        <PageBreadcrumbs currentPageName="Contact Us" />
        {/* Hero Section - What BadBlue Does */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Contact BadBlue</h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            BadBlue is a police accountability platform that helps citizens file police misconduct complaints, 
            generate 42 U.S.C. §1983 civil rights lawsuits, submit FOIA requests, and create petitions demanding 
            officer resignation — all from the comfort of your home.
          </p>
        </div>

        {/* Key Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <Card className="text-center">
            <CardContent className="pt-6">
              <FileText className="w-10 h-10 text-primary mx-auto mb-3" />
              <h3 className="font-semibold mb-2">Misconduct Complaints</h3>
              <p className="text-sm text-muted-foreground">
                File professional police misconduct complaints with automatic routing to oversight agencies.
              </p>
            </CardContent>
          </Card>
          
          <Card className="text-center">
            <CardContent className="pt-6">
              <Scale className="w-10 h-10 text-primary mx-auto mb-3" />
              <h3 className="font-semibold mb-2">§1983 Lawsuits</h3>
              <p className="text-sm text-muted-foreground">
                Generate U.S. District Court-compliant civil rights lawsuits against officers who violated your rights.
              </p>
            </CardContent>
          </Card>
          
          <Card className="text-center">
            <CardContent className="pt-6">
              <Users className="w-10 h-10 text-primary mx-auto mb-3" />
              <h3 className="font-semibold mb-2">Resignation Petitions</h3>
              <p className="text-sm text-muted-foreground">
                Create community petitions demanding officer resignation, delivered to city councils.
              </p>
            </CardContent>
          </Card>
          
          <Card className="text-center">
            <CardContent className="pt-6">
              <Search className="w-10 h-10 text-primary mx-auto mb-3" />
              <h3 className="font-semibold mb-2">Officer Search</h3>
              <p className="text-sm text-muted-foreground">
                Free officer badge lookup and background search using public records and disciplinary data.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Why BadBlue */}
        <div className="bg-card rounded-lg p-8 mb-12 border">
          <h2 className="text-2xl font-bold mb-4 text-center">Why Choose BadBlue?</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-primary mb-2">Affordable Alternative to Attorneys</h3>
              <p className="text-muted-foreground">
                Civil rights attorneys can charge $300-500/hour. BadBlue provides professional legal document 
                preparation at a fraction of the cost, making police accountability accessible to everyone.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-primary mb-2">Fully Remote — Never Leave Home</h3>
              <p className="text-muted-foreground">
                Complete every step online. File complaints, generate lawsuits, submit FOIA requests, and 
                track your cases without visiting an office or courthouse. Justice from your living room.
              </p>
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold mb-4">Get in Touch</h2>
          <p className="text-lg mb-4">
            <Mail className="w-5 h-5 inline-block mr-2" />
            <a href="mailto:contact.badblue@gmail.com" className="text-primary hover:underline font-medium">
              contact.badblue@gmail.com
            </a>
          </p>
          <p className="text-muted-foreground">
            We respond to all inquiries within 24-48 hours.
          </p>
        </div>

        {/* Contact Form or Success Message */}
        {!submitted ? (
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                Send Us a Message
              </CardTitle>
              <CardDescription>
                Questions about filing a police misconduct complaint, §1983 lawsuit, or FOIA request? We're here to help.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type of Message</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-contact-type">
                              <SelectValue placeholder="Select message type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="contact">General Contact</SelectItem>
                            <SelectItem value="support">Support Request</SelectItem>
                            <SelectItem value="report">Report an Issue</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Your Name</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="John Doe" 
                              {...field} 
                              data-testid="input-contact-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Your Email</FormLabel>
                          <FormControl>
                            <Input 
                              type="email" 
                              placeholder="john@example.com" 
                              {...field} 
                              data-testid="input-contact-email"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Brief summary of your message" 
                            {...field} 
                            data-testid="input-contact-subject"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="message"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Message</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Tell us how we can help you with your police accountability needs..." 
                            rows={6}
                            {...field} 
                            data-testid="textarea-contact-message"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button 
                    type="submit" 
                    className="w-full" 
                    size="lg"
                    disabled={submitMutation.isPending}
                    data-testid="button-submit-contact"
                  >
                    {submitMutation.isPending ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Message
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        ) : (
          <Card className="text-center p-8 max-w-2xl mx-auto">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-2">Message Sent Successfully!</h2>
                <p className="text-muted-foreground mb-6">
                  Thank you for contacting BadBlue. We've received your message and will respond within 24-48 hours.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button asChild variant="default" data-testid="button-back-home">
                    <Link href="/landing">Return Home</Link>
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setSubmitted(false);
                      form.reset();
                    }}
                    data-testid="button-send-another"
                  >
                    Send Another Message
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Hidden Crawlable FAQ - Visually hidden but in DOM for SEO */}
        <div 
          className="sr-only" 
          aria-hidden="false"
          itemScope 
          itemType="https://schema.org/FAQPage"
        >
          <h2>Frequently Asked Questions About BadBlue Police Accountability Tools</h2>
          
          <div itemScope itemProp="mainEntity" itemType="https://schema.org/Question">
            <h3 itemProp="name">How do I file a police misconduct complaint online?</h3>
            <div itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
              <p itemProp="text">
                BadBlue provides a streamlined online complaint filing system. After creating a free account, 
                navigate to the Complaint Form, describe the incident involving police misconduct, excessive force, 
                or civil rights violations, and our AI will help format your complaint professionally. We automatically 
                route completed complaints to the appropriate internal affairs division, civilian oversight board, 
                or department command staff. You can track your complaint status and receive email updates without 
                ever leaving your home.
              </p>
            </div>
          </div>

          <div itemScope itemProp="mainEntity" itemType="https://schema.org/Question">
            <h3 itemProp="name">What is a petition demanding officer resignation and how does BadBlue help?</h3>
            <div itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
              <p itemProp="text">
                A resignation petition is a community-driven document calling for a specific police officer to 
                resign from their position due to misconduct, abuse of power, or patterns of civil rights violations. 
                BadBlue's petition tool allows you to create professional petitions, collect digital signatures from 
                community members, and automatically deliver the completed petition to city council members, police 
                oversight boards, and local officials. This grassroots approach empowers communities to demand 
                accountability when internal processes fail.
              </p>
            </div>
          </div>

          <div itemScope itemProp="mainEntity" itemType="https://schema.org/Question">
            <h3 itemProp="name">How do I file a 42 U.S.C. Section 1983 civil rights lawsuit against a police officer?</h3>
            <div itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
              <p itemProp="text">
                Section 1983 of Title 42 of the United States Code allows citizens to sue government officials, 
                including police officers, who violate their constitutional rights while acting under color of law. 
                BadBlue's lawsuit generator creates U.S. District Court-compliant legal documents including the 
                complaint, summons, and civil cover sheet. Our system follows district-specific formatting rules 
                for California, New York, Texas, and all federal districts. You can file the lawsuit yourself 
                (pro se) or use our documents as a foundation when working with an attorney. This is an affordable 
                alternative to paying hundreds of dollars per hour for civil rights attorney consultation.
              </p>
            </div>
          </div>

          <div itemScope itemProp="mainEntity" itemType="https://schema.org/Question">
            <h3 itemProp="name">What is a FOIA request and how can BadBlue help me file one?</h3>
            <div itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
              <p itemProp="text">
                FOIA (Freedom of Information Act) requests allow citizens to obtain public records from government 
                agencies, including police departments. BadBlue generates state-specific FOIA requests that comply 
                with your state's public records laws, including proper statutory citations, deadlines, and exemption 
                references. Our system automatically looks up the correct FOIA officer or records custodian for your 
                target agency and routes your request appropriately. Common requests include body camera footage, 
                disciplinary records, use-of-force reports, and internal investigation files.
              </p>
            </div>
          </div>

          <div itemScope itemProp="mainEntity" itemType="https://schema.org/Question">
            <h3 itemProp="name">How much does BadBlue cost compared to hiring a civil rights attorney?</h3>
            <div itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
              <p itemProp="text">
                Civil rights attorneys typically charge $300-500 per hour, with initial consultations alone costing 
                $200 or more. Complex police misconduct cases can cost $5,000-50,000 in legal fees. BadBlue offers 
                individual services starting at affordable rates: complaint filing, FOIA requests, petition creation, 
                and lawsuit document generation are each priced to be accessible to everyone. Our AI-powered legal 
                consultation is free for registered users. BadBlue is designed to democratize access to police 
                accountability tools, ensuring that cost is not a barrier to seeking justice.
              </p>
            </div>
          </div>

          <div itemScope itemProp="mainEntity" itemType="https://schema.org/Question">
            <h3 itemProp="name">Can I use BadBlue without leaving my home?</h3>
            <div itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
              <p itemProp="text">
                Yes, BadBlue is a fully remote police accountability platform. Every feature is accessible online: 
                search for officers by name and state, file misconduct complaints, generate §1983 civil rights lawsuits, 
                submit FOIA requests, and create resignation petitions — all from your computer or phone. Documents 
                are delivered electronically to appropriate agencies. You never need to visit a law office, courthouse, 
                or police department. This remote convenience makes police accountability accessible to people who 
                cannot take time off work, have mobility limitations, or live in rural areas far from legal services.
              </p>
            </div>
          </div>
        </div>
      </main>

      <SupportEmailFooter />
      
      {/* Footer Navigation */}
      <footer className="border-t bg-card py-8">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
            <Link href="/landing" className="hover:text-foreground">Home</Link>
            <Link href="/login" className="hover:text-foreground">Officer Search</Link>
            <Link href="/login" className="hover:text-foreground">Complaints/FOIA</Link>
            <Link href="/login" className="hover:text-foreground">§1983 Lawsuit Generator</Link>
            <Link href="/contact" className="hover:text-foreground font-medium text-foreground">Contact</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4">
            BadBlue — Affordable police accountability tools, fully online. Never leave home.
          </p>
        </div>
      </footer>
    </div>
  );
}
