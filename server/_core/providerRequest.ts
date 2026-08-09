import {
  outboundRequestSignal,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseJson,
} from "./outboundRequest";

export const PROVIDER_JSON_MAX_BYTES = 1024 * 1024;

export function providerRequestInit(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    redirect: "error",
    signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
  };
}

export function readProviderJson<T>(response: Response): Promise<T> {
  return readBoundedResponseJson<T>(response, PROVIDER_JSON_MAX_BYTES);
}
