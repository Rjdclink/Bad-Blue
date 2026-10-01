import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { type Server } from "http";
import { BASE_URL, SEO_CONFIG } from "../shared/seoConfig";

const __dirname = path.dirname(fileURLToPath(import.meta.url));


function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSeoShell(template: string, pathname: string): string {
  const config = SEO_CONFIG[pathname];
  if (!config) return template;

  const canonicalUrl = `${BASE_URL}${config.canonicalPath}`;
  const robots = config.noIndex
    ? "noindex, nofollow"
    : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";
  const title = escapeHtml(config.title);
  const description = escapeHtml(config.description);
  const canonical = escapeHtml(canonicalUrl);

  // Keep the first HTML Google receives aligned with the canonical/meta values
  // that SEOHead applies after React renders. This avoids conflicting
  // pre-render and post-render canonical signals on public SPA routes.
  return template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${description}" />`)
    .replace(/<meta\s+name=["']robots["'][^>]*>/i, `<meta name="robots" content="${robots}" />`)
    .replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<meta\s+property=["']og:title["'][^>]*>/i, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta\s+property=["']og:description["'][^>]*>/i, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta\s+property=["']og:url["'][^>]*>/i, `<meta property="og:url" content="${canonical}" />`)
    .replace(/<meta\s+name=["']twitter:title["'][^>]*>/i, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta\s+name=["']twitter:description["'][^>]*>/i, `<meta name="twitter:description" content="${description}" />`);
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // Dynamic imports - only load Vite in development mode
  const { createServer: createViteServer, createLogger } = await import("vite");
  const viteConfig = (await import("../vite.config.ts")).default;
  const { nanoid } = await import("nanoid");
  
  const viteLogger = createLogger();
  
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = renderSeoShell(template, req.path || "/");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // Try multiple path resolution strategies for production deployment
  // Based on vite.config.ts, the build output is in dist/public
  const possiblePaths = [
    path.resolve(__dirname, "public"),               // Standard: /app/dist/public (when dist is in /app/dist)
    path.resolve(process.cwd(), "dist", "public"),   // Alternative: Use process working directory
    path.resolve(process.cwd(), "public"),           // Fallback: public at root
    path.resolve(__dirname, "..", "public"),         // Legacy: /app/dist/../public = /app/public
  ];

  let distPath: string | null = null;
  
  for (const possiblePath of possiblePaths) {
    console.log(`[serveStatic] Checking path: ${possiblePath}`);
    const indexPath = path.resolve(possiblePath, "index.html");
    
    // Check if both directory and index.html exist with a single validation
    if (fs.existsSync(indexPath)) {
      distPath = possiblePath;
      console.log(`[serveStatic] ✓ Found valid build directory: ${distPath}`);
      console.log(`[serveStatic] ✓ index.html exists at: ${indexPath}`);
      break;
    } else if (fs.existsSync(possiblePath)) {
      console.log(`[serveStatic] ✗ Directory exists but missing index.html: ${possiblePath}`);
    }
  }

  if (!distPath) {
    const errorMsg = `Could not find the build directory with index.html. Tried:\n${possiblePaths.map(p => `  - ${p}`).join('\n')}`;
    console.error(`[serveStatic] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.log(`[serveStatic] Serving static files from: ${distPath}`);
  app.use(express.static(distPath));

  const indexPath = path.resolve(distPath, "index.html");
  const indexTemplate = fs.readFileSync(indexPath, "utf-8");

  // Fall through to index.html only for SPA navigation. Missing static
  // assets must be real 404s so <img onError> and other fallback logic can
  // advance instead of receiving index.html with HTTP 200. Known SPA routes
  // receive route-correct canonical/meta tags in the initial HTML response so
  // crawlers do not first see the homepage canonical and then a different one
  // after JavaScript renders.
  app.use("*", (req, res) => {
    const pathname = req.path || '';
    const looksLikeStaticAsset = pathname.startsWith('/images/')
      || pathname.startsWith('/assets/')
      || /\.[a-z0-9]{2,8}$/i.test(pathname);
    if (looksLikeStaticAsset) {
      return res.status(404).type('text/plain').send('Static asset not found');
    }
    return res.status(200).type('html').send(renderSeoShell(indexTemplate, pathname));
  });
}
