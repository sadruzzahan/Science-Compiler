import { logger } from "../logger";
import type { NormalizedPaper, SourceAdapter, SourceSearchOptions } from "./types";

const BASE = "https://api.semanticscholar.org/graph/v1";
const API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;
const USER_AGENT = process.env.SEMANTIC_SCHOLAR_USER_AGENT ?? "ScienceCompiler/1.0 (mailto:noreply@science-compiler.app)";

const FIELDS = "paperId,title,abstract,authors,year,venue,externalIds,openAccessPdf,publicationTypes";

interface S2Paper {
  paperId: string;
  title?: string;
  abstract?: string;
  authors?: Array<{ name?: string }>;
  year?: number;
  venue?: string;
  externalIds?: { DOI?: string; PubMed?: string };
  openAccessPdf?: { url?: string } | null;
  publicationTypes?: string[] | null;
}

async function s2fetch(url: string): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": USER_AGENT, ...(API_KEY ? { "x-api-key": API_KEY } : {}) } });
}

function toNormalized(p: S2Paper): NormalizedPaper | null {
  if (!p.paperId || !p.title || !p.abstract || p.abstract.length < 50) return null;
  const year = p.year ?? new Date().getFullYear();
  const authorNames = (p.authors ?? []).map(a => a.name ?? "").filter(Boolean);
  const firstAuthor = (authorNames[0] ?? "").split(/\s+/).slice(-1)[0] ?? "";
  const authors = authorNames.length > 3 ? `${authorNames.slice(0, 3).join(", ")}, et al.` : (authorNames.join(", ") || "Unknown");
  const isPreprint = (p.publicationTypes ?? []).some(t => /preprint/i.test(t));
  return {
    nativeId: p.paperId,
    doi: p.externalIds?.DOI ?? null,
    pmid: p.externalIds?.PubMed ?? null,
    title: p.title,
    authors,
    firstAuthor,
    journal: p.venue || "Unknown Venue",
    publicationYear: year,
    abstract: p.abstract,
    methodsText: null,
    sampleSize: null,
    pValue: null,
    url: `https://www.semanticscholar.org/paper/${p.paperId}`,
    openAccessUrl: p.openAccessPdf?.url ?? null,
    isPreprint,
    rawXml: null,
  };
}

export const semanticScholarAdapter: SourceAdapter = {
  id: "semantic-scholar",
  displayName: "Semantic Scholar",

  async search(query: string, opts: SourceSearchOptions): Promise<string[]> {
    const params = new URLSearchParams({ query, limit: String(Math.min(opts.limit, 100)), fields: "paperId" });
    if (opts.fromDate) params.set("publicationDateOrYear", `${opts.fromDate.slice(0, 4)}-`);
    const res = await s2fetch(`${BASE}/paper/search?${params.toString()}`);
    if (!res.ok) {
      logger.warn({ status: res.status }, "Semantic Scholar search failed");
      return [];
    }
    const data = await res.json() as { data?: Array<{ paperId: string }> };
    return (data.data ?? []).map(p => p.paperId).filter(Boolean);
  },

  async fetchByIds(ids: string[]): Promise<NormalizedPaper[]> {
    if (ids.length === 0) return [];
    try {
      const res = await fetch(`${BASE}/paper/batch?fields=${encodeURIComponent(FIELDS)}`, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}) },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "Semantic Scholar batch fetch failed");
        return [];
      }
      const data = await res.json() as Array<S2Paper | null>;
      return data.filter((p): p is S2Paper => p !== null).map(toNormalized).filter((p): p is NormalizedPaper => p !== null);
    } catch (err) {
      logger.warn({ err }, "Semantic Scholar batch fetch threw");
      return [];
    }
  },

  citationLine(p: NormalizedPaper): string {
    return `${p.authors}. ${p.title}. ${p.journal}. ${p.publicationYear}.${p.doi ? ` doi:${p.doi}` : ""}`;
  },
};
