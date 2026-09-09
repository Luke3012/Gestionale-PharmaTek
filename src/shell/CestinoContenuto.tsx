// Contenuto del Cestino, riusabile (FASE 6D): il pop-over in topbar e la finestra
// «Cestino» (aperta dallo Spotlight) condividono lo stesso hook dati + la stessa
// lista (ripristina / elimina definitivamente / svuota).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  LoadingOverlay,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconRestore, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { api, type CestinoItem } from "../lib/tauri";
import { dialog } from "../ui/dialog/store";
import { toast } from "../ui/toast/store";
import { centsToEurStr } from "../lib/money";
import { formattaDataItaliana, isoLocale } from "../lib/date";
import { VirtualStack } from "../ui/VirtualStack";
import { calcolaSogliaVirtualizzazione } from "../ui/virtualizzazione";
import { useAnimazioniRidotte } from "../ui/motion";
import { useRicaricaSuEventi } from "../lib/useRicaricaSuEventi";
import { ricalcolaNotificheSubito } from "../features/notifiche/ricalcolaNotifiche";

const ALTEZZA_RIGA_STIMATA = 58;
const GAP_RIGHE = 4;
const EVENTI_RICARICA_CESTINO = ["pt:dati-modificati", "pt:proiezione-ricostruita"] as const;

const NOMI_ENTITA: Record<string, string> = {
  agente: "Agente",
  medico: "Medico",
  cliente: "Cliente",
  prodotto: "Prodotto",
  conto: "Conto",
  corriere: "Corriere",
  regola_prezzo: "Regola prezzo",
  ordine: "Ordine",
  riga_ordine: "Riga ordine",
  pagamento: "Pagamento",
  distinta: "Distinta corriere",
  rimborso: "Rimborso",
  promemoria: "Promemoria",
  preventivo: "Preventivo",
};

function etichetta(it: CestinoItem): string {
  const tipo = NOMI_ENTITA[it.entity] ?? it.entity;
  let nome = (it.data.nome as string) || "";
  if (it.entity === "ordine") nome = `del ${(it.data.data as string) ?? "?"}`;
  else if (it.entity === "pagamento") {
    const imp = typeof it.data.importo === "number" ? it.data.importo : 0;
    nome = `€ ${centsToEurStr(imp)}${it.data.tipo ? ` (${it.data.tipo})` : ""}`;
  } else if (it.entity === "rimborso") {
    const imp = typeof it.data.importo === "number" ? it.data.importo : 0;
    nome = `€ ${centsToEurStr(imp)}${it.data.ragione_sociale ? ` · ${it.data.ragione_sociale}` : ""}`;
  } else if (it.entity === "promemoria") {
    const testo = (it.data.testo as string) || "";
    nome = testo.length > 40 ? `${testo.slice(0, 40)}…` : testo;
  } else if (it.entity === "preventivo") {
    const numeroPreventivo = String(it.data.numero_preventivo ?? "").trim();
    const numeroOrdine = String(it.data.ordine_numero ?? "").trim();
    nome = numeroPreventivo
      ? numeroPreventivo
      : numeroOrdine
        ? `ordine ${numeroOrdine}`
        : "";
  }
  return nome ? `${tipo} · ${nome}` : tipo;
}

