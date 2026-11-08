import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "playground",

  plugins: [react()],

  css: {
    postcss: {
      plugins: [],
    },
  },

  server: {
    port: 5173,
  },
});