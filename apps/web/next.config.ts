import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@lexilens/contracts'],
  poweredByHeader: false,
};

export default nextConfig;
