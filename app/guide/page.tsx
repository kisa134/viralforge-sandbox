import type { Metadata } from "next";
import { Guide } from "@/components/Guide";

export const metadata: Metadata = { title: "Как это работает — ViralForge", description: "Инструкция для основателя и для креатора" };

export default function GuidePage() {
  return <Guide />;
}
