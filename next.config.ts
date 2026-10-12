import type { NextConfig } from "next";

// create-next-app 16.4 enables cacheComponents/partialPrefetching by default.
// Off on purpose: routes declare `runtime = "nodejs"` per docs/02-ARCHITECTURE.md,
// and the dashboard reads live Neon data on every request. See docs/DECISIONS.md.
const nextConfig: NextConfig = {};

export default nextConfig;
