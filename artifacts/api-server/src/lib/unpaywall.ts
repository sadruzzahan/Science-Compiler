import { logger } from "./logger";

const EMAIL = process.env.UNPAYWALL_EMAIL ?? "noreply@science-compiler.app";

export interface UnpaywallLocation {
  url: string;
  isPdf: boolean;
}

interface UnpaywallResponse {
  best_oa_location?: { url?: string; url_for_pdf?: string | null; host_type?: string } | null;
}

export async function lookupOpenAccessUrl(doi: string): Promise<UnpaywallLocation | null> {
  if (!doi) return null;
  try {
    const res = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(EMAIL)}`, {
      headers: { "User-Agent": `ScienceCompiler/1.0 (mailto:${EMAIL})` },
    });
    if (!res.ok) return null;
    const data = await res.json() as UnpaywallResponse;
    const best = data.best_oa_location;
    if (!best) return null;
    if (best.url_for_pdf) return { url: best.url_for_pdf, isPdf: true };
    if (best.url) return { url: best.url, isPdf: best.url.endsWith(".pdf") };
    return null;
  } catch (err) {
    logger.debug({ err, doi }, "Unpaywall lookup failed");
    return null;
  }
}
