/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Microphone is only needed by this origin; nothing else.
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default nextConfig;
