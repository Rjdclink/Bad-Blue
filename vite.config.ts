import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { build as esbuildBuild } from "esbuild";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Node 18 compatibility: polyfill for __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function cryptocrawlMonteCarloWorkerBuild() {
  return {
    name: "cryptocrawl-monte-carlo-worker-build",
    apply: "build" as const,
    async closeBundle() {
      await esbuildBuild({
        entryPoints: [path.resolve(__dirname, "server/services/cryptocrawl/execution/adapters/monte-carlo-worker.ts")],
        bundle: true,
        platform: "node",
        target: "node20",
        format: "esm",
        outfile: path.resolve(__dirname, "dist/cryptocrawl-monte-carlo-worker.js"),
        packages: "external",
        define: { "process.env.NODE_ENV": "'production'" },
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    cryptocrawlMonteCarloWorkerBuild(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true
    },
    rollupOptions: {
      external: [
        '@babel/preset-typescript/package.json',
        'lightningcss'
      ]
    }
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  optimizeDeps: {
    exclude: ['@google/genai', '@babel/preset-typescript', 'lightningcss']
  },
});