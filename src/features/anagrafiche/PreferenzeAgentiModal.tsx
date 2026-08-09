// Rotella ⚙️ "Preferenze agenti" (anagrafica Agenti): impostazioni globali
// (salvate su `parametri_globali` con ID `agenti`, condivise da tutti).
import { useEffect, useState } from "react";
import { ActionIcon, Modal, Stack, Switch, Text, Tooltip, NumberInput } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { api } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";

export function PreferenzeAgentiButton({ onChanged }: { onChanged?: () => void }) {
  const [aperto, setAperto] = useState(false);
  return (
    <>
      <Tooltip label="Preferenze agenti" withArrow>
        <ActionIcon variant="default" size="lg" onClick={() => setAperto(true)} aria-label="Preferenze agenti">
          <IconSettings size={18} />
        </ActionIcon>
      </Tooltip>
      <PreferenzeAgentiModal
        aperto={aperto}
        onClose={() => setAperto(false)}
        onChanged={onChanged}
      />
    </>
  );
}

function PreferenzeAgentiModal({
  aperto,
  onClose,
  onChanged,
}: {
  aperto: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [scorporaIva, setScorporaIva] = useState(true);
  const [detraiSpedizione, setDetraiSpedizione] = useState(true);
  const [quotaSpedizione, setQuotaSpedizione] = useState<number>(0);

  async function carica() {
    try {
      const res = await api.recordGet("parametri_globali", "agenti");
      if (res) {
        setScorporaIva(res.data.scorpora_iva !== false);
        setDetraiSpedizione(res.data.detrai_spedizione !== false);
        setQuotaSpedizione(typeof res.data.quota_spedizione === "number" ? res.data.quota_spedizione / 100 : 0);
      } else {
        setScorporaIva(true);
        setDetraiSpedizione(true);
        setQuotaSpedizione(0);
      }
    } catch (e) {
      toast.error(`Caricamento impostazioni non riuscito: ${e}`);
    }
  }

  useEffect(() => {
    if (aperto) carica();
  }, [aperto]);

  async function salva(
    key: "scorpora_iva" | "detrai_spedizione" | "quota_spedizione",
    val: boolean | number
  ) {
    let nextIva = scorporaIva;
    let nextDetrai = detraiSpedizione;
    let nextQuota = quotaSpedizione;

    if (key === "scorpora_iva") {
      nextIva = val as boolean;
      setScorporaIva(nextIva);
    } else if (key === "detrai_spedizione") {
      nextDetrai = val as boolean;
      setDetraiSpedizione(nextDetrai);
    } else if (key === "quota_spedizione") {
      nextQuota = val as number;
      setQuotaSpedizione(nextQuota);
    }

    try {
      const current = await api.recordGet("parametri_globali", "agenti");
      const fieldsIniziali = {
        scorpora_iva: nextIva,
        detrai_spedizione: nextDetrai,
        quota_spedizione: Math.round(nextQuota * 100),
      };
      if (current) {
        // Una preferenza modificata su questo PC non deve riscrivere anche le altre:
        // potrebbero essere state cambiate nel frattempo da un'altra postazione.
        const fieldModificato: Record<string, boolean | number> = {
          [key]: key === "quota_spedizione" ? Math.round(Number(val) * 100) : val,
        };
        await api.recordUpdate("parametri_globali", "agenti", fieldModificato);
      } else {
        await api.recordCreateId("parametri_globali", "agenti", fieldsIniziali);
      }
      onChanged?.();
    } catch (e) {
      toast.error(`Salvataggio impostazione non riuscito: ${e}`);
      carica(); // ripristina in caso di errore
    }
  }

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
          checked={scorporaIva}
          onChange={(e) => salva("scorpora_iva", e.currentTarget.checked)}
        />
        <Switch
          label="Detrai spese di spedizione"
          description="Se attivo, esclude le spese di spedizione inserite sotto prima di calcolare la provvigione"
          checked={detraiSpedizione}
          onChange={(e) => salva("detrai_spedizione", e.currentTarget.checked)}
        />
        <NumberInput
          label="Spese di spedizione standard (€)"
          description="L'importo flat detratto da ogni ordine se la detrazione è attiva"
          value={quotaSpedizione}
          onChange={(v) => salva("quota_spedizione", v === "" ? 0 : Number(v))}
          prefix="€ "
          decimalScale={2}
          fixedDecimalScale
          thousandSeparator="."
          decimalSeparator=","
          min={0}
          disabled={!detraiSpedizione}
        />
      </Stack>
    </Modal>
  );
}
