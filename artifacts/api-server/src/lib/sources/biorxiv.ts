import { logger } from "../logger";
import type { NormalizedPaper, SourceAdapter, SourceSearchOptions } from "./types";

// bioRxiv has no full-text query endpoint, only date-window listing per server.
// We fetch the most recent window and substring-filter by query terms; this
// keeps the adapter usable as a simple "preprint sweep" source.
const BASE = "https://api.biorxiv.org";
const USER_AGENT = process.env.BIORXIV_USER_AGENT ?? "ScienceCompiler/1.0 (mailto:noreply@science-compiler.app)";

interface BxPaper {
  doi: string;
  title: string;
  authors: string;
  abstract: string;
  date: string;
  server: string;
}

function toNormalized(p: BxPaper, query: string): NormalizedPaper | null {
  if (!p.doi || !p.title || !p.abstract || p.abstract.length < 50) return null;
  const q = query.toLowerCase();
  const text = `${p.title} ${p.abstract}`.toLowerCase();
  if (q && !q.split(/\s+/).slice(0, 3).every(t => text.includes(t))) return null;
  const year = parseInt(p.date.slice(0, 4), 10) || new Date().getFullYear();
  const authorNames = p.authors.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const firstAuthor = (authorNames[0] ?? "").split(/\s+/).slice(-1)[0] ?? "";
  const authors = authorNames.length > 3 ? `${authorNames.slice(0, 3).join(", ")}, et al.` : (authorNames.join(", ") || "Unknown");
  return {
    nativeId: p.doi,
    doi: p.doi,
    pmid: null,
    title: p.title,
    authors,
    firstAuthor,
    journal: p.server === "medrxiv" ? "medRxiv (preprint)" : "bioRxiv (preprint)",
    publicationYear: year,
    abstract: p.abstract,
    methodsText: null,
    sampleSize: null,
    pValue: null,
    url: `https://doi.org/${p.doi}`,
    openAccessUrl: `https://www.${p.server ?? "biorxiv"}.org/content/${p.doi}v1.full.pdf`,
    isPreprint: true,
    rawXml: null,
  };
}

async function fetchWindow(server: "biorxiv" | "medrxiv", from: string, to: string): Promise<BxPaper[]> {
  const out: BxPaper[] = [];
  let cursor = 0;
  for (let i = 0; i < 5; i++) {
    const url = `${BASE}/details/${server}/${from}/${to}/${cursor}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      logger.warn({ status: res.status, server }, "bioRxiv fetch failed");
      break;
    }
    const data = await res.json() as { collection?: BxPaper[]; messages?: Array<{ count: number; total: number }> };
    const items = data.collection ?? [];
    out.push(...items);
    if (items.length < 100) break;
    cursor += items.length;
  }
  return out;
}

function dateWindow(opts: SourceSearchOptions): { from: string; to: string } {
  const to = (opts.toDate ?? new Date().toISOString().slice(0, 10));
  const fromDefault = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  return { from: opts.fromDate ?? fromDefault, to };
}

const cache = new Map<string, { ts: number; papers: NormalizedPaper[] }>();
const CACHE_TTL_MS = 10 * 60_000;

export const biorxivAdapter: SourceAdapter = {
  id: "biorxiv",
  displayName: "bioRxiv",

  async search(query: string, opts: SourceSearchOptions): Promise<string[]> {
    const { from, to } = dateWindow(opts);
    const cacheKey = `${query}|${from}|${to}|${opts.limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.papers.slice(0, opts.limit).map(p => p.doi!);
    }
    const [bx, mx] = await Promise.all([fetchWindow("biorxiv", from, to), fetchWindow("medrxiv", from, to)]);
    const normalized = [...bx, ...mx]
      .map(p => toNormalized(p, query))
      .filter((p): p is NormalizedPaper => p !== null)
      .slice(0, opts.limit);
    cache.set(cacheKey, { ts: Date.now(), papers: normalized });
    return normalized.map(p => p.doi!);
  },

  async fetchByIds(dois: string[]): Promise<NormalizedPaper[]> {
    if (dois.length === 0) return [];
    // The window cache populated by `search` already holds normalized records; pull from there.
    const result: NormalizedPaper[] = [];
    const wanted = new Set(dois);
    for (const entry of cache.values()) {
      for (const p of entry.papers) {
        if (p.doi && wanted.has(p.doi)) result.push(p);
      }
    }
    if (result.length === 0) {
      // Fall back to a per-DOI lookup against bioRxiv's details endpoint.
      for (const doi of dois) {
        try {
          const res = await fetch(`${BASE}/details/biorxiv/${doi}`, { headers: { "User-Agent": USER_AGENT } });
          if (!res.ok) continue;
          const data = await res.json() as { collection?: BxPaper[] };
          for (const p of data.collection ?? []) {
            const n = toNormalized(p, "");
            if (n) result.push(n);
          }
        } catch { /* ignore */ }
      }
    }
    return result;
  },

  citationLine(p: NormalizedPaper): string {
    return `${p.authors}. ${p.title}. ${p.journal}. ${p.publicationYear}. doi:${p.doi}`;
  },
};
