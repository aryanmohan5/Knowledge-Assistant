import type { NextConfig } from "next";
import { MAX_UPLOAD_REQUEST_BYTES } from "./src/lib/limits";

const nextConfig: NextConfig = {
  experimental: {
    // Middleware runs on /api/* and buffers request bodies, silently truncating
    // anything over its cap (default 10 MB). Keep it just above our upload cap
    // so the route's own limit check decides, with a clear 413.
    middlewareClientMaxBodySize: MAX_UPLOAD_REQUEST_BYTES + 1024 * 1024,
  },
  // pdf.js is large and loads optional modules dynamically; don't bundle it.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
