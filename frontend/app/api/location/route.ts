import { NextResponse } from "next/server";
import { formatLocationLabel, type ReverseGeocodingAddress } from "../../../lib/location";

interface NominatimResult {
  display_name?: string;
  address?: ReverseGeocodingAddress;
}

interface CachedLocation {
  label: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const MIN_REQUEST_INTERVAL_MS = 1_100;
const locationCache = new Map<string, CachedLocation>();
let lastRequestAt = 0;
let requestQueue: Promise<void> = Promise.resolve();

function queueNominatimRequest<T>(request: () => Promise<T>): Promise<T> {
  const result = requestQueue.then(async () => {
    const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      return await request();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  requestQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawLatitude = url.searchParams.get("latitude");
  const rawLongitude = url.searchParams.get("longitude");
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);

  if (rawLatitude === null || rawLatitude.trim() === ""
    || rawLongitude === null || rawLongitude.trim() === ""
    || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: "Coordenadas inválidas." }, { status: 400 });
  }

  const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const cached = locationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ label: cached.label });
  }

  try {
    const result = await queueNominatimRequest(async () => {
      const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
      endpoint.search = new URLSearchParams({
        format: "jsonv2",
        lat: String(latitude),
        lon: String(longitude),
        addressdetails: "1",
        zoom: "16",
      }).toString();
      const response = await fetch(endpoint, {
        headers: {
          "Accept-Language": request.headers.get("accept-language") || "pt-BR,pt;q=0.9",
          Referer: request.headers.get("referer") || url.origin,
          "User-Agent": "ServeAI/0.1 (local-services location lookup)",
        },
        next: { revalidate: 86_400 },
      });
      if (!response.ok) throw new Error(`Nominatim respondeu com status ${response.status}.`);
      return response.json() as Promise<NominatimResult>;
    });

    const label = formatLocationLabel(result.address || {}, result.display_name);
    if (locationCache.size >= 1_000) locationCache.clear();
    locationCache.set(cacheKey, { label, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ label });
  } catch (error) {
    console.error("Reverse geocoding failed", error);
    return NextResponse.json({ error: "Não foi possível identificar a localização." }, { status: 502 });
  }
}
