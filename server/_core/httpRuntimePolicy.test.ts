import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_FORM_LIMIT,
  APPLICATION_JSON_LIMIT,
  applyHttpRuntimePolicy,
  HTTP_RUNTIME_POLICY,
} from "./httpRuntimePolicy";

describe("HTTP runtime resource policy", () => {
  it("keeps the JSON envelope just above the bounded 10 MiB document transport", () => {
    expect(APPLICATION_JSON_LIMIT).toBe("16mb");
    expect(APPLICATION_FORM_LIMIT).toBe("1mb");
  });

  it("bounds slow or indefinitely reused connections", () => {
    const server = createServer();
    applyHttpRuntimePolicy(server);

    expect({
      headersTimeout: server.headersTimeout,
      requestTimeout: server.requestTimeout,
      keepAliveTimeout: server.keepAliveTimeout,
      maxHeadersCount: server.maxHeadersCount,
      maxRequestsPerSocket: server.maxRequestsPerSocket,
    }).toEqual(HTTP_RUNTIME_POLICY);

    server.close();
  });
});
