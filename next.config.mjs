/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow validation builds alongside a running development server.
  distDir: process.env.IMEX_BUILD_DIR || ".next",
};

export default nextConfig;
