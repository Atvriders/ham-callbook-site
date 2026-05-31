/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Next 15 / React 19 — keep server components lean and let Caddy do the gzip.
  compress: false,
  experimental: {
    // Allow importing SVGs / fonts from the design system without warnings.
    optimizePackageImports: ["lucide-react", "motion", "recharts"],
  },
  // The FastAPI service is reachable via Caddy at /api/*. In dev (no Caddy),
  // we proxy to http://localhost:8000 so the frontend can `fetch('/api/...')`
  // identically in both environments.
  async rewrites() {
    const apiTarget = process.env.NEXT_PUBLIC_API_PROXY_TARGET || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
