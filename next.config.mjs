/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow validation builds alongside a running development server.
  distDir: process.env.IMEX_BUILD_DIR || ".next",
  // Loaded as-is on the server: it launches the Claude Code program.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
