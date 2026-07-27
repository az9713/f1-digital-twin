import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GH_PAGES ? "/f1-digital-twin/" : "/",
});
