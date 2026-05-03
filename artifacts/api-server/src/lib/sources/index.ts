import type { SourceAdapter } from "./types";
import { pubmedAdapter } from "./pubmed";
import { semanticScholarAdapter } from "./semanticScholar";
import { openAlexAdapter } from "./openAlex";
import { biorxivAdapter } from "./biorxiv";

export const ALL_ADAPTERS: SourceAdapter[] = [pubmedAdapter, semanticScholarAdapter, openAlexAdapter, biorxivAdapter];

const ADAPTER_MAP = new Map(ALL_ADAPTERS.map(a => [a.id, a]));

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTER_MAP.get(id);
}

export function getAdapters(ids: readonly string[]): SourceAdapter[] {
  return ids.map(id => ADAPTER_MAP.get(id)).filter((a): a is SourceAdapter => a != null);
}

export type { SourceAdapter, NormalizedPaper, SourceSearchOptions } from "./types";
export { fingerprint } from "./types";
