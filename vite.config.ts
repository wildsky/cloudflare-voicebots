import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [cloudflare(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // If you have an SSR or server build, you can define rollupOptions.external or noExternal:
    rollupOptions: {
      external: ["ws"], // So it doesn't get bundled for browser
    },
  },
  ssr: {
    noExternal: ["ws"],
  },
});
