import type { ReactNode } from "react";
import { IconFlask2 } from "@tabler/icons-react";
import { CompletamentoFlourish } from "../../ui/CompletamentoFlourish";

export function InProduzioneFlourish({
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
      Icona={IconFlask2}
      titolo="Lotto creato!"
      descrizione={
        <>
          Vuoi esportare il <b>file Excel</b> per l'invio al laboratorio?
        </>
      }
      timbro="FATTO"
    />
  );
}
