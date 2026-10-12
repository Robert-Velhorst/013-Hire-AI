/**
 * Job Data Normalization and Advanced Deduplication Service
 * Handles salary normalization, location standardization, and TF-IDF similarity detection
 */

import { isKnownSalaryCurrency } from "../shared/salaryCurrency";

// ============================================================================
// SALARY NORMALIZATION
// ============================================================================

export interface NormalizedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "yearly" | "monthly" | "hourly" | "weekly";
  normalizedYearly: { min: number | null; max: number | null };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "£": "GBP",
  "€": "EUR",
  "¥": "JPY",
  "₹": "INR",
  "A$": "AUD",
  "C$": "CAD",
  "CHF": "CHF",
  "kr": "SEK",
  "R$": "BRL",
};

const PERIOD_MULTIPLIERS: Record<string, number> = {
  hourly: 2080, // 40 hours * 52 weeks
  weekly: 52,
  monthly: 12,
  yearly: 1,
};

function parseSalaryNumber(token: string): number | null {
  const compact = token.replace(/\s/g, "");
  const suffix = compact.match(/[km]$/i)?.[0].toLowerCase();
  const value = suffix ? compact.slice(0, -1) : compact;
  let normalized = value;

  // Keep locale-formatted thousands intact: 60.000, 60,000, and 60 000
  // all mean sixty thousand, while 1.234,50 is a decimal salary amount.
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(value)) {
    normalized = value.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(value)) {
    normalized = value.replace(/,/g, "");
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(value)) {
    normalized = value.replace(/[.,]/g, "");
  } else if (/^\d+(?:,\d+)?$/.test(value)) {
    normalized = value.replace(",", ".");
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;

  if (suffix === "k") return parsed * 1_000;
  if (suffix === "m") return parsed * 1_000_000;
  return parsed;
}

function extractSalaryValues(text: string): number[] {
  const tokens = text.match(/\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?(?:\s*[km])?/gi) || [];
  return tokens
    .map((token) => parseSalaryNumber(token))
    .filter((value): value is number => value !== null);
}

function detectCurrency(text: string) {
  const explicitCode = text.match(/\b([a-z]{3})\b/i)?.[1]?.toUpperCase();
  if (explicitCode && isKnownSalaryCurrency(explicitCode)) return explicitCode;

  const symbol = Object.entries(CURRENCY_SYMBOLS)
    .sort(([left], [right]) => right.length - left.length)
    .find(([candidate]) => text.includes(candidate.toLowerCase()));
  return symbol?.[1] || null;
}

export function normalizeSalary(salaryString: string | null | undefined): NormalizedSalary {
  const result: NormalizedSalary = {
    min: null,
    max: null,
    currency: null,
    period: "yearly",
    normalizedYearly: { min: null, max: null },
  };

  if (!salaryString) return result;

  const text = salaryString.toLowerCase().trim();

  result.currency = detectCurrency(text);

  // Detect period
  if (text.includes("/hr") || text.includes("per hour") || text.includes("hourly") || text.includes("/hour") || /\bhours?\b/.test(text)) {
    result.period = "hourly";
  } else if (text.includes("/wk") || text.includes("per week") || text.includes("weekly") || text.includes("/week") || /\bweeks?\b/.test(text)) {
    result.period = "weekly";
  } else if (text.includes("/mo") || text.includes("per month") || text.includes("monthly") || text.includes("/month") || /\bmonths?\b/.test(text)) {
    result.period = "monthly";
  } else {
    result.period = "yearly";
  }

  const values = extractSalaryValues(text);
  if (values.length === 1) {
    result.min = values[0];
    result.max = values[0];
  } else if (values.length >= 2) {
    result.min = Math.min(values[0], values[1]);
    result.max = Math.max(values[0], values[1]);
  }

  // Normalize to yearly
  const multiplier = PERIOD_MULTIPLIERS[result.period];
  result.normalizedYearly = {
    min: result.min ? result.min * multiplier : null,
    max: result.max ? result.max * multiplier : null,
  };

  return result;
}

