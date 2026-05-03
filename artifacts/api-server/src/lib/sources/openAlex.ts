import { logger } from "../logger";
import type { NormalizedPaper, SourceAdapter, SourceSearchOptions } from "./types";

const BASE = "https://api.openalex.org";
const MAILTO = process.env.OPENALEX_MAILTO ?? "noreply@science-compiler.app";
const USER_AGENT = `ScienceCompiler/1.0 (mailto:${MAILTO})`;

interface OAWork {
  id: string;
  doi?: string | null;
  title?: string;
  display_name?: string;
  publication_year?: number;
  type?: string;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string } | null; pdf_url?: string | null; landing_page_url?: string | null } | null;
  open_access?: { oa_url?: string | null } | null;
  ids?: { pmid?: string };
}

function inverseIndexToText(idx: Record<string, number[]> | null | undefined): string {
  if (!idx) return "";
  const positions: Array<[number, string]> = [];
  for (const [word, positionList] of Object.entries(idx)) {
    for (const p of positionList) positions.push([p, word]);
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(p => p[1]).join(" ");
}

function toNormalized(w: OAWork): NormalizedPaper | null {
  const title = w.title || w.display_name || "";
  const abstract = inverseIndexToText(w.abstract_inverted_index);
  if (!title || !abstract || abstract.length < 50) return null;
  const year = w.publication_year ?? new Date().getFullYear();
  const authorNames = (w.authorships ?? []).map(a => a.author?.display_name ?? "").filter(Boolean);
  const firstAuthor = (authorNames[0] ?? "").split(/\s+/).slice(-1)[0] ?? "";
  const authors = authorNames.length > 3 ? `${authorNames.slice(0, 3).join(", ")}, et al.` : (authorNames.join(", ") || "Unknown");
  const journal = w.primary_location?.source?.display_name ?? "Unknown Venue";
  const doiUrl = w.doi ?? null;
  const doi = doiUrl ? doiUrl.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") : null;
  const pmid = w.ids?.pmid ? w.ids.pmid.replace(/^https?:\/\/[^/]+\//, "") : null;
  const oaUrl = w.open_access?.oa_url ?? w.primary_location?.pdf_url ?? null;
  const isPreprint = (w.type ?? "").toLowerCase() === "preprint";
  const nativeId = w.id.replace(/^https?:\/\/openalex\.org\//, "");
  return {
    nativeId,
    doi,
    pmid,
    title,
    authors,
    firstAuthor,
    journal,
    publicationYear: year,
    abstract,
    methodsText: null,
    sampleSize: null,
    pValue: null,
    url: w.primary_location?.landing_page_url ?? `https://openalex.org/${nativeId}`,
    openAccessUrl: oaUrl,
    isPreprint,
    rawXml: null,
  };
}

export const openAlexAdapter: SourceAdapter = {
  id: "openalex",
  displayName: "OpenAlex",

  async search(query: string, opts: SourceSearchOptions): Promise<string[]> {
    const params = new URLSearchParams({ search: query, "per-page": String(Math.min(opts.limit, 50)), mailto: MAILTO });
    const res = await fetch(`${BASE}/works?${params.toString()}`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      logger.warn({ status: res.status }, "OpenAlex search failed");
      return [];
    }
    const data = await res.json() as { results?: OAWork[] };
    return (data.results ?? []).map(w => w.id.replace(/^https?:\/\/openalex\.org\//, ""));
  },

  async fetchByIds(ids: string[]): Promise<NormalizedPaper[]> {
    if (ids.length === 0) return [];
    const filter = `openalex_id:${ids.map(i => `https://openalex.org/${i}`).join("|")}`;
    const params = new URLSearchParams({ filter, "per-page": String(Math.min(ids.length, 50)), mailto: MAILTO });
    const res = await fetch(`${BASE}/works?${params.toString()}`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      logger.warn({ status: res.status }, "OpenAlex fetch failed");
      return [];
    }
    const data = await res.json() as { results?: OAWork[] };
    return (data.results ?? []).map(toNormalized).filter((p): p is NormalizedPaper => p !== null);
  },

  citationLine(p: NormalizedPaper): string {
    return `${p.authors}. ${p.title}. ${p.journal}. ${p.publicationYear}.${p.doi ? ` doi:${p.doi}` : ""}`;
  },
};
