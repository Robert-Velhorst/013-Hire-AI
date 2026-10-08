export type SourceRegion =
  | "global"
  | "europe"
  | "north_america"
  | "latin_america"
  | "asia"
  | "middle_east"
  | "africa"
  | "oceania"
  | "unknown";

export interface SourceGeography {
  region: SourceRegion;
  countries: string[];
  languages: string[];
  evidenceUrl: string | null;
  reviewedAt: string | null;
  verification: "directory_reviewed" | "candidate" | "legacy";
}

// Geographic coverage is a discovery scope, never a candidate's work eligibility.
// A homepage review verifies the directory entry, not remote inventory or collection permission.
const regionalEntries: Array<
  [string, string, SourceRegion, string[], string[], boolean]
> = [
  ["Himalayas", "https://himalayas.app/", "global", [], ["en"], true],
  [
    "Arbeitnow UK",
    "https://www.arbeitnow.co.uk/",
    "europe",
    ["GB"],
    ["en"],
    true,
  ],
  [
    "Nationale Vacaturebank",
    "https://www.nationalevacaturebank.nl/",
    "europe",
    ["NL"],
    ["nl"],
    true,
  ],
  ["Werk.nl", "https://www.werk.nl/", "europe", ["NL"], ["nl"], false],
  ["VDAB", "https://www.vdab.be/", "europe", ["BE"], ["nl"], true],
  ["EURES", "https://eures.europa.eu/index_en", "europe", [], [], true],
  ["Reed", "https://www.reed.co.uk/", "europe", ["GB"], ["en"], true],
  [
    "HelloWork",
    "https://www.hellowork.com/fr-fr/",
    "europe",
    ["FR"],
    ["fr"],
    true,
  ],
  ["Pracuj.pl", "https://www.pracuj.pl/", "europe", ["PL"], ["pl"], true],
  [
    "StepStone Germany",
    "https://www.stepstone.de/",
    "europe",
    ["DE"],
    ["de"],
    true,
  ],
  [
    "InfoJobs Spain",
    "https://www.infojobs.net/",
    "europe",
    ["ES"],
    ["es"],
    false,
  ],
  [
    "jobs.ch",
    "https://www.jobs.ch/en/",
    "europe",
    ["CH"],
    ["de", "fr", "en"],
    true,
  ],
  [
    "Job Bank Canada",
    "https://www.jobbank.gc.ca/",
    "north_america",
    ["CA"],
    ["en", "fr"],
    false,
  ],
  [
    "USAJOBS",
    "https://www.usajobs.gov/",
    "north_america",
    ["US"],
    ["en"],
    true,
  ],
  [
    "Get on Board",
    "https://www.getonbrd.com/",
    "latin_america",
    [],
    ["es", "en"],
    true,
  ],
  [
    "Computrabajo",
    "https://www.computrabajo.com/",
    "latin_america",
    [],
    ["es", "pt"],
    true,
  ],
  [
    "Catho",
    "https://www.catho.com.br/",
    "latin_america",
    ["BR"],
    ["pt"],
    false,
  ],
  ["SEEK Australia", "https://au.seek.com/", "oceania", ["AU"], ["en"], true],
  ["SEEK New Zealand", "https://nz.seek.com/", "oceania", ["NZ"], ["en"], true],
  [
    "Jobstreet",
    "https://www.jobstreet.com/",
    "asia",
    ["SG", "MY", "PH", "ID"],
    [],
    true,
  ],
  ["Naukri", "https://www.naukri.com/", "asia", ["IN"], ["en"], false],
  ["TokyoDev", "https://www.tokyodev.com/", "asia", ["JP"], ["en"], true],
  ["Cake", "https://www.cake.me/", "asia", ["TW"], ["en", "zh"], true],
  ["Bayt", "https://www.bayt.com/", "middle_east", [], ["en", "ar"], true],
  [
    "GulfTalent",
    "https://www.gulftalent.com/",
    "middle_east",
    [],
    ["en"],
    true,
  ],
  [
    "BrighterMonday Kenya",
    "https://www.brightermonday.co.ke/",
    "africa",
    ["KE"],
    ["en"],
    true,
  ],
  [
    "Jobberman Nigeria",
    "https://www.jobberman.com/",
    "africa",
    ["NG"],
    ["en"],
    true,
  ],
  ["Pnet", "https://www.pnet.co.za/", "africa", ["ZA"], ["en"], true],
];

export const regionalPlatformSeeds = regionalEntries.map(([name, url]) => ({
  name,
  url,
  tier: "tier4" as const,
  category: "Regional",
}));

const geography = new Map<string, SourceGeography>(
  regionalEntries.map(([name, url, region, countries, languages, reviewed]) => [
    name,
    {
      region,
      countries,
      languages,
      evidenceUrl:
        name === "Himalayas"
          ? "https://himalayas.app/api"
          : name === "Arbeitnow UK"
            ? "https://www.arbeitnow.com/blog/job-board-api"
            : url,
      reviewedAt: reviewed ? "2026-09-04" : null,
      verification: reviewed ? "directory_reviewed" : "candidate",
    },
  ])
);

for (const name of [
  "RemoteOK",
  "We Work Remotely",
  "Remotive",
  "Jobicy",
  "NoDesk",
  "ProBlogger",
]) {
  geography.set(name, {
    region: "global",
    countries: [],
    languages: ["en"],
    evidenceUrl: null,
    reviewedAt: null,
    verification: "legacy",
  });
}
geography.set("Arbeitnow", {
  region: "europe",
  countries: ["DE"],
  languages: ["en", "de"],
  evidenceUrl: "https://www.arbeitnow.com/blog/job-board-api",
  reviewedAt: "2026-09-04",
  verification: "directory_reviewed",
});

export function getSourceGeography(name: string): SourceGeography {
  return (
    geography.get(name) ?? {
      region: "unknown",
      countries: [],
      languages: [],
      evidenceUrl: null,
      reviewedAt: null,
      verification: "legacy",
    }
  );
}