// ============================================================================
// LOCATION NORMALIZATION
// ============================================================================

export interface NormalizedLocation {
  city: string | null;
  state: string | null;
  country: string;
  region: string;
  isRemote: boolean;
  remoteType: "fully_remote" | "hybrid" | "onsite" | "unknown";
  timezone: string | null;
}

const COUNTRY_ALIASES: Record<string, string> = {
  "usa": "United States",
  "us": "United States",
  "united states": "United States",
  "united states of america": "United States",
  "uk": "United Kingdom",
  "gb": "United Kingdom",
  "united kingdom": "United Kingdom",
  "great britain": "United Kingdom",
  "england": "United Kingdom",
  "de": "Germany",
  "germany": "Germany",
  "deutschland": "Germany",
  "fr": "France",
  "france": "France",
  "ca": "Canada",
  "canada": "Canada",
  "au": "Australia",
  "australia": "Australia",
  "nz": "New Zealand",
  "new zealand": "New Zealand",
  "in": "India",
  "india": "India",
  "sg": "Singapore",
  "singapore": "Singapore",
  "jp": "Japan",
  "japan": "Japan",
  "nl": "Netherlands",
  "netherlands": "Netherlands",
  "holland": "Netherlands",
  "ie": "Ireland",
  "ireland": "Ireland",
  "es": "Spain",
  "spain": "Spain",
  "it": "Italy",
  "italy": "Italy",
  "pt": "Portugal",
  "portugal": "Portugal",
  "br": "Brazil",
  "brazil": "Brazil",
  "mx": "Mexico",
  "mexico": "Mexico",
  "ar": "Argentina",
  "argentina": "Argentina",
  "pl": "Poland",
  "poland": "Poland",
  "cz": "Czech Republic",
  "czechia": "Czech Republic",
  "czech republic": "Czech Republic",
  "se": "Sweden",
  "sweden": "Sweden",
  "no": "Norway",
  "norway": "Norway",
  "dk": "Denmark",
  "denmark": "Denmark",
  "fi": "Finland",
  "finland": "Finland",
  "ch": "Switzerland",
  "switzerland": "Switzerland",
  "at": "Austria",
  "austria": "Austria",
  "be": "Belgium",
  "belgium": "Belgium",
};

