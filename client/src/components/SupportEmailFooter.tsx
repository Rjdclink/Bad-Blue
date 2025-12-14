import { useQuery } from "@tanstack/react-query";
import { Mail, Activity } from "lucide-react";
import { useState, useEffect } from "react";

export function SupportEmailFooter() {
  const [correlationId, setCorrelationId] = useState<string>("");

  useEffect(() => {
    const handleCorrelationId = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      setCorrelationId(customEvent.detail);
    };

    window.addEventListener('correlation-id-updated', handleCorrelationId);
    return () => window.removeEventListener('correlation-id-updated', handleCorrelationId);
  }, []);

  const { data: supportData, isError } = useQuery<{ email: string }>({
    queryKey: ['/api/support-email'],
    retry: 1,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fallback to environment variable or default
  const supportEmail = supportData?.email || import.meta.env.VITE_SUPPORT_EMAIL || 'contact.badblue@gmail.com';

  return (
    <footer className="mt-auto border-t bg-card">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4" />
            <span>Support:</span>
            <a 
              href={`mailto:${supportEmail}`}
              className="text-primary hover:underline"
              data-testid="link-support-email"
            >
              {supportEmail}
            </a>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} BadBlue. All rights reserved.
            </div>
            {correlationId && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 font-mono" title="Request Correlation ID">
                <Activity className="h-3 w-3" />
                <span>ID: {correlationId}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
