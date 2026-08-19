export interface BrowserLocation {
  label: string;
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface ReverseGeocodingAddress {
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city_district?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
}

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 12_000,
  maximumAge: 60_000,
};

export function formatBrowserLocation(
  latitude: number,
  longitude: number,
  accuracy: number,
): BrowserLocation {
  return {
    label: "Localização atual",
    latitude,
    longitude,
    accuracy,
  };
}

export function formatLocationLabel(address: ReverseGeocodingAddress, displayName = "") {
  const district = address.neighbourhood
    || address.suburb
    || address.quarter
    || address.city_district
    || address.road;
  const city = address.city
    || address.town
    || address.village
    || address.municipality
    || address.county;
  const parts = [district, city].filter((part, index, values): part is string => (
    Boolean(part) && values.indexOf(part) === index
  ));

  if (parts.length > 0) return parts.join(", ");
  if (address.state) return address.state;
  return displayName.split(",").slice(0, 2).join(",").trim() || "Localização atual";
}

export async function resolveLocationName(
  location: BrowserLocation,
  fetcher: typeof fetch = fetch,
): Promise<BrowserLocation> {
  const response = await fetcher("/api/location", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      latitude: location.latitude,
      longitude: location.longitude,
    }),
  });
  if (!response.ok) throw new Error("Não foi possível identificar o nome da localização.");
  const result = await response.json() as { label?: string };
  return { ...location, label: result.label?.trim() || location.label };
}

export function getGeolocationErrorMessage(code?: number) {
  if (code === 1) return "Permissão de localização negada. Libere o acesso nas configurações do navegador e tente novamente.";
  if (code === 2) return "Não foi possível determinar sua localização. Verifique se o GPS está ativado.";
  if (code === 3) return "A localização demorou para responder. Tente novamente em um local com melhor sinal.";
  return "Não foi possível acessar sua localização.";
}

export function requestBrowserLocation(geolocation?: Geolocation): Promise<BrowserLocation> {
  if (!geolocation) {
    return Promise.reject(new Error("A localização não está disponível neste navegador."));
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      ({ coords }) => resolve(formatBrowserLocation(coords.latitude, coords.longitude, coords.accuracy)),
      (error) => reject(new Error(getGeolocationErrorMessage(error.code))),
      GEOLOCATION_OPTIONS,
    );
  });
}
