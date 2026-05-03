import { logger } from "./logger";
import { lookupOpenAccessUrl } from "./unpaywall";

export type FullTextStatus = "fetched" | "pdf_skipped" | "unavailable" | "failed" | "skipped" | "unknown";

export interface FullTextResult {
  status: FullTextStatus;
  source: string | null;
  url: string | null;
  text: string | null;
}

const MAX_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "ScienceCompiler/1.0" } });
    return res;
  } catch (err) {
    logger.debug({ err, url }, "fullText fetch threw");
    return null;
  } finally {
    clearTimeout(t);
  }
}

function stripHtml(html: string): string {
  // Strip script/style blocks first, then tags, then collapse whitespace.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function resolveFullText(doi: string | null, fallbackUrl: string | null): Promise<FullTextResult> {
  let candidate = doi ? await lookupOpenAccessUrl(doi) : null;
  if (!candidate && fallbackUrl) candidate = { url: fallbackUrl, isPdf: fallbackUrl.toLowerCase().endsWith(".pdf") };
  if (!candidate) return { status: "unavailable", source: null, url: null, text: null };

  if (candidate.isPdf) {
    // PDF extraction (pdf-parse) is intentionally not pulled into this build
    // to keep cold start fast and avoid the binary deps. Future work: opt-in.
    return { status: "pdf_skipped", source: doi ? "unpaywall" : "fallback", url: candidate.url, text: null };
  }

  const res = await fetchWithTimeout(candidate.url);
  if (!res || !res.ok) return { status: "failed", source: doi ? "unpaywall" : "fallback", url: candidate.url, text: null };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/pdf")) {
    return { status: "pdf_skipped", source: doi ? "unpaywall" : "fallback", url: candidate.url, text: null };
  }

  try {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { status: "failed", source: "html", url: candidate.url, text: null };
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const text = stripHtml(html);
    if (text.length < 500) return { status: "failed", source: "html", url: candidate.url, text: null };
    return { status: "fetched", source: doi ? "unpaywall" : "fallback", url: candidate.url, text: text.slice(0, 200_000) };
  } catch (err) {
    logger.debug({ err }, "fullText extraction failed");
    return { status: "failed", source: "html", url: candidate.url, text: null };
  }
}
