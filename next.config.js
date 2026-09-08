/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Any single-segment path like /XYZ123 (a room code) should
      // be served by the root page, which reads the room code
      // from window.location.pathname on the client.
      { source: '/:room([A-Za-z0-9]{4,10})', destination: '/' },
    ];
  },
};

module.exports = nextConfig;