function containsLocationAlias(text: string, alias: string) {
  const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escapedAlias}(?:$|[^a-z0-9])`, "i").test(text);
}

const US_STATES: Record<string, string> = {
  "al": "Alabama", "ak": "Alaska", "az": "Arizona", "ar": "Arkansas",
  "ca": "California", "co": "Colorado", "ct": "Connecticut", "de": "Delaware",
  "fl": "Florida", "ga": "Georgia", "hi": "Hawaii", "id": "Idaho",
  "il": "Illinois", "in": "Indiana", "ia": "Iowa", "ks": "Kansas",
  "ky": "Kentucky", "la": "Louisiana", "me": "Maine", "md": "Maryland",
  "ma": "Massachusetts", "mi": "Michigan", "mn": "Minnesota", "ms": "Mississippi",
  "mo": "Missouri", "mt": "Montana", "ne": "Nebraska", "nv": "Nevada",
  "nh": "New Hampshire", "nj": "New Jersey", "nm": "New Mexico", "ny": "New York",
  "nc": "North Carolina", "nd": "North Dakota", "oh": "Ohio", "ok": "Oklahoma",
  "or": "Oregon", "pa": "Pennsylvania", "ri": "Rhode Island", "sc": "South Carolina",
  "sd": "South Dakota", "tn": "Tennessee", "tx": "Texas", "ut": "Utah",
  "vt": "Vermont", "va": "Virginia", "wa": "Washington", "wv": "West Virginia",
  "wi": "Wisconsin", "wy": "Wyoming", "dc": "District of Columbia",
};

const REGION_MAPPING: Record<string, string> = {
  "United States": "North America",
  "Canada": "North America",
  "Mexico": "North America",
  "United Kingdom": "Europe",
  "Germany": "Europe",
  "France": "Europe",
  "Netherlands": "Europe",
  "Ireland": "Europe",
  "Spain": "Europe",
  "Italy": "Europe",
  "Portugal": "Europe",
  "Poland": "Europe",
  "Czech Republic": "Europe",
  "Sweden": "Europe",
  "Norway": "Europe",
  "Denmark": "Europe",
  "Finland": "Europe",
  "Switzerland": "Europe",
  "Austria": "Europe",
  "Belgium": "Europe",
  "Australia": "Oceania",
  "New Zealand": "Oceania",
  "India": "Asia",
  "Singapore": "Asia",
  "Japan": "Asia",
  "China": "Asia",
  "South Korea": "Asia",
  "Brazil": "South America",
  "Argentina": "South America",
  "Colombia": "South America",
  "Chile": "South America",
};

export function normalizeLocation(locationString: string | null | undefined): NormalizedLocation {
  const result: NormalizedLocation = {
    city: null,
    state: null,
    country: "Unknown",
    region: "Unknown",
    isRemote: false,
    remoteType: "unknown",
    timezone: null,
  };

  if (!locationString) return result;

  const text = locationString.toLowerCase().trim();

  // Detect remote type
  if (text.includes("fully remote") || text.includes("100% remote") || text.includes("remote only")) {
    result.remoteType = "fully_remote";
    result.isRemote = true;
  } else if (text.includes("hybrid") || text.includes("part remote") || text.includes("flexible")) {
    result.remoteType = "hybrid";
    result.isRemote = true;
  } else if (text.includes("onsite") || text.includes("on-site") || text.includes("in office") || text.includes("in-office")) {
    result.remoteType = "onsite";
    result.isRemote = false;
  } else if (text.includes("remote")) {
    result.remoteType = "fully_remote";
    result.isRemote = true;
  }

  // Check for worldwide/anywhere
  if (text.includes("worldwide") || text.includes("anywhere") || text.includes("global") || text === "remote") {
    result.country = "Worldwide";
    result.region = "Global";
    return result;
  }

  // Detect country
  for (const [alias, country] of Object.entries(COUNTRY_ALIASES)
    .sort(([left], [right]) => right.length - left.length)) {
    if (containsLocationAlias(text, alias)) {
      result.country = country;
      result.region = REGION_MAPPING[country] || "Other";
      break;
    }
  }

  // Detect US state
  if (result.country === "United States" || result.country === "Worldwide") {
    for (const [abbr, state] of Object.entries(US_STATES)) {
      const statePattern = new RegExp(`\\b${abbr}\\b|\\b${state.toLowerCase()}\\b`);
      if (statePattern.test(text)) {
        result.state = state;
        result.country = "United States";
        result.region = "North America";
        break;
      }
    }
  }

  // Extract city (first capitalized word before comma or state)
  const cityMatch = locationString.match(/^([A-Z][a-zA-Z\s]+?)(?:,|\s+[A-Z]{2}\b)/);
  if (cityMatch) {
    result.city = cityMatch[1].trim();
  }

  return result;
}

// ============================================================================
// JOB TYPE NORMALIZATION
// ============================================================================

export type NormalizedJobType = "full_time" | "part_time" | "contract" | "freelance" | "internship" | "temporary" | "unknown";

export function normalizeJobType(jobTypeString: string | null | undefined): NormalizedJobType {
  if (!jobTypeString) return "unknown";

  const text = jobTypeString.toLowerCase().trim();

  if (text.includes("full-time") || text.includes("full time") || text.includes("fulltime") || text.includes("permanent")) {
    return "full_time";
  }
  if (text.includes("part-time") || text.includes("part time") || text.includes("parttime")) {
    return "part_time";
  }
  if (text.includes("contract") || text.includes("contractor") || text.includes("fixed-term")) {
    return "contract";
  }
  if (text.includes("freelance") || text.includes("freelancer") || text.includes("gig")) {
    return "freelance";
  }
  if (text.includes("intern") || text.includes("internship") || text.includes("trainee")) {
    return "internship";
  }
  if (text.includes("temporary") || text.includes("temp") || text.includes("seasonal")) {
    return "temporary";
  }

  return "unknown";
}

// ============================================================================
// EXPERIENCE LEVEL NORMALIZATION
// ============================================================================

export type NormalizedExperienceLevel = "entry" | "junior" | "mid" | "senior" | "lead" | "executive" | "unknown";

export function normalizeExperienceLevel(text: string | null | undefined): NormalizedExperienceLevel {
  if (!text) return "unknown";

  const lower = text.toLowerCase();

  if (
    lower.includes("entry") ||
    lower.includes("graduate") ||
    lower.includes("new grad") ||
    lower.includes("intern") ||
    lower.includes("0-1") ||
    lower.includes("no experience")
  ) {
    return "entry";
  }
  if (lower.includes("junior") || lower.includes("jr") || lower.includes("1-2") || lower.includes("1-3")) {
    return "junior";
  }
  if (lower.includes("mid") || lower.includes("intermediate") || lower.includes("3-5") || lower.includes("2-4")) {
    return "mid";
  }
  if (lower.includes("senior") || lower.includes("sr") || lower.includes("5+") || lower.includes("5-7") || lower.includes("experienced")) {
    return "senior";
  }
  if (lower.includes("lead") || lower.includes("principal") || lower.includes("staff") || lower.includes("7+") || lower.includes("8+")) {
    return "lead";
  }
  if (lower.includes("executive") || lower.includes("director") || lower.includes("vp") || lower.includes("c-level") || lower.includes("chief")) {
    return "executive";
  }

  return "unknown";
}

// ============================================================================
// TF-IDF SIMILARITY DETECTION
// ============================================================================

interface TFIDFDocument {
  id: number;
  terms: Map<string, number>;
  magnitude: number;
}

class TFIDFDeduplicator {
  private documents: TFIDFDocument[] = [];
  private idf: Map<string, number> = new Map();
  private totalDocs = 0;

  /**
   * Tokenize and clean text
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .filter((word) => !this.isStopWord(word));
  }

  /**
   * Check if word is a stop word
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
      "be", "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "must", "shall", "can", "need",
      "this", "that", "these", "those", "it", "its", "they", "them", "their",
      "we", "our", "you", "your", "he", "she", "him", "her", "his", "hers",
      "who", "what", "where", "when", "why", "how", "which", "whom", "whose",
      "all", "each", "every", "both", "few", "more", "most", "other", "some",
      "such", "no", "not", "only", "own", "same", "so", "than", "too", "very",
      "just", "also", "now", "here", "there", "then", "once", "if", "because",
      "about", "into", "through", "during", "before", "after", "above", "below",
      "between", "under", "again", "further", "while", "job", "work", "working",
      "position", "role", "opportunity", "looking", "seeking", "hiring", "join",
      "team", "company", "experience", "years", "required", "requirements",
    ]);
    return stopWords.has(word);
  }

  /**
   * Calculate term frequency
   */
  private calculateTF(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    const totalTerms = tokens.length;

    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // Normalize by total terms
    Array.from(tf.entries()).forEach(([term, count]) => {
      tf.set(term, count / totalTerms);
    });

    return tf;
  }

  /**
   * Update IDF values
   */
  private updateIDF(): void {
    const docFreq = new Map<string, number>();

    for (const doc of this.documents) {
      Array.from(doc.terms.keys()).forEach((term) => {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      });
    }

    this.idf.clear();
    Array.from(docFreq.entries()).forEach(([term, freq]) => {
      this.idf.set(term, Math.log(this.totalDocs / freq));
    });
  }

  /**
   * Calculate TF-IDF vector magnitude
   */
  private calculateMagnitude(tfidf: Map<string, number>): number {
    let sum = 0;
    Array.from(tfidf.values()).forEach((value) => {
      sum += value * value;
    });
    return Math.sqrt(sum);
  }

  /**
   * Add a document to the corpus
   */
  addDocument(id: number, text: string): void {
    const tokens = this.tokenize(text);
    const tf = this.calculateTF(tokens);

    this.documents.push({
      id,
      terms: tf,
      magnitude: 0,
    });
    this.totalDocs++;

    // Recalculate IDF periodically (every 100 docs for performance)
    if (this.totalDocs % 100 === 0) {
      this.updateIDF();
      this.recalculateMagnitudes();
    }
  }

  /**
   * Recalculate all document magnitudes
   */
  private recalculateMagnitudes(): void {
    for (const doc of this.documents) {
      const tfidf = new Map<string, number>();
      Array.from(doc.terms.entries()).forEach(([term, tf]) => {
        const idf = this.idf.get(term) || 0;
        tfidf.set(term, tf * idf);
      });
      doc.magnitude = this.calculateMagnitude(tfidf);
    }
  }

  /**
   * Calculate cosine similarity between two documents
   */
  calculateSimilarity(doc1: TFIDFDocument, doc2: TFIDFDocument): number {
    if (doc1.magnitude === 0 || doc2.magnitude === 0) return 0;

    let dotProduct = 0;

    Array.from(doc1.terms.entries()).forEach(([term, tf1]) => {
      const tf2 = doc2.terms.get(term);
      if (tf2) {
        const idf = this.idf.get(term) || 0;
        dotProduct += (tf1 * idf) * (tf2 * idf);
      }
    });

    return dotProduct / (doc1.magnitude * doc2.magnitude);
  }

  /**
   * Find similar documents for a given text
   */
  findSimilar(text: string, threshold = 0.7): Array<{ id: number; similarity: number }> {
    // Ensure IDF is up to date
    if (this.documents.length > 0 && this.idf.size === 0) {
      this.updateIDF();
      this.recalculateMagnitudes();
    }

    const tokens = this.tokenize(text);
    const tf = this.calculateTF(tokens);

    const tfidf = new Map<string, number>();
    Array.from(tf.entries()).forEach(([term, tfVal]) => {
      const idf = this.idf.get(term) || 0;
      tfidf.set(term, tfVal * idf);
    });

    const magnitude = this.calculateMagnitude(tfidf);
    if (magnitude === 0) return [];

    const queryDoc: TFIDFDocument = { id: -1, terms: tf, magnitude };

    const similar: Array<{ id: number; similarity: number }> = [];

    for (const doc of this.documents) {
      const similarity = this.calculateSimilarity(queryDoc, doc);
      if (similarity >= threshold) {
        similar.push({ id: doc.id, similarity });
      }
    }

    return similar.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Check if a job is a duplicate
   */
  isDuplicate(text: string, threshold = 0.85): { isDuplicate: boolean; matchedId: number | null; similarity: number } {
    const similar = this.findSimilar(text, threshold);
    
    if (similar.length > 0) {
      return {
        isDuplicate: true,
        matchedId: similar[0].id,
        similarity: similar[0].similarity,
      };
    }

    return { isDuplicate: false, matchedId: null, similarity: 0 };
  }

  /**
   * Get corpus statistics
   */
  getStats(): { totalDocs: number; uniqueTerms: number } {
    return {
      totalDocs: this.totalDocs,
      uniqueTerms: this.idf.size,
    };
  }

  /**
   * Clear the corpus
   */
  clear(): void {
    this.documents = [];
    this.idf.clear();
    this.totalDocs = 0;
  }
}

// Singleton instance
let deduplicatorInstance: TFIDFDeduplicator | null = null;

export function getDeduplicator(): TFIDFDeduplicator {
  if (!deduplicatorInstance) {
    deduplicatorInstance = new TFIDFDeduplicator();
  }
  return deduplicatorInstance;
}

// ============================================================================
// FULL JOB NORMALIZATION
// ============================================================================

export interface NormalizedJob {
  title: string;
  company: string;
  description: string;
  salary: NormalizedSalary;
  location: NormalizedLocation;
  jobType: NormalizedJobType;
  experienceLevel: NormalizedExperienceLevel;
  skills: string[];
  benefits: string[];
  postedDate: Date | null;
  applicationUrl: string;
  sourceUrl: string;
  platform: string;
  externalId: string;
  deduplicationHash: string;
}

/**
 * Extract skills from job description
 */
export function extractSkills(description: string): string[] {
  const skillPatterns = [
    // Programming languages
    /\b(javascript|typescript|python|java|c\+\+|c#|ruby|go|golang|rust|php|swift|kotlin|scala|r)\b/gi,
    // Frameworks
    /\b(react|angular|vue|node\.?js|express|django|flask|spring|rails|laravel|next\.?js|nuxt)\b/gi,
    // Databases
    /\b(sql|mysql|postgresql|postgres|mongodb|redis|elasticsearch|dynamodb|firebase|oracle)\b/gi,
    // Cloud
    /\b(aws|azure|gcp|google cloud|docker|kubernetes|k8s|terraform|jenkins|ci\/cd)\b/gi,
    // Tools
    /\b(git|github|gitlab|jira|confluence|figma|sketch|photoshop|illustrator)\b/gi,
    // Concepts
    /\b(agile|scrum|devops|machine learning|ml|ai|data science|analytics|api|rest|graphql)\b/gi,
  ];

  const skills = new Set<string>();

  for (const pattern of skillPatterns) {
    const matches = description.match(pattern);
    if (matches) {
      matches.forEach((match) => skills.add(match.toLowerCase()));
    }
  }

  return Array.from(skills);
}

/**
 * Extract benefits from job description
 */
export function extractBenefits(description: string): string[] {
  const benefitPatterns = [
    /\b(health insurance|medical|dental|vision)\b/gi,
    /\b(401k|401\(k\)|retirement|pension)\b/gi,
    /\b(pto|paid time off|vacation|holidays)\b/gi,
    /\b(remote work|work from home|wfh|flexible|hybrid)\b/gi,
    /\b(equity|stock options|rsu|shares)\b/gi,
    /\b(bonus|commission|profit sharing)\b/gi,
    /\b(parental leave|maternity|paternity)\b/gi,
    /\b(professional development|learning budget|education)\b/gi,
    /\b(gym|wellness|fitness)\b/gi,
    /\b(lunch|meals|snacks|catering)\b/gi,
  ];

  const benefits = new Set<string>();

  for (const pattern of benefitPatterns) {
    const matches = description.match(pattern);
    if (matches) {
      matches.forEach((match) => benefits.add(match.toLowerCase()));
    }
  }

  return Array.from(benefits);
}

/**
 * Generate deduplication hash
 */
export function generateDeduplicationHash(job: {
  title: string;
  company: string;
  description: string;
}): string {
  const normalized = `${job.title.toLowerCase().trim()}|${job.company.toLowerCase().trim()}|${job.description.substring(0, 500).toLowerCase().trim()}`;
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return Math.abs(hash).toString(36);
}

/**
 * Normalize a raw job object
 */
export function normalizeJob(rawJob: {
  title?: string;
  company?: string;
  description?: string;
  salary?: string;
  location?: string;
  jobType?: string;
  experienceLevel?: string;
  postedDate?: string | Date;
  applicationUrl?: string;
  sourceUrl?: string;
  platform?: string;
  externalId?: string;
}): NormalizedJob {
  const title = rawJob.title?.trim() || "Unknown Position";
  const company = rawJob.company?.trim() || "Unknown Company";
  const description = rawJob.description?.trim() || "";

  return {
    title,
    company,
    description,
    salary: normalizeSalary(rawJob.salary),
    location: normalizeLocation(rawJob.location),
    jobType: normalizeJobType(rawJob.jobType),
    experienceLevel: normalizeExperienceLevel(rawJob.experienceLevel || rawJob.title),
    skills: extractSkills(description),
    benefits: extractBenefits(description),
    postedDate: rawJob.postedDate ? new Date(rawJob.postedDate) : null,
    applicationUrl: rawJob.applicationUrl || "",
    sourceUrl: rawJob.sourceUrl || "",
    platform: rawJob.platform || "unknown",
    externalId: rawJob.externalId || "",
    deduplicationHash: generateDeduplicationHash({ title, company, description }),
  };
}
