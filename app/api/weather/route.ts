import { NextResponse } from "next/server";

/**
 * Weather for the *visitor's* location.
 *
 * Three sources, most accurate first:
 *  1. `?lat=&lon=` — the browser's Geolocation API, asked for by the panel.
 *     This is the only one that works on localhost, and the only one that
 *     reflects where you actually are rather than where your IP resolves.
 *  2. Vercel's geo headers (`x-vercel-ip-latitude` / `-longitude` / `-city`),
 *     present in production — no permission prompt, no third party.
 *  3. Nothing — we return `city: "your town"` and a null reading rather than
 *     inventing a city.
 *
 * Weather comes from open-meteo (free, keyless). When coordinates come from
 * the browser there's no city name attached, so that one is resolved through
 * BigDataCloud's keyless reverse-geocode endpoint.
 */
export const dynamic = "force-dynamic"; // per-visitor: reads geo headers

async function cityFromCoords(lat: string, lon: string): Promise<string> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { next: { revalidate: 86400 } }
    );
    const d = await r.json();
    return d.city || d.locality || d.principalSubdivision || d.countryName || "your town";
  } catch {
    return "your town";
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const h = request.headers;

  // Browser coordinates win — they're the only ones right on localhost.
  let lat = searchParams.get("lat");
  let lon = searchParams.get("lon");
  let city: string | null = null;

  if (lat && lon) {
    city = await cityFromCoords(lat, lon);
  } else {
    lat = h.get("x-vercel-ip-latitude");
    lon = h.get("x-vercel-ip-longitude");
    const cityHeader = h.get("x-vercel-ip-city");
    city = cityHeader ? decodeURIComponent(cityHeader) : "your town";
  }

  // No location available — don't guess.
  if (!lat || !lon) {
    return NextResponse.json({ current: null, city: "your town" });
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`;
    // Cache per-coordinate for 10 min so repeat visitors from the same place
    // don't each trigger a fresh upstream call.
    const r = await fetch(url, { next: { revalidate: 600 } });
    const d = await r.json();
    return NextResponse.json({ current: d.current ?? null, city });
  } catch {
    return NextResponse.json({ current: null, city });
  }
}
