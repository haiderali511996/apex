"use client";

/**
 * Where the user is, for the assistant to know. The browser's own location
 * (GPS / Wi-Fi) is used when allowed; otherwise an approximate city from the
 * internet connection. The answer is shared by the weather card and every chat
 * request, refreshed every 10 minutes.
 */

export type UserLocation = {
  lat: number;
  lon: number;
  city: string;
  region: string;
  country: string;
  /** Metres; IP-based guesses are city-level at best. */
  accuracy: number | null;
  source: "device" | "ip";
  /** Why the precise location wasn't available, when it wasn't. */
  problem?: string;
  at: number;
};

const FRESH_MS = 10 * 60_000;
const STORAGE_KEY = "assistant.location";
// BigDataCloud's free client-side endpoint: coordinates → place, or (with none) the caller's IP → place.
const GEOCODE = "https://api.bigdatacloud.net/data/reverse-geocode-client";

let current: UserLocation | null = null;
let pending: Promise<UserLocation | null> | null = null;

type Place = { latitude?: number; longitude?: number; city?: string; locality?: string; principalSubdivision?: string; countryName?: string };

async function place(lat?: number, lon?: number): Promise<Place | null> {
  const qs = lat != null && lon != null ? `?latitude=${lat}&longitude=${lon}&localityLanguage=en` : "?localityLanguage=en";
  try {
    const res = await fetch(`${GEOCODE}${qs}`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? (await res.json()) as Place : null;
  } catch { return null; }
}

function devicePosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(Object.assign(new Error("unsupported"), { code: 0 }));
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000, maximumAge: FRESH_MS, enableHighAccuracy: false });
  });
}

const isMac = () => typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

/** Plain-language reason, with the fix, for a failed browser location. */
function explain(err: { code?: number }): string {
  if (err.code === 1) return "Location is blocked for this site in the browser — click the icon left of the address bar and allow Location.";
  if (err.code === 2) return isMac()
    ? "The browser is allowed, but macOS isn't sharing location with it — turn on System Settings → Privacy & Security → Location Services, and switch on Google Chrome there."
    : "The browser couldn't get a position — turn on location in the computer's privacy settings.";
  if (err.code === 3) return "Getting the location timed out.";
  return "This browser can't share its location.";
}

async function locate(): Promise<UserLocation | null> {
  try {
    const pos = await devicePosition();
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    const p = await place(lat, lon);
    return { lat, lon, accuracy: Math.round(accuracy), source: "device", city: p?.city || p?.locality || "", region: p?.principalSubdivision || "", country: p?.countryName || "", at: Date.now() };
  } catch (err) {
    const problem = explain(err as { code?: number });
    const p = await place();
    if (!p || p.latitude == null || p.longitude == null) return null;
    return { lat: p.latitude, lon: p.longitude, accuracy: null, source: "ip", city: p.city || p.locality || "", region: p.principalSubdivision || "", country: p.countryName || "", problem, at: Date.now() };
  }
}

/** The user's location, fresh within 10 minutes; null when nothing is known. */
export function userLocation(): Promise<UserLocation | null> {
  if (current && Date.now() - current.at < FRESH_MS) return Promise.resolve(current);
  if (!current) {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); if (saved?.lat != null) current = saved; } catch { /* storage blocked */ }
  }
  pending ??= locate().then(loc => {
    pending = null;
    if (loc) {
      current = loc;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loc)); } catch { /* storage blocked */ }
    }
    return current;
  });
  // A remembered place answers at once while the fresh one loads.
  return current ? Promise.resolve(current) : pending;
}

/** What goes to the assistant with each message: place, local time and time zone. */
export async function chatContext() {
  const loc = await Promise.race([userLocation(), new Promise<null>(r => setTimeout(() => r(null), 3000))]);
  return {
    location: loc,
    localTime: new Date().toLocaleString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
