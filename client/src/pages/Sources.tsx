import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Globe2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Download,
  Search,
  AlertTriangle,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { getSafeExternalUrl } from "@/lib/externalUrl";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type Filters = inferRouterInputs<AppRouter>["platforms"]["directory"];
const PAGE_SIZE = 25;
const regions = [
  "global",
  "europe",
  "north_america",
  "latin_america",
  "asia",
  "middle_east",
  "africa",
  "oceania",
  "unknown",
] as const;
const modes = ["automated", "manual", "unavailable"] as const;
const states = [
  "success",
  "partial",
  "failed",
  "paused",
  "never_run",
  "not_initialized",
  "not_connected",
  "unavailable",
] as const;
const labels: Record<string, [string, string]> = {
  global: ["Global", "Wereldwijd"],
  europe: ["Europe", "Europa"],
  north_america: ["North America", "Noord-Amerika"],
  latin_america: ["Latin America", "Latijns-Amerika"],
  asia: ["Asia", "Azië"],
  middle_east: ["Middle East", "Midden-Oosten"],
  africa: ["Africa", "Afrika"],
  oceania: ["Oceania", "Oceanië"],
  unknown: ["Not classified", "Nog niet ingedeeld"],
  automated: ["Automatic collection", "Automatisch verzamelen"],
  manual: ["Integration needed", "Koppeling nodig"],
  unavailable: ["Unavailable", "Niet beschikbaar"],
  success: ["Last scan succeeded", "Laatste scan geslaagd"],
  partial: ["Partial result", "Gedeeltelijk resultaat"],
  failed: ["Last scan failed", "Laatste scan mislukt"],
  paused: ["Paused", "Gepauzeerd"],
  never_run: ["Not scanned yet", "Nog niet gescand"],
  not_initialized: ["Not initialized", "Nog niet geïnitialiseerd"],
  not_connected: ["Not connected", "Niet gekoppeld"],
  title: ["Title", "Functie"],
  company: ["Company", "Werkgever"],
  location: ["Location", "Locatie"],
  jobType: ["Contract type", "Contracttype"],
  salaryCurrency: ["Currency", "Valuta"],
  salaryMin: ["Minimum annual salary", "Minimumjaarsalaris"],
  salaryMax: ["Maximum annual salary", "Maximumjaarsalaris"],
  directory_reviewed: ["Directory checked", "Vermelding gecontroleerd"],
  candidate: ["To verify", "Nog te verifiëren"],
  legacy: ["Review outstanding", "Hercontrole open"],
};

function External({
  url,
  children,
}: {
  url: string | null;
  children: React.ReactNode;
}) {
  const safe = getSafeExternalUrl(url);
  return safe ? (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 break-words text-teal-300 underline-offset-4 hover:underline"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  ) : (
    <span>{children}</span>
  );
}

