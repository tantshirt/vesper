/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The admin app shares the consumer package's Convex backend, design tokens, and globals.css via
  // the workspace (`vesper-app`). transpilePackages compiles that shared TS/CSS through the admin
  // app's own toolchain rather than expecting a pre-built dist.
  transpilePackages: ["vesper-app"],
};

export default nextConfig;
