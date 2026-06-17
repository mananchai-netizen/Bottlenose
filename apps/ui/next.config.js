const path = require('path');
const { withWorkflow } = require('workflow/next');

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['typeorm', 'pg'],
  transpilePackages: ['ioredis'],
  turbopack: process.env.VERCEL ? {} : {
    root: path.resolve(__dirname, '../..'),
  },
};

module.exports = withWorkflow(nextConfig);
