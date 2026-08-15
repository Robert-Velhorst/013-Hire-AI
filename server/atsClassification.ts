export const ATS_TYPES = [
  "greenhouse",
  "lever",
  "workday",
  "taleo",
  "icims",
  "smartrecruiters",
  "bamboohr",
  "jobvite",
  "unknown",
] as const;

export type ATSType = typeof ATS_TYPES[number];

const ATS_DOMAINS: ReadonlyArray<readonly [ATSType, readonly string[]]> = [
  ["greenhouse", ["greenhouse.io"]],
  ["lever", ["lever.co"]],
  ["workday", ["workday.com", "myworkday.com", "myworkdayjobs.com"]],
  ["taleo", ["taleo.net", "taleo.com"]],
  ["icims", ["icims.com"]],
  ["smartrecruiters", ["smartrecruiters.com"]],
  ["bamboohr", ["bamboohr.com"]],
  ["jobvite", ["jobvite.com"]],
];

function isDomainOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function detectATSType(url: string): ATSType {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "unknown";
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    return "unknown";
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  for (const [atsType, domains] of ATS_DOMAINS) {
    if (domains.some((domain) => isDomainOrSubdomain(hostname, domain))) return atsType;
  }
  return "unknown";
}
