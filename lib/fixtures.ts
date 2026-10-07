/** Sandbox fixtures — no Higgsfield / Apify spend. Hooks from formula-cards.example.json */

export const DEMO_LINK = "https://vf.app/c/sandbox_glow";

export const SANDBOX_OFFER = {
  id: "offer_sandbox_resin_glow",
  sku: "Resin Glow Lamp — Amber",
  subtitle: "Sandbox décor · fake SKU",
  cpa: 18,
  revSharePct: 8,
  geo: "US",
  creativeLimit: "14 / 7д",
  priceDisplay: "$49.95 (−50%) · free ship $50+",
  price: 49.95,
  claimStrip: {
    ban: ["медицинские claims", "miracle / cures", "flame-breath / fire jet"],
    ok: ["ambient décor truth", "warm resin LED glow"],
  },
} as const;

export type ClipFixture = {
  id: string;
  num: number;
  hook: string;
  caption: string;
  keyword: string;
  accountSlot: string;
  durationSec: number;
  pattern: string;
  soundHint: string;
  formulaId: string;
  proofHandle: string;
  plays: number;
  gradient: string;
};

/** 3 clips from formula T01/T02/T03 (formula-cards.example.json) */
export const FAKE_CLIPS: ClipFixture[] = [
  {
    id: "clip_01",
    num: 1,
    hook: "don't scroll — I finished this",
    caption:
      "pls don't scroll — hand-finished resin glow / comment GLOW / $49.95 (−50%) · free ship $50+ · 30-day returns / #dragonlamp #halloweendecor",
    keyword: "GLOW",
    accountSlot: "A",
    durationSec: 11,
    pattern: "Maker don't-scroll",
    soundHint: "Original ASMR quiet click",
    formulaId: "fc_maker_dont_scroll_craftedbyelliee",
    proofHandle: "@craftedbyelliee",
    plays: 57117447,
    gradient: "linear-gradient(145deg, #1a0f0a 0%, #c45c26 45%, #f0c27b 100%)",
  },
  {
    id: "clip_02",
    num: 2,
    hook: "would you put this in your room?",
    caption:
      "would you put this in your room? / comment BUNDLE — DM link / $49.95 (−50%) · free ship $50+ · 30-day returns / #dragonlamp #tiktokmademebuyit",
    keyword: "BUNDLE",
    accountSlot: "A",
    durationSec: 11,
    pattern: "Would you put + offer",
    soundHint: "Original · offer cadence",
    formulaId: "fc_would_you_put_offer_ambientlightt",
    proofHandle: "@ambientlightt",
    plays: 4396886,
    gradient: "linear-gradient(145deg, #0d1117 0%, #6b2d5c 50%, #e8a87c 100%)",
  },
  {
    id: "clip_03",
    num: 3,
    hook: "don't show him yet",
    caption:
      "bought one for me… one for him / comment GIFT / $49.95 (−50%) · free ship $50+ · 30-day returns",
    keyword: "GIFT",
    accountSlot: "B",
    durationSec: 14,
    pattern: "Friends obsessed / gift",
    soundHint: "Soft Original unbox",
    formulaId: "fc_friends_obsessed_gift_decorpocket1",
    proofHandle: "@decorpocket1",
    plays: 30333968,
    gradient: "linear-gradient(145deg, #0a1628 0%, #2d4a6f 40%, #d4a574 100%)",
  },
];
