"use client";

import { useEffect, useState } from "react";

/** Who Sarah is greeting. Change this if someone else runs the deck. */
const OWNER = "Haider";
const WCODE: Record<number, string> = { 0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 61: "Rain", 63: "Rain", 65: "Heavy rain", 71: "Snow", 73: "Snow", 75: "Snow", 80: "Showers", 81: "Showers", 82: "Showers", 95: "Storm", 96: "Storm", 99: "Storm" };

type Weather = { temp: number | null; code: number | null; city: string };

function useWeather() {
  const [wx, setWx] = useState<Weather | null>(null);
  useEffect(() => {
    let ok = true;
    // Via our own API route, so open-meteo never sees visitor IPs.
    const load = (coords?: { lat: number; lon: number }) => {
      const qs = coords ? `?lat=${coords.lat}&lon=${coords.lon}` : "";
      return fetch(`/api/weather${qs}`)
        .then((r) => r.json())
        .then((d) => { if (ok) setWx({ temp: d.current?.temperature_2m ?? null, code: d.current?.weather_code ?? null, city: d.city || "your town" }); })
        .catch(() => {});
    };
    // On localhost there are no geo headers, so the browser is the only
    // source that knows where we are; fall back to the route's own guess.
    let coords: { lat: number; lon: number } | undefined;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }; load(coords); },
        () => load(),
        { timeout: 8000, maximumAge: 600000 }
      );
    } else load();
    const id = setInterval(() => load(coords), 1200000);
    return () => { ok = false; clearInterval(id); };
  }, []);
  return wx;
}

export default function TodayCard() {
  const [now, setNow] = useState<Date | null>(null);
  const wx = useWeather();
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return <section className="sarah-panel sarah-today" aria-label="Today" />;
  const hour = now.getHours();
  const part = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const hm = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sec = String(now.getSeconds()).padStart(2, "0");
  const date = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <section className="sarah-panel sarah-today" aria-label="Today">
      <div className="sarah-label">{part}, {OWNER}</div>
      <div className="sarah-clock">
        <span>{hm}</span><span className="sarah-clock-sec">{sec}</span>
      </div>
      <div className="sarah-date">{date}</div>
      <div className="sarah-weather">
        <span className="sarah-weather-temp">{wx?.temp != null ? `${Math.round(wx.temp)}°` : "--°"}</span>
        <span className="sarah-weather-meta">
          <span>{wx ? wx.city : "Locating…"}</span>
          <span>{wx?.code != null ? WCODE[wx.code] ?? "" : ""}</span>
        </span>
      </div>
    </section>
  );
}