/** Hook dati del Cestino: carica gli elementi (con refresh periodico) + azioni. */
export function useCestino() {
  const [items, setItems] = useState<CestinoItem[]>([]);
  const [svuotando, setSvuotando] = useState(false);

  const carica = useCallback(async () => {
    try {
      setItems(await api.cestino());
    } catch {
      /* vuoto */
    }
  }, []);

  useEffect(() => {
    void carica();
    const iv = setInterval(() => void carica(), 12000);
    return () => clearInterval(iv);
  }, [carica]);

  useRicaricaSuEventi(EVENTI_RICARICA_CESTINO, carica, 250);

  const ripristina = useCallback(
    async (it: CestinoItem) => {
      try {
        if (it.entity === "preventivo") await api.preventivoRipristina(it.id);
        else await api.recordRestore(it.entity, it.id);
        await carica();
      } catch (e) {
        toast.error(`Ripristino non riuscito: ${e}`);
        throw e;
      }
    },
    [carica]
  );

  const elimina = useCallback(
    async (it: CestinoItem) => {
      const ok = await dialog.confirmDanger(
        "Eliminare definitivamente?",
        `«${etichetta(it)}» non sarà più ripristinabile.`,
        { conferma: "Elimina per sempre" }
      );
      if (!ok) return;
      try {
        if (it.entity === "preventivo") await api.preventivoPurge(it.id);
        else await api.recordPurge(it.entity, it.id);
        await ricalcolaNotificheSubito();
        void carica();
      } catch (e) {
        toast.error(`Eliminazione non riuscita: ${e}`);
      }
    },
    [carica]
  );

  const svuota = useCallback(async () => {
    const ok = await dialog.confirmDanger(
      "Svuotare il Cestino?",
      `${items.length} elemento/i verranno eliminati definitivamente.`,
      { conferma: "Svuota" }
    );
    if (!ok) return false;
    setSvuotando(true);
    try {
      await api.cestinoSvuota();
      await ricalcolaNotificheSubito();
      void carica();
      return true;
    } catch (e) {
      toast.error(`Operazione non riuscita: ${e}`);
      return false;
    } finally {
      setSvuotando(false);
    }
  }, [items.length, carica]);

  return { items, carica, ripristina, elimina, svuota, svuotando };
}

