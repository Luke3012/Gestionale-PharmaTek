// Rifiuto di un ordine (qualsiasi linea) tramite il **dialog globale** (niente modale
// dedicata): porta lo stato a Rifiutato. L'ordine **resta vivo** nel Giornaliero (mostrato
// come rifiutato) ed è escluso dai conteggi PER STATO (provvigioni/crediti/spedizioni). Lo
// srifiuto avviene dal Giornaliero (menu ⋯ o salvataggio). NON è un soft-delete. FASE 5E.
import { useState } from "react";
import { Textarea } from "@mantine/core";
import { api, type OrdineDto } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { dialog } from "../../ui/dialog/store";
import { oggiIso as oggi } from "../../lib/date";

/** Contenuto del dialog: motivo facoltativo. Riporta il testo via `onMotivo`. */
function RifiutaContenuto({ onMotivo }: { onMotivo: (m: string) => void }) {
  const [motivo, setMotivo] = useState("");
  return (
    <Textarea
      label="Motivo del rifiuto"
      description="Facoltativo"
      value={motivo}
      onChange={(e) => {
        const v = e.currentTarget.value;
        setMotivo(v);
        onMotivo(v);
      }}
      autosize
      minRows={2}
      placeholder="Es. non interessato, mai risposto, ricoverato…"
      data-autofocus
    />
  );
}

/** Rifiuta un ordine via il dialog globale. Ritorna `true` se il rifiuto è andato a buon
 * fine (il chiamante ricarica), `false` se annullato o in errore. */
export async function rifiutaOrdine(o: OrdineDto): Promise<boolean> {
  const ref = { motivo: "" };
  const ok = await dialog.open<boolean>({
    tipo: "warning",
    titolo: `Rifiuta ordine ${o.numero}`,
    contenuto: <RifiutaContenuto onMotivo={(m) => (ref.motivo = m)} />,
    valoreAnnulla: false,
    bottoni: [
      { label: "Annulla", variante: "secondario", value: false },
      { label: "Contrassegna come rifiutato", variante: "pericolo", value: true },
    ],
  });
  if (!ok) return false;
  try {
    // Solo cambio di stato: l'ordine resta vivo (NON soft-delete). `stato_pre_rifiuto`
    // serve a Ripristina dal Cestino per tornare esattamente com'era.
    await api.recordUpdate("ordine", o.id, {
      stato: "Rifiutato",
      stato_pre_rifiuto: o.stato,
      motivo_rifiuto: ref.motivo.trim(),
      data_rifiuto: oggi(),
    });
    toast.success(`Ordine ${o.numero} contrassegnato come rifiutato.`);
    return true;
  } catch (e) {
    toast.error(`Rifiuto non riuscito: ${e}`);
    return false;
  }
}
