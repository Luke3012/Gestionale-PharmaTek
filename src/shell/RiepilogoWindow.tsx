// Finestra "Riepilogo" di un'entità (cliente/medico/agente) — FASE 6A.
// Aperta dalla barra Spotlight: elenca gli ordini in attesa di quell'entità.
// Da qui si apre il singolo ordine (editor) o si va ai Crediti. Le note e i
// promemoria collegati arriveranno con FASE 6C/6D (vedi sezione in fondo).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAddressBook,
  IconCoin,
  IconId,
  IconMail,
  IconMapPin,
  IconMessage,
  IconNote,
  IconPhone,
  IconPencil,
  IconPlus,
  IconStethoscope,
  IconUser,
  IconUsers,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { api, inTauri, type Identity, type OrdineDto, type RecordDto } from "../lib/tauri";
import { useRicordaGeometria } from "../lib/geometriaFinestre";
import { statoDef, isSpedito } from "../features/giornaliero/stati";
import { apriFinestraOrdine } from "../features/giornaliero/apriFinestra";
import { vaiAllaPrincipale, type DeepLink } from "./navigazione";
import {
  apriFinestraRiepilogo,
  destinazioneComunicazioneDaRiepilogo,
  type RiepilogoTarget,
  type TipoRiepilogo,
} from "./apriRiepilogo";
import { BachecaPromemoria } from "../features/promemoria/BachecaPromemoria";
import { useRicaricaSuEventi } from "../lib/useRicaricaSuEventi";
import { creaRelazioniRiepilogo, type RelazioneRiepilogo } from "./riepilogoRelazioni";
import { canRunPremiumAction } from "../premium/PremiumAction";
import { usePremiumAccess } from "../premium/PremiumAccess";
import { apriComunicazione } from "../features/comunicazioni/apriComunicazione";
import {
  urlConversazioneWhatsapp,
  urlNuovaEmail,
} from "../features/comunicazioni/recapiti";
import { toast } from "../ui/toast/store";
import { AnagraficaEditorModal } from "../features/anagrafiche/AnagraficaEditorModal";
import { REGISTRI } from "../features/anagrafiche/registri";

const EUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const euro = (c: number) => EUR.format((c || 0) / 100);
type AzioneClienteDettaglio = "whatsapp" | "email";
type ClienteDettaglio = {
  label: string;
  valore: string;
  Ico: typeof IconUser;
  azione?: AzioneClienteDettaglio;
};
const EVENTI_RICARICA = [
  "ordine:salvato",
  "pagamento:salvato",
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
] as const;

const META: Record<TipoRiepilogo, { label: string; color: string; Ico: typeof IconUser; campo: keyof OrdineDto }> = {
  cliente: { label: "Cliente", color: "blue", Ico: IconUsers, campo: "clienteId" },
  medico: { label: "Medico", color: "teal", Ico: IconStethoscope, campo: "medicoId" },
  agente: { label: "Agente", color: "grape", Ico: IconUser, campo: "agenteId" },
};
const REGISTRO_CLIENTE = REGISTRI.find(
  (registro) => registro.entity === "cliente",
)!;

export function RiepilogoWindow() {
  const params = new URLSearchParams(window.location.search);
  const tipo = (params.get("riepilogo") as TipoRiepilogo) || "cliente";
  const id = params.get("id") || "";
  const nome = params.get("ent") || "";
  const uid = params.get("uid");
  const identity: Identity | undefined = uid
    ? {
        userId: uid,
        nome: params.get("nome") ?? "",
        deviceId: params.get("dev") ?? "",
        avatarTipo: "iniziali",
        avatarValore: "",
        deviceNome: "",
        dataDir: "",
      }
    : undefined;

  const [clienteDaModificare, setClienteDaModificare] =
    useState<RecordDto | null>(null);

  useRicordaGeometria("riepilogo");
  return (
    <>
      <RiepilogoContenuto
        target={{ tipo, id, nome }}
        identity={identity}
        dentroFinestra
        onModificaCliente={setClienteDaModificare}
      />
      <AnagraficaEditorModal
        opened={!!clienteDaModificare}
        registro={REGISTRO_CLIENTE}
        record={clienteDaModificare}
        onClose={() => setClienteDaModificare(null)}
      />
    </>
  );
}

export interface ApriOrdineDaRiepilogo {
  ordineId: string | null;
  numero?: string;
  clientePre?: string;
  medicoPre?: string;
}

