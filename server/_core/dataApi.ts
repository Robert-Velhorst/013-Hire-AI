/**
 * Quick example (matches curl usage):
 *   await callDataApi("Youtube/search", {
 *     query: { gl: "US", hl: "en", q: "manus" },
 *   })
 */
import { ENV } from "./env";
import {
  outboundRequestSignal,
  OUTBOUND_RESPONSE_MAX_BYTES,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "./outboundRequest";
import { buildTrustedServiceUrl } from "./trustedServiceUrl";

export type DataApiCallOptions = {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};

export async function callDataApi(
  apiId: string,
  options: DataApiCallOptions = {}
): Promise<unknown> {
  if (!ENV.forgeApiUrl) {
    throw new Error("BUILT_IN_FORGE_API_URL is not configured");
  }
  if (!ENV.forgeApiKey) {
    throw new Error("BUILT_IN_FORGE_API_KEY is not configured");
  }

  // Build the full URL by appending the service path to the base URL
  const fullUrl = buildTrustedServiceUrl(ENV.forgeApiUrl, "webdevtoken.v1.WebDevService/CallApi");

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify({
      apiId,
      query: options.query,
      body: options.body,
      path_params: options.pathParams,
      multipart_form_data: options.formData,
    }),
    signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
    redirect: "error",
  });

  if (!response.ok) {
    const detail = await readBoundedResponseText(response, OUTBOUND_RESPONSE_MAX_BYTES.error).catch(() => "");
    throw new Error(
      `Data API request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readBoundedResponseJson<Record<string, unknown>>(
      response,
      OUTBOUND_RESPONSE_MAX_BYTES.standardJson
    );
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    payload = {};
  }
  if (payload && typeof payload === "object" && "jsonData" in payload) {
    try {
      return JSON.parse((payload as Record<string, string>).jsonData ?? "{}");
    } catch {
      return (payload as Record<string, unknown>).jsonData;
    }
  }
  return payload;
}
