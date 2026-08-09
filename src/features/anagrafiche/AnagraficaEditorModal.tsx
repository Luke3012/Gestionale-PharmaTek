import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { IconMessage } from "@tabler/icons-react";
import { api, type RecordDto } from "../../lib/tauri";
import { focusInvalidField } from "../../ui/focusInvalid";
import { mergeRealtimeSelettivo } from "../../lib/mergeRealtime";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { PremiumAction, canRunPremiumAction } from "../../premium/PremiumAction";
import { usePremiumAccess } from "../../premium/PremiumAccess";
import { toast } from "../../ui/toast/store";
import { apriComunicazione } from "../comunicazioni/apriComunicazione";
import { FormCampiGrid, type Valori } from "./FormAnagrafica";
import { salvaNuovoClienteConControllo } from "./salvataggioCliente";
import {
  REGISTRI,
  eurToCents,
  validaCampo,
  type Opzione,
  type Registro,
} from "./registri";

export function valoriAnagrafica(
  registro: Registro,
  record?: RecordDto | null,
): Valori {
  const valori: Valori = {};
  for (const campo of registro.campi) {
    const raw = record?.data[campo.key] ?? campo.defaultValue;
    if (campo.tipo === "eur") {
      valori[campo.key] = typeof raw === "number" ? raw / 100 : "";
    } else if (campo.tipo === "numero") {
      valori[campo.key] = typeof raw === "number" ? raw : "";
    } else if (campo.tipo === "segmented") {
      valori[campo.key] =
        raw != null ? String(raw) : campo.opzioni?.[0]?.value ?? "";
    } else {
      valori[campo.key] = raw != null ? String(raw) : "";
    }
  }
  return valori;
}

export function preparaPatchAnagrafica(
  registro: Registro,
  valori: Valori,
  record?: RecordDto | null,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const campo of registro.campi) {
    const valore = valori[campo.key];
    let stored: unknown;
    if (campo.tipo === "eur") {
      stored =
        valore === "" || valore == null
          ? undefined
          : eurToCents(Number(valore));
    } else if (campo.tipo === "numero") {
      stored =
        valore === "" || valore == null ? undefined : Number(valore);
    } else {
      const testo = String(valore ?? "").trim();
      const normalizzato =
        campo.tipo === "cf" ? testo.toUpperCase() : testo;
      stored = normalizzato === "" ? undefined : normalizzato;
    }

    if (!record) {
      if (stored !== undefined) fields[campo.key] = stored;
      continue;
    }

    const originale = record.data[campo.key];
    if (stored === undefined) {
      if (originale != null && originale !== "") fields[campo.key] = "";
    } else if (!Object.is(stored, originale)) {
      fields[campo.key] = stored;
    }
  }
  return fields;
}

function inizialeMaiuscola(testo: string): string {
  return testo.charAt(0).toUpperCase() + testo.slice(1);
}

