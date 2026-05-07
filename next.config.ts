import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/api/catalog": ["./data/huerto_regenerativo.sqlite"],
    "/api/locations": ["./data/huerto_regenerativo.sqlite"],
    "/api/optimize": ["./data/huerto_regenerativo.sqlite"],
    "/api/soil": ["./data/huerto_regenerativo.sqlite"],
    "/api/species": ["./data/huerto_regenerativo.sqlite"]
  }
};

export default nextConfig;
