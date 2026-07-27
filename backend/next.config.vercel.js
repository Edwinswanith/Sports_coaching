/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  rewrites() {
    return {
      fallback: [
        {
          source: "/:path*",
          destination: "/index.html",
        },
      ],
    };
  },
};

module.exports = nextConfig;
