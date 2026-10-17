import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
const { httpsRequestMock } = vi.hoisted(() => ({ httpsRequestMock: vi.fn() }));
vi.mock("node:https", () => ({ request: httpsRequestMock }));
import {
  createPinnedLookup,
  fetchAllowlistedHttpsUrl,
  fetchPublicHttpsUrl,
  requirePublicHttpsUrl,
  resolveAllowlistedHttpsUrl,
  resolvePublicHttpsUrl,
} from "./publicUrl";

type MockNodeResponse = NodeJS.ReadableStream & {
  rawHeaders: string[];
  statusCode: number;
  statusMessage: string;
};

afterEach(() => {
  httpsRequestMock.mockReset();
});

describe("public outbound URL policy", () => {
  it("accepts a credential-free HTTPS URL resolving only to public addresses", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    await expect(
      requirePublicHttpsUrl("https://media.example/audio.mp3", lookup)
    ).resolves.toBe("https://media.example/audio.mp3");
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.20",
    "192.88.99.1",
    "::1",
    "fc00::1",
    "2001:2::1",
    "2001:10::1",
    "3fff::1",
    "5f00::1",
    "::ffff:7f00:1",
  ])("rejects a URL resolving to blocked address %s", async address => {
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    await expect(
      requirePublicHttpsUrl("https://media.example/audio.mp3", lookup)
    ).rejects.toThrow(/public address/i);
  });

  it("rejects mixed public and private DNS answers", async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(
      requirePublicHttpsUrl("https://media.example/audio.mp3", lookup)
    ).rejects.toThrow(/public address/i);
  });

  it("does not expose DNS resolver failures", async () => {
    const lookup = vi
      .fn()
      .mockRejectedValue(new Error("internal resolver 10.0.0.53 failed"));
    await expect(
      requirePublicHttpsUrl("https://media.example/audio.mp3", lookup)
    ).rejects.toThrow("Remote URL could not be resolved safely.");
  });

  it("returns the validated addresses for connection pinning", async () => {
    const addresses = [
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    const resolved = await resolvePublicHttpsUrl(
      "https://media.example/audio.mp3",
      vi.fn().mockResolvedValue(addresses)
    );

    expect(resolved).toEqual({
      url: new URL("https://media.example/audio.mp3"),
      addresses,
    });
  });

  it("allows an exact-origin private HTTPS scanner", async () => {
    const addresses = [{ address: "10.24.3.8", family: 4 }];
    const resolved = await resolveAllowlistedHttpsUrl(
      "https://scanner.internal.test/scan",
      "https://scanner.internal.test",
      vi.fn().mockResolvedValue(addresses)
    );

    expect(resolved).toEqual({
      url: new URL("https://scanner.internal.test/scan"),
      addresses,
    });
  });

  it.each([
    { addresses: [{ address: "127.0.0.1", family: 4 }] },
    { addresses: [{ address: "169.254.169.254", family: 4 }] },
    { addresses: [{ address: "::ffff:169.254.169.254", family: 6 }] },
    { addresses: [{ address: "2001:2::1", family: 6 }] },
    {
      addresses: [
        { address: "10.0.0.8", family: 4 },
        { address: "1.1.1.1", family: 4 },
      ],
    },
  ])(
    "rejects unsafe allowlisted scanner DNS answers $addresses",
    async ({ addresses }) => {
      await expect(
        resolveAllowlistedHttpsUrl(
          "https://scanner.internal.test/scan",
          "https://scanner.internal.test",
          vi.fn().mockResolvedValue(addresses)
        )
      ).rejects.toThrow(
        "Remote URL must resolve consistently to public or private addresses."
      );
    }
  );

  it("rejects a scanner origin mismatch before DNS or network access", async () => {
    const lookup = vi.fn();
    await expect(
      resolveAllowlistedHttpsUrl(
        "https://other.internal.test/scan",
        "https://scanner.internal.test",
        lookup
      )
    ).rejects.toThrow(
      "Remote URL must match an explicitly allowlisted HTTPS origin."
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it("pins connection lookup to the addresses that passed validation", async () => {
    const lookup = createPinnedLookup([
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);

    await expect(
      new Promise((resolve, reject) => {
        lookup("media.example", { all: true }, (error, addresses) => {
          if (error) reject(error);
          else resolve(addresses);
        });
      })
    ).resolves.toEqual([
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
  });

  it("sends a bounded caller-provided request body after public-address validation", async () => {
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn((body?: string | Uint8Array) => {
        expect(body).toEqual(Buffer.from("scanner-input"));
        queueMicrotask(() =>
          responseCallback(
            Object.assign(Readable.from([Buffer.from("ok")]), {
              rawHeaders: [],
              statusCode: 200,
              statusMessage: "OK",
            })
          )
        );
      }),
    });
    let responseCallback!: (
      response: NodeJS.ReadableStream & {
        rawHeaders: string[];
        statusCode: number;
        statusMessage: string;
      }
    ) => void;
    httpsRequestMock.mockImplementation((_url, options, callback) => {
      expect(options.agent).toBe(false);
      expect(options.lookup).toEqual(expect.any(Function));
      responseCallback = callback;
      return request;
    });

    const response = await fetchPublicHttpsUrl(
      "https://scanner.example/scan",
      { method: "POST", body: Buffer.from("scanner-input") },
      async () => [{ address: "1.1.1.1", family: 4 }]
    );

    expect(await response.text()).toBe("ok");
    expect(httpsRequestMock).toHaveBeenCalledOnce();
  });

  it("does not connect to a scanner URL that resolves to a private address", async () => {
    await expect(
      fetchPublicHttpsUrl(
        "https://scanner.example/scan",
        { method: "POST", body: Buffer.from("scanner-input") },
        async () => [{ address: "169.254.169.254", family: 4 }]
      )
    ).rejects.toThrow("Remote URL must resolve only to public addresses.");

    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it("sends an allowlisted internal HTTPS request through the pinned address", async () => {
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(() => {
        queueMicrotask(() =>
          responseCallback(
            Object.assign(Readable.from([Buffer.from("ok")]), {
              rawHeaders: [],
              statusCode: 200,
              statusMessage: "OK",
            })
          )
        );
      }),
    });
    let responseCallback!: (
      response: NodeJS.ReadableStream & {
        rawHeaders: string[];
        statusCode: number;
        statusMessage: string;
      }
    ) => void;
    httpsRequestMock.mockImplementation((_url, options, callback) => {
      expect(options.agent).toBe(false);
      expect(options.lookup).toEqual(expect.any(Function));
      responseCallback = callback;
      return request;
    });

    const response = await fetchAllowlistedHttpsUrl(
      "https://scanner.internal.test/scan",
      "https://scanner.internal.test",
      { method: "POST", body: Buffer.from("scanner-input") },
      async () => [{ address: "10.24.3.8", family: 4 }]
    );

    expect(await response.text()).toBe("ok");
    expect(httpsRequestMock).toHaveBeenCalledOnce();
  });

  it.each([204, 205, 304])(
    "returns bodyless scanner response status %s without throwing",
    async status => {
      let responseCallback!: (response: MockNodeResponse) => void;
      const request = Object.assign(new EventEmitter(), {
        end: vi.fn(() =>
          queueMicrotask(() =>
            responseCallback(
              Object.assign(Readable.from([]), {
                rawHeaders: [],
                statusCode: status,
                statusMessage: "No Content",
              })
            )
          )
        ),
      });
      httpsRequestMock.mockImplementation((_url, _options, callback) => {
        responseCallback = callback;
        return request;
      });

      const response = await fetchAllowlistedHttpsUrl(
        "https://scanner.internal.test/scan",
        "https://scanner.internal.test",
        {},
        async () => [{ address: "10.24.3.8", family: 4 }]
      );

      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      await expect(response.text()).resolves.toBe("");
    }
  );

  it("rejects invalid Node response statuses instead of throwing from the callback", async () => {
    let responseCallback!: (response: MockNodeResponse) => void;
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(() =>
        queueMicrotask(() =>
          responseCallback(
            Object.assign(Readable.from([]), {
              rawHeaders: [],
              statusCode: 101,
              statusMessage: "Switching Protocols",
            })
          )
        ),
      ),
    });
    httpsRequestMock.mockImplementation((_url, _options, callback) => {
      responseCallback = callback;
      return request;
    });

    await expect(
      fetchAllowlistedHttpsUrl(
        "https://scanner.internal.test/scan",
        "https://scanner.internal.test",
        {},
        async () => [{ address: "10.24.3.8", family: 4 }]
      )
    ).rejects.toThrow();
  });
});
