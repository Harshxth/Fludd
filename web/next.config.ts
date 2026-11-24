import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // One switch for AI: the browser learns the server's AI_PROVIDER setting through this (read in lib/config.ts).
  env: { NEXT_PUBLIC_AI: process.env.AI_PROVIDER === "gemini" ? "on" : "off" },
  // The reports route reads the gold files (model depth at the photo) on the server; ship them with it on Vercel.
  outputFileTracingIncludes: {
    "/api/reports": ["./public/data/**/*"],
    "/api/health": ["./public/data/manifest.json", "./public/data/toy/manifest.json"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
