import { useState, type FormEvent } from "react";
import { Link, useSearch } from "wouter";
import { Star, Send, CheckCircle2, ArrowLeft } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function ReviewsPage() {
  const search = useSearch();
  const source = new URLSearchParams(search).get("source") || "site";
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const googleReviewUrl = String(import.meta.env.VITE_GOOGLE_REVIEW_URL || "").trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!rating || name.trim().length < 2 || !email.includes("@") || review.trim().length < 20) {
      toast({ title: "Please complete your review", description: "Choose a rating and provide your name, email, and at least 20 characters of feedback.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("/api/contact", "POST", {
        type: "contact",
        name: name.trim(),
        email: email.trim(),
        subject: `LegalWhat review submission — ${rating}/5`,
        message: `Review source: ${source}\nRating: ${rating}/5\n\n${review.trim()}`,
      });
      setSubmitted(true);
      toast({ title: "Review received", description: "Thank you for sharing your genuine experience with Legal What?." });
    } catch (error: any) {
      toast({ title: "Could not submit review", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Legal What? Reviews | Customer Feedback"
        description="Read about Legal What? customer experiences and share genuine feedback about LEXARA and the Legal What? platform."
        canonicalUrl="https://legalwhat.com/reviews"
        ogTitle="Legal What? Reviews"
        ogDescription="Share genuine feedback about your experience with Legal What? and LEXARA."
      />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/landing" className="flex items-center gap-2 font-semibold">
            <ArrowLeft className="h-4 w-4" /> Legal What?
          </Link>
          <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground">Contact</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="mb-3 text-4xl font-bold">Legal What? Reviews</h1>
          <p className="text-muted-foreground">Share an honest review of your experience. Positive, negative, and mixed feedback are all welcome.</p>
        </div>

        {submitted ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <h2 className="text-2xl font-semibold">Thank you for your feedback</h2>
              <p className="max-w-xl text-muted-foreground">Your review has been received for moderation. Genuine customer feedback may be published on this page without changing its meaning.</p>
              {googleReviewUrl && (
                <Button asChild>
                  <a href={googleReviewUrl} target="_blank" rel="noopener noreferrer">Also review Legal What? on Google</a>
                </Button>
              )}
              <Button asChild variant="outline"><Link href="/landing">Return home</Link></Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Leave a Review</CardTitle>
              <CardDescription>Please describe your genuine experience. No incentive is offered for reviews.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-5">
                <div>
                  <div className="mb-2 text-sm font-medium">Your rating</div>
                  <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                    {[1,2,3,4,5].map(value => (
                      <button key={value} type="button" onClick={() => setRating(value)} className="rounded p-1" aria-label={`${value} star${value === 1 ? "" : "s"}`} aria-pressed={rating === value}>
                        <Star className={`h-8 w-8 ${value <= rating ? "fill-current text-amber-500" : "text-muted-foreground"}`} />
                      </button>
                    ))}
                  </div>
                </div>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={100} />
                <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Your email (not published)" />
                <Textarea value={review} onChange={e => setReview(e.target.value)} placeholder="Tell us about your experience with Legal What? or LEXARA." rows={7} maxLength={3000} />
                <p className="text-xs text-muted-foreground">Submitting feedback does not guarantee publication. Moderation is limited to authenticity, privacy, abuse, and spam; reviews are not selected based on whether they are positive.</p>
                <Button type="submit" className="w-full" disabled={busy}>
                  <Send className="mr-2 h-4 w-4" />{busy ? "Submitting…" : "Submit Review"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