export default function Sources() {
  const { locale } = useLocale();
  const nl = locale === "nl";
  const copy = (en: string, dutch: string) => (nl ? dutch : en);
  const label = (key: string) => labels[key]?.[nl ? 1 : 0] ?? key;
  const [tab, setTab] = useState("directory");
  const [filters, setFilters] = useState<Filters>({
    limit: PAGE_SIZE,
    offset: 0,
  });
  const deferredFilters = useDeferredValue(filters);
  const directory = trpc.platforms.directory.useQuery(deferredFilters, {
    staleTime: 60_000,
  });
  const comparisons = trpc.platforms.comparisons.useInfiniteQuery(
    { limit: 20 },
    {
      enabled: tab === "comparisons",
      staleTime: 60_000,
      getNextPageParam: page => page.nextCursor ?? undefined,
    }
  );
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const pairs = useMemo(
    () => comparisons.data?.pages.flatMap(page => page.items) ?? [],
    [comparisons.data]
  );
  const visiblePairs = onlyDifferences
    ? pairs.filter(pair => pair.differences.length > 0)
    : pairs;
  const countries = useMemo(
    () => new Intl.DisplayNames([locale], { type: "region" }),
    [locale]
  );
  const languages = useMemo(
    () => new Intl.DisplayNames([locale], { type: "language" }),
    [locale]
  );
  const change = (value: Partial<Filters>) =>
    setFilters(current => ({ ...current, ...value, offset: 0 }));
  const date = (value: Date | null | undefined) =>
    value
      ? new Date(value).toLocaleString(locale)
      : copy("No recorded scan", "Geen scan vastgelegd");
  const data = directory.data;
  const busy = directory.isFetching || deferredFilters !== filters;
  const exportPage = () => {
    if (!data) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            scope: "filtered_page",
            filters: deferredFilters,
            ...data,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "hire-ai-source-page.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <DashboardLayout>
      <div className="min-w-0 bg-zinc-950 text-zinc-100">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 px-4 py-6 md:px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Globe2 className="h-6 w-6 shrink-0 text-teal-300" />
              <h1 className="text-2xl font-semibold">
                {copy("Hire.AI Sources", "Hire.AI Bronnen")}
              </h1>
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              {copy(
                "Worldwide and local job platforms",
                "Wereldwijde en lokale vacatureplatforms"
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/jobs">{copy("Vacancies", "Vacatures")}</Link>
            </Button>
            <Button
              variant="outline"
              size="icon"
              title={copy("Refresh overview", "Overzicht vernieuwen")}
              aria-label={copy("Refresh overview", "Overzicht vernieuwen")}
              disabled={directory.isFetching || comparisons.isFetching}
              onClick={() => {
                void directory.refetch();
                if (tab === "comparisons") void comparisons.refetch();
              }}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <div className="px-4 py-5 md:px-8">
          {data?.dataMode === "sample" ? (
            <p
              role="status"
              className="mb-5 border-l-2 border-amber-400 bg-amber-400/5 p-3 text-sm text-amber-200"
            >
              {copy(
                "Sample vacancy data: no database is connected. Platform directory entries are real; vacancy counts are examples.",
                "Voorbeeldvacatures: er is geen database verbonden. De platforms zijn echt; de vacatureaantallen zijn voorbeelden."
              )}
            </p>
          ) : null}
          <dl className="mb-6 grid grid-cols-2 gap-4 border-b border-zinc-800 pb-5 md:grid-cols-4">
            {[
              [
                copy("Registered platforms", "Geregistreerde platforms"),
                data?.summary.total,
              ],
              [
                copy("Automatic adapters", "Automatische koppelingen"),
                data?.summary.automated,
              ],
              [
                copy("Sources with scan attempts", "Bronnen met scanpogingen"),
                data?.summary.scanned,
              ],
              [
                copy("Countries in directory", "Landen in register"),
                data?.summary.listedCountries,
              ],
            ].map(([name, value]) => (
              <div key={String(name)}>
                <dt className="text-xs text-zinc-400">{name}</dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums">
                  {value ?? "-"}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mb-5 text-sm text-zinc-400">
            {copy(
              "Coverage is incomplete. A platform's region does not establish where an applicant may work.",
              "De dekking is nog onvolledig. De regio van een platform bepaalt niet vanuit welk land je mag werken."
            )}
          </p>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-5 grid h-auto w-full grid-cols-2 sm:w-fit">
              <TabsTrigger
                value="directory"
                className="min-h-10 min-w-0 whitespace-normal px-2"
              >
                {copy("Source register", "Bronnenregister")}
              </TabsTrigger>
              <TabsTrigger
                value="comparisons"
                className="min-h-10 min-w-0 whitespace-normal px-2"
              >
                {copy("Duplicates & differences", "Duplicaten en verschillen")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="directory">
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="text-xs text-zinc-400">
                  {copy("Search platforms", "Platforms zoeken")}
                  <div className="relative mt-1">
                    <Search
                      className="absolute left-3 top-3 h-4 w-4"
                      aria-hidden="true"
                    />
                    <Input
                      className="pl-9"
                      value={filters.query ?? ""}
                      onChange={event => change({ query: event.target.value })}
                    />
                  </div>
                </label>
                <label className="text-xs text-zinc-400">
                  {copy("Region", "Regio")}
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                    value={filters.region ?? ""}
                    onChange={event =>
                      change({
                        region:
                          (event.target.value as Filters["region"]) ||
                          undefined,
                      })
                    }
                  >
                    <option value="">
                      {copy("All regions", "Alle regio's")}
                    </option>
                    {regions.map(region => (
                      <option key={region} value={region}>
                        {label(region)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-zinc-400">
                  {copy("Country", "Land")}
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                    value={filters.country ?? ""}
                    onChange={event =>
                      change({ country: event.target.value || undefined })
                    }
                  >
                    <option value="">
                      {copy("All countries", "Alle landen")}
                    </option>
                    {data?.countries.map(country => (
                      <option key={country} value={country}>
                        {countries.of(country)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-zinc-400">
                  {copy("Language", "Taal")}
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                    value={filters.language ?? ""}
                    onChange={event =>
                      change({ language: event.target.value || undefined })
                    }
                  >
                    <option value="">
                      {copy("All languages", "Alle talen")}
                    </option>
                    {data?.languages.map(language => (
                      <option key={language} value={language}>
                        {languages.of(language)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-zinc-400">
                  {copy("Collection", "Verzameling")}
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                    value={filters.mode ?? ""}
                    onChange={event =>
                      change({
                        mode:
                          (event.target.value as Filters["mode"]) || undefined,
                      })
                    }
                  >
                    <option value="">
                      {copy("All methods", "Alle methoden")}
                    </option>
                    {modes.map(mode => (
                      <option key={mode} value={mode}>
                        {label(mode)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-zinc-400">
                  {copy("Status", "Status")}
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
                    value={filters.state ?? ""}
                    onChange={event =>
                      change({
                        state:
                          (event.target.value as Filters["state"]) || undefined,
                      })
                    }
                  >
                    <option value="">
                      {copy("All statuses", "Alle statussen")}
                    </option>
                    {states.map(state => (
                      <option key={state} value={state}>
                        {label(state)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <p aria-live="polite">
                  {busy
                    ? copy("Loading...", "Laden...")
                    : `${data?.total ?? 0} ${data?.total === 1 ? "platform" : "platforms"}`}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setFilters({ limit: PAGE_SIZE, offset: 0 })}
                  >
                    {copy("Clear filters", "Filters wissen")}
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={!data || busy}
                    title={copy(
                      "Export this page as JSON",
                      "Deze pagina exporteren als JSON"
                    )}
                    aria-label={copy(
                      "Export this page as JSON",
                      "Deze pagina exporteren als JSON"
                    )}
                    onClick={exportPage}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {directory.error ? (
                <p role="alert" className="py-5 text-red-300">
                  {copy(
                    "Source overview could not load. Try refreshing.",
                    "Bronnenoverzicht kon niet laden. Probeer te vernieuwen."
                  )}
                </p>
              ) : (
                <div aria-busy={busy} className="min-w-0 overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{copy("Platform", "Platform")}</TableHead>
                        <TableHead>{copy("Coverage", "Dekking")}</TableHead>
                        <TableHead>
                          {copy(
                            "Collection / last scan",
                            "Verzameling / laatste scan"
                          )}
                        </TableHead>
                        <TableHead className="text-right">
                          {copy("Stored listings", "Opgeslagen vermeldingen")}
                        </TableHead>
                        <TableHead className="text-right">
                          {copy("Linked duplicates", "Gekoppelde duplicaten")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data?.items.map(source => (
                        <TableRow key={source.name}>
                          <TableCell className="max-w-60 align-top py-4">
                            <External url={source.url}>{source.name}</External>
                            <div className="mt-1 text-xs text-zinc-400">
                              {label(source.verification)}
                              {source.reviewedAt
                                ? ` · ${source.reviewedAt}`
                                : ""}
                            </div>
                            {source.evidenceUrl ? (
                              <div className="mt-1 text-xs">
                                <External url={source.evidenceUrl}>
                                  {copy("Source reference", "Bronreferentie")}
                                </External>
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="max-w-52 align-top py-4">
                            <div>{label(source.region)}</div>
                            <div className="mt-1 whitespace-normal text-xs text-zinc-400">
                              {source.countries
                                .map(country => countries.of(country))
                                .join(", ") ||
                                copy(
                                  "Countries not enumerated",
                                  "Landen niet opgesomd"
                                )}
                            </div>
                            <div className="mt-1 text-xs text-zinc-400">
                              {source.languages
                                .map(language => languages.of(language))
                                .join(", ") ||
                                copy(
                                  "Language not recorded",
                                  "Taal niet vastgelegd"
                                )}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-72 align-top py-4">
                            <div
                              className={
                                source.state === "failed"
                                  ? "text-red-300"
                                  : source.state === "success"
                                    ? "text-emerald-300"
                                    : "text-zinc-200"
                              }
                            >
                              {label(source.state)}
                            </div>
                            <div className="mt-1 text-xs text-zinc-400">
                              {date(source.lastAttemptedAt)}
                            </div>
                            <details className="mt-2 text-xs text-zinc-400">
                              <summary className="cursor-pointer">
                                {label(source.policy.mode)}
                              </summary>
                              <p className="mt-2 whitespace-normal leading-5">
                                {source.policy.reason}
                              </p>
                            </details>
                          </TableCell>
                          <TableCell className="text-right align-top py-4 tabular-nums">
                            {source.listingCount.toLocaleString(locale)}
                          </TableCell>
                          <TableCell className="text-right align-top py-4 tabular-nums">
                            {source.duplicateCount.toLocaleString(locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {!busy && data?.items.length === 0 ? (
                    <p className="py-10 text-center text-zinc-400">
                      {copy(
                        "No matching platforms",
                        "Geen overeenkomende platforms"
                      )}
                    </p>
                  ) : null}
                </div>
              )}
              <div className="mt-4 flex items-center justify-end gap-3">
                <Button
                  size="icon"
                  variant="outline"
                  title={copy("Previous page", "Vorige pagina")}
                  aria-label={copy("Previous page", "Vorige pagina")}
                  disabled={!filters.offset || busy}
                  onClick={() =>
                    setFilters(current => ({
                      ...current,
                      offset: Math.max(0, (current.offset ?? 0) - PAGE_SIZE),
                    }))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm tabular-nums">
                  {Math.floor((filters.offset ?? 0) / PAGE_SIZE) + 1}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  title={copy("Next page", "Volgende pagina")}
                  aria-label={copy("Next page", "Volgende pagina")}
                  disabled={!data?.hasMore || busy}
                  onClick={() =>
                    setFilters(current => ({
                      ...current,
                      offset: (current.offset ?? 0) + PAGE_SIZE,
                    }))
                  }
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="comparisons">
              <p className="mb-4 text-sm leading-6 text-zinc-400">
                {copy(
                  "Comparisons use the latest stored records and existing duplicate links. Differences need review; matching values do not prove the vacancy is accurate. Canonical records may include updates from linked sources.",
                  "Vergelijkingen gebruiken de laatst opgeslagen gegevens en bestaande duplicaatkoppelingen. Verschillen vragen controle; gelijke waarden bewijzen niet dat de vacature klopt. Hoofdvermeldingen kunnen updates uit gekoppelde bronnen bevatten."
                )}
              </p>
              <label className="mb-5 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyDifferences}
                  onChange={event => setOnlyDifferences(event.target.checked)}
                />
                {copy(
                  "Only differences in loaded pairs",
                  "Alleen verschillen in geladen paren"
                )}
              </label>
              {comparisons.isLoading ? (
                <p role="status">
                  {copy("Loading comparisons...", "Vergelijkingen laden...")}
                </p>
              ) : null}
              {comparisons.error ? (
                <p role="alert" className="text-red-300">
                  {copy(
                    "Comparisons could not load.",
                    "Vergelijkingen konden niet laden."
                  )}
                </p>
              ) : null}
              {comparisons.data?.pages.some(
                page => page.unavailablePairs > 0
              ) ? (
                <p role="status" className="mb-4 text-amber-300">
                  {copy(
                    "Some linked records are missing and could not be compared.",
                    "Sommige gekoppelde vermeldingen ontbreken en konden niet worden vergeleken."
                  )}
                </p>
              ) : null}
              <div className="divide-y divide-zinc-800">
                {visiblePairs.map(pair => (
                  <article key={pair.duplicate.id} className="py-5">
                    <h2 className="break-words text-base font-semibold">
                      {pair.primary.title}{" "}
                      <span className="font-normal text-zinc-400">
                        · {pair.primary.company}
                      </span>
                    </h2>
                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      {[pair.primary, pair.duplicate].map(source => (
                        <div key={source.id} className="min-w-0">
                          <External url={source.url}>
                            {source.platform}
                          </External>
                          <p className="mt-1 break-words text-zinc-300">
                            {source.title}
                          </p>
                          <p className="mt-1 text-xs text-zinc-400">
                            {date(source.updatedAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                    {pair.differences.length > 0 ? (
                      <div className="mt-4 min-w-0 overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                {copy("Difference", "Verschil")}
                              </TableHead>
                              <TableHead>{pair.primary.platform}</TableHead>
                              <TableHead>{pair.duplicate.platform}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pair.differences.map(difference => (
                              <TableRow key={difference.field}>
                                <TableCell className="whitespace-normal text-amber-300">
                                  <AlertTriangle className="mr-2 inline h-3.5 w-3.5" />
                                  {label(difference.field)}
                                </TableCell>
                                <TableCell className="max-w-64 whitespace-normal break-words">
                                  {difference.primary}
                                </TableCell>
                                <TableCell className="max-w-64 whitespace-normal break-words">
                                  {difference.duplicate}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-zinc-400">
                        {copy(
                          "No differences in comparable fields",
                          "Geen verschillen in vergelijkbare velden"
                        )}
                      </p>
                    )}
                    {pair.missingFields.length ? (
                      <p className="mt-3 break-words text-xs leading-5 text-zinc-400">
                        {copy(
                          "Missing from one or both records: ",
                          "Ontbreekt in één of beide vermeldingen: "
                        )}
                        {pair.missingFields.map(label).join(", ")}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
              {!comparisons.isLoading &&
              !comparisons.error &&
              visiblePairs.length === 0 ? (
                <p className="py-8 text-zinc-400">
                  {copy(
                    "No matching pairs in the loaded results",
                    "Geen overeenkomende paren in de geladen resultaten"
                  )}
                </p>
              ) : null}
              {comparisons.hasNextPage ? (
                <Button
                  className="mt-4"
                  variant="outline"
                  disabled={comparisons.isFetchingNextPage}
                  onClick={() => void comparisons.fetchNextPage()}
                >
                  {copy("Load more pairs", "Meer paren laden")}
                </Button>
              ) : null}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
