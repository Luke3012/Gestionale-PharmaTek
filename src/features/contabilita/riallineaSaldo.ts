import { api, type Pagamento } from "../../lib/tauri";

type VoceRiallineabile = {
  tipo: "acconto" | "saldo" | "rata";
  importo: number;
  saldato: boolean;
};

function dividiImportoEquo(importo: number, parti: number): number[] {
  if (parti <= 0) return [];
  const base = Math.floor(importo / parti);
  let resto = importo - base * parti;
  return Array.from({ length: parti }, () => base + (resto-- > 0 ? 1 : 0));
}

export function ripartisciImportoProporzionale(target: number, importiAttuali: number[]): number[] {
  if (importiAttuali.length === 0 || target <= 0) return importiAttuali.map(() => 0);
  const pesi = importiAttuali.map((v) => Math.max(0, Math.floor(v)));
  const totaleAttuale = pesi.reduce((sum, v) => sum + v, 0);
  if (totaleAttuale <= 0) return dividiImportoEquo(target, importiAttuali.length);

  const quote = pesi.map((peso) => Math.floor((target * peso) / totaleAttuale));
  let residuo = target - quote.reduce((sum, v) => sum + v, 0);
  const resti = pesi
    .map((peso, index) => ({ index, resto: (target * peso) % totaleAttuale }))
    .sort((a, b) => b.resto - a.resto || a.index - b.index);

  for (const { index } of resti) {
    if (residuo <= 0) break;
    quote[index] += 1;
    residuo -= 1;
  }
  return quote;
}

export function riallineaVociAperteLocali<T extends VoceRiallineabile>(voci: T[], totale: number): T[] {
  const totaleOrdine = Math.max(0, Math.floor(totale));
  const regolabile = (v: T) => !v.saldato && (v.tipo === "saldo" || v.tipo === "rata");
  const fissi = voci.filter((v) => !regolabile(v)).reduce((sum, v) => sum + Math.max(0, v.importo), 0);
  const aperti = voci.filter(regolabile);
  if (aperti.length === 0) return voci;

  const targetAperto = Math.max(0, totaleOrdine - fissi);
  if (targetAperto === 0) return voci.filter((v) => !regolabile(v));

  const quote = ripartisciImportoProporzionale(
    targetAperto,
    aperti.map((v) => v.importo)
  );
  let index = 0;
  return voci.flatMap((v) => {
    if (!regolabile(v)) return [v];
    const importo = quote[index++];
    if (importo <= 0) return [];
    return [v.importo === importo ? v : { ...v, importo }];
  });
}

export async function riallineaPagamentiAperti(ordineId: string): Promise<Pagamento[]> {
  if (!ordineId) return [];
  return api.pagamentiRiallineaAperti(ordineId);
}
