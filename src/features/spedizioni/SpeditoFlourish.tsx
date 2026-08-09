import type { ReactNode } from "react";
import { IconTruckDelivery } from "@tabler/icons-react";
import { CompletamentoFlourish } from "../../ui/CompletamentoFlourish";

export function SpeditoFlourish({
  attivo,
  onFine,
  distinta,
}: {
  attivo: boolean;
  onFine: () => void;
  distinta?: ReactNode;
}) {
  return (
    <CompletamentoFlourish
      attivo={attivo}
      onFine={onFine}
      azione={distinta}
      Icona={IconTruckDelivery}
      titolo="Spedito!"
      descrizione={
        <>
          Vuoi creare la <b>distinta del corriere</b> per questa spedizione?
        </>
      }
      timbro="SPEDITO"
    />
  );
}
