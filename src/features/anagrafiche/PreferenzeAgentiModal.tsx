// Rotella ⚙️ "Preferenze agenti" (anagrafica Agenti): impostazioni globali
// (salvate su `parametri_globali` con ID `agenti`, condivise da tutti).
import { Modal, Stack, Switch, Text } from "@mantine/core";
import { EuroInput } from "../../ui/EuroInput";
import { BottonePreferenze, type PreferenzeModalProps } from "./BottonePreferenze";
import { usePreferenzeGlobali } from "./usePreferenzeGlobali";

type PreferenzeAgenti = {
  scorpora_iva: boolean;
  detrai_spedizione: boolean;
  quota_spedizione: number;
};

const INIZIALI: PreferenzeAgenti = {
  scorpora_iva: true,
  detrai_spedizione: true,
  quota_spedizione: 0,
};
const decodifica = (data: Record<string, unknown>): PreferenzeAgenti => ({
  scorpora_iva: data.scorpora_iva !== false,
  detrai_spedizione: data.detrai_spedizione !== false,
  quota_spedizione: typeof data.quota_spedizione === "number" ? data.quota_spedizione / 100 : 0,
});
const codificaCampo = (key: keyof PreferenzeAgenti, valore: boolean | number) =>
  key === "quota_spedizione" ? Math.round(Number(valore) * 100) : valore;
const codifica = (valori: PreferenzeAgenti) => ({
  ...valori,
  quota_spedizione: codificaCampo("quota_spedizione", valori.quota_spedizione),
});

export function PreferenzeAgentiButton({ onChanged }: { onChanged?: () => void }) {
  return <BottonePreferenze etichetta="Preferenze agenti" onChanged={onChanged} Modale={PreferenzeAgentiModal} />;
}

function PreferenzeAgentiModal({
  aperto,
  onClose,
  onChanged,
}: PreferenzeModalProps) {
  const { valori, salva } = usePreferenzeGlobali({
    id: "agenti", aperto, iniziali: INIZIALI, decodifica, codifica, codificaCampo, onChanged,
  });

  return (
    <Modal
      opened={aperto}
      onClose={onClose}
      title={<Text fw={700}>Preferenze agenti</Text>}
      size="md"
      zIndex={1100}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Regole di calcolo globali per le provvigioni degli agenti (percentuali). Valgono per tutti i PC.
        </Text>
        <Switch
          label="Calcola provvigioni percentuali su imponibile (scorpora IVA 10%)"
          description="Se attivo, scorpora l'IVA del 10% prima di calcolare la percentuale provvigionale"
          checked={valori.scorpora_iva}
          onChange={(e) => salva("scorpora_iva", e.currentTarget.checked)}
        />
        <Switch
          label="Detrai spese di spedizione"
          description="Se attivo, esclude le spese di spedizione inserite sotto prima di calcolare la provvigione"
          checked={valori.detrai_spedizione}
          onChange={(e) => salva("detrai_spedizione", e.currentTarget.checked)}
        />
        <EuroInput
          label="Spese di spedizione standard (€)"
          description="L'importo flat detratto da ogni ordine se la detrazione è attiva"
          value={valori.quota_spedizione}
          onChange={(v) => salva("quota_spedizione", v === "" ? 0 : Number(v))}
          min={0}
          disabled={!valori.detrai_spedizione}
        />
      </Stack>
    </Modal>
  );
}
