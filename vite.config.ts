import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "clipweave-local-api",
      configureServer(server) {
        // Prefer the in-repo server; fall back to a legacy sibling web-server.cjs if present.
        // Both are optional for production builds and CI.
        let api: { setApiBase?: (base: string) => void; handle: (req: any, res: any, next: any) => void };
        try {
          api = require("./server/dev-api.cjs");
        } catch {
          try {
            api = require("../web-server.cjs");
          } catch {
            console.warn(
              "[clipweave] local API unavailable; /api, /stream and /media are disabled. " +
                "server/dev-api.cjs should be present in the repo."
            );
            api = {
              handle(req: any, res: any, next: any) {
                const url = String(req.url || "");
                if (url.startsWith("/api") || url.startsWith("/stream") || url.startsWith("/media")) {
                  res.statusCode = 503;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ ok: false, error: "Local API unavailable: server/dev-api.cjs is missing." }));
                  return;
                }
                next();
              },
            };
          }
        }
        // The server modules are required once, so a running dev server keeps executing old code
        // after they are edited unless we restart. Watch the whole directory now that the API is
        // split across routes, services, and lib modules.
        const apiDir = path.join(server.config.root, "server");
        server.watcher.add(apiDir);
        server.watcher.on("change", (file) => {
          if (path.resolve(file).startsWith(apiDir + path.sep)) server.restart();
        });

        // Use the port actually bound, which differs when 3000 is taken.
        const applyBase = () => {
          const address = server.httpServer?.address();
          const port = typeof address === "object" && address ? address.port : server.config.server.port || 3000;
          api.setApiBase?.(`http://127.0.0.1:${port}`);
        };
        applyBase();
        server.httpServer?.once("listening", applyBase);
        server.middlewares.use((req: any, res: any, next: any) => api.handle(req, res, next));
      },
    },
  ],
  server: { host: "0.0.0.0", port: 3000, allowedHosts: true },
});
