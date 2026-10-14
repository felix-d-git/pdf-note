/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://v2.tauri.app/start/frontend/vite/ – Tauri erwartet festen Port, nur localhost
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/vendor/**"] } },
  test: { include: ["src/**/*.test.ts"] },
});
