// Export/stampa di un pagamento provvigioni (le righe appena saldate o una voce dello storico).
// Riusa il modale globale in-app `EsportaTabella` (anteprima + colonne + «Salva Excel»/«Stampa»):
// l'unica finestra di sistema è il file-picker per il percorso di salvataggio.
import { EsportaTabella, type ColonnaExport } from "../../ui/esporta/EsportaTabella";
import { formattaDataFileItaliana } from "../../lib/date";

/** Una riga di un pagamento provvigioni (importi in **centesimi**). */
export interface RigaPagProvv {
  ordineId: string;
  numero: string;
  data: string;
  clienteNome: string;
  base: number;
  provvigione: number;
}

/** Un pagamento provvigioni esportabile (snapshot delle righe + intestazione). */
export interface PagamentoProvv {
  /** Id dell'agente pagato (per ritrovarne la card e scorrervi sopra). */
  agenteId?: string;
  agenteNome: string;
  /** Data del pagamento (ISO `YYYY-MM-DD`). */
  data: string;
  righe: RigaPagProvv[];
}

const COLONNE: ColonnaExport<RigaPagProvv>[] = [
  { key: "numero", label: "N°", valore: (r) => r.numero },
  { key: "data", label: "Data", tipo: "data", valore: (r) => r.data },
  { key: "cliente", label: "Cliente", valore: (r) => r.clienteNome },
  { key: "base", label: "Importo", tipo: "euro", totale: true, valore: (r) => r.base },
  { key: "provvigione", label: "Provvigione", tipo: "euro", totale: true, valore: (r) => r.provvigione },
];

/** Modale (controllato) di export/stampa di un pagamento provvigioni. `pagamento` null = chiuso. */
export function EsportaProvvigioni({
  pagamento,
  onClose,
}: {
  pagamento: PagamentoProvv | null;
  onClose: () => void;
}) {
  const nomeBase = pagamento
    ? `Provvigioni ${pagamento.agenteNome} ${formattaDataFileItaliana(pagamento.data)}`.trim()
    : "Provvigioni";
  return (
    <EsportaTabella<RigaPagProvv>
      senzaTrigger
      nomeCompleto
      aperto={!!pagamento}
      onApertoChange={(v) => {
        if (!v) onClose();
      }}
      nomeBase={nomeBase}
      foglio="Provvigioni"
      titolo={pagamento ? `Provvigioni — ${pagamento.agenteNome}` : "Provvigioni"}
      titoloModale="Esporta o stampa provvigioni"
      colonne={COLONNE}
      righe={pagamento?.righe ?? []}
    />
  );
}
