import { createHash } from "node:crypto";

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "cmpid",
  "ito",
]);

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return key.startsWith("utm_") || TRACKING_PARAMS.has(key);
}

function stripAmpPath(pathname: string): string {
  let path = pathname;
  // /amp/companies/foo → /companies/foo, /companies/foo/amp → /companies/foo
  if (path === "/amp" || path === "/amp/") return "/";
  if (path.startsWith("/amp/")) path = path.slice("/amp".length);
  path = path.replace(/\/amp\/?$/i, "");
  return path || "/";
}

/**
 * One canonical form per article URL: lowercase scheme/host, no `www.`, no
 * fragment, no tracking params, sorted params, no trailing slash, AMP resolved.
 */
export function canonicalizeUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const port = url.port ? `:${url.port}` : "";

  const params = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParam(name))
    .filter(([name]) => name.toLowerCase() !== "amp")
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = new URLSearchParams(params).toString();

  let path = stripAmpPath(url.pathname);
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "/") path = "";

  return `${url.protocol}//${host}${port}${path}${query ? `?${query}` : ""}`;
}

export function hashUrl(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}
