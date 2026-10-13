# Remote Job Source Directory

This page is a curated 50-source reference directory, not a list of working integrations. The canonical catalog currently contains 90 names in [`server/scrapers/platformCatalog.ts`](server/scrapers/platformCatalog.ts) and [`server/scrapers/regionalPlatforms.ts`](server/scrapers/regionalPlatforms.ts).

## Overview

At this checkout, 52 adapter factories are registered (14 dedicated, 36 generic HTML, and 2 generic RSS), but only nine sources have an explicit policy allowing unattended API/RSS discovery. A registered adapter or catalog entry does not mean that the source is currently reachable, contractually approved, or being polled. The job-discovery scheduler is disabled by default; live source status must be read from runtime source-health records.

Sources without an approved public ingestion contract remain manual or unavailable. Do not bypass access controls, account restrictions, rate limits, attribution requirements, or provider terms. For example, Working Nomads is held from unattended ingestion pending written authorization under its published Terms of Service section 3.1(d): [Terms of Service](https://www.workingnomads.com/terms-and-conditions).

Hire.AI does not currently cover every remote job platform worldwide. The source catalog is an inventory of known sources, not a coverage guarantee.
The tier groupings and short descriptions below are editorial reference notes; they are not a verified statement of current platform features or source health.

---

## Tier 1: Major General Remote Job Boards (6 platforms)

These are the largest and most established remote job platforms with extensive listings across all industries.

| Platform | URL | Category | Key Features |
|----------|-----|----------|--------------|
| **FlexJobs** | https://www.flexjobs.com/ | General | Hand-screened jobs, no ads, subscription-based |
| **We Work Remotely** | https://weworkremotely.com/ | General | Large community, diverse categories |
| **Remote.co** | https://remote.co/ | General | Curated listings, company profiles |
| **RemoteOK** | https://remoteok.com/ | General | Real-time updates, salary transparency |
| **Indeed** | https://www.indeed.com/ | General | Largest job board, advanced filters |
| **LinkedIn Jobs** | https://www.linkedin.com/jobs/ | General | Professional network integration |

---

## Tier 2: Specialized Remote Job Boards (9 platforms)

Focused remote job boards with strong communities and quality listings.

| Platform | URL | Category | Key Features |
|----------|-----|----------|--------------|
| **Remotive** | https://remotive.io/ | General | Newsletter, community, resources |
| **JustRemote** | https://justremote.co/ | General | Clean interface, global focus |
| **Jobspresso** | https://jobspresso.co/ | General | Curated daily, quality over quantity |
| **Working Nomads** | https://workingnomads.com/ | General | Manual only until written authorization: its Terms of Service section 3.1(d) prohibits using the service to build a competitive product |
| **NoDesk** | https://nodesk.co/ | General | Remote work resources, job board |
| **Remotive.com** | https://remotive.com/ | General | Community-driven, remote culture |
| **Pangian** | https://pangian.com/ | Diversity | Global diversity focus |
| **Virtual Vocations** | https://virtualvocations.com/ | General | Telecommute jobs, career resources |
| **Skip The Drive** | https://www.skipthedrive.com/ | General | US-focused, diverse industries |

---

## Tier 3: Industry-Specific Remote Boards (10 platforms)

Platforms specialized for specific industries or skill sets.

### Tech & Development
| Platform | URL | Category | Key Features |
|----------|-----|----------|--------------|
| **Arc** | https://arc.dev/ | Tech | Developer-focused, vetted talent |
| **Gun.io** | https://gun.io/ | Tech | Freelance developers, high-quality |
| **Stack Overflow Jobs** | https://stackoverflow.com/jobs/ | Tech | Developer community integration |
| **Built In** | https://builtin.com/ | Tech | Tech hubs, startup focus |
| **Crossover** | https://www.crossover.com/ | Tech | Full-time remote tech roles |

### Design & Creative
| Platform | URL | Category | Key Features |
|----------|-----|----------|--------------|
| **Behance** | https://www.behance.net/ | Design | Creative portfolio platform |
| **Dribbble** | https://dribbble.com/ | Design | Designer community, job board |
| **Creativepool** | https://creativepool.com/ | Design | Creative industry focus |

### Writing & Content
| Platform | URL | Category | Key Features |
|----------|-----|----------|--------------|
| **ProBlogger** | https://problogger.com/ | Writing | Blogging and writing jobs |

### Startups
| Platform | URL | Category | Key Features |
|----------|-----|----------|--------------|
| **Wellfound** | https://wellfound.com/ | Startups | Startup jobs, equity information |

---

## Tier 4: Niche and Emerging Platforms (25 platforms)

Specialized platforms for specific markets, regions, or demographics.

### High-Paying & Premium
| Platform | URL | Category |
|----------|-----|----------|
| **Remote100K** | https://remote100k.com/ | High-Paying |

### General Remote
| Platform | URL | Category |
|----------|-----|----------|
| **Jobgether** | https://jobgether.com/ | General |
| **Remotive.io** | https://remotive.io/ | General |
| **Snaphunt** | https://snaphunt.com/ | General |
| **Remote.com** | https://remote.com/ | General |
| **HiringCafe** | https://hiringcafe.com/ | General |
| **DailyRemote** | https://dailyremote.com/ | General |
| **The Muse** | https://www.themuse.com/ | General |
| **Workster** | https://workster.co/ | General |
| **Workew** | https://workew.com/ | General |
| **Remoters** | https://remoters.net/ | General |
| **Still Hiring Today** | https://stillhiring.today/ | General |
| **Dynamite Jobs** | https://dynamitejobs.com/ | General |
| **Citizen Remote** | https://citizenremote.com/ | General |
| **Open To Work Remote** | https://opentoworkremote.com/ | General |

### Creative & Freelance
| Platform | URL | Category |
|----------|-----|----------|
| **Contra** | https://contra.com/ | Creative |

### Diversity & Inclusion
| Platform | URL | Category |
|----------|-----|----------|
| **PowerToFly** | https://powertofly.com/ | Diversity |
| **Inclusively Remote** | https://inclusivelyremote.com/ | Diversity |

### Regional Focus
| Platform | URL | Category |
|----------|-----|----------|
| **EU Remote Jobs** | https://euremotejobs.com/ | Europe |
| **JobRack** | https://jobrack.com/ | Eastern Europe |

### Specialized Industries
| Platform | URL | Category |
|----------|-----|----------|
| **Remote Healthcare Jobs** | https://remotehealthcarejobs.com/ | Healthcare |
| **SEO Jobs** | https://seojobs.com/ | Marketing |
| **Dice** | https://www.dice.com/ | Tech |

### Lifestyle & Niche
| Platform | URL | Category |
|----------|-----|----------|
| **Remote Nomad Jobs** | https://remotenomadjobs.com/ | Digital Nomads |
| **Outsourcely** | https://www.outsourcely.com/ | Outsourcing |

---

## Source Status

- **Catalogued names**: 90. This is not the number of sources being scraped.
- **Registered adapters**: 52. Generic parser registrations are not proof of a working or authorized source.
- **Allowed unattended discovery**: 9 public API/RSS sources, subject to their individual poll and attribution policies.
- **Default scheduler state**: disabled (`JOB_SCRAPING_SCHEDULER_ENABLED=false`).
- **Unavailable sources**: explicitly excluded when discontinued.
- **Other sources**: manual until a suitable approved ingestion contract and adapter are available.

The tables above are a 50-name curated reference and may not reflect all 90 canonical catalog records. Use runtime source-health results for observed availability and the source catalog for current policy; neither establishes universal job-market coverage.

**Status checked**: 2026-10-09. Source policies and terms can change; recheck before enabling a feed.
