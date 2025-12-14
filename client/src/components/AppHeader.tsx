/**
 * AppHeader Component
 * 
 * Common header for all authenticated pages
 * - Back button in upper left
 * - Logout button in upper right
 * - Optional title/branding in center
 */

import { BackButton } from "@/components/BackButton";
import { LogoutButton } from "@/components/LogoutButton";
import { Shield } from "lucide-react";

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  showLogo?: boolean;
  fallbackRoute?: string;
  className?: string;
}

export function AppHeader({ 
  title, 
  subtitle, 
  showLogo = true, 
  fallbackRoute,
  className 
}: AppHeaderProps) {
  return (
    <header className={`border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 ${className || ""}`}>
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left: Back Button - Mobile-optimized tap zone */}
          <div className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2">
            <BackButton fallbackRoute={fallbackRoute} />
          </div>

          {/* Center: Title/Logo */}
          {(title || showLogo) && (
            <div className="flex-1 flex items-center justify-center gap-3 mx-4 min-w-0">
              {showLogo && <Shield className="h-6 w-6 text-primary flex-shrink-0" />}
              {title && (
                <div className="text-center min-w-0">
                  <h1 className="text-lg font-bold text-foreground flex items-center gap-1 justify-center">
                    <span className="truncate">{title}</span>
                    <img 
                      src="/images/Legal What Icon.png" 
                      alt="?" 
                      className="inline-block h-[1em] w-auto object-contain flex-shrink-0"
                      style={{ marginBottom: '-0.05em' }}
                    />
                  </h1>
                  {subtitle && (
                    <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Right: Logout Button - Mobile-optimized tap zone */}
          <div className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2">
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
