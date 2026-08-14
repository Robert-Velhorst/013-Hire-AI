import type { Server } from "node:http";

export const APPLICATION_JSON_LIMIT = "16mb";
export const APPLICATION_FORM_LIMIT = "1mb";

export const HTTP_RUNTIME_POLICY = Object.freeze({
  headersTimeout: 15_000,
  requestTimeout: 120_000,
  keepAliveTimeout: 5_000,
  maxHeadersCount: 100,
  maxRequestsPerSocket: 1_000,
});

type ConfigurableHttpServer = Pick<
  Server,
  | "headersTimeout"
  | "requestTimeout"
  | "keepAliveTimeout"
  | "maxHeadersCount"
  | "maxRequestsPerSocket"
>;

export function applyHttpRuntimePolicy(server: ConfigurableHttpServer) {
  Object.assign(server, HTTP_RUNTIME_POLICY);
}
