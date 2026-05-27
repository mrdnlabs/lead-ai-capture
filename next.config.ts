import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
});

const nextConfig: NextConfig = {
  // Serwist injects a webpack config for the SW bundle. Next 16 defaults to
  // Turbopack and warns if both are present without explicit opt-in.
  // Empty turbopack config = "use Turbopack for the main app, webpack only
  // for the SW that Serwist owns."
  turbopack: {},

  // Expose the build's commit SHA to the client so we can render a tiny
  // build indicator. Lets the user (and Claude) tell at a glance which
  // build the PWA is actually running vs. what's been deployed — important
  // because the service worker can serve a stale shell across deploys.
  env: {
    NEXT_PUBLIC_BUILD_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
      process.env.NEXT_PUBLIC_BUILD_SHA ??
      'dev',
  },

  // PWA-related headers
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
