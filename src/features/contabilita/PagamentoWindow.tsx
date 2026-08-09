// Finestra dedicata "Dettaglio pagamento" — aperta dalla ricerca globale per saldare
// rapidamente un credito. Carica il pagamento dall'id passato in query, riusa lo stesso
// PagamentoForm della modale e si chiude al salvataggio. L'invalidazione delle
// altre finestre viene emessa dal backend insieme alla scrittura.
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Group, Text, ThemeIcon } from "@mantine/core";
import { IconCashBanknote } from "@tabler/icons-react";
import { api, inTauri, type Pagamento } from "../../lib/tauri";
import { useRicordaGeometria } from "../../lib/geometriaFinestre";
import { PagamentoForm, type PagamentoModalTarget } from "./PagamentoModal";
import { chiudiFinestraCorrente as chiudiFinestra } from "../../lib/finestreTauri";

export function PagamentoWindow() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("pagamento") || "";
  const salda = params.get("salda") === "1";
  const unsubsRef = useRef<Array<() => void>>([]);

  const [target, setTarget] = useState<PagamentoModalTarget | null>(null);
  const [numeroOrdine, setNumeroOrdine] = useState("");
  const [errore, setErrore] = useState<string | null>(null);

  useRicordaGeometria("pagamento-dettaglio");

  const caricaTarget = useCallback(async () => {
    try {
      // Vista (porta nomi cliente/conto) + record (note + distinta) → oggetto Pagamento.
      const [viste, rec] = await Promise.all([
        api.pagamentiVista(),
        api.recordGet("pagamento", id).catch(() => null),
      ]);
      const r = viste.find((v) => v.id === id);
      if (!r || rec?.deleted) {
        setErrore("Pagamento non trovato (forse è stato eliminato).");
        return false;
      }
      const pagamento: Pagamento = {
        id: r.id,
        revision: rec?.revision || r.revision,
        ordineId: r.ordineId,
        tipo: r.tipo as Pagamento["tipo"],
        importo: r.importo,
        saldato: r.saldato,
        scadenza: r.scadenza,
        contoId: r.contoId,
        contoNome: r.contoNome,
        contoTipo: r.contoTipo,
        data: r.data,
        verificato: r.verificato,
        distintaId: (rec?.data.distinta_id as string) || "",
        contoAccreditoNome: r.contoAccreditoNome,
        note: (rec?.data.note as string) || "",
        scadDaSpedizione: (rec?.data.scad_da_spedizione as boolean) || false,
        scadRelGiorni: (rec?.data.scad_rel_giorni as number) || 0,
      };
      setErrore(null);
      setNumeroOrdine(r.ordineNumero || "");
      // saldaSubito solo se è ancora da incassare (un già-saldato si apre in dettaglio).
      setTarget({ pagamento, saldaSubito: salda && !r.saldato });
      return true;
    } catch (e) {
      setErrore(`Apertura non riuscita: ${e}`);
      return false;
    }
  }, [id, salda]);

  useEffect(() => {
    void caricaTarget();
  }, [caricaTarget]);

  // Chiude la finestra se il pagamento viene eliminato altrove
  useEffect(() => {
    if (!id || !inTauri) return;

    const controllaStatoPagamento = async () => {
      if ((window as any).eliminatoDaMe) return;
      try {
        const rec = await api.recordGet("pagamento", id);
        if (!rec || rec.deleted) {
          const { dialog } = await import("../../ui/dialog/store");
          await dialog.alert(
            "Pagamento eliminato",
            "Questo pagamento è stato eliminato da un'altra postazione. Questa finestra verrà chiusa.",
            "warning"
          );
          chiudiFinestra();
        } else {
          await caricaTarget();
        }
      } catch {}
    };

    import("@tauri-apps/api/event").then(({ listen }) => {
      Promise.all([
        listen("pagamento:salvato", controllaStatoPagamento),
        listen("ordine:salvato", controllaStatoPagamento),
        listen("pt:proiezione-ricostruita", controllaStatoPagamento),
      ]).then((fns) => {
        unsubsRef.current = fns;
      });
    });

    return () => {
      unsubsRef.current.forEach((u) => u());
    };
  }, [id, caricaTarget]);

  if (errore) {
    return (
      <Box style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text c="dimmed" ta="center">
          {errore}
        </Text>
      </Box>
    );
  }
  if (!target) return <Box style={{ flex: 1, height: "100vh", background: "var(--bg)" }} />;

  return (
    <Box className="pt-payment-window" style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--surface)" }}>
      <Group className="pt-payment-window-header" p="md" gap="sm" wrap="nowrap" style={{ borderBottom: "1px solid var(--border)" }}>
        <ThemeIcon size={38} radius="md" variant="light" color="accent">
          <IconCashBanknote size={20} />
        </ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Text fw={700}>{target.saldaSubito ? "Salda pagamento" : "Dettaglio pagamento"}</Text>
          {numeroOrdine && (
            <Text size="xs" c="dimmed">
              Ordine {numeroOrdine}
            </Text>
          )}
        </Box>
      </Group>
      <Box className="pt-window-form pt-payment-window-form" style={{ padding: 16 }}>
        <PagamentoForm
          key={target.pagamento?.id || "nuovo"}
          target={target}
          onClose={() => void chiudiFinestra()}
          onChanged={async () => {
            unsubsRef.current.forEach((u) => u());
            await chiudiFinestra();
          }}
          dentroFinestra={true}
        />
      </Box>
    </Box>
  );
}