export function RiepilogoContenuto({
  target,
  identity,
  dentroFinestra = false,
  onClose,
  primaAzione,
  onApriOrdine,
  onNaviga,
  onApriEntita,
  onModificaCliente,
  onSoggettoEliminato,
}: {
  target: RiepilogoTarget;
  identity?: Identity;
  dentroFinestra?: boolean;
  /** Presente soltanto nel riepilogo modale della finestra principale. */
  onClose?: () => void;
  primaAzione?: () => void;
  onApriOrdine?: (target: ApriOrdineDaRiepilogo) => void;
  onNaviga?: (link: DeepLink) => void;
  onApriEntita?: (target: RiepilogoTarget) => void;
  onModificaCliente?: (record: RecordDto) => void;
  onSoggettoEliminato?: () => void;
}) {
  const { tipo, id, nome } = target;
  const meta = META[tipo] ?? META.cliente;
  const premium = usePremiumAccess();

  const [ordini, setOrdini] = useState<OrdineDto[] | null>(null);
  const [nomeCorrente, setNomeCorrente] = useState(nome);
  const [clienteRecord, setClienteRecord] = useState<RecordDto | null>(null);
  const [soggettoRecord, setSoggettoRecord] = useState<RecordDto | null>(null);
  const [relazioni, setRelazioni] = useState<RelazioneRiepilogo[]>([]);

  async function carica() {
    try {
      const tutti = await api.ordiniLista();
      setOrdini(tutti.filter((o) => (o[meta.campo] as string) === id));
    } catch {
      setOrdini([]);
    }
  }

  async function caricaAnagrafica() {
    if (tipo === "agente" || !id) {
      setClienteRecord(null);
      setSoggettoRecord(null);
      setRelazioni([]);
      return;
    }
    try {
      const soggetto = await api.recordGet(tipo, id);
      const recordVivo = soggetto && !soggetto.deleted ? soggetto : null;
      setSoggettoRecord(recordVivo);
      setClienteRecord(tipo === "cliente" ? recordVivo : null);

      let medico: RecordDto | null = tipo === "medico" ? recordVivo : null;
      if (tipo === "cliente") {
        const medicoId = val(recordVivo?.data ?? {}, "ultimo_medico_id");
        medico = medicoId ? await api.recordGet("medico", medicoId) : null;
      }
      const agenteId = val(medico?.data ?? {}, "agente_id");
      const agente = agenteId ? await api.recordGet("agente", agenteId) : null;
      setRelazioni(creaRelazioniRiepilogo(tipo, recordVivo, medico, agente));
    } catch {
      setClienteRecord(null);
      setSoggettoRecord(null);
      setRelazioni([]);
    }
  }

  useEffect(() => {
    void carica();
    void caricaAnagrafica();
  }, []);
  useRicaricaSuEventi(EVENTI_RICARICA, async () => {
    await Promise.all([carica(), caricaAnagrafica()]);
  });

  // Chiude la finestra se il soggetto (cliente/medico/agente) viene eliminato altrove
  useEffect(() => {
    if (!id || !inTauri) return;
    let attivo = true;
    let off: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen(`${tipo}:salvato`, async () => {
        try {
          const rec = await api.recordGet(tipo, id);
          if (!rec || rec.deleted) {
            if (onSoggettoEliminato) {
              onSoggettoEliminato();
              return;
            }
            const { dialog } = await import("../ui/dialog/store");
            await dialog.alert(
              "Soggetto eliminato",
              "Questo soggetto è stato eliminato da un'altra postazione. Questa finestra verrà chiusa.",
              "warning"
            );
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().close();
          } else {
            setNomeCorrente((rec.data.nome as string) || "(senza nome)");
            void carica();
            void caricaAnagrafica();
          }
        } catch {}
      }))
      .then((unlisten) => {
        if (attivo) off = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      attivo = false;
      off?.();
    };
  }, [id, tipo, onSoggettoEliminato]);

  // In attesa = ordini ancora "vivi" (non chiusi, non rifiutati): il lavoro aperto.
  const inAttesa = useMemo(
    () =>
      (ordini ?? [])
        .filter((o) => o.stato !== "Chiuso" && o.stato !== "Rifiutato")
        .sort((a, b) => b.data.localeCompare(a.data)),
    [ordini]
  );

  const stats = useMemo(() => {
    const list = ordini ?? [];
    return {
      nAttesa: inAttesa.length,
      totale: inAttesa.reduce((s, o) => s + o.totale, 0),
      daSaldare: list.reduce((s, o) => s + (o.residuo > 0 ? o.residuo : 0), 0),
    };
  }, [ordini, inAttesa]);

  const dettagliCliente = useMemo(() => dettagliClienteDaRecord(clienteRecord), [clienteRecord]);

  const apriOrdine = (ordine: ApriOrdineDaRiepilogo) => {
    primaAzione?.();
    if (onApriOrdine) onApriOrdine(ordine);
    else void apriFinestraOrdine(
      ordine.ordineId,
      ordine.numero,
      identity,
      undefined,
      ordine.ordineId ? undefined : { cliente: ordine.clientePre, medico: ordine.medicoPre }
    );
  };
  const naviga = (link: DeepLink) => {
    primaAzione?.();
    if (onNaviga) onNaviga(link);
    else {
      void (async () => {
        try {
          await vaiAllaPrincipale(link);
          // Il riepilogo autonomo ha terminato il proprio compito quando consegna
          // un'azione alla vista principale. Gli ordini seguono invece apriOrdine
          // e mantengono volutamente aperto il riepilogo accanto alla loro finestra.
          if (!dentroFinestra || !inTauri) return;
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().close();
        } catch {
          // Se la vista principale non riceve l'azione, il riepilogo resta aperto
          // così l'utente può riprovare senza perdere il contesto.
        }
      })();
    }
  };
  const apriEntita = (next: RiepilogoTarget) => {
    primaAzione?.();
    if (onApriEntita) onApriEntita(next);
    else void apriFinestraRiepilogo(next.tipo, next.id, next.nome, identity);
  };
  const comunica = async () => {
    if (
      tipo === "agente" ||
      !soggettoRecord ||
      !canRunPremiumAction(premium)
    ) {
      return;
    }
    // Nel riepilogo modale chiudiamo prima il livello sottostante: in questo
    // modo Esc agirà soltanto sul compositore appena aperto.
    primaAzione?.();
    await apriComunicazione(
      {
        destinatarioEntita: tipo,
        destinatarioId: id,
        destinatarioNome: nomeCorrente,
        email: String(soggettoRecord.data.email ?? "").trim(),
        telefono: String(soggettoRecord.data.telefono ?? "").trim(),
      },
      {
        // Una finestra riepilogo non deve consegnare il flusso a un modale
        // nascosto nella main: mantiene il contesto e apre un pannello affiancabile.
        forzaFinestra:
          destinazioneComunicazioneDaRiepilogo(dentroFinestra) === "finestra",
      },
    );
  };
  const apriRecapito = async (dettaglio: ClienteDettaglio) => {
    const url =
      dettaglio.azione === "whatsapp"
        ? urlConversazioneWhatsapp(dettaglio.valore)
        : dettaglio.azione === "email"
          ? urlNuovaEmail(dettaglio.valore)
          : null;
    if (!url) {
      toast.warning(
        dettaglio.azione === "whatsapp"
          ? "Il numero non è valido per WhatsApp."
          : "L'indirizzo e-mail non è valido.",
      );
      return;
    }
    try {
      if (inTauri) {
        await api.apriUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (errore) {
      toast.error(
        dettaglio.azione === "whatsapp"
          ? `WhatsApp non si è aperto: ${errore}`
          : `Il programma e-mail non si è aperto: ${errore}`,
      );
    }
  };

  if (ordini === null) {
    return (
      <Box
        style={{
          minHeight: dentroFinestra ? "100vh" : 420,
          display: "grid",
          placeItems: "center",
          background: "var(--bg)",
        }}
      >
        <Loader size="sm" color="accent" />
      </Box>
    );
  }

  return (
    <Box style={{ height: dentroFinestra ? "100vh" : "min(76vh, 680px)", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Intestazione */}
      <Group
        p="lg"
        gap="md"
        wrap="nowrap"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <ThemeIcon size={48} radius="md" variant="light" color={meta.color}>
          <meta.Ico size={26} />
        </ThemeIcon>
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text fw={800} fz="xl" truncate>
            {nomeCorrente || "(senza nome)"}
          </Text>
          <Text c="dimmed" size="sm">
            {meta.label} · riepilogo
          </Text>
        </Box>
        {/* Azioni: una sola primaria (accent) + le altre neutre, così non sembrano
            scoordinate (prima erano 2 gialle con una bianca in mezzo). */}
        <Group gap="xs" wrap="nowrap">
          {tipo !== "agente" && (
            <Button
              color="accent"
              leftSection={<IconPlus size={16} />}
              onClick={() => apriOrdine({ ordineId: null, clientePre: tipo === "cliente" ? id : undefined, medicoPre: tipo === "medico" ? id : undefined })}
            >
              Nuovo ordine
            </Button>
          )}
          {tipo === "agente" ? (
            <Button
              color="accent"
              leftSection={<IconCoin size={16} />}
              onClick={() => naviga({ path: "/contabilita", tab: "provvigioni", agenteId: id })}
            >
              Provvigioni
            </Button>
          ) : (
            <Button
              variant="default"
              leftSection={<IconWallet size={16} />}
              onClick={() => naviga({ path: "/contabilita", tab: "pagamenti", cerca: nomeCorrente })}
            >
              Crediti
            </Button>
          )}
          {tipo === "cliente" && onModificaCliente ? (
            <Button
              variant="default"
              leftSection={<IconPencil size={16} />}
              disabled={!soggettoRecord}
              onClick={() => {
                if (soggettoRecord) onModificaCliente(soggettoRecord);
              }}
            >
              Modifica cliente
            </Button>
          ) : (
            <Button
              variant="default"
              leftSection={<IconAddressBook size={16} />}
              onClick={() =>
                naviga({ path: "/anagrafiche", tab: tipo, apriId: id })
              }
            >
              Apri scheda
            </Button>
          )}
          {onClose && (
            <Tooltip label="Chiudi" withArrow>
              <ActionIcon
                variant="default"
                size={36}
                radius="md"
                aria-label="Chiudi riepilogo"
                onClick={onClose}
              >
                <IconX size={19} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>

      {/* KPI */}
      <Box px="lg" py="md" className="pt-riepilogo-kpi-container">
        <Box
          className="pt-riepilogo-kpi-row"
          data-con-relazioni={relazioni.length > 0 || undefined}
        >
          <Box className="pt-riepilogo-kpi-group">
            <Kpi label="Ordini in attesa" labelCompatta="Ordini" valore={String(stats.nAttesa)} />
            <Kpi label="Valore in attesa" valore={euro(stats.totale)} />
            <Kpi label="Da saldare" valore={euro(stats.daSaldare)} colore={stats.daSaldare > 0 ? "var(--mantine-color-red-7)" : undefined} />
          </Box>
          {relazioni.length > 0 && (
            <RelazioniAnagrafica relazioni={relazioni} onApri={apriEntita} />
          )}
        </Box>
      </Box>

      {tipo === "cliente" && dettagliCliente.length > 0 && (
        <Box px="lg" pb="md">
          <ClienteInfoStrip
            dettagli={dettagliCliente}
            onAzione={(dettaglio) => void apriRecapito(dettaglio)}
          />
        </Box>
      )}

      <ScrollArea style={{ flex: 1 }} px="lg">
        {/* Promemoria collegati a questa entità (FASE 6C): in cima, come prima cosa. */}
        <Box py="md">
          <BachecaPromemoria
            identity={identity}
            collegato={{ tipo, id, nome }}
            compatta
            azioneCompatta={
              tipo !== "agente" &&
              canRunPremiumAction(premium) &&
              soggettoRecord ? (
                <Tooltip label="Comunica" withArrow>
                  <ActionIcon
                    variant="default"
                    size={26}
                    radius="sm"
                    aria-label="Comunica"
                    onClick={() => void comunica()}
                  >
                    <IconMessage size={14} />
                  </ActionIcon>
                </Tooltip>
              ) : null
            }
            onAzione={primaAzione}
            onApriOrdine={(ordineId, numero) => apriOrdine({ ordineId, numero })}
          />
        </Box>

        <Divider mb="sm" />

        {/* Lista ordini in attesa */}
        <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={6}>
          Ordini in attesa
        </Text>
        {inAttesa.length === 0 ? (
          <Text c="dimmed" size="sm" py="xl" ta="center">
            Nessun ordine in attesa.
          </Text>
        ) : (
          <Stack gap={6} pb="md">
            {inAttesa.map((o) => {
              const s = statoDef(o.stato);
              return (
                <Paper
                  key={o.id}
                  withBorder
                  radius="md"
                  p="sm"
                  onClick={() => apriOrdine({ ordineId: o.id, numero: o.numero })}
                  style={{ cursor: "pointer" }}
                  className="pt-pagamento-row"
                >
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      <Tooltip label={s.label} withArrow>
                        <Badge variant="light" color={s.color} leftSection={<s.Ico size={12} />}>
                          {s.label}
                        </Badge>
                      </Tooltip>
                      <Box style={{ minWidth: 0 }}>
                        <Text fw={600} size="sm" className="tabular">
                          {o.numero}
                        </Text>
                        <Group gap={6} wrap="wrap" style={{ rowGap: 2 }} onClick={(e) => e.stopPropagation()}>
                          <Text size="xs" c="dimmed">
                            {o.data}
                          </Text>
                          {tipo !== "cliente" && o.clienteId && (
                            <EntitaLink ruolo="Cliente" tipo="cliente" id={o.clienteId} nome={o.clienteNome} onApri={apriEntita} />
                          )}
                          {tipo !== "medico" && o.medicoId && (
                            <EntitaLink ruolo="Medico" tipo="medico" id={o.medicoId} nome={o.medicoNome} onApri={apriEntita} />
                          )}
                          {tipo !== "agente" && o.agenteId && (
                            <EntitaLink ruolo="Agente" tipo="agente" id={o.agenteId} nome={o.agenteNome} onApri={apriEntita} />
                          )}
                          {isSpedito(o.stato) && (
                            <Text size="xs" c="dimmed">
                              · spedito
                            </Text>
                          )}
                        </Group>
                      </Box>
                    </Group>
                    <Box ta="right" style={{ whiteSpace: "nowrap" }}>
                      <Text fw={600} size="sm" className="tabular">
                        {euro(o.totale)}
                      </Text>
                      {o.residuo > 0 && (
                        <Text size="xs" c="red.7" className="tabular">
                          da saldare {euro(o.residuo)}
                        </Text>
                      )}
                    </Box>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        )}

      </ScrollArea>
    </Box>
  );
}

/** Link a un'altra entità collegata all'ordine: apre il suo riepilogo in una finestra. */
function EntitaLink({
  ruolo,
  tipo,
  id,
  nome,
  onApri,
}: {
  ruolo: string;
  tipo: TipoRiepilogo;
  id: string;
  nome: string;
  onApri: (target: RiepilogoTarget) => void;
}) {
  return (
    <Text size="xs" c="dimmed" component="span">
      ·{" "}
      <Anchor
        component="button"
        type="button"
        size="xs"
        onClick={() => onApri({ tipo, id, nome })}
        title={`Apri il riepilogo di ${nome}`}
      >
        {ruolo}: {nome || "—"}
      </Anchor>
    </Text>
  );
}

function Kpi({
  label,
  labelCompatta,
  valore,
  colore,
}: {
  label: string;
  labelCompatta?: string;
  valore: string;
  colore?: string;
}) {
  const [valoreRef, valoreTroncato] = useTroncamento<HTMLParagraphElement>(valore);
  return (
    <Box className="pt-riepilogo-kpi">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} className="pt-riepilogo-kpi-label">
        <span
          className={`pt-riepilogo-kpi-label-estesa${labelCompatta ? " pt-riepilogo-kpi-label-estesa-adattiva" : ""}`}
        >
          {label}
        </span>
        {labelCompatta && (
          <span className="pt-riepilogo-kpi-label-compatta">{labelCompatta}</span>
        )}
      </Text>
      <Tooltip label={valore} withArrow openDelay={350} disabled={!valoreTroncato}>
        <Text
          ref={valoreRef}
          fw={800}
          className="tabular pt-riepilogo-kpi-valore"
          style={colore ? { color: colore } : undefined}
        >
          {valore}
        </Text>
      </Tooltip>
    </Box>
  );
}

function RelazioniAnagrafica({
  relazioni,
  onApri,
}: {
  relazioni: RelazioneRiepilogo[];
  onApri: (target: RiepilogoTarget) => void;
}) {
  return (
    <Box
      className="pt-riepilogo-relazioni"
      style={{
        gridTemplateColumns: `repeat(${relazioni.length}, minmax(0, 1fr))`,
      }}
    >
      {relazioni.map((relazione) => (
        <RelazioneCard
          key={`${relazione.tipo}:${relazione.id}`}
          relazione={relazione}
          onApri={onApri}
        />
      ))}
    </Box>
  );
}

function RelazioneCard({
  relazione,
  onApri,
}: {
  relazione: RelazioneRiepilogo;
  onApri: (target: RiepilogoTarget) => void;
}) {
  const Ico = relazione.tipo === "medico" ? IconStethoscope : IconUser;
  const color = relazione.tipo === "medico" ? "teal" : "grape";
  const [nomeRef, nomeTroncato] = useTroncamento<HTMLButtonElement>(relazione.nome);
  return (
    <Paper
      withBorder
      radius="md"
      px={8}
      py={8}
      className="pt-riepilogo-relazione-card"
      style={{
        minWidth: 0,
        background: "color-mix(in srgb, var(--surface) 92%, var(--mantine-color-gray-0))",
      }}
    >
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, width: "100%" }}>
        <ThemeIcon
          size={30}
          radius="md"
          variant="light"
          color={color}
          className="pt-riepilogo-relazione-icona"
          style={{ flex: "0 0 auto" }}
        >
          <Ico size={15} />
        </ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Text size="10px" c="dimmed" tt="uppercase" fw={700} lh={1.15}>
            {relazione.tipo === "medico" ? "Medico" : "Agente"}
          </Text>
          <Tooltip label={relazione.nome} withArrow openDelay={350} disabled={!nomeTroncato}>
            <Anchor
              ref={nomeRef}
              component="button"
              type="button"
              size="sm"
              fw={650}
              c={color}
              onClick={() => onApri(relazione)}
              style={{
                display: "block",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {relazione.nome}
            </Anchor>
          </Tooltip>
        </Box>
      </Group>
    </Paper>
  );
}

function useTroncamento<T extends HTMLElement>(contenuto: string) {
  const ref = useRef<T>(null);
  const [troncato, setTroncato] = useState(false);
  useEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;
    const misura = () => setTroncato(elemento.scrollWidth > elemento.clientWidth + 1);
    misura();
    const observer = new ResizeObserver(misura);
    observer.observe(elemento);
    return () => observer.disconnect();
  }, [contenuto]);
  return [ref, troncato] as const;
}

function val(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
}

function indirizzoCliente(data: Record<string, unknown>): string {
  const citta = [val(data, "cap"), val(data, "citta")].filter(Boolean).join(" ");
  const prov = val(data, "prov");
  return [
    val(data, "indirizzo"),
    [citta, prov ? `(${prov})` : ""].filter(Boolean).join(" "),
    val(data, "regione"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function dettagliClienteDaRecord(rec: RecordDto | null): ClienteDettaglio[] {
  if (!rec) return [];
  const data = rec.data;
  const dettagli: ClienteDettaglio[] = [];
  const cf = val(data, "cf");
  const indirizzo = indirizzoCliente(data);
  const telefono = val(data, "telefono");
  const email = val(data, "email");
  const note = val(data, "note_spedizione");
  if (cf) dettagli.push({ label: "Codice", valore: cf, Ico: IconId });
  if (indirizzo) dettagli.push({ label: "Indirizzo", valore: indirizzo, Ico: IconMapPin });
  if (telefono) {
    dettagli.push({
      label: "Tel",
      valore: telefono,
      Ico: IconPhone,
      azione: "whatsapp",
    });
  }
  if (email) {
    dettagli.push({
      label: "Mail",
      valore: email,
      Ico: IconMail,
      azione: "email",
    });
  }
  if (note) dettagli.push({ label: "Note", valore: note.length > 90 ? `${note.slice(0, 87).trim()}...` : note, Ico: IconNote });
  return dettagli;
}

function ClienteInfoStrip({
  dettagli,
  onAzione,
}: {
  dettagli: ClienteDettaglio[];
  onAzione: (dettaglio: ClienteDettaglio) => void;
}) {
  const indirizzo = dettagli.find((d) => d.label === "Indirizzo");
  const codice = dettagli.find((d) => d.label === "Codice");
  const altri = dettagli.filter((d) => d.label !== "Indirizzo" && d.label !== "Codice");
  const principale = indirizzo ?? codice ?? altri[0];
  const secondari = altri.filter((d) => d !== principale);
  if (!principale) return null;

  return (
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        border: "1px solid color-mix(in srgb, var(--border) 78%, transparent)",
        borderRadius: 8,
        background: "linear-gradient(135deg, var(--surface) 0%, color-mix(in srgb, var(--mantine-color-blue-0) 42%, var(--surface)) 100%)",
        boxShadow: "0 10px 28px rgba(15, 23, 42, 0.06)",
      }}
    >
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: codice && principale.label === "Indirizzo" ? "minmax(0, 1fr) minmax(190px, 0.34fr)" : "minmax(0, 1fr)",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        <ClienteInfoMain dettaglio={principale} onAzione={onAzione} />
        {codice && principale.label === "Indirizzo" && (
          <ClienteInfoCodice dettaglio={codice} />
        )}
      </Box>
      {secondari.length > 0 && (
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
            paddingTop: 10,
            borderTop: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
          }}
        >
          {secondari.map((d) => (
            <ClienteInfoMeta
              key={d.label}
              dettaglio={d}
              onAzione={onAzione}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

function ClienteInfoMain({
  dettaglio,
  onAzione,
}: {
  dettaglio: ClienteDettaglio;
  onAzione: (dettaglio: ClienteDettaglio) => void;
}) {
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }} title={`${dettaglio.label}: ${dettaglio.valore}`}>
      <ClienteInfoIcona
        dettaglio={dettaglio}
        size={42}
        iconSize={18}
        variant="light"
        color="blue"
        onAzione={onAzione}
      />
      <Box style={{ minWidth: 0 }}>
        <Text size="11px" c="dimmed" tt="uppercase" fw={700} lh={1.1}>
          {dettaglio.label}
        </Text>
        <Text
          size="md"
          fw={650}
          c="bright"
          style={{
            minWidth: 0,
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {dettaglio.valore}
        </Text>
      </Box>
    </Group>
  );
}

function ClienteInfoCodice({ dettaglio }: { dettaglio: ClienteDettaglio }) {
  return (
    <Box
      title={`${dettaglio.label}: ${dettaglio.valore}`}
      style={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        paddingLeft: 16,
        borderLeft: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
      }}
    >
      <Text size="11px" c="dimmed" tt="uppercase" fw={700} lh={1.1}>
        Codice fiscale / P.IVA
      </Text>
      <Text size="sm" fw={650} c="bright" className="tabular" truncate>
        {dettaglio.valore}
      </Text>
    </Box>
  );
}

function ClienteInfoMeta({
  dettaglio,
  onAzione,
}: {
  dettaglio: ClienteDettaglio;
  onAzione: (dettaglio: ClienteDettaglio) => void;
}) {
  return (
    <Group
      gap={8}
      wrap="nowrap"
      style={{ minWidth: 0, paddingRight: 8 }}
      title={`${dettaglio.label}: ${dettaglio.valore}`}
    >
      <ClienteInfoIcona
        dettaglio={dettaglio}
        size={26}
        iconSize={14}
        variant="white"
        color="gray"
        onAzione={onAzione}
      />
      <Box style={{ minWidth: 0 }}>
        <Text size="11px" c="dimmed" fw={700} lh={1.05}>
          {dettaglio.label}
        </Text>
        <Text size="xs" fw={600} c="bright" truncate style={{ minWidth: 0 }}>
          {dettaglio.valore}
        </Text>
      </Box>
    </Group>
  );
}

function ClienteInfoIcona({
  dettaglio,
  size,
  iconSize,
  variant,
  color,
  onAzione,
}: {
  dettaglio: ClienteDettaglio;
  size: number;
  iconSize: number;
  variant: "light" | "white";
  color: string;
  onAzione: (dettaglio: ClienteDettaglio) => void;
}) {
  const style = {
    flex: "0 0 auto",
    boxShadow:
      variant === "white" ? "0 1px 4px rgba(15, 23, 42, 0.08)" : undefined,
  };
  if (!dettaglio.azione) {
    return (
      <ThemeIcon
        size={size}
        radius="md"
        variant={variant}
        color={color}
        style={style}
      >
        <dettaglio.Ico size={iconSize} />
      </ThemeIcon>
    );
  }

  const etichetta =
    dettaglio.azione === "whatsapp"
      ? `Apri WhatsApp con ${dettaglio.valore}`
      : `Scrivi a ${dettaglio.valore}`;
  return (
    <Tooltip label={etichetta} withArrow>
      <ActionIcon
        size={size}
        radius="md"
        variant={variant}
        color={color}
        style={style}
        aria-label={etichetta}
        onClick={() => onAzione(dettaglio)}
      >
        <dettaglio.Ico size={iconSize} />
      </ActionIcon>
    </Tooltip>
  );
}
