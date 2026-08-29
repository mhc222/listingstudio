import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static must stay unbundled so its binary path resolves at runtime;
  // tracing includes carry the binary + bundled music into the reel-rendering routes.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/reels": ["./assets/music/**", "./node_modules/ffmpeg-static/ffmpeg"],
    "/api/cron/reconcile": ["./assets/music/**", "./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
