import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static must stay unbundled so its binary path resolves at runtime;
  // tracing includes carry the binary + bundled music into the reel-rendering routes.
  // sharp is external too, and its platform binaries (@img/*) must be traced
  // explicitly — the turbopack production build left them out of the Vercel
  // function bundles, 500ing every sharp-importing route in prod (2026-08-30:
  // "Could not load the sharp module using the linux-x64 runtime").
  serverExternalPackages: ["ffmpeg-static", "sharp"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/sharp/**", "./node_modules/@img/**"],
    "/api/reels": ["./assets/music/**", "./node_modules/ffmpeg-static/ffmpeg"],
    "/api/cron/reconcile": ["./assets/music/**", "./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
