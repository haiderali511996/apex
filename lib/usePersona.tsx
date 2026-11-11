"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_PERSONA, type Persona } from "./persona";
import { setWakeName } from "./voiceRecognition";

type Me = {
  user: { email: string; displayName: string; role: "owner" | "user" } | null;
  persona: Persona;
  subscription: { plan: string; status: "active" | "expired" | "pending"; periodEnd: string } | null;
  usage?: { voiceMinutesUsed: number; voiceMinutes: number; computers: number } | null;
};

const PersonaContext = createContext<Me & { reload: () => Promise<void> }>({
  user: null, persona: DEFAULT_PERSONA, subscription: null, reload: async () => {},
});

/** Loads the signed-in user's assistant (name, face, voice) once for the whole app. */
export function PersonaProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me>({ user: null, persona: DEFAULT_PERSONA, subscription: null });
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const body = (await res.json()) as Me;
      setMe(body);
    } catch { /* signed out or offline: keep the defaults */ }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setWakeName(me.persona.name); }, [me.persona.name]);
  return <PersonaContext.Provider value={{ ...me, reload }}>{children}</PersonaContext.Provider>;
}

export const usePersona = () => useContext(PersonaContext);
