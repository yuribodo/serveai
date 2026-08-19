import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.unstubAllGlobals());

function locationRequest(body: unknown, headers?: HeadersInit) {
  return new Request("http://localhost/api/location", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/location", () => {
  it("rejects missing or out-of-range coordinates", async () => {
    const missing = await POST(locationRequest({}));
    const invalid = await POST(locationRequest({ latitude: -91, longitude: -46 }));

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({ error: "Coordenadas inválidas." });
  });

  it("rejects a cross-origin browser request", async () => {
    const response = await POST(locationRequest(
      { latitude: -23.55052, longitude: -46.633308 },
      { Origin: "https://example.test" },
    ));

    expect(response.status).toBe(403);
  });

  it("returns a friendly reverse-geocoded label", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      address: { suburb: "Pinheiros", city: "São Paulo" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(locationRequest({ latitude: -23.561, longitude: -46.69 }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ label: "Pinheiros, São Paulo" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
