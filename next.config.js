/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The container image (Dockerfile) builds a standalone server; `npm start`
  // keeps working as before.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

module.exports = nextConfig;