/** Lista presentazionale del Cestino (header + righe). */
export function CestinoContenuto({
  items,
  ripristina,
  elimina,
  svuota,
  svuotando = false,
  altezzaMax = 300,
}: {
  items: CestinoItem[];
  ripristina: (it: CestinoItem) => Promise<void> | void;
  elimina: (it: CestinoItem) => void;
  svuota: () => Promise<boolean | void> | boolean | void;
  svuotando?: boolean;
  altezzaMax?: number;
}) {
  const [ripristinati, setRipristinati] = useState<Record<string, boolean>>({});
  const [fantasmiRipristinati, setFantasmiRipristinati] = useState<
    Record<string, { item: CestinoItem; indice: number }>
  >({});
  const ridotte = useAnimazioniRidotte();

  const keyItem = (it: CestinoItem) => `${it.entity}-${it.id}`;
  const itemsVisualizzati = useMemo(() => {
    const presenti = new Set(items.map(keyItem));
    const result = [...items];
    Object.entries(fantasmiRipristinati)
      .filter(([key]) => !presenti.has(key))
      .sort(([, a], [, b]) => a.indice - b.indice)
      .forEach(([, fantasma]) => {
        result.splice(
          Math.min(Math.max(0, fantasma.indice), result.length),
          0,
          fantasma.item,
        );
      });
    return result;
  }, [items, fantasmiRipristinati]);
  const virtualizza =
    itemsVisualizzati.length >
    calcolaSogliaVirtualizzazione(
      altezzaMax,
      ALTEZZA_RIGA_STIMATA,
      GAP_RIGHE,
    );

  const gestisciRipristina = async (it: CestinoItem) => {
    const key = keyItem(it);
    const indice = Math.max(
      0,
      itemsVisualizzati.findIndex((item) => keyItem(item) === key),
    );
    setRipristinati((prev) => ({ ...prev, [key]: true }));
    setFantasmiRipristinati((prev) => ({
      ...prev,
      [key]: { item: it, indice },
    }));
    try {
      await ripristina(it);
      // Il refresh realtime può togliere subito l'elemento dal Cestino. Manteniamo
      // comunque il feedback abbastanza a lungo da poter essere letto.
      if (!ridotte) await new Promise((resolve) => setTimeout(resolve, 1100));
      setFantasmiRipristinati((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setRipristinati((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch {
      setRipristinati((prev) => ({ ...prev, [key]: false }));
      setFantasmiRipristinati((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  return (
    <Box pos="relative">
      <LoadingOverlay
        visible={svuotando}
        zIndex={10}
        overlayProps={{ radius: "sm", backgroundOpacity: 0.72 }}
        loaderProps={{ color: "red", size: "sm", type: "dots" }}
      />
      <Group justify="space-between" mb="xs">
        <Text fw={700} size="sm">
          Cestino
        </Text>
        {items.length > 0 && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="red"
            onClick={svuota}
            disabled={svuotando}
          >
            Svuota
          </Button>
        )}
      </Group>
      {itemsVisualizzati.length === 0 ? (
        <Text size="xs" c="dimmed" py="xs">
          Il cestino è vuoto.
        </Text>
      ) : (
        virtualizza ? (
          <VirtualStack
            items={itemsVisualizzati}
            getKey={keyItem}
            maxHeight={altezzaMax}
            gap={GAP_RIGHE}
            estimateHeight={ALTEZZA_RIGA_STIMATA}
            overscan={3}
            renderItem={(it) => (
              <RigaCestino
                it={it}
                ripristinato={!!ripristinati[keyItem(it)]}
                onRipristina={() => gestisciRipristina(it)}
                onElimina={() => elimina(it)}
                layout={false}
              />
            )}
          />
        ) : (
          <ScrollArea.Autosize mah={altezzaMax} type="scroll" scrollbars="y" styles={{ viewport: { overflowX: "hidden" } }}>
            <Stack gap={GAP_RIGHE}>
              <AnimatePresence initial={false}>
                {itemsVisualizzati.map((it) => (
                  <RigaCestino
                    key={keyItem(it)}
                    it={it}
                    ripristinato={!!ripristinati[keyItem(it)]}
                    onRipristina={() => gestisciRipristina(it)}
                    onElimina={() => elimina(it)}
                    layout
                  />
                ))}
              </AnimatePresence>
            </Stack>
          </ScrollArea.Autosize>
        )
      )}
    </Box>
  );
}

function RigaCestino({
  it,
  ripristinato,
  onRipristina,
  onElimina,
  layout,
}: {
  it: CestinoItem;
  ripristinato: boolean;
  onRipristina: () => void;
  onElimina: () => void;
  layout: boolean;
}) {
  const ridotte = useAnimazioniRidotte();

  return (
    <motion.div
      layout={layout}
      exit={{ opacity: 0, height: 0, scale: 0.95 }}
      transition={{ duration: ridotte ? 0 : 0.2 }}
      style={{ overflow: "hidden" }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {ripristinato ? (
          <motion.div
            key="ripristinato"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: ridotte ? 0 : 0.15 }}
          >
            <Group
              h={36}
              px={12}
              style={{
                background: "var(--mantine-color-teal-light)",
                borderRadius: 6,
                color: "var(--mantine-color-teal-light-color)",
              }}
              align="center"
              justify="center"
              gap={6}
            >
              <motion.div
                animate={ridotte ? {} : { rotate: -360 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                style={{ display: "flex", alignItems: "center" }}
              >
                <IconRestore size={14} />
              </motion.div>
              <Text size="xs" fw={700}>Ripristinato!</Text>
            </Group>
          </motion.div>
        ) : (
          <motion.div
            key="contenuto"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: ridotte ? 0 : 0.15 }}
          >
            <Box
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                alignItems: "start",
                columnGap: 8,
                minHeight: 40,
                width: "100%",
                minWidth: 0,
                overflow: "hidden",
                paddingBlock: 2,
              }}
            >
              <Box style={{ minWidth: 0, overflow: "hidden" }}>
                <Text
                  size="sm"
                  style={{
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    lineHeight: 1.25,
                  }}
                >
                  {etichetta(it)}
                </Text>
                <Text size="xs" c="dimmed">
                  {it.deletedMs ? formattaDataItaliana(isoLocale(new Date(it.deletedMs))) : "—"}
                </Text>
              </Box>
              <Group gap={2} wrap="nowrap" style={{ flexShrink: 0, alignSelf: "center" }}>
                <Tooltip label="Ripristina" withArrow>
                  <ActionIcon size="sm" variant="subtle" color="teal" onClick={onRipristina}>
                    <IconRestore size={15} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Elimina definitivamente" withArrow>
                  <ActionIcon size="sm" variant="subtle" color="red" onClick={onElimina}>
                    <IconX size={15} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
