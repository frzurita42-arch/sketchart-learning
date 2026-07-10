/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The AI/DB libs use Node built-ins; keep them on the Node.js server runtime.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
