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
import { Mail, Send, CheckCircle2, Home as HomeIcon } from "lucide-react";
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
      "name": "Contact Legal What? - Support",
      "description": "Contact Legal What? for support, questions, feedback, and account assistance.",
      "url": "https://legalwhat.com/contact",
      "mainEntity": {
        "@type": "Organization",
        "name": "Legal What?",
        "description": "AI-assisted legal information and research platform.",
        "url": "https://legalwhat.com",
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
        title="Contact Legal What? | Support"
        description="Contact Legal What? for support, questions, feedback, and account assistance."
        canonicalUrl="https://legalwhat.com/contact"
        breadcrumbs={[
          { name: "Contact & Support", url: "https://legalwhat.com/contact" }
        ]}
      />
      
      {/* Header with Navigation */}
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 cursor-pointer hover-elevate px-2 py-1 rounded-md">
            <img src="/images/Legal%20What%20Icon.png" alt="" aria-hidden="true" className="w-8 h-8 object-contain" />
            <span className="font-semibold text-lg">Legal What?</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/landing" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <HomeIcon className="w-4 h-4" />
              Home
            </Link>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground">Terms</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        <PageBreadcrumbs currentPageName="Contact Us" />
        {/* Hero Section - What Legal What? Does */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Contact Legal What?</h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Legal What? is an AI-assisted legal information and research platform with tools for two-way legal consultation, document workflows, background reports, people finding, inmate searches, public records, and police accountability.
          </p>
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
                  Thank you for contacting Legal What?. We've received your message and will respond within 24-48 hours.
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

      </main>

      <SupportEmailFooter />
      
      {/* Footer Navigation */}
      <footer className="border-t bg-card py-8">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
            <Link href="/landing" className="hover:text-foreground">Home</Link>
            <Link href="/contact" className="hover:text-foreground font-medium text-foreground">Contact</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </div>
        </div>
      </footer>

    </div>
  );
}
