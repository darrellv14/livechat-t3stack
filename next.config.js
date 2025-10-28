/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Asset prefix agar static files tetap load dari domain asli
  assetPrefix: process.env.NODE_ENV === 'production' 
    ? 'https://livechat-t3stack.vercel.app'
    : undefined,
};

export default config;
