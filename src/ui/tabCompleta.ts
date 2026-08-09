// Handler `onKeyDown` condiviso per i campi Autocomplete: alla pressione di Tab
// completa il testo col primo suggerimento pertinente (prima «inizia con», poi
// «contiene») e lascia che il Tab sposti normalmente il focus al campo successivo.
//
// Pensato perché TUTTI i campi con suggerimenti dell'app si comportino come quelli
// delle anagrafiche/produzione: si digita, si preme Tab, il primo suggerimento è
// accettato e si va avanti. Non fa nulla con Shift+Tab (navigazione all'indietro),
// con modificatori, a campo vuoto o quando il valore combacia già col suggerimento.
import { useRef, type KeyboardEvent } from "react";

export function tabCompleta(
  data: readonly string[],
  valore: string | undefined,
  applica: (v: string) => void,
) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const v = (valore ?? "").trim().toLowerCase();
    if (!v) return;
    const first =
      data.find((x) => x.toLowerCase().startsWith(v)) ??
      data.find((x) => x.toLowerCase().includes(v));
    if (first && first.toLowerCase() !== v) applica(first);
  };
}

/** Voce normalizzata di un `Select` Mantine: valore + etichetta. */
export interface OpzioneSelect {
  value: string;
  label: string;
}

type DatiSelect = ReadonlyArray<string | OpzioneSelect | { group: string; items: ReadonlyArray<string | OpzioneSelect> }>;

/** Appiattisce i `data` di un Mantine `Select` (stringhe, oggetti, gruppi) in {value,label}. */
function normalizzaOpzioni(data: DatiSelect | undefined): OpzioneSelect[] {
  const out: OpzioneSelect[] = [];
  for (const it of data ?? []) {
    if (typeof it === "string") out.push({ value: it, label: it });
    else if ("group" in it) {
      for (const sub of it.items) {
        if (typeof sub === "string") out.push({ value: sub, label: sub });
        else out.push({ value: sub.value, label: sub.label });
      }
    } else out.push({ value: it.value, label: it.label });
  }
  return out;
}

/**
 * Tab-completamento per i Mantine `Select` ricercabili: alla pressione di Tab seleziona la
 * prima opzione che combacia col testo digitato (prima «inizia con», poi «contiene»), poi
 * lascia che il Tab sposti normalmente il focus. A differenza dell'`Autocomplete` (testo
 * libero), il `Select` non espone il testo digitato: lo OSSERVIAMO via `onSearchChange`
 * (senza controllare `searchValue`, per non interferire col display gestito da Mantine).
 *
 * Uso: `<Select {...tabSelect(data, value, onChange)} ...altre props />`. Le props ritornate
 * (`searchable`, `onSearchChange`, `onKeyDown`) vanno sparse: passa pure `searchable` a parte,
 * verrà sovrascritta con `true`.
 */
export function useTabSelect(
  data: DatiSelect | undefined,
  valore: string | null | undefined,
  applica: (v: string) => void,
) {
  const ricercaRef = useRef("");
  return {
    searchable: true as const,
    onSearchChange: (s: string) => {
      ricercaRef.current = s;
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Tab" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const q = ricercaRef.current.trim().toLowerCase();
      if (!q) return;
      const opts = normalizzaOpzioni(data);
      const m =
        opts.find((o) => o.label.toLowerCase().startsWith(q)) ??
        opts.find((o) => o.label.toLowerCase().includes(q));
      if (m && m.value !== valore) applica(m.value);
    },
  };
}
