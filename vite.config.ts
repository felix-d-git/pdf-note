/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://v2.tauri.app/start/frontend/vite/ – Tauri erwartet festen Port, nur localhost
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // dist/.vite/license.md: Lizenztexte aller gebündelten npm-Pakete → scripts/licenses.mjs (Installer)
  build: { license: true },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/vendor/**"] } },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
