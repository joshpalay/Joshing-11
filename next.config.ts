import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  outputFileTracingIncludes: {
    // Include migration SQL files so drizzle migrate() works in Vercel serverless
    '/api/**': ['./drizzle/**'],
    '/**': ['./drizzle/**'],
  },
  async redirects() {
    return [
      // B-FRIENDS-INVITE-LINKS-01 — /friends/find's content (search, contact
      // matching, invite reflections) moved onto the consolidated /friends
      // page; this path no longer has a route. Permanent since every inbound
      // link (feed promos, TodaysFiveCard, settings) points at the old path
      // and won't be redeployed atomically with this change.
      {
        source: '/friends/find',
        destination: '/friends',
        permanent: true,
      },
    ]
  },
}

export default nextConfig
