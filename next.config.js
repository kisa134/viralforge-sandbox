/** @type {import('next').NextConfig} */
const isGithubPages = process.env.GITHUB_PAGES === '1';

const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true, // GitHub Pages: /analytics/ → analytics/index.html
  images: { unoptimized: true },
  ...(isGithubPages
    ? {
        basePath: '/viralforge-sandbox',
        assetPrefix: '/viralforge-sandbox',
      }
    : {}),
};

module.exports = nextConfig;
