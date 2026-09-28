interface ReadabilityArticle {
  title: string | null;
  content: string;
  textContent: string;
  length: number;
  excerpt: string | null;
  lang: string | null;
}

declare class Readability {
  constructor(document: Document, options?: { charThreshold?: number; maxElemsToParse?: number; keepClasses?: boolean });
  parse(): ReadabilityArticle | null;
}

export default Readability;
