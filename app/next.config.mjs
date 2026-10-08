/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
