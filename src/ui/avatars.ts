// Set di avatar predefiniti, bundlati con l'app (offline-safe): non scaricati a
// runtime. Ognuno è un gradiente + icona Tabler. Vedi UI-SPEC §7.2.
import {
  IconMoodSmile,
  IconUser,
  IconStar,
  IconHeart,
  IconBolt,
  IconLeaf,
  IconFlask,
  IconPaw,
  type Icon,
} from "@tabler/icons-react";

export interface Preset {
  id: string;
  grad: [string, string];
  Icon: Icon;
}

export const PRESETS: Preset[] = [
  { id: "p1", grad: ["#F4C20D", "#E0900C"], Icon: IconMoodSmile },
  { id: "p2", grad: ["#1971C2", "#0B4A85"], Icon: IconUser },
  { id: "p3", grad: ["#2F9E44", "#1B6E2E"], Icon: IconLeaf },
  { id: "p4", grad: ["#E03131", "#A01818"], Icon: IconHeart },
  { id: "p5", grad: ["#7048E8", "#4B2FB0"], Icon: IconStar },
  { id: "p6", grad: ["#0CA678", "#08715A"], Icon: IconFlask },
  { id: "p7", grad: ["#F76707", "#C24A02"], Icon: IconBolt },
  { id: "p8", grad: ["#495057", "#212529"], Icon: IconPaw },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

// Colore deterministico dalle iniziali (fallback "iniziali").
export function coloreNome(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 42%)`;
}

export function iniziali(nome: string): string {
  const parti = nome.trim().split(/\s+/).filter(Boolean);
  if (parti.length === 0) return "?";
  if (parti.length === 1) return parti[0].slice(0, 2).toUpperCase();
  return (parti[0][0] + parti[parti.length - 1][0]).toUpperCase();
}
