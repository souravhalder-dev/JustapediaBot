/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Allow external images if needed (e.g. Justapedia or Internet Archive logos)
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'justapedia.org',
      },
      {
        protocol: 'https',
        hostname: 'archive.org',
      },
    ],
  },
};

export default nextConfig;
