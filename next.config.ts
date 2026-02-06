import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Avoid Next.js inferring an incorrect workspace root when multiple lockfiles exist.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
