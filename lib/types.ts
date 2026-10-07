export type Phase =
  | "boot"
  | "niche"
  | "geo"
  | "social"
  | "offer"
  | "claimed"
  | "generating"
  | "delivered"
  | "posted"
  | "payout";

export type Role = "bot" | "user" | "system";

export type MessageKind =
  | "text"
  | "offer"
  | "progress"
  | "clips"
  | "status"
  | "payout"
  | "dm_script"
  | "post_ack"
  | "links";

export type Message = {
  id: string;
  role: Role;
  kind: MessageKind;
  text?: string;
  ts: number;
};

export type QuickReply = {
  id: string;
  label: string;
  payload: string;
};

export type CreatorState = {
  phase: Phase;
  niche: string | null;
  geo: string | null;
  social: string | null;
  offerClaimed: boolean;
  clipsReady: boolean;
  postedClip: number | null;
  balance: number;
};
