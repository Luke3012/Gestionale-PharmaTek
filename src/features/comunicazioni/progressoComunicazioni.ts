import type { Comunicazione, StatoComunicazione } from "../../lib/tauri";

const TERMINALI = new Set<StatoComunicazione>([
  "invio_azionato",
  "consegna_verificata",
  "fallito",
  "annullato",
]);

export interface ProgressoComunicazioni {
  totale: number;
  completate: number;
  inviate: number;
  fallite: number;
  annullate: number;
  inInvio: number;
  sospese: number;
  progress: number;
  terminale: boolean;
  messaggio: string;
}

export function riepilogaProgressoComunicazioni(
  comunicazioni: Comunicazione[],
): ProgressoComunicazioni {
  const totale = comunicazioni.length;
  const completate = comunicazioni.filter((item) => TERMINALI.has(item.stato)).length;
  const inviate = comunicazioni.filter((item) =>
    ["invio_azionato", "consegna_verificata"].includes(item.stato),
  ).length;
  const fallite = comunicazioni.filter((item) => item.stato === "fallito").length;
  const annullate = comunicazioni.filter((item) => item.stato === "annullato").length;
  const inInvio = comunicazioni.filter((item) => item.stato === "in_invio").length;
  const sospese = comunicazioni.filter((item) => item.stato === "sospeso").length;
  const terminale = totale > 0 && completate === totale;
  const progress = totale
    ? Math.round(((completate + inInvio * 0.5) / totale) * 100)
    : 0;

  let messaggio: string;
  if (terminale) {
    const dettagli = [
      inviate ? `${inviate} ${inviate === 1 ? "inviata" : "inviate"}` : "",
      fallite ? `${fallite} ${fallite === 1 ? "fallita" : "fallite"}` : "",
      annullate ? `${annullate} ${annullate === 1 ? "annullata" : "annullate"}` : "",
    ].filter(Boolean);
    messaggio = dettagli.join(" · ") || "Invio concluso.";
  } else if (sospese > 0 && inInvio === 0) {
    messaggio = `${completate} di ${totale} completate · invio in pausa`;
  } else {
    messaggio = `${completate} di ${totale} completate${inInvio ? " · invio in corso…" : " · in coda…"}`;
  }

  return {
    totale,
    completate,
    inviate,
    fallite,
    annullate,
    inInvio,
    sospese,
    progress,
    terminale,
    messaggio,
  };
}
