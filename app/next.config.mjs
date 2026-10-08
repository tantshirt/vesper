/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // The authenticated app moved from flat routes to /app/*. Keep old bookmarks working.
  async redirects() {
    return [
      { source: "/explore", destination: "/app/explore", permanent: false },
      { source: "/portfolio", destination: "/app/portfolio", permanent: false },
      { source: "/income", destination: "/app/income", permanent: false },
      { source: "/updates", destination: "/app/updates", permanent: false },
      { source: "/property/:path*", destination: "/app/property/:path*", permanent: false },
      { source: "/invest/:path*", destination: "/app/invest/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
