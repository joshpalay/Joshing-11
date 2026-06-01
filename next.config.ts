import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  outputFileTracingIncludes: {
    // Include migration SQL files so drizzle migrate() works in Vercel serverless
    '/api/**': ['./drizzle/**'],
    '/**': ['./drizzle/**'],
  },
};

export default nextConfig;
