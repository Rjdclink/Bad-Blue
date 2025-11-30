import { Link, useLocation } from "wouter";
import { Home } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SEO_CONFIG, BASE_URL, type BreadcrumbItem as BreadcrumbData } from "@shared/seoConfig";

interface PageBreadcrumbsProps {
  customBreadcrumbs?: BreadcrumbData[];
  currentPageName?: string;
  className?: string;
}

function generateBreadcrumbSchema(breadcrumbs: BreadcrumbData[], finalPageName?: string, currentUrl?: string) {
  const items = [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": BASE_URL
    }
  ];
  
  breadcrumbs.slice(0, -1).forEach((crumb, index) => {
    items.push({
      "@type": "ListItem",
      "position": index + 2,
      "name": crumb.name,
      "item": crumb.url
    });
  });
  
  if (finalPageName && breadcrumbs.length > 0) {
    const lastCrumb = breadcrumbs[breadcrumbs.length - 1];
    items.push({
      "@type": "ListItem",
      "position": items.length + 1,
      "name": finalPageName,
      "item": lastCrumb?.url || `${BASE_URL}${currentUrl}`
    });
  }
  
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items
  };
}

export function PageBreadcrumbs({ 
  customBreadcrumbs, 
  currentPageName,
  className = ""
}: PageBreadcrumbsProps) {
  const [location] = useLocation();
  
  const seoConfig = SEO_CONFIG[location];
  const breadcrumbs = customBreadcrumbs || seoConfig?.breadcrumbs || [];
  
  if (breadcrumbs.length === 0 && location === "/") {
    return null;
  }

  const finalPageName = currentPageName || 
    (breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].name : seoConfig?.title?.split("|")[0]?.trim());

  const parentBreadcrumbs = breadcrumbs.slice(0, -1);
  
  const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbs, finalPageName, location);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <nav aria-label="Breadcrumb navigation" role="navigation" className={`mb-4 ${className}`} data-testid="nav-breadcrumbs">
        <Breadcrumb>
          <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/" data-testid="breadcrumb-home">
                <Home className="h-4 w-4" />
                <span className="sr-only">Home</span>
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          
          {parentBreadcrumbs.map((crumb, index) => (
            <span key={crumb.url} className="contents">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link 
                    href={crumb.url.replace(BASE_URL, "")} 
                    data-testid={`breadcrumb-${crumb.name.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {crumb.name}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </span>
          ))}
          
          {finalPageName && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage data-testid="breadcrumb-current">
                  {finalPageName}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
          </BreadcrumbList>
        </Breadcrumb>
      </nav>
    </>
  );
}

export function useBreadcrumbs(path?: string): BreadcrumbData[] {
  const [location] = useLocation();
  const currentPath = path || location;
  const seoConfig = SEO_CONFIG[currentPath];
  return seoConfig?.breadcrumbs || [];
}
