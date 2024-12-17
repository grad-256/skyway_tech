/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    globals: true,
  },
  server: {
    host: true,
    port: 5173
  },
  define: {
    'process.env': {
      VITE_SKYWAY_API_KEY: JSON.stringify(process.env.VITE_SKYWAY_API_KEY),
      VITE_SKYWAY_SECRET_KEY: JSON.stringify(process.env.VITE_SKYWAY_SECRET_KEY)
    }
  }
});