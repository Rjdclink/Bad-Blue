import type { RequestHandler, Request, Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isPaidAccessState, isPublicMarketingAppPath, isSubscriptionEntryPath, normalizeSubscriptionPath } from "../shared/subscriptionPolicy.ts";

type AccessDecision = {
  authenticated: boolean;
  authorized: boolean;
  accessState: string;
  reason: string;
};

type ResolveAccess = (req: Request, res: Response) => Promise<AccessDecision>;

/**
 * Expose only published SEO HTML, never a guessed URL or an application route.
 * The sitemap is the editorial allowlist; an actual static index.html must
 * exist as well. Search engines and anonymous visitors get identical pages.
 */
const PUBLIC_HTML_ROOTS = [
  resolve(process.cwd(), "public"),
  resolve(process.cwd(), "dist", "public"),
];

function publishedStaticSeoPaths(): Set<string> {
  const pages = new Set<string>();
  const sitemapRoot = PUBLIC_HTML_ROOTS.find((root) => existsSync(join(root, "sitemap.xml")));
  if (!sitemapRoot) return pages; // Fail closed when publishing inventory is unavailable.
  try {
    const sitemap = readFileSync(join(sitemapRoot, "sitemap.xml"), "utf8");
    for (const match of sitemap.matchAll(new RegExp('<loc>([^<]+)</loc>', 'g'))) {
      const url = new URL(match[1]);
      if (url.origin !== "https://legalwhat.com" || url.search || url.hash) continue;
      const normalized = normalizeSubscriptionPath(url.pathname);
      if (!normalized || normalized === "/") continue;
      const relative = normalized.slice(1);
      if (PUBLIC_HTML_ROOTS.some((root) => existsSync(join(root, relative, "index.html")))) {
        pages.add(normalized);
      }
    }
  } catch (error) {
    console.error("[SEO] Cannot load static public landing-page inventory:", error);
  }
  return pages;
}

const PUBLISHED_STATIC_SEO_PATHS = publishedStaticSeoPaths();

export function isPublicSeoPage(pathname: string): boolean {
  const path = normalizeSubscriptionPath(pathname);
  return path !== null && (isPublicMarketingAppPath(path) || PUBLISHED_STATIC_SEO_PATHS.has(path));
}

// These handlers retain their existing identity, rate-limit, or signature checks.
// Do not exempt an entire /api prefix or accept browser-provided payment state.
const PUBLIC_GET_APIS = new Set([
  "/api/auth/user/status", "/api/plans", "/api/maintenance-status", "/api/support-email",
]);
const PUBLIC_POST_APIS = new Set([
  "/api/subscription/checkout", "/api/subscription/confirm", "/api/contact",
  "/api/webhooks/square", "/api/blog-webhook",
  "/api/pulse/node", "/api/pulse/mirror", "/api/pulse/ingest",
]);
const PUBLIC_FILES = new Set([
  "/robots.txt", "/sitemap.xml", "/manifest.json", "/favicon.ico", "/favicon.png",
  // Build inventory contains only generated public filenames and timestamps.
  "/assets/browser-asset-history.json",
  "/favicon-16x16.png", "/favicon-32x32.png", "/favicon-48x48.png",
  "/apple-touch-icon.png", "/icon-192x192.png", "/icon-512x512.png",
]);

function isPublicResource(method: string, path: string, development: boolean): boolean {
  const read = method === "GET" || method === "HEAD";
  if (read && (isPublicSeoPage(path) || isSubscriptionEntryPath(path) || PUBLIC_GET_APIS.has(path) || PUBLIC_FILES.has(path))) return true;
  if (method === "POST" && PUBLIC_POST_APIS.has(path)) return true;
  // Only frontend code, styles, fonts, and images needed to render account pages.
  // HTML, JSON exports, downloads, uploads and unknown extensions stay protected.
  if (read && /^\/(?:assets|images|fonts)\/[^?]+\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|gif|svg|ico|avif)$/.test(path)) return true;
  if (development && read && /^\/(?:@vite\/|@react-refresh$|src\/|node_modules\/|@fs\/)/.test(path)) return true;
  return false;
}

/** Mount after identity hydration and BEFORE every content route/static handler. */
export function createSubscriptionGate(resolveAccess: ResolveAccess, development = false): RequestHandler {
  return async (req, res, next) => {
    const path = normalizeSubscriptionPath(req.path);
    if (path !== null && isPublicResource(req.method, path, development)) return next();

    // Applies to successful protected responses as well as denied ones. Never
    // let a shared cache reuse a subscriber's HTML or API response for a visitor.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.vary("Cookie");
    if (path === null) return res.status(400).json({ code: "INVALID_PATH" });

    try {
      const access = await resolveAccess(req, res);
      if (access.authenticated && access.authorized && (isPaidAccessState(access.accessState) || access.accessState === "trial_active")) return next();
      if (access.reason === "auth_store_unavailable") {
        return res.status(503).json({ code: "AUTH_STATE_UNAVAILABLE", message: "Subscription verification is temporarily unavailable. Please try again." });
      }
      const code = access.authenticated ? "SUBSCRIPTION_REQUIRED" : "AUTHENTICATION_REQUIRED";
      if (path === "/api" || path.startsWith("/api/") || !["GET", "HEAD"].includes(req.method)) {
        return res.status(access.authenticated ? 402 : 401).json({ code, message: "An active paid LegalWhat subscription is required." });
      }
      return res.redirect(303, access.authenticated ? "/subscription-required" : "/login");
    } catch {
      // Express 4 does not forward rejected async handlers automatically.
      return res.status(503).json({ code: "AUTH_STATE_UNAVAILABLE", message: "Subscription verification is temporarily unavailable. Please try again." });
    }
  };
}
