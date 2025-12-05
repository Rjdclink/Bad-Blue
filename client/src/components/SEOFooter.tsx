import { Link } from "wouter";
import { Shield } from "lucide-react";

interface SEOFooterProps {
  currentPage?: string;
}

export function SEOFooter({ currentPage }: SEOFooterProps) {
  const links = [
    { href: "/badblue", label: "Home" },
    { href: "/login", label: "Officer Search" },
    { href: "/login", label: "Complaints/FOIA" },
    { href: "/login", label: "§1983 Lawsuit Generator" },
    { href: "/contact", label: "Contact" },
    { href: "/privacy", label: "Privacy" },
    { href: "/terms", label: "Terms" },
  ];

  return (
    <footer className="border-t bg-card py-8 mt-auto">
      <div className="max-w-7xl mx-auto px-4">
        {/* Logo and Tagline */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-primary" />
          <span className="font-semibold">BadBlue</span>
        </div>
        
        {/* Navigation Links */}
        <nav className="flex flex-wrap justify-center gap-4 md:gap-6 text-sm text-muted-foreground mb-4">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className={`hover:text-foreground transition-colors ${
                currentPage === link.label ? "font-medium text-foreground" : ""
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        
        {/* Keyword-rich tagline */}
        <p className="text-center text-xs text-muted-foreground max-w-2xl mx-auto">
          BadBlue — Affordable police accountability tools for filing misconduct complaints, 
          42 U.S.C. §1983 civil rights lawsuits, FOIA requests, and officer resignation petitions. 
          Fully online — never leave home.
        </p>
        
        {/* Contact Email */}
        <p className="text-center text-xs text-muted-foreground mt-2">
          Questions? Email us at{" "}
          <a 
            href="mailto:contact.badblue@gmail.com" 
            className="text-primary hover:underline"
          >
            contact.badblue@gmail.com
          </a>
        </p>
      </div>
    </footer>
  );
}
