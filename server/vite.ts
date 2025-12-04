import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  const possiblePaths = [
    path.resolve(__dirname, "..", "public"), // Standard: /app/dist/../public = /app/public
    path.resolve(process.cwd(), "public"),    // Alternative: Use process working directory
    path.resolve(__dirname, "public"),         // Fallback: Same directory as server bundle
    path.resolve(__dirname, "..", "..", "public"), // Deep bundle: /app/dist/server/../public
  ];

  let distPath: string | null = null;
  
  for (const possiblePath of possiblePaths) {
    console.log(`[serveStatic] Checking path: ${possiblePath}`);
    if (fs.existsSync(possiblePath)) {
      const indexPath = path.resolve(possiblePath, "index.html");
      if (fs.existsSync(indexPath)) {
        distPath = possiblePath;
        console.log(`[serveStatic] ✓ Found valid build directory: ${distPath}`);
        console.log(`[serveStatic] ✓ index.html exists at: ${indexPath}`);
        break;
      } else {
        console.log(`[serveStatic] ✗ Directory exists but missing index.html: ${possiblePath}`);
      }
    }
  }

  if (!distPath) {
    const errorMsg = `Could not find the build directory with index.html. Tried:\n${possiblePaths.map(p => `  - ${p}`).join('\n')}`;
    console.error(`[serveStatic] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  console.log(`[serveStatic] Serving static files from: ${distPath}`);
  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    const indexPath = path.resolve(distPath!, "index.html");
    console.log(`[serveStatic] Serving index.html from: ${indexPath}`);
    res.sendFile(indexPath);
  });
}
