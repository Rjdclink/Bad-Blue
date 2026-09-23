/**
 * LegalWhat Welcome Page - responsive antique law library.
 *
 * Scope invariant:
 * - Presentation only: preserve all existing destinations and law-domain routing.
 * - Every law book still enters /lexara-consent/:domainId.
 * - TEMPORARY SOLUTION X: PANTHEON, SPECTRA, and Inmate Locator remain visible but are intentionally non-interactive.
 */

import { useCallback, useEffect, useRef, type CSSProperties } from "react";
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
import "./welcome-statues.css";

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

const SHELF_STATUES = [
  [
    {
      key: "crouch",
      src: "/images/library-statues/statue-crouch.svg",
      className: "shelf-statue-crouch shelf-statue-mobile-only",
    },
  ],
  [
    {
      key: "standing",
      src: "/images/library-statues/statue-standing.svg",
      className: "shelf-statue-standing shelf-statue-mobile-only",
    },
  ],
  [
    {
      key: "reclining",
      src: "/images/library-statues/statue-reclining.svg",
      className: "shelf-statue-reclining shelf-statue-mobile-only",
    },
  ],
  [
    {
      key: "kneeling",
      src: "/images/library-statues/statue-kneeling.svg",
      className: "shelf-statue-kneeling shelf-statue-mobile-only",
    },
    {
      key: "westie",
      src: "/images/library-statues/statue-westie.svg",
      className: "shelf-statue-westie shelf-statue-persistent",
    },
  ],
] as const;

/**
 * Decorative shelf filler only. It deliberately has no click, focus, route,
 * label, or other product behavior.
 */
const ShelfStatue = ({
  className,
  src,
}: {
  className: string;
  src: string;
}) => (
  <span className={`shelf-statue ${className}`} aria-hidden="true">
    <img
      className="shelf-statue-art"
      src={src}
      alt=""
      draggable={false}
      decoding="async"
    />
  </span>
);

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

const FIELD_ANTHEM_URL =
  "https://commons.wikimedia.org/wiki/Special:Redirect/file/The_United_States_Army_Old_Guard_Fife_and_Drum_Corps_-_02_-_United_States_National_Anthem_The_Star_Spangled_Banner.ogg";

export default function WelcomePage() {
  const [, setLocation] = useLocation();
  const anthemRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = anthemRef.current;
    if (!audio) return;

    audio.volume = 0.12;

    const beginPlayback = () => {
      void audio.play().catch(() => {
        // Audible autoplay may be blocked until the visitor interacts.
      });
    };

    beginPlayback();

    const resumeAfterInteraction = () => {
      beginPlayback();
      document.removeEventListener("pointerdown", resumeAfterInteraction);
      document.removeEventListener("keydown", resumeAfterInteraction);
    };

    document.addEventListener("pointerdown", resumeAfterInteraction, { once: true });
    document.addEventListener("keydown", resumeAfterInteraction, { once: true });

    return () => {
      document.removeEventListener("pointerdown", resumeAfterInteraction);
      document.removeEventListener("keydown", resumeAfterInteraction);
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

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
      <audio
        ref={anthemRef}
        src={FIELD_ANTHEM_URL}
        autoPlay
        loop
        preload="auto"
        aria-hidden="true"
      />
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
                  {SHELF_STATUES[shelfIndex]?.map((statue) => (
                    <ShelfStatue
                      key={`shelf-statue-${shelfIndex}-${statue.key}`}
                      className={statue.className}
                      src={statue.src}
                    />
                  ))}
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
                    disabled
                    aria-disabled="true"
                    title="Temporarily out of order. Contact contact.badblue@gmail.com for assistance."
                  >
                    <span className="service-icon-wrap" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="service-copy">
                      <strong>{service.name}</strong>
                      <span>{service.subtitle}</span>
                      <small>{service.description}</small>
                      <small className="block mt-1 text-xs opacity-80">Temporarily out of order. Contact contact.badblue@gmail.com for assistance.</small>
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
        <p>© 2026 LegalWhat · AI-powered legal platform · 40 legal areas</p>
      </footer>
    </div>
  );
}
