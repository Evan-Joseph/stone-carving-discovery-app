import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(dirname, "./src")
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;

            if (id.includes("node_modules/pdfjs-dist")) {
              return "vendor-pdf";
            }
            if (id.includes("node_modules/three")) {
              return "vendor-three";
            }
            if (id.includes("node_modules/react-router")) {
              return "vendor-router";
            }
            if (id.includes("node_modules/react")) {
              return "vendor-react";
            }
          }
        }
      }
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.VITE_AI_PROXY_TARGET || "http://127.0.0.1:8787",
          changeOrigin: true
        }
      }
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: true
    }
  };
});
