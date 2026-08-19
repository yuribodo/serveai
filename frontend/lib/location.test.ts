import { describe, expect, it, vi } from "vitest";
import {
  formatBrowserLocation,
  formatLocationLabel,
  getGeolocationErrorMessage,
  requestBrowserLocation,
  resolveLocationName,
} from "./location";

describe("browser location", () => {
  it("formats GPS coordinates without losing their numeric values", () => {
    expect(formatBrowserLocation(-23.55052, -46.633308, 12)).toEqual({
      label: "Localização atual",
      latitude: -23.55052,
      longitude: -46.633308,
      accuracy: 12,
    });
  });

  it("turns a reverse-geocoded address into a friendly location", () => {
    expect(formatLocationLabel({ suburb: "Pinheiros", city: "São Paulo" }))
      .toBe("Pinheiros, São Paulo");
  });

  it("requests a high-accuracy browser position", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({
      coords: {
        latitude: -23.55052,
        longitude: -46.633308,
        accuracy: 8,
      },
    } as GeolocationPosition));

    await expect(requestBrowserLocation({ getCurrentPosition } as unknown as Geolocation))
      .resolves.toMatchObject({ latitude: -23.55052, longitude: -46.633308 });
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });

  it("explains when the user denies permission", () => {
    expect(getGeolocationErrorMessage(1)).toContain("Permissão de localização negada");
  });

  it("reverse geocodes coordinates without putting them in the URL", async () => {
    const fetcher = vi.fn(async () => Response.json({ label: "Pinheiros, São Paulo" }));

    const resolved = await resolveLocationName(
      formatBrowserLocation(-23.55052, -46.633308, 12),
      fetcher,
    );

    expect(resolved.label).toBe("Pinheiros, São Paulo");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/location",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ latitude: -23.55052, longitude: -46.633308 }),
      }),
    );
  });
});
