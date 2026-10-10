import type { Spedizione } from "../../lib/tauri";
import { rigaHaDatiVaccino } from "./datiVaccino";

/** Il popover salva solo dati logistici: non deve ripristinare la fotografia
 * contabile (né le righe aggiunte/rimosse) ricevuta quando è stato aperto. */
export function applicaDatiSpedizioneSalvati(attuale: Spedizione, salvata: Spedizione): Spedizione {
  const numeri = new Map(salvata.righe.map((r) => [r.rigaId, r.numero]));
  const righe = attuale.righe.map((r) => numeri.has(r.rigaId)
    ? { ...r, numero: numeri.get(r.rigaId)! }
    : r);
  return {
    ...attuale,
    clienteNome: salvata.clienteNome,
    indirizzo: salvata.indirizzo,
    cap: salvata.cap,
    citta: salvata.citta,
    prov: salvata.prov,
    regione: salvata.regione,
    telefono: salvata.telefono,
    email: salvata.email,
    colli: salvata.colli,
    peso: salvata.peso,
    colliExport: salvata.colliExport,
    pesoExport: salvata.pesoExport,
    preavviso: salvata.preavviso,
    numero: righe.length ? righe.filter(rigaHaDatiVaccino)
      .map((r) => r.numero).filter(Boolean).join(" + ") : salvata.numero,
    righe,
  };
}
