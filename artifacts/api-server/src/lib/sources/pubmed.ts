import { logger } from "../logger";
import type { NormalizedPaper, SourceAdapter, SourceSearchOptions } from "./types";

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const API_KEY = process.env.NCBI_API_KEY;
const USER_AGENT = process.env.NCBI_USER_AGENT ?? "ScienceCompiler/1.0 (mailto:noreply@science-compiler.app)";

function buildUrl(endpoint: string, params: Record<string, string | number>): string {
  const p = new URLSearchParams({ db: "pubmed", retmode: "json", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  if (API_KEY) p.set("api_key", API_KEY);
  return `${NCBI_BASE}/${endpoint}.fcgi?${p.toString()}`;
}

async function fetchWithUa(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, headers: { ...(init?.headers ?? {}), "User-Agent": USER_AGENT } });
}

export const pubmedAdapter: SourceAdapter = {
  id: "pubmed",
  displayName: "PubMed",

  async search(query: string, opts: SourceSearchOptions): Promise<string[]> {
    const oaQuery = query.toLowerCase().includes("free full text") ? query : `(${query}) AND free full text[sb]`;
    const url = buildUrl("esearch", { term: oaQuery, retmax: opts.limit, sort: "pub_date" });
    const res = await fetchWithUa(url);
    if (!res.ok) throw new Error(`PubMed esearch failed: ${res.status}`);
    const data = await res.json() as { esearchresult?: { idlist?: string[] } };
    return data.esearchresult?.idlist ?? [];
  },

  async fetchByIds(pmids: string[]): Promise<NormalizedPaper[]> {
    if (pmids.length === 0) return [];
    const url = buildUrl("efetch", { id: pmids.join(","), rettype: "abstract", retmode: "xml" });
    const res = await fetchWithUa(url);
    if (!res.ok) throw new Error(`PubMed efetch failed: ${res.status}`);
    const xml = await res.text();
    return parsePubMedXml(xml, pmids);
  },

  citationLine(p: NormalizedPaper): string {
    return `${p.authors}. ${p.title}. ${p.journal}. ${p.publicationYear}.${p.pmid ? ` PMID:${p.pmid}` : ""}`;
  },
};

function parsePubMedXml(xml: string, pmids: string[]): NormalizedPaper[] {
  const papers: NormalizedPaper[] = [];

  const articleMatches = xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g);
  for (const match of articleMatches) {
    const article = match[1];
    try {
      const pmid = extractTag(article, "PMID") ?? "";
      if (!pmid) continue;

      const title = stripTags(extractTag(article, "ArticleTitle") ?? "Untitled");
      const journal = stripTags(extractTag(article, "Title") ?? extractTag(article, "ISOAbbreviation") ?? "Unknown Journal");
      const { abstractText, methodsText } = extractStructuredAbstract(article);

      const authorList = [...article.matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/g)].map(a => {
        const last = extractTag(a[1], "LastName") ?? "";
        const initials = extractTag(a[1], "Initials") ?? "";
        return `${last} ${initials}`.trim();
      });
      const firstAuthor = authorList[0]?.split(/\s+/)[0] ?? "";
      const authors = authorList.length > 3 ? `${authorList.slice(0, 3).join(", ")}, et al.` : authorList.join(", ") || "Unknown";

      const yearStr = extractTag(article, "Year") ?? extractTag(article, "PubDate") ?? "";
      const yearMatch = yearStr.match(/\d{4}/);
      const publicationYear = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();

      const doi = extractArticleId(article, "doi");
      const pmc = extractArticleId(article, "pmc");
      const openAccessUrl = pmc ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc}/` : null;

      if (!abstractText || abstractText.length < 50) continue;

      const combinedText = [abstractText, methodsText].filter(Boolean).join(" ");

      papers.push({
        nativeId: pmid,
        pmid,
        doi,
        title,
        authors,
        firstAuthor,
        journal,
        publicationYear,
        abstract: abstractText,
        methodsText,
        sampleSize: extractSampleSize(combinedText),
        pValue: extractPValue(combinedText),
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        openAccessUrl,
        isPreprint: false,
        rawXml: match[0],
      });
    } catch (err) {
      logger.warn({ err }, "Failed to parse PubMed article XML");
    }
  }

  if (papers.length === 0 && pmids.length > 0) {
    logger.warn({ pmids }, "No papers parsed from PubMed XML response");
  }
  return papers;
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : null;
}

function extractStructuredAbstract(article: string): { abstractText: string; methodsText: string | null } {
  const abstractSection = article.match(/<Abstract>([\s\S]*?)<\/Abstract>/i);
  if (!abstractSection) return { abstractText: "", methodsText: null };
  const innerXml = abstractSection[1];
  const sections = [...innerXml.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/gi)];
  if (sections.length === 0) return { abstractText: stripTags(innerXml).trim(), methodsText: null };
  const methodSections: string[] = [];
  const otherSections: string[] = [];
  for (const sec of sections) {
    const attrs = sec[1] ?? "";
    const content = stripTags(sec[2]).trim();
    if (!content) continue;
    const labelMatch = attrs.match(/(?:Label|NlmCategory)="([^"]+)"/i);
    const label = labelMatch ? labelMatch[1].toUpperCase() : "";
    if (label.includes("METHOD") || label.includes("DESIGN") || label.includes("PROCEDURE")) methodSections.push(content);
    else otherSections.push(content);
  }
  const abstractText = otherSections.join(" ").trim() || sections.map(s => stripTags(s[2])).join(" ").trim();
  const methodsText = methodSections.length > 0 ? methodSections.join(" ").trim() : null;
  return { abstractText, methodsText };
}

function extractSampleSize(text: string): number | null {
  const patterns = [
    /\b(?:n\s*=\s*|N\s*=\s*)(\d[\d,]+)/,
    /(\d[\d,]+)\s+(?:participants?|patients?|subjects?|individuals?|adults?|children|women|men)/i,
    /(?:enrolled|recruited|included|analyzed)\s+(\d[\d,]+)/i,
    /sample\s+(?:size|of)\s+(\d[\d,]+)/i,
    /total\s+of\s+(\d[\d,]+)\s+(?:participants?|patients?|subjects?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1].replace(/,/g, ""), 10);
      if (!isNaN(num) && num > 1 && num < 10_000_000) return num;
    }
  }
  return null;
}

function extractPValue(text: string): string | null {
  const patterns = [/p\s*[<=>≤≥]\s*0\.\d+/i, /p\s*-?\s*value\s*[<=>≤≥]\s*0\.\d+/i, /p\s*=\s*0\.\d+/i, /p\s*<\s*0\.0{1,4}[1-9]/i];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].replace(/\s+/g, "").toLowerCase();
  }
  return null;
}

function extractArticleId(article: string, idType: string): string | null {
  const pattern = new RegExp(`<ArticleId IdType="${idType}"[^>]*>([^<]+)<\\/ArticleId>`, "i");
  const m = article.match(pattern);
  return m ? m[1].trim() : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
