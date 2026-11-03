/**
 * The plans on the pricing page. Prices and limits live here only, so they can
 * be changed in one place. The UNC price is the USD price times the UNC rate
 * (NEXT_PUBLIC_UNC_PER_USD: how many UNC make one US dollar).
 */

export type PlanId = "starter" | "pro" | "business";

export type Plan = {
  id: PlanId;
  name: string;
  priceUsd: number;
  tagline: string;
  features: string[];
  highlighted?: boolean;
  /** Voice minutes a month: speech transcribed plus speech generated. */
  voiceMinutes: number;
  /** Computers that can be linked through the desktop app. */
  computers: number;
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    voiceMinutes: 300,
    computers: 1,
    name: "Starter",
    priceUsd: 19,
    tagline: "A voice assistant of your own.",
    features: [
      "Your assistant's name, face and voice",
      "English, Urdu and 100+ languages",
      "300 voice minutes a month",
      "1 computer connected",
      "2 connected accounts (Gmail, Calendar…)",
    ],
  },
  {
    id: "pro",
    voiceMinutes: 1500,
    computers: 3,
    name: "Pro",
    priceUsd: 49,
    tagline: "For people who run their day through it.",
    highlighted: true,
    features: [
      "Everything in Starter",
      "1,500 voice minutes a month",
      "3 computers (Mac, Windows, Linux)",
      "10 connected accounts, Search Console & socials",
      "Picture design and camera vision",
    ],
  },
  {
    id: "business",
    voiceMinutes: 5000,
    computers: 10,
    name: "Business",
    priceUsd: 129,
    tagline: "For founders and small teams.",
    features: [
      "Everything in Pro",
      "5,000 voice minutes a month",
      "10 computers",
      "Unlimited connected accounts",
      "Specialist agents and developer tasks",
      "Priority support",
    ],
  },
];

/** What the free trial includes. */
export const TRIAL_LIMITS = { voiceMinutes: 60, computers: 1 };

export function limitsFor(plan: string): { voiceMinutes: number; computers: number } {
  const found = PLANS.find(p => p.id === plan);
  return found ? { voiceMinutes: found.voiceMinutes, computers: found.computers } : TRIAL_LIMITS;
}

/** Days a purchase adds to the plan. */
export const PERIOD_DAYS = 30;
/** Days of the free trial every new account starts with. */
export const TRIAL_DAYS = 7;

export function uncPerUsd(): number {
  const rate = Number(process.env.NEXT_PUBLIC_UNC_PER_USD);
  // 100 UNC = $1 unless NEXT_PUBLIC_UNC_PER_USD says otherwise (Starter $19 = 1,900 UNC).
  return Number.isFinite(rate) && rate > 0 ? rate : 100;
}

export function priceUnc(plan: Plan): number {
  return Math.round(plan.priceUsd * uncPerUsd() * 100) / 100;
}

export function findPlan(id: unknown): Plan | undefined {
  return PLANS.find(p => p.id === id);
}
