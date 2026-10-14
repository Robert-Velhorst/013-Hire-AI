import net from "node:net";

const LOCAL_ENDPOINT_NAMES = new Set([
  "localhost",
  "host.docker.internal",
  "gateway",
  "app",
]);

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [first, second] = address.split(".").map(Number);
    return first === 10
      || first === 127
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }
  if (version === 6) {
    if (address.toLowerCase() === "::1") return true;
    const firstSegment = address.split(":", 1)[0].toLowerCase();
    return /^f[cd][0-9a-f]{2}$/.test(firstSegment);
  }
  return false;
}

export function validateHaiConnectorUrl(value) {
  if (value !== value.trim()) {
    return "HAI_CONNECTOR_URL must not contain surrounding whitespace.";
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return "HAI_CONNECTOR_URL must be a valid local HTTP(S) URL.";
  }

  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    return "HAI_CONNECTOR_URL must be a plain local HTTP(S) URL without credentials, query data, or fragments.";
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowedName = LOCAL_ENDPOINT_NAMES.has(hostname);
  if (!allowedName && !isPrivateAddress(hostname)) {
    return "HAI_CONNECTOR_URL must use localhost, a private-network address, host.docker.internal, gateway, or the Hire.AI Docker service name app.";
  }
  if (url.pathname !== "/api/hai/a2a") {
    return "HAI_CONNECTOR_URL must use the exact /api/hai/a2a endpoint path.";
  }
  return null;
}