export function AnagraficaEditorModal({
  opened,
  registro,
  record,
  onClose,
  onSaved,
  onInvalidated,
  campiDisabilitati,
  modalExtra,
  size,
  bloccaChiusura = false,
}: {
  opened: boolean;
  registro: Registro;
  /** `null` crea un record; un record esistente viene modificato a patch. */
  record: RecordDto | null;
  onClose: () => void;
  onSaved?: (record: RecordDto) => void;
  onInvalidated?: () => void;
  campiDisabilitati?: (record: RecordDto | null) => string[];
  modalExtra?: (record: RecordDto | null) => ReactNode;
  size?: string;
  bloccaChiusura?: boolean;
}) {
  const premium = usePremiumAccess();
  const [mostrato, setMostrato] = useState(false);
  const [corrente, setCorrente] = useState<RecordDto | null>(record);
  const [valori, setValori] = useState<Valori>(() =>
    valoriAnagrafica(registro, record),
  );
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [rifOpzioni, setRifOpzioni] = useState<Record<string, Opzione[]>>({});
  const [salvando, setSalvando] = useState(false);
  const sessioneRef = useRef(0);
  const correnteRef = useRef<RecordDto | null>(corrente);
  const valoriRef = useRef<Valori>(valori);
  const apertoRef = useRef(opened);
  correnteRef.current = corrente;
  valoriRef.current = valori;
  apertoRef.current = opened;

  const rifEntities = useMemo(
    () =>
      [...new Set(
        registro.campi
          .map((campo) => campo.rifEntity)
          .filter((entity): entity is string => Boolean(entity)),
      )],
    [registro],
  );
  const eventi = useMemo(
    () => [`${registro.entity}:salvato`] as const,
    [registro.entity],
  );
  const disabilitati = useMemo(
    () => new Set(campiDisabilitati?.(corrente) ?? []),
    [campiDisabilitati, corrente],
  );
  const mostraComunica =
    Boolean(corrente) &&
    registro.entity === "medico" &&
    canRunPremiumAction(premium);

  async function caricaRiferimenti(sessione: number) {
    const entries = await Promise.all(
      rifEntities.map(async (entity) => {
        const registroRif = REGISTRI.find((item) => item.entity === entity);
        try {
          const records = await api.recordsList(entity);
          return [
            entity,
            records.map((item) => ({
              value: item.id,
              label: registroRif ? registroRif.titolo(item.data) : item.id,
            })),
          ] as const;
        } catch {
          return [entity, []] as const;
        }
      }),
    );
    if (apertoRef.current && sessioneRef.current === sessione) {
      setRifOpzioni(Object.fromEntries(entries));
    }
  }

  function applicaRemoto(remoto: RecordDto) {
    const baselineRecord = correnteRef.current;
    const prossimiValori =
      baselineRecord && baselineRecord.id === remoto.id
        ? mergeRealtimeSelettivo(
            valoriAnagrafica(registro, baselineRecord),
            valoriRef.current,
            valoriAnagrafica(registro, remoto),
          ).valori
        : valoriAnagrafica(registro, remoto);
    correnteRef.current = remoto;
    valoriRef.current = prossimiValori;
    setCorrente(remoto);
    setValori(prossimiValori);
  }

  async function ricaricaCorrente() {
    if (!apertoRef.current || !corrente?.id) return;
    const sessione = sessioneRef.current;
    try {
      const remoto = await api.recordGet(registro.entity, corrente.id);
      if (!apertoRef.current || sessioneRef.current !== sessione) return;
      if (!remoto || remoto.deleted) {
        toast.warning(
          "Questa anagrafica è stata eliminata o spostata nel Cestino da un'altra postazione.",
        );
        onClose();
        onInvalidated?.();
        return;
      }
      applicaRemoto(remoto);
    } catch {
      // Un evento successivo o il controllo prima del salvataggio ritenterà.
    }
  }

  useRicaricaSuEventi(eventi, ricaricaCorrente, 180);

  useEffect(() => {
    if (!opened) return;
    const sessione = ++sessioneRef.current;
    const valoriIniziali = valoriAnagrafica(registro, record);
    setMostrato(true);
    correnteRef.current = record;
    valoriRef.current = valoriIniziali;
    setCorrente(record);
    setValori(valoriIniziali);
    setErrori({});
    setSalvando(false);
    setRifOpzioni({});
    void caricaRiferimenti(sessione);
    if (record) {
      void api
        .recordGet(registro.entity, record.id)
        .then((remoto) => {
          if (
            !apertoRef.current ||
            sessioneRef.current !== sessione ||
            !remoto ||
            remoto.deleted
          ) {
            return;
          }
          applicaRemoto(remoto);
        })
        .catch(() => {});
    }
    // L'oggetto `record` può essere aggiornato dalla tabella mentre si scrive:
    // la sessione si reinizializza solo per apertura/id, gli eventi fanno il merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, registro.entity, record?.id]);

  async function salva() {
    const prossimiErrori: Record<string, string> = {};
    for (const campo of registro.campi) {
      const errore = validaCampo(campo, valori[campo.key]);
      if (errore) prossimiErrori[campo.key] = errore;
    }
    const primaChiaveErrore = Object.keys(prossimiErrori)[0];
    if (primaChiaveErrore) {
      setErrori(prossimiErrori);
      focusInvalidField(`[data-pt-field="${primaChiaveErrore}"]`);
      return;
    }

    setSalvando(true);
    try {
      if (!corrente) {
        const fields = preparaPatchAnagrafica(registro, valori);
        if (registro.entity === "cliente") {
          const risultato = await salvaNuovoClienteConControllo(fields);
          if (!risultato) return;
          onSaved?.(risultato.record);
        } else {
          const creato = await api.recordCreate(registro.entity, fields);
          toast.success(`${inizialeMaiuscola(registro.singolare)} creato.`);
          onSaved?.(creato);
        }
        onClose();
        return;
      }

      const remoto = await api.recordGet(registro.entity, corrente.id);
      if (!remoto || remoto.deleted) {
        toast.warning(
          "Questa anagrafica è stata eliminata o spostata nel Cestino da un'altra postazione.",
        );
        onClose();
        onInvalidated?.();
        return;
      }

      // La patch contiene solo i campi cambiati localmente. Un salvataggio remoto
      // concorrente su altri campi resta quindi intatto; sullo stesso campo vince
      // intenzionalmente l'ultimo salvataggio.
      const aggiornato = await api.recordUpdate(
        registro.entity,
        corrente.id,
        preparaPatchAnagrafica(registro, valori, corrente),
      );
      toast.success("Modifiche salvate.");
      onSaved?.(aggiornato);
      onClose();
    } catch (errore) {
      toast.error(`Salvataggio non riuscito: ${errore}`);
    } finally {
      setSalvando(false);
    }
  }

  function comunica() {
    if (
      !corrente ||
      (registro.entity !== "cliente" && registro.entity !== "medico")
    ) {
      return;
    }
    const nome = registro.titolo(corrente.data);
    onClose();
    void apriComunicazione({
      destinatarioEntita: registro.entity,
      destinatarioId: corrente.id,
      destinatarioNome: nome,
      email: String(corrente.data.email ?? ""),
      telefono: String(corrente.data.telefono ?? ""),
      variabili: {
        nome_cliente: nome,
        ragione_sociale: nome,
        nome_medico: registro.entity === "medico" ? nome : "",
      },
    });
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={700}>
          {corrente
            ? `Modifica ${registro.singolare}`
            : `Nuovo ${registro.singolare}`}
        </Text>
      }
      size={size ?? "lg"}
      closeOnEscape={!bloccaChiusura}
      closeOnClickOutside={!bloccaChiusura}
      transitionProps={{
        onExited: () => {
          setMostrato(false);
          correnteRef.current = null;
          setCorrente(null);
        },
      }}
    >
      {mostrato && (
        <Box className="pt-modal-shell">
          <Box className="pt-modal-scroll">
            <Stack gap="md">
              <FormCampiGrid
                registro={registro}
                valori={valori}
                errori={errori}
                disabilitati={disabilitati}
                rifOpzioni={rifOpzioni}
                setValori={setValori}
                setErrori={setErrori}
              />

              {modalExtra?.(corrente)}

              {rifEntities.some(
                (entity) => (rifOpzioni[entity] ?? []).length === 0,
              ) && (
                <Alert color="yellow" variant="light">
                  Manca un'anagrafica collegata (es. nessun agente
                  disponibile). Creala prima per poterla selezionare.
                </Alert>
              )}
            </Stack>
          </Box>

          <div
            className="pt-modal-footer"
            style={{
              justifyContent: mostraComunica ? "space-between" : "flex-end",
            }}
          >
            {mostraComunica && (
              <PremiumAction
                leftSection={<IconMessage size={16} />}
                onAction={comunica}
              >
                Comunica
              </PremiumAction>
            )}
            <div className="pt-modal-actions">
              <Button variant="default" onClick={onClose}>
                Annulla
              </Button>
              <Button color="accent" loading={salvando} onClick={salva}>
                Salva
              </Button>
            </div>
          </div>
        </Box>
      )}
    </Modal>
  );
}
