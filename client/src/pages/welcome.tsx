/**
 * LegalWhat Welcome Page - responsive antique law library.
 *
 * Scope invariant:
 * - Presentation only: preserve all existing destinations and law-domain routing.
 * - Every law book still enters /lexara-consent/:domainId.
 * - PANTHEON, SPECTRA, and Inmate Locator keep their existing routes.
 */

import { useCallback, type CSSProperties } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  BookOpen,
  Eye,
  Globe2,
  Landmark,
  MapPin,
  Scale,
  Search,
  Shield,
} from "lucide-react";
import { LAW_TYPE_DATA, type LawTypeInfo } from "@shared/lawTypes";
import { SEOHead } from "@/components/SEOHead";
import { AppHeader } from "@/components/AppHeader";
import "./welcome-library.css";

const LEATHER_PALETTE = [
  "#3b1717",
  "#4d211b",
  "#17283b",
  "#2f1715",
  "#4a2520",
  "#18362c",
  "#542b1e",
  "#321818",
  "#13283c",
  "#55231e",
  "#23402f",
  "#4b291d",
  "#24352f",
  "#4d201f",
  "#1f3737",
  "#42211f",
] as const;

const SERVICE_DESTINATIONS = [
  {
    name: "PANTHEON",
    subtitle: "Intelligence Platform",
    description: "Advanced identity and evidence intelligence.",
    route: "/pantheon",
    icon: Eye,
  },
  {
    name: "SPECTRA",
    subtitle: "Location Intelligence",
    description: "Conversational target acquisition and location intelligence.",
    route: "/spectra",
    icon: MapPin,
  },
  {
    name: "United States Inmate Locator",
    subtitle: "Nationwide Corrections Search",
    description: "Search federal, state, local, and participating corrections sources.",
    route: "/inmate-locator",
    icon: Search,
  },
] as const;

const BookSpine = ({
  lawType,
  number,
  leather,
  onClick,
}: {
  lawType: LawTypeInfo;
  number: number;
  leather: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={"Open " + lawType.name + " consultation"}
    className={"antique-book-spine" + (lawType.featured ? " antique-book-featured" : "")}
    style={{ "--book-leather": leather } as CSSProperties}
  >
    <span className="antique-book-gilt antique-book-gilt-top" aria-hidden="true" />
    <span className="antique-book-ornament" aria-hidden="true">❦</span>
    <span className="antique-book-title">{lawType.name}</span>
    {lawType.featured && (
      <span className="antique-feature-ribbon" aria-hidden="true">
        <Shield className="h-4 w-4" />
      </span>
    )}
    <span className="antique-book-number" aria-hidden="true">{number}</span>
    <span className="antique-book-gilt antique-book-gilt-bottom" aria-hidden="true" />
  </button>
);

export default function WelcomePage() {
  const [, setLocation] = useLocation();

  const sortedLawTypes = [...LAW_TYPE_DATA].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const shelfGroups = [
    sortedLawTypes.slice(0, 8),
    sortedLawTypes.slice(8, 16),
    sortedLawTypes.slice(16, 24),
    sortedLawTypes.slice(24),
  ];

  const handleBookClick = useCallback((lawTypeId: string) => {
    const selectedType = LAW_TYPE_DATA.find((type) => type.id === lawTypeId);
    if (!selectedType) return;
    setLocation("/lexara-consent/" + selectedType.id);
  }, [setLocation]);

  return (
    <div className="legal-library-page min-h-screen">
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat -z-20"
        style={{ backgroundImage: "url(/images/premium_photo-.jpg)" }}
        aria-hidden="true"
      />
      <div className="fixed inset-0 legal-library-backdrop -z-10" aria-hidden="true" />

      <SEOHead
        title="LegalWhat Law Library"
        description="Choose your legal area or open a LegalWhat intelligence service."
      />

      <AppHeader
        title="LegalWhat"
        subtitle="AI Legal Platform"
        fallbackRoute="/login"
        className="legal-library-app-header"
      />

      <main className="legal-library-main">
        <section className="library-cabinet" aria-labelledby="law-library-title">
          <div className="library-crown">
            <BookOpen className="library-crown-icon" aria-hidden="true" />
            <h1 id="law-library-title">LegalWhat</h1>
            <p>Law Library — Choose Your Legal Area</p>
            <span className="library-crown-flourish" aria-hidden="true">◆</span>
          </div>

          <div className="library-mantel" aria-hidden="true">
            <div className="library-decor-bay">
              <div className="library-plant">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="library-decor-piece">
                <Globe2 />
                <span>Knowledge</span>
              </div>
            </div>
            <div className="library-decor-bay library-decor-bay-right">
              <div className="library-picture-frame">
                <Landmark />
              </div>
              <div className="library-decor-piece">
                <Scale />
                <span>Justice</span>
              </div>
            </div>
          </div>

          <div className="law-shelf-grid" aria-label="Legal practice areas">
            {shelfGroups.map((group, shelfIndex) => (
              <div className="law-shelf-bay" key={"shelf-" + shelfIndex}>
                <div className="law-book-row">
                  {group.map((lawType, groupIndex) => {
                    const absoluteIndex = shelfIndex * 8 + groupIndex;
                    const leather = lawType.featured
                      ? "#10263d"
                      : LEATHER_PALETTE[absoluteIndex % LEATHER_PALETTE.length];

                    return (
                      <BookSpine
                        key={lawType.id}
                        lawType={lawType}
                        number={absoluteIndex + 1}
                        leather={leather}
                        onClick={() => handleBookClick(lawType.id)}
                      />
                    );
                  })}
                </div>
                <div className="wood-shelf-edge" aria-hidden="true" />
              </div>
            ))}
          </div>

          <section className="service-shelf" aria-labelledby="services-title">
            <div className="service-shelf-heading">
              <span className="service-statue" aria-hidden="true">
                <Scale />
              </span>
              <div>
                <h2 id="services-title">Intelligence Services</h2>
                <p>Three additional LegalWhat tools, built directly into the library.</p>
              </div>
              <span className="service-lamp" aria-hidden="true">
                <i />
                <b />
              </span>
            </div>

            <div className="service-panel-grid">
              {SERVICE_DESTINATIONS.map((service) => {
                const Icon = service.icon;
                return (
                  <button
                    key={service.route}
                    type="button"
                    className="library-service-panel"
                    onClick={() => service.route === "/spectra" ? setLocation('/spectra') : setLocation(service.route)}
                  >
                    <span className="service-icon-wrap" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="service-copy">
                      <strong>{service.name}</strong>
                      <span>{service.subtitle}</span>
                      <small>{service.description}</small>
                    </span>
                    <ArrowRight className="service-arrow" aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            <div className="service-plant-row" aria-hidden="true">
              <div className="service-mini-plant">
                <span />
                <span />
                <span />
              </div>
              <p>The right information empowers real people.</p>
              <div className="service-mini-plant service-mini-plant-right">
                <span />
                <span />
                <span />
              </div>
            </div>
          </section>

          <div className="library-base" aria-hidden="true">
            <div />
            <div />
            <div />
            <div />
          </div>
        </section>

        <p className="library-helper-text">
          Select any law book to begin your consultation, or choose an intelligence service below the shelves.
        </p>
      </main>

      <footer className="legal-library-footer">
        <p>© 2026 LegalWhat · AI-powered legal platform · 31 legal areas</p>
      </footer>
    </div>
  );
}
