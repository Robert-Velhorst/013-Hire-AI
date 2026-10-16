import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

export type LookupAddress = { address: string; family: number };
type AddressLookup = (hostname: string) => Promise<LookupAddress[]>;

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function isBlockedAddress(address: string) {
  const ipv4 = mappedIpv4Address(address);
  if (ipv4) return blockedAddresses.check(ipv4, "ipv4");
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, "ipv4");
  if (family === 6) return blockedAddresses.check(address, "ipv6");
  return true;
}

function mappedIpv4Address(address: string) {
  const normalized = address.toLowerCase();
  const dotted = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted && isIP(dotted[1]) === 4) return dotted[1];
  const mapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return null;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

function isPrivateAddress(address: string) {
  const normalized = mappedIpv4Address(address) ?? address.toLowerCase();
  const family = isIP(normalized);
  if (family === 4) {
    const octets = normalized.split(".").map(Number);
    return (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }
  return family === 6 && /^f[cd]/.test(normalized);
}

const defaultLookup: AddressLookup = async hostname =>
  await dnsLookup(hostname, { all: true, verbatim: true });

async function lookupUrlAddresses(url: URL, lookup: AddressLookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    throw new Error("Remote URL must resolve to a public address.");
  }
  const literalFamily = isIP(hostname);
  let addresses: LookupAddress[];
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await lookup(hostname);
  } catch {
    throw new Error("Remote URL could not be resolved safely.");
  }
  return addresses;
}

export async function resolvePublicHttpsUrl(
  value: string,
  lookup: AddressLookup = defaultLookup
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Remote URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    value.length > 2_000
  ) {
    throw new Error("Remote URL must use credential-free HTTPS.");
  }

  const addresses = await lookupUrlAddresses(url, lookup);
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedAddress(address))
  ) {
    throw new Error("Remote URL must resolve only to public addresses.");
  }
  return { url, addresses };
}

export async function resolveAllowlistedHttpsUrl(
  value: string,
  allowedOrigin: string,
  lookup: AddressLookup = defaultLookup
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Remote URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.length > 2_000 ||
    url.origin !== allowedOrigin
  ) {
    throw new Error(
      "Remote URL must match an explicitly allowlisted HTTPS origin."
    );
  }

  const addresses = await lookupUrlAddresses(url, lookup);
  const privateAddressFlags = addresses.map(({ address }) =>
    isPrivateAddress(address)
  );
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address }) => isBlockedAddress(address) && !isPrivateAddress(address)
    ) ||
    (privateAddressFlags.some(Boolean) && !privateAddressFlags.every(Boolean))
  ) {
    throw new Error(
      "Remote URL must resolve consistently to public or private addresses."
    );
  }
  return { url, addresses };
}

export async function requirePublicHttpsUrl(
  value: string,
  lookup: AddressLookup = defaultLookup
) {
  return (await resolvePublicHttpsUrl(value, lookup)).url.toString();
}

export function createPinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return ((_hostname, options, callback) => {
    const requestedFamily =
      typeof options === "number" ? options : options.family;
    const matches =
      requestedFamily && requestedFamily !== 0
        ? addresses.filter(({ family }) => family === requestedFamily)
        : addresses;

    queueMicrotask(() => {
      if (matches.length === 0) {
        const error = Object.assign(
          new Error("No validated address matches the requested family."),
          {
            code: "ENOTFOUND",
          }
        );
        callback(error, "", 0);
      } else if (typeof options !== "number" && options.all) {
        callback(null, matches);
      } else {
        callback(null, matches[0].address, matches[0].family);
      }
    });
  }) as LookupFunction;
}

async function fetchPinnedHttpsUrl(
  url: URL,
  addresses: LookupAddress[],
  init: Pick<RequestInit, "headers" | "method" | "signal"> & {
    body?: string | Uint8Array;
  }
) {
  return await new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        lookup: createPinnedLookup(addresses),
        signal: init.signal ?? undefined,
      },
      response => {
        const headers = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          headers.append(
            response.rawHeaders[index],
            response.rawHeaders[index + 1]
          );
        }
        resolve(
          new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
            status: response.statusCode ?? 500,
            statusText: response.statusMessage,
            headers,
          })
        );
      }
    );
    request.once("error", reject);
    request.end(init.body);
  });
}

export async function fetchPublicHttpsUrl(
  value: string,
  init: Pick<RequestInit, "headers" | "method" | "signal"> & {
    body?: string | Uint8Array;
  } = {},
  lookup: AddressLookup = defaultLookup
): Promise<Response> {
  const { url, addresses } = await resolvePublicHttpsUrl(value, lookup);
  return await fetchPinnedHttpsUrl(url, addresses, init);
}

export async function fetchAllowlistedHttpsUrl(
  value: string,
  allowedOrigin: string,
  init: Pick<RequestInit, "headers" | "method" | "signal"> & {
    body?: string | Uint8Array;
  } = {},
  lookup: AddressLookup = defaultLookup
): Promise<Response> {
  const { url, addresses } = await resolveAllowlistedHttpsUrl(
    value,
    allowedOrigin,
    lookup
  );
  return await fetchPinnedHttpsUrl(url, addresses, init);
}
