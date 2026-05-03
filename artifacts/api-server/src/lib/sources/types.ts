// Common shape every source adapter normalizes to before deduplication.
// Adapters MUST set at least one of `doi` or a source-native id (returned via
// `nativeId`); the worker uses doi → fingerprint(title|year|firstAuthor) to
// merge across sources.
export interface NormalizedPaper {
  // Source's native id (e.g. PMID, S2 paperId, OpenAlex W..., bioRxiv DOI).
  nativeId: string;
  doi: string | null;
  pmid: string | null;
  title: string;
  authors: string;          // already display-formatted ("Smith J, Doe A, et al.")
  firstAuthor: string;      // lowercased last name; used in fingerprint
  journal: string;
  publicationYear: number;
  abstract: string;
  methodsText: string | null;
  sampleSize: number | null;
  pValue: string | null;
  url: string | null;       // landing page on the source
  openAccessUrl: string | null;
  isPreprint: boolean;
  rawXml: string | null;    // PubMed only; null elsewhere
}

export interface SourceSearchOptions {
  /** ISO date strings; both optional. */
  fromDate?: string;
  toDate?: string;
  limit: number;
}

export interface SourceAdapter {
  readonly id: string;          // stable id stored in paper_sources.source_id
  readonly displayName: string; // human label for badges
  /** Returns this source's native ids matching `query`. */
  search(query: string, opts: SourceSearchOptions): Promise<string[]>;
  /** Resolves native ids to normalized papers. Adapters drop ones they can't fully populate. */
  fetchByIds(ids: string[]): Promise<NormalizedPaper[]>;
  /** A short formatted citation line for UI badges/tooltips. */
  citationLine(paper: NormalizedPaper): string;
}

export function fingerprint(title: string, year: number, firstAuthor: string): string {
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  const a = firstAuthor.toLowerCase().trim();
  // md5 mirrors the SQL backfill in migration 0008.
  // Lazy require to avoid pulling crypto into hot paths that don't need it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("crypto") as typeof import("crypto");
  return createHash("md5").update(`${t}|${year}|${a}`).digest("hex");
}
