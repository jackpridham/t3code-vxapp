import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const port = Number(process.env.PORT ?? 5733);
const sourcemapEnv = process.env.T3CODE_WEB_SOURCEMAP?.trim().toLowerCase();

const buildSourcemap =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

export default defineConfig({
  plugins: [
    tanstackRouter(),
    react(),
    babel({
      // We need to be explicit about the parser options after moving to @vitejs/plugin-react v6.0.0
      // This is because the babel plugin only automatically parses typescript and jsx based on relative paths (e.g. "**/*.ts")
      // whereas the previous version of the plugin parsed all files with a .ts extension.
      // This is causing our packages/ directory to fail to parse, as they are not relative to the CWD.
      parserOpts: { plugins: ["typescript", "jsx"] },
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
  ],
  optimizeDeps: {
    include: ["@pierre/diffs", "@pierre/diffs/react", "@pierre/diffs/worker/worker.js"],
  },
  define: {
    // In dev mode, tell the web app where the WebSocket server lives
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
    "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    ...(process.env.VITE_HOST === "true" ? { host: "0.0.0.0" } : {}),
    port,
    strictPort: true,
    // When VITE_HOST is set, omit hmr config so the client derives the
    // WebSocket URL from window.location (works for remote browsers).
    // Otherwise pin to localhost for Electron BrowserWindow reliability.
    hmr: {
      protocol: "ws",
      // VITE_HMR_HOST overrides for remote access (e.g. LAN dev server).
      // Defaults to localhost for Electron BrowserWindow reliability.
      host: process.env.VITE_HMR_HOST ?? "localhost",
    },
    // Proxy WebSocket upgrade requests so the browser only needs the Vite
    // port (avoids firewall issues when the bun server port is blocked).
    ...(process.env.VITE_WS_PROXY_PORT
      ? {
          proxy: {
            "/ws": {
              target: `http://localhost:${process.env.VITE_WS_PROXY_PORT}`,
              ws: true,
              rewriteWsOrigin: true,
            },
          },
        }
      : {}),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: buildSourcemap,
  },
});
