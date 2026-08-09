// Rotella ⚙️ "Preferenze prodotti" (anagrafica Prodotti): impostazioni globali acconti
// (salvate su `parametri_globali` con ID `prodotti`, condivise da tutti).
import { useEffect, useState } from "react";
import { ActionIcon, Modal, Stack, Text, Tooltip, NumberInput } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { api } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";

export function PreferenzeProdottiButton({ onChanged }: { onChanged?: () => void }) {
  const [aperto, setAperto] = useState(false);
  return (
    <>
      <Tooltip label="Preferenze prodotti" withArrow>
        <ActionIcon variant="default" size="lg" onClick={() => setAperto(true)} aria-label="Preferenze prodotti">
          <IconSettings size={18} />
        </ActionIcon>
      </Tooltip>
      <PreferenzeProdottiModal
        aperto={aperto}
        onClose={() => setAperto(false)}
        onChanged={onChanged}
      />
    </>
  );
}

function PreferenzeProdottiModal({
  aperto,
  onClose,
  onChanged,
}: {
  aperto: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [sogliaPrezzo, setSogliaPrezzo] = useState<number>(300);
  const [accontoBasso, setAccontoBasso] = useState<number>(90);
  const [accontoAlto, setAccontoAlto] = useState<number>(115);

  async function carica() {
    try {
      const res = await api.recordGet("parametri_globali", "prodotti");
      if (res) {
        setSogliaPrezzo(typeof res.data.soglia_prezzo === "number" ? res.data.soglia_prezzo / 100 : 300);
        setAccontoBasso(typeof res.data.acconto_prezzo_basso === "number" ? res.data.acconto_prezzo_basso / 100 : 90);
        setAccontoAlto(typeof res.data.acconto_prezzo_alto === "number" ? res.data.acconto_prezzo_alto / 100 : 115);
      } else {
        setSogliaPrezzo(300);
        setAccontoBasso(90);
        setAccontoAlto(115);
      }
    } catch (e) {
      toast.error(`Caricamento impostazioni non riuscito: ${e}`);
    }
  }

  useEffect(() => {
    if (aperto) carica();
  }, [aperto]);

  async function salva(
    key: "soglia_prezzo" | "acconto_prezzo_basso" | "acconto_prezzo_alto",
    val: number
  ) {
    let nextSoglia = sogliaPrezzo;
    let nextBasso = accontoBasso;
    let nextAlto = accontoAlto;

    if (key === "soglia_prezzo") {
      nextSoglia = val;
      setSogliaPrezzo(nextSoglia);
    } else if (key === "acconto_prezzo_basso") {
      nextBasso = val;
      setAccontoBasso(nextBasso);
    } else if (key === "acconto_prezzo_alto") {
      nextAlto = val;
      setAccontoAlto(nextAlto);
    }

    try {
      const current = await api.recordGet("parametri_globali", "prodotti");
      const fieldsIniziali = {
        soglia_prezzo: Math.round(nextSoglia * 100),
        acconto_prezzo_basso: Math.round(nextBasso * 100),
        acconto_prezzo_alto: Math.round(nextAlto * 100),
      };
      if (current) {
        // Salva soltanto il campo appena toccato: le altre soglie possono essere
        // state aggiornate contemporaneamente da un'altra postazione.
        await api.recordUpdate("parametri_globali", "prodotti", {
          [key]: Math.round(val * 100),
        });
      } else {
        await api.recordCreateId("parametri_globali", "prodotti", fieldsIniziali);
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
      title={<Text fw={700}>Preferenze acconti prodotti</Text>}
      size="md"
      zIndex={1100}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Regole globali per il calcolo dell'acconto standard basato sul prezzo unitario dei prodotti immunoterapia.
        </Text>
        
        <NumberInput
          label="Soglia di prezzo (€)"
          description="Il prezzo di riferimento oltre il quale (o uguale al quale) si applica l'acconto alto"
          value={sogliaPrezzo}
          onChange={(v) => salva("soglia_prezzo", v === "" ? 300 : Number(v))}
          prefix="€ "
          decimalScale={2}
          fixedDecimalScale
          thousandSeparator="."
          decimalSeparator=","
          min={0}
        />

        <NumberInput
          label="Acconto standard per prodotti sotto soglia (€)"
          description="Applicato a ciascun flacone/prodotto dell'ordine con prezzo unitario inferiore alla soglia"
          value={accontoBasso}
          onChange={(v) => salva("acconto_prezzo_basso", v === "" ? 90 : Number(v))}
          prefix="€ "
          decimalScale={2}
          fixedDecimalScale
          thousandSeparator="."
          decimalSeparator=","
          min={0}
        />

        <NumberInput
          label="Acconto standard per prodotti sopra soglia (€)"
          description="Applicato a ciascun flacone/prodotto dell'ordine con prezzo unitario maggiore o uguale alla soglia"
          value={accontoAlto}
          onChange={(v) => salva("acconto_prezzo_alto", v === "" ? 115 : Number(v))}
          prefix="€ "
          decimalScale={2}
          fixedDecimalScale
          thousandSeparator="."
          decimalSeparator=","
          min={0}
        />
      </Stack>
    </Modal>
  );
}
