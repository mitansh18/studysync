import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root so Next.js doesn't infer it from a stray
  // lockfile in a parent directory.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
