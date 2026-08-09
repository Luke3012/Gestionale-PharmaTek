import type { OrdineDto, RecordDto } from "../../lib/tauri";

/** Un lotto di produzione raggruppa le righe mandate insieme, presentate per ordine. */
export interface GruppoLotto {
  lotto: string;
  ordini: OrdineDto[];
  righeLotto: Map<string, RecordDto[]>;
  dataInvio: string;
  totale: number;
  nInProd: number;
  nArrivati: number;
  unito: boolean;
}
