/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The container image (Dockerfile) builds a standalone server; `npm start`
  // keeps working as before.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  // The old Kara (docker on .68) lived under /kara; bookmarks and the old
  // simorghai.com/kara redirect still carry the prefix.
  async redirects() {
    return [
      { source: "/kara", destination: "/", permanent: true },
      { source: "/kara/:path*", destination: "/:path*", permanent: true },
    ];
  },
  experimental: {
    serverActions: {
      // Company knowledge takes uploaded HR documents (PDF, Word) up to 20 MB.
      bodySizeLimit: "25mb",
    },
    // Text extraction from uploads (src/lib/extract.ts) runs as plain Node packages.
    serverComponentsExternalPackages: ["unpdf", "mammoth"],
  },
};

module.exports = nextConfig;
