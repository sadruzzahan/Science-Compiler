import { logger } from "./logger";

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const API_KEY = process.env.NCBI_API_KEY;

export interface PubMedPaper {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  publicationYear: number;
  doi: string | null;
  abstract: string;
  openAccessUrl: string | null;
}

function buildUrl(endpoint: string, params: Record<string, string | number>): string {
  const p = new URLSearchParams({ db: "pubmed", retmode: "json", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  if (API_KEY) p.set("api_key", API_KEY);
  return `${NCBI_BASE}/${endpoint}.fcgi?${p.toString()}`;
}

export async function searchPubMed(query: string, maxResults: number = 10): Promise<string[]> {
  const url = buildUrl("esearch", { term: query, retmax: maxResults, sort: "pub_date" });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PubMed esearch failed: ${res.status}`);
  const data = await res.json() as { esearchresult?: { idlist?: string[] } };
  return data.esearchresult?.idlist ?? [];
}

export async function fetchPubMedPapers(pmids: string[]): Promise<PubMedPaper[]> {
  if (pmids.length === 0) return [];
  const url = buildUrl("efetch", { id: pmids.join(","), rettype: "abstract", retmode: "xml" });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PubMed efetch failed: ${res.status}`);
  const xml = await res.text();
  return parsePubMedXml(xml, pmids);
}

function parsePubMedXml(xml: string, pmids: string[]): PubMedPaper[] {
  const papers: PubMedPaper[] = [];

  const articleMatches = xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g);
  for (const match of articleMatches) {
    const article = match[1];
    try {
      const pmid = extractTag(article, "PMID") ?? "";
      if (!pmid) continue;

      const title = stripTags(extractTag(article, "ArticleTitle") ?? "Untitled");
      const journal = stripTags(extractTag(article, "Title") ?? extractTag(article, "ISOAbbreviation") ?? "Unknown Journal");
      const abstractText = extractAbstract(article);

      const authorList = [...article.matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/g)].map(a => {
        const last = extractTag(a[1], "LastName") ?? "";
        const initials = extractTag(a[1], "Initials") ?? "";
        return `${last} ${initials}`.trim();
      });
      const authors = authorList.length > 3
        ? `${authorList.slice(0, 3).join(", ")}, et al.`
        : authorList.join(", ") || "Unknown";

      const yearStr = extractTag(article, "Year") ?? extractTag(article, "PubDate") ?? "";
      const yearMatch = yearStr.match(/\d{4}/);
      const publicationYear = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();

      const doi = extractArticleId(article, "doi");
      const pmc = extractArticleId(article, "pmc");
      const openAccessUrl = pmc ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc}/` : null;

      if (!abstractText || abstractText.length < 50) continue;

      papers.push({ pmid, title, authors, journal, publicationYear, doi, abstract: abstractText, openAccessUrl });
    } catch (err) {
      logger.warn({ err }, "Failed to parse PubMed article XML");
    }
  }

  if (papers.length === 0 && pmids.length > 0) {
    logger.warn({ pmids }, "No papers parsed from PubMed XML response; XML may be malformed or empty");
  }

  return papers;
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : null;
}

function extractAbstract(article: string): string {
  const abstractSection = article.match(/<Abstract>([\s\S]*?)<\/Abstract>/i);
  if (!abstractSection) return "";
  const texts = [...abstractSection[1].matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi)];
  if (texts.length > 0) return texts.map(t => stripTags(t[1])).join(" ").trim();
  return stripTags(abstractSection[1]).trim();
}

function extractArticleId(article: string, idType: string): string | null {
  const pattern = new RegExp(`<ArticleId IdType="${idType}"[^>]*>([^<]+)<\\/ArticleId>`, "i");
  const m = article.match(pattern);
  return m ? m[1].trim() : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
