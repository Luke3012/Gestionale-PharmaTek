import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { IconBell, IconSearch } from "@tabler/icons-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Preventivo } from "../../lib/tauri";
import { centsToEurStr } from "../../lib/money";
import { VirtualStack } from "../../ui/VirtualStack";
import type { GruppoSollecitiPreventivi } from "./sollecitiPreventivi";
import { testoRicercaPreventivo } from "./ricercaPreventivi";

const FORMATO_DATA_PREVENTIVO = new Intl.DateTimeFormat("it-IT");

function dataPreventivo(preventivo: Preventivo): string {
  return preventivo.creatoMs
    ? FORMATO_DATA_PREVENTIVO.format(preventivo.creatoMs)
    : "Data non disponibile";
}

function testoRicerca(preventivo: Preventivo): string {
  return [
    testoRicercaPreventivo(preventivo),
    dataPreventivo(preventivo),
  ]
    .join(" ")
    .toLocaleLowerCase("it");
}

function chiavePreventivo(preventivo: Preventivo): string {
  return preventivo.id;
}

export function SelettoreSollecitiPreventiviModal({
  opened,
  daInviare,
  daSollecitare,
  onClose,
  onConferma,
}: {
  opened: boolean;
  daInviare: Preventivo[];
  daSollecitare: Preventivo[];
  onClose: () => void;
  onConferma: (
    gruppo: GruppoSollecitiPreventivi,
    preventivi: Preventivo[],
  ) => void;
}) {
  const [cerca, setCerca] = useState("");
  const cercaDifferita = useDeferredValue(cerca.trim().toLocaleLowerCase("it"));
  const [gruppo, setGruppo] =
    useState<GruppoSollecitiPreventivi>("da_inviare");
  const [selezionati, setSelezionati] = useState<
    Record<GruppoSollecitiPreventivi, Set<string>>
  >(() => ({ da_inviare: new Set(), da_sollecitare: new Set() }));
  const eraApertoRef = useRef(false);
  const toccatiRef = useRef<
    Record<GruppoSollecitiPreventivi, Set<string>>
  >({ da_inviare: new Set(), da_sollecitare: new Set() });

  useEffect(() => {
    if (opened && !eraApertoRef.current) {
      toccatiRef.current = {
        da_inviare: new Set(),
        da_sollecitare: new Set(),
      };
      setCerca("");
      setGruppo(daInviare.length ? "da_inviare" : "da_sollecitare");
      setSelezionati({
        da_inviare: new Set(daInviare.map((preventivo) => preventivo.id)),
        da_sollecitare: new Set(
          daSollecitare.map((preventivo) => preventivo.id),
        ),
      });
    }
    eraApertoRef.current = opened;
  }, [daInviare, daSollecitare, opened]);

  // Le due sorgenti arrivano dalla stessa lista realtime della pagina. Durante
  // l'apertura rimuoviamo gli elementi non più candidati e preselezioniamo quelli
  // nuovi, senza riattivare una voce deselezionata manualmente.
  useEffect(() => {
    if (!opened) return;
    const sorgenti = {
      da_inviare: daInviare,
      da_sollecitare: daSollecitare,
    };
    setSelezionati((correnti) => {
      const prossimi = {
        da_inviare: new Set<string>(),
        da_sollecitare: new Set<string>(),
      };
      for (const chiave of [
        "da_inviare",
        "da_sollecitare",
      ] as GruppoSollecitiPreventivi[]) {
        const idsPresenti = new Set(
          sorgenti[chiave].map((preventivo) => preventivo.id),
        );
        for (const id of correnti[chiave]) {
          if (idsPresenti.has(id)) prossimi[chiave].add(id);
        }
        for (const id of idsPresenti) {
          if (!toccatiRef.current[chiave].has(id)) {
            prossimi[chiave].add(id);
          }
        }
      }
      return prossimi;
    });
  }, [daInviare, daSollecitare, opened]);

  useEffect(() => {
    if (!opened) return;
    if (
      gruppo === "da_inviare" &&
      daInviare.length === 0 &&
      daSollecitare.length > 0
    ) {
      setGruppo("da_sollecitare");
    } else if (
      gruppo === "da_sollecitare" &&
      daSollecitare.length === 0 &&
      daInviare.length > 0
    ) {
      setGruppo("da_inviare");
    }
  }, [daInviare.length, daSollecitare.length, gruppo, opened]);

  const candidati =
    gruppo === "da_inviare" ? daInviare : daSollecitare;
  const selezionatiAttivi = selezionati[gruppo];
  const indicizzati = useMemo(
    () =>
      candidati.map((preventivo) => ({
        preventivo,
        testo: testoRicerca(preventivo),
      })),
    [candidati],
  );
  const visibili = useMemo(
    () =>
      indicizzati
        .filter(
          ({ testo }) => !cercaDifferita || testo.includes(cercaDifferita),
        )
        .sort(
          (a, b) =>
            (gruppo === "da_sollecitare"
              ? Math.max(
                  a.preventivo.ultimoInvioMs,
                  a.preventivo.ultimoSollecitoMs,
                ) -
                Math.max(
                  b.preventivo.ultimoInvioMs,
                  b.preventivo.ultimoSollecitoMs,
                )
              : b.preventivo.creatoMs - a.preventivo.creatoMs) ||
            a.preventivo.numeroPreventivo.localeCompare(
              b.preventivo.numeroPreventivo,
              "it",
              { numeric: true },
            ),
        )
        .map(({ preventivo }) => preventivo),
    [cercaDifferita, gruppo, indicizzati],
  );

  const cambia = (id: string, selezionato: boolean) => {
    toccatiRef.current[gruppo].add(id);
    setSelezionati((correnti) => {
      const attivi = new Set(correnti[gruppo]);
      if (selezionato) attivi.add(id);
      else attivi.delete(id);
      return { ...correnti, [gruppo]: attivi };
    });
  };

  const selezionaVisibili = () => {
    setSelezionati((correnti) => {
      const attivi = new Set(correnti[gruppo]);
      for (const preventivo of visibili) {
        toccatiRef.current[gruppo].add(preventivo.id);
        attivi.add(preventivo.id);
      }
      return { ...correnti, [gruppo]: attivi };
    });
  };

  const deselezionaTutto = () => {
    toccatiRef.current[gruppo] = new Set(
      candidati.map((preventivo) => preventivo.id),
    );
    setSelezionati((correnti) => ({
      ...correnti,
      [gruppo]: new Set(),
    }));
  };

  const conferma = () => {
    const scelti = candidati.filter((preventivo) =>
      selezionatiAttivi.has(preventivo.id),
    );
    if (scelti.length) onConferma(gruppo, scelti);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="min(820px, calc(100vw - 40px))"
      centered
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="yellow" radius="md">
            <IconBell size={18} />
          </ThemeIcon>
          <Text fw={700}>Invia o sollecita preventivi</Text>
        </Group>
      }
      closeButtonProps={{ tabIndex: -1 }}
      styles={{ body: { overflow: "hidden" } }}
    >
      <Stack gap="sm">
        <Group grow gap="xs">
          <Button
            variant={gruppo === "da_inviare" ? "light" : "default"}
            color={gruppo === "da_inviare" ? "yellow" : "gray"}
            onClick={() => {
              setGruppo("da_inviare");
              setCerca("");
            }}
            disabled={daInviare.length === 0}
          >
            Da inviare · {daInviare.length}
          </Button>
          <Button
            variant={gruppo === "da_sollecitare" ? "light" : "default"}
            color={gruppo === "da_sollecitare" ? "red" : "gray"}
            onClick={() => {
              setGruppo("da_sollecitare");
              setCerca("");
            }}
            disabled={daSollecitare.length === 0}
          >
            Da sollecitare · {daSollecitare.length}
          </Button>
        </Group>

        <TextInput
          leftSection={<IconSearch size={16} />}
          placeholder="Cerca preventivo, cliente o lotto…"
          value={cerca}
          onChange={(event) => setCerca(event.currentTarget.value)}
          autoFocus
        />

        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <Badge variant="light" color="yellow">
              {selezionatiAttivi.size} selezionati
            </Badge>
            <Badge
              variant="light"
              color={gruppo === "da_inviare" ? "blue" : "red"}
            >
              {candidati.length} candidati
            </Badge>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={visibili.length === 0}
              onClick={selezionaVisibili}
            >
              Seleziona risultati
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              disabled={selezionatiAttivi.size === 0}
              onClick={deselezionaTutto}
            >
              Deseleziona tutto
            </Button>
          </Group>
        </Group>

        {visibili.length > 0 ? (
          <VirtualStack
            items={visibili}
            getKey={chiavePreventivo}
            maxHeight="min(52dvh, 500px)"
            estimateHeight={70}
            gap={6}
            overscan={6}
            renderItem={(preventivo) => {
              const selezionato = selezionatiAttivi.has(preventivo.id);
              const aggiornato =
                preventivo.indicazioneInvio === "modificato_dopo_invio";
              return (
                <Group
                  wrap="nowrap"
                  gap="sm"
                  p="sm"
                  role="button"
                  tabIndex={0}
                  onClick={() => cambia(preventivo.id, !selezionato)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    cambia(preventivo.id, !selezionato);
                  }}
                  style={{
                    cursor: "pointer",
                    border:
                      gruppo === "da_inviare"
                        ? "1px solid var(--mantine-color-yellow-5)"
                        : "1px solid var(--mantine-color-red-4)",
                    borderRadius: "var(--mantine-radius-md)",
                    background: selezionato
                      ? gruppo === "da_inviare"
                        ? "var(--mantine-color-yellow-light)"
                        : "var(--mantine-color-red-light)"
                      : "var(--mantine-color-body)",
                  }}
                >
                  <Checkbox
                    checked={selezionato}
                    readOnly
                    tabIndex={-1}
                    aria-label={`Seleziona ${preventivo.numeroPreventivo}`}
                    style={{ pointerEvents: "none" }}
                  />
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" fw={700} truncate>
                        {preventivo.numeroPreventivo}
                      </Text>
                      <Badge
                        size="xs"
                        color={gruppo === "da_inviare" ? "blue" : "red"}
                        variant="light"
                      >
                        {gruppo === "da_sollecitare"
                          ? "Da sollecitare"
                          : aggiornato
                            ? "Aggiornato dopo l’invio"
                            : "Mai inviato"}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed" truncate>
                      {preventivo.clienteNome ||
                        preventivo.medicoNome ||
                        "Destinatario non indicato"}
                      {" · "}
                      Preventivo del {dataPreventivo(preventivo)}
                      {" · "}
                      Ordine {preventivo.ordineNumero}
                      {" · "}€ {centsToEurStr(preventivo.totale)}
                    </Text>
                  </Box>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {preventivo.linee.join(", ")}
                  </Text>
                </Group>
              );
            }}
          />
        ) : (
          <Stack align="center" gap={4} py={42}>
            <Text fw={600}>
              {candidati.length
                ? "Nessun preventivo corrisponde alla ricerca."
                : gruppo === "da_inviare"
                  ? "Non ci sono preventivi da inviare."
                  : "Non ci sono preventivi da sollecitare."}
            </Text>
            <Text size="sm" c="dimmed">
              La lista si aggiorna automaticamente quando arrivano modifiche.
            </Text>
          </Stack>
        )}

        <Group justify="flex-end" className="pt-modal-footer">
          <Button variant="default" onClick={onClose}>
            Annulla
          </Button>
          <Button
            color="accent"
            leftSection={<IconBell size={16} />}
            disabled={selezionatiAttivi.size === 0}
            onClick={conferma}
          >
            Continua con {selezionatiAttivi.size || 0}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
