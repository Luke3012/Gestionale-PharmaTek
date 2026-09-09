// Rotella ⚙️ "Preferenze conti" (anagrafica Conti): impostazioni UNIVERSALI
// (salvate sui record `conto`, condivise da tutti) — non preferenze per-utente.
// Per ora: conto predefinito incassi (modale "Salda") e conto accrediti corrieri.
import { useEffect, useMemo, useState } from "react";
import { Modal, Select, Stack, Text } from "@mantine/core";
import { api, type RecordDto } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { èContoTransito, opzioniConti } from "../contabilita/contoPreferito";
import { BottonePreferenze, type PreferenzeModalProps } from "./BottonePreferenze";

export function PreferenzeContiButton({ onChanged }: { onChanged?: () => void }) {
  return <BottonePreferenze etichetta="Preferenze conti" onChanged={onChanged} Modale={PreferenzeContiModal} />;
}

function PreferenzeContiModal({
  aperto,
  onClose,
  onChanged,
}: PreferenzeModalProps) {
  const [conti, setConti] = useState<RecordDto[]>([]);

  async function carica() {
    try {
      setConti(await api.recordsList("conto"));
    } catch (e) {
      toast.error(`Caricamento conti non riuscito: ${e}`);
    }
  }

  useEffect(() => {
    if (aperto) carica();
  }, [aperto]);

  // Solo conti bancari (i conti di transito Contrassegno/Assegno non sono destinazioni).
  const bancari = useMemo(
    () =>
      opzioniConti(conti.filter((c) => !èContoTransito(c.data.tipo))),
    [conti]
  );

  const incassi = conti.find((c) => c.data.predefinito_incassi === true)?.id ?? null;
  const acconti = conti.find((c) => c.data.predefinito_acconti === true)?.id ?? null;
  const accrediti = conti.find((c) => c.data.predefinito_accrediti === true)?.id ?? null;
  const rimborsi = conti.find((c) => c.data.predefinito_rimborsi === true)?.id ?? null;

  async function imposta(contoId: string | null, ruolo: "incassi" | "accrediti" | "acconti" | "rimborsi") {
    if (!contoId) return;
    try {
      await api.contoPredefinitoSet(contoId, ruolo);
      await carica();
      onChanged?.();
    } catch (e) {
      toast.error(`Impostazione non riuscita: ${e}`);
    }
  }

  return (
    <Modal
      opened={aperto}
      onClose={onClose}
      title={<Text fw={700}>Preferenze conti</Text>}
      size="md"
      zIndex={1100}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Conti proposti in automatico durante le registrazioni. Valgono per tutti i PC.
        </Text>
        <Select
          label="Conto predefinito incassi"
          description="proposto quando si salda un pagamento"
          placeholder="Scegli un conto…"
          data={bancari}
          value={incassi}
          onChange={(v) => imposta(v, "incassi")}
          searchable
          comboboxProps={{ withinPortal: true, zIndex: 1300 }}
        />
        <Select
          label="Conto preferito acconti"
          description="proposto per gli acconti (se medico/agente non ne hanno uno)"
          placeholder="Come gli incassi"
          data={bancari}
          value={acconti}
          onChange={(v) => imposta(v, "acconti")}
          searchable
          clearable
          comboboxProps={{ withinPortal: true, zIndex: 1300 }}
        />
        <Select
          label="Conto accrediti corrieri"
          description="dove arrivano i bonifici delle distinte (FASE spedizioni)"
          placeholder="Scegli un conto…"
          data={bancari}
          value={accrediti}
          onChange={(v) => imposta(v, "accrediti")}
          searchable
          comboboxProps={{ withinPortal: true, zIndex: 1300 }}
        />
        <Select
          label="Conto predefinito rimborsi"
          description="proposto quando si emette un rimborso"
          placeholder="Scegli un conto…"
          data={bancari}
          value={rimborsi}
          onChange={(v) => imposta(v, "rimborsi")}
          searchable
          clearable
          comboboxProps={{ withinPortal: true, zIndex: 1300 }}
        />
      </Stack>
    </Modal>
  );
}
