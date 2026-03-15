/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    KOMMO_SUBDOMAIN: process.env.KOMMO_SUBDOMAIN,
    KOMMO_ACCESS_TOKEN: process.env.KOMMO_ACCESS_TOKEN,
    TENFRONT_BASE_URL: process.env.TENFRONT_BASE_URL,
    TENFRONT_BEARER_TOKEN: process.env.TENFRONT_BEARER_TOKEN,
    TENFRONT_CONSUMER_KEY: process.env.TENFRONT_CONSUMER_KEY,
    TENFRONT_CONSUMER_SECRET: process.env.TENFRONT_CONSUMER_SECRET,
  },
};

module.exports = nextConfig;
