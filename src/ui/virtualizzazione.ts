import { useCallback, useState } from "react";

export type AltezzeVirtuali = Record<string, number>;

/** Numero massimo di elementi da montare senza virtualizzazione, calcolato
 * dalla capacità del viewport più un piccolo margine per lo scorrimento. */
export function calcolaSogliaVirtualizzazione(
  altezzaViewport: number,
  altezzaStimata: number,
  gap = 0,
  margineElementi = 2,
) {
  const passo = Math.max(1, altezzaStimata + gap);
  const visibili = Math.max(1, Math.ceil(Math.max(0, altezzaViewport) / passo));
  return visibili + Math.max(0, Math.floor(margineElementi));
}

export function calcolaLayoutVirtuale(
  chiavi: string[],
  altezze: AltezzeVirtuali,
  altezzaStimata: number,
  gap: number,
  padding = 0
) {
  const offsets: number[] = [];
  let totale = padding;
  for (const chiave of chiavi) {
    offsets.push(totale);
    totale += (altezze[chiave] ?? altezzaStimata) + gap;
  }
  if (chiavi.length > 0) totale -= gap;
  totale += padding;
  return { offsets, totale };
}

export function calcolaRangeVirtuale({
  numeroElementi,
  chiavi,
  offsets,
  altezze,
  altezzaStimata,
  overscan,
  viewportTop,
  viewportHeight,
}: {
  numeroElementi: number;
  chiavi: string[];
  offsets: number[];
  altezze: AltezzeVirtuali;
  altezzaStimata: number;
  overscan: number;
  viewportTop: number;
  viewportHeight: number;
}) {
  if (numeroElementi === 0) return { start: 0, end: 0 };
  const margine = overscan * altezzaStimata;
  const minimo = Math.max(0, viewportTop - margine);
  const massimo = viewportTop + viewportHeight + margine;

  // Gli offset sono crescenti: una ricerca binaria evita di ripercorrere l'intera
  // lista a ogni frame di scroll, soprattutto quando il viewport è vicino al fondo.
  let basso = 0;
  let alto = numeroElementi;
  while (basso < alto) {
    const centro = Math.floor((basso + alto) / 2);
    const fineElemento =
      offsets[centro] + (altezze[chiavi[centro]] ?? altezzaStimata);
    if (fineElemento < minimo) basso = centro + 1;
    else alto = centro;
  }
  const start = basso;

  basso = start;
  alto = numeroElementi;
  while (basso < alto) {
    const centro = Math.floor((basso + alto) / 2);
    if (offsets[centro] < massimo) basso = centro + 1;
    else alto = centro;
  }
  const end = basso;
  return { start, end: Math.min(numeroElementi, Math.max(end, start + 1)) };
}

export function useAltezzeVirtuali() {
  const [altezze, setAltezze] = useState<AltezzeVirtuali>({});
  const registraAltezza = useCallback((chiave: string, altezza: number) => {
    if (!Number.isFinite(altezza) || altezza <= 0) return;
    setAltezze((precedenti) => {
      if (Math.abs((precedenti[chiave] ?? 0) - altezza) < 0.5) return precedenti;
      return { ...precedenti, [chiave]: altezza };
    });
  }, []);
  return { altezze, registraAltezza };
}
