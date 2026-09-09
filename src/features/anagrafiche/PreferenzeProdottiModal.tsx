// Rotella ⚙️ "Preferenze prodotti" (anagrafica Prodotti): impostazioni globali acconti
// (salvate su `parametri_globali` con ID `prodotti`, condivise da tutti).
import { Modal, Stack, Text } from "@mantine/core";
import { EuroInput } from "../../ui/EuroInput";
import { BottonePreferenze, type PreferenzeModalProps } from "./BottonePreferenze";
import { usePreferenzeGlobali } from "./usePreferenzeGlobali";

type PreferenzeProdotti = {
  soglia_prezzo: number;
  acconto_prezzo_basso: number;
  acconto_prezzo_alto: number;
};

const INIZIALI: PreferenzeProdotti = {
  soglia_prezzo: 300,
  acconto_prezzo_basso: 90,
  acconto_prezzo_alto: 115,
};
const decodifica = (data: Record<string, unknown>): PreferenzeProdotti => ({
  soglia_prezzo: typeof data.soglia_prezzo === "number" ? data.soglia_prezzo / 100 : 300,
  acconto_prezzo_basso: typeof data.acconto_prezzo_basso === "number" ? data.acconto_prezzo_basso / 100 : 90,
  acconto_prezzo_alto: typeof data.acconto_prezzo_alto === "number" ? data.acconto_prezzo_alto / 100 : 115,
});
const codificaCampo = (_key: keyof PreferenzeProdotti, valore: number) =>
  Math.round(valore * 100);
const codifica = (valori: PreferenzeProdotti) => ({
  soglia_prezzo: codificaCampo("soglia_prezzo", valori.soglia_prezzo),
  acconto_prezzo_basso: codificaCampo("acconto_prezzo_basso", valori.acconto_prezzo_basso),
  acconto_prezzo_alto: codificaCampo("acconto_prezzo_alto", valori.acconto_prezzo_alto),
});

export function PreferenzeProdottiButton({ onChanged }: { onChanged?: () => void }) {
  return <BottonePreferenze etichetta="Preferenze prodotti" onChanged={onChanged} Modale={PreferenzeProdottiModal} />;
}

function PreferenzeProdottiModal({
  aperto,
  onClose,
  onChanged,
}: PreferenzeModalProps) {
  const { valori, salva } = usePreferenzeGlobali({
    id: "prodotti", aperto, iniziali: INIZIALI, decodifica, codifica, codificaCampo, onChanged,
  });

  return (
    <Modal
      opened={aperto}
      onClose={onClose}
      title={<Text fw={700}>Preferenze acconti prodotti</Text>}
      size="md"
      zIndex={1100}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Regole globali per il calcolo dell'acconto standard basato sul prezzo unitario dei prodotti immunoterapia.
        </Text>
        
        <EuroInput
          label="Soglia di prezzo (€)"
          description="Il prezzo di riferimento oltre il quale (o uguale al quale) si applica l'acconto alto"
          value={valori.soglia_prezzo}
          onChange={(v) => salva("soglia_prezzo", v === "" ? 300 : Number(v))}
          min={0}
        />

        <EuroInput
          label="Acconto standard per prodotti sotto soglia (€)"
          description="Applicato a ciascun flacone/prodotto dell'ordine con prezzo unitario inferiore alla soglia"
          value={valori.acconto_prezzo_basso}
          onChange={(v) => salva("acconto_prezzo_basso", v === "" ? 90 : Number(v))}
          min={0}
        />

        <EuroInput
          label="Acconto standard per prodotti sopra soglia (€)"
          description="Applicato a ciascun flacone/prodotto dell'ordine con prezzo unitario maggiore o uguale alla soglia"
          value={valori.acconto_prezzo_alto}
          onChange={(v) => salva("acconto_prezzo_alto", v === "" ? 115 : Number(v))}
          min={0}
        />
      </Stack>
    </Modal>
  );
}
