import type { Metadata } from "next";
import { AnalyticsCabinet } from "@/components/analytics/AnalyticsCabinet";

export const metadata: Metadata = {
  title: "ViralForge — Аналитика",
  description: "Сквозная аналитика ViralForge × Likky: тренд → ролик → заказ → выплата",
};

export default function AnalyticsPage() {
  return <AnalyticsCabinet />;
}
