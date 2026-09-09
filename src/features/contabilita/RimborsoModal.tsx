// Modale rimborso (FASE 3D): crea un nuovo rimborso (manuale o "extra" collegato a un
// ordine pagato in eccesso) oppure modifica/elimina uno esistente. Un rimborso è un
// flusso di denaro IN USCITA: non tocca i pagamenti né i totali Crediti. Lo stato è
// derivato dalla "Data rimborso" (vuota = richiesto, valorizzata = effettuato); per
// marcarlo effettuato rapidamente c'è la SegnaEffettuatoModal (azione di riga).
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconReceiptRefund, IconTrash } from "@tabler/icons-react";
import { api, type OrdineDto, type Rimborso, type RecordDto } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { EuroInput } from "../../ui/EuroInput";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { oggiIso as oggi } from "../../lib/date";
import {
  catturaOrigineCestino,
  volaNelCestino,
  type PuntoVoloCestino,
} from "../../ui/volaCestino";
import { dialog } from "../../ui/dialog/store";
import { centsToEurStr, eurToCents } from "../../lib/money";
import { origineRimborsoLabel } from "./statiRimborso";
import { focusInvalidField } from "../../ui/focusInvalid";
import { opzioniConti } from "./contoPreferito";
import { FooterAzioniModale } from "../../ui/FooterAzioniModale";

export interface RimborsoModalTarget {
  /** Modifica/dettaglio di un rimborso esistente. */
  rimborso?: Rimborso;
  /** Nuovo rimborso "extra" precompilato da un ordine pagato in eccesso. */
  nuovoExtra?: { ordineId: string; numero?: string };
}

export function RimborsoModal({
  target,
  onClose,
  onChanged,
}: {
  target: RimborsoModalTarget | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mostrato, clearMostrato] = useModalSnapshot(target);

  const titolo = mostrato?.rimborso ? "Dettaglio rimborso" : "Nuovo rimborso";

  return (
    <Modal
      opened={!!target}
      onClose={onClose}
      size="md"
      zIndex={1300}
      title={
        <Group gap="sm">
          <Text fw={700}>{titolo}</Text>
          {mostrato?.rimborso?.origine === "extra" && (
            <Badge variant="light" color="grape">
              Soldi in eccesso
            </Badge>
          )}
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: clearMostrato }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.stopPropagation();
      }}
    >
      {mostrato && <Form target={mostrato} onClose={onClose} onChanged={onChanged} />}
    </Modal>
  );
}

function Form({
  target,
  onClose,
  onChanged,
}: {
  target: RimborsoModalTarget;
  onClose: () => void;
  onChanged: () => void;
}) {
  const r = target.rimborso;
  const isEdit = !!r;
  const [conti, setConti] = useState<RecordDto[]>([]);
  const [ordini, setOrdini] = useState<OrdineDto[]>([]);

  const [dataRichiesta, setDataRichiesta] = useState(r?.dataRichiesta || oggi());
  const [importo, setImporto] = useState<number | "">(r && r.importo > 0 ? r.importo / 100 : "");
  const [ragioneSociale, setRagioneSociale] = useState(r?.ragioneSociale ?? "");
  const [motivo, setMotivo] = useState(r?.motivo ?? "");
  const [iban, setIban] = useState(r?.iban ?? "");
  const [contoId, setContoId] = useState(r?.contoId || "");
  const [dataRimborso, setDataRimborso] = useState(r?.dataRimborso ?? "");
  const [note, setNote] = useState(r?.note ?? "");
  const [ordineId, setOrdineId] = useState(r?.ordineId || target.nuovoExtra?.ordineId || "");
  const [origine, setOrigine] = useState<"manuale" | "extra">(
    r?.origine ?? (target.nuovoExtra ? "extra" : "manuale")
  );
  const [salvando, setSalvando] = useState(false);
  const [caricandoOrdine, setCaricandoOrdine] = useState(false);

  // Caricamento iniziale: conti + (se nuovo) ordini per il collegamento opzionale;
  // se "nuovo extra" precompila importo/ragione/iban dall'ordine.
  useEffect(() => {
    api
      .recordsList("conto")
      .then((cs) => {
        setConti(cs);
        // Conto di uscita proposto per un nuovo rimborso: il predefinito rimborsi.
        if (!isEdit && !contoId) {
          const pred = cs.find((c) => c.data.predefinito_rimborsi === true);
          if (pred) setContoId(pred.id);
        }
      })
      .catch(() => {});
    if (!isEdit) {
      Promise.all([api.ordiniLista(), api.rimborsiLista()])
        .then(([listaOrdini, listaRimborsi]) => {
          const giaCollegati = new Set(
            listaRimborsi.filter((rimborso) => rimborso.origine === "extra").map((rimborso) => rimborso.ordineId)
          );
          setOrdini(listaOrdini.filter((ordine) => ordine.residuo < 0 && !giaCollegati.has(ordine.id)));
        })
        .catch(() => {});
    }
    if (!isEdit && target.nuovoExtra) {
      setCaricandoOrdine(true);
      api
        .rimborsoExtraPrecompila(target.nuovoExtra.ordineId)
        .then((pre) => {
          if (pre.importo > 0) setImporto(pre.importo / 100);
          setRagioneSociale(pre.ragioneSociale);
          setIban(pre.iban);
          setMotivo("Soldi in eccesso");
        })
        .catch(() => toast.error("Precompilazione del rimborso non riuscita."))
        .finally(() => setCaricandoOrdine(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const datiConti = useMemo(() => opzioniConti(conti), [conti]);
  const datiOrdini = useMemo(
    () =>
      ordini.map((o) => ({
        value: o.id,
        label: `${o.numero}${o.clienteNome ? ` · ${o.clienteNome}` : ""}`,
      })),
    [ordini]
  );

  // Collegare un ordine (solo in creazione) → diventa "extra" e precompila i dati.
  async function collegaOrdine(oid: string | null) {
    setOrdineId(oid ?? "");
    if (!oid) {
      setOrigine("manuale");
      return;
    }
    setOrigine("extra");
    setImporto("");
    setCaricandoOrdine(true);
    try {
      const pre = await api.rimborsoExtraPrecompila(oid);
      if (pre.importo > 0) setImporto(pre.importo / 100);
      if (pre.ragioneSociale) setRagioneSociale(pre.ragioneSociale);
      if (pre.iban) setIban(pre.iban);
      if (!motivo.trim()) setMotivo("Soldi in eccesso");
    } catch {
      toast.error("Precompilazione del rimborso non riuscita.");
      setOrdineId("");
      setOrigine("manuale");
    } finally {
      setCaricandoOrdine(false);
    }
  }

  async function salva() {
    const cents = importo === "" ? 0 : eurToCents(Number(importo));
    if (cents <= 0) {
      toast.warning("Inserisci un importo maggiore di zero.");
      focusInvalidField('[data-pt-field="rimborso-importo"]');
      return;
    }
    if (!ragioneSociale.trim()) {
      toast.warning("Indica la ragione sociale / intestatario del rimborso.");
      focusInvalidField('[data-pt-field="rimborso-ragione"]');
      return;
    }
    if (origine === "extra" && ordineId) {
      setCaricandoOrdine(true);
      try {
        const corrente = await api.rimborsoExtraPrecompila(ordineId);
        if (corrente.importo <= 0) {
          toast.warning(
            "Questo ordine non ha più un'eccedenza da rimborsare. Il rimborso non è stato modificato."
          );
          return;
        }
        if (cents > corrente.importo) {
          toast.warning(
            `L'importo supera l'eccedenza attualmente salvata (€ ${centsToEurStr(corrente.importo)}). Riducilo oppure salva prima le modifiche dell'ordine.`
          );
          focusInvalidField('[data-pt-field="rimborso-importo"]');
          return;
        }
      } catch {
        toast.error("Verifica dell'eccedenza non riuscita. Riprova.");
        return;
      } finally {
        setCaricandoOrdine(false);
      }
    }
    setSalvando(true);
    try {
      await api.rimborsoSalva({
        id: r?.id,
        dataRichiesta,
        importo: cents,
        ragioneSociale: ragioneSociale.trim(),
        motivo: motivo.trim(),
        iban: iban.trim(),
        contoId,
        dataRimborso,
        note: note.trim(),
        ordineId,
        origine,
      });
      toast.success(isEdit ? "Rimborso aggiornato." : "Rimborso creato.");
      onChanged();
    } catch (e) {
      toast.error(`Operazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  async function elimina(origine?: PuntoVoloCestino) {
    if (!r) return;
    const ok = await dialog.confirmDanger(
      "Eliminare il rimborso?",
      "Il rimborso verrà spostato nel Cestino (ripristinabile).",
      { conferma: "Elimina" }
    );
    if (!ok) return;
    setSalvando(true);
    try {
      await api.recordDelete("rimborso", r.id);
      if (!volaNelCestino(origine)) toast.success("Rimborso eliminato.");
      onChanged();
    } catch (e) {
      toast.error(`Eliminazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Box className="pt-modal-shell">
      <Box className="pt-modal-scroll">
        <Stack gap="sm">
          {!isEdit && (
            <Select
              label="Collega a un ordine (rimborso da soldi in eccesso)"
              placeholder="Nessuno — rimborso manuale"
              data={datiOrdini}
              value={ordineId || null}
              onChange={collegaOrdine}
              disabled={caricandoOrdine}
              clearable
              searchable
              limit={100}
              comboboxProps={{ withinPortal: true, zIndex: 1400 }}
            />
          )}
          {isEdit && r?.ordineNumero && (
            <Text size="sm" c="dimmed">
              Collegato all'ordine <strong>{r.ordineNumero}</strong> · {origineRimborsoLabel(origine)}
            </Text>
          )}

          <Group grow>
            <TextInput
              label="Data richiesta"
              type="date"
              value={dataRichiesta}
              onChange={(e) => setDataRichiesta(e.currentTarget.value)}
            />
            <Box data-pt-field="rimborso-importo">
              <EuroInput
                label="Importo"
                value={importo}
                onChange={(v) => setImporto(v === "" ? "" : Number(v))}
                min={0}
              />
            </Box>
          </Group>

          <Box data-pt-field="rimborso-ragione">
            <TextInput
              label="Ragione sociale / intestatario"
              value={ragioneSociale}
              onChange={(e) => setRagioneSociale(e.currentTarget.value)}
            />
          </Box>
          <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
          <TextInput label="IBAN" value={iban} onChange={(e) => setIban(e.currentTarget.value)} />

          <Divider label="Esecuzione" labelPosition="left" my={2} />
          <Group grow>
            <Select
              label="Conto di uscita"
              placeholder="Scegli…"
              data={datiConti}
              value={contoId || null}
              onChange={(v) => setContoId(v ?? "")}
              allowDeselect={false}
              clearable
              comboboxProps={{ withinPortal: true, zIndex: 1400 }}
            />
            <TextInput
              label="Data rimborso"
              description="Vuota = ancora da effettuare"
              type="date"
              value={dataRimborso}
              onChange={(e) => setDataRimborso(e.currentTarget.value)}
            />
          </Group>

          <Textarea label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={1} />
        </Stack>
      </Box>

      <div className="pt-modal-footer">
        {isEdit ? (
          <Button
            variant="subtle"
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={(event) =>
              elimina(catturaOrigineCestino(event.currentTarget))
            }
            disabled={salvando}
          >
            Elimina
          </Button>
        ) : (
          <span />
        )}
        <Group gap="sm">
          <Button variant="default" onClick={onClose} disabled={salvando}>
            Chiudi
          </Button>
          <Button color="accent" onClick={salva} loading={salvando || caricandoOrdine} disabled={caricandoOrdine} leftSection={<IconReceiptRefund size={16} />}>
            {isEdit ? "Salva" : "Crea rimborso"}
          </Button>
        </Group>
      </div>
    </Box>
  );
}

/** Modale leggera per marcare un rimborso "effettuato": data (default oggi) + conto di
 * uscita (suggerito dal predefinito accrediti, modificabile/opzionale). */
export function SegnaEffettuatoModal({
  rimborso,
  onClose,
  onDone,
}: {
  rimborso: Rimborso | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [conti, setConti] = useState<RecordDto[]>([]);
  // Mantiene il contenuto durante il fade-out: il parent può azzerare subito
  // `rimborso` senza far collassare il modale prima della fine dell'animazione.
  const [mostrato, clearRimborsoMostrato] = useModalSnapshot(rimborso);
  const [data, setData] = useState(oggi());
  const [contoId, setContoId] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!rimborso) return;
    setData(oggi());
    api
      .recordsList("conto")
      .then((cs) => {
        setConti(cs);
        // Conto suggerito: quello del rimborso, altrimenti il predefinito rimborsi.
        const pred = cs.find((c) => c.data.predefinito_rimborsi === true);
        setContoId(rimborso.contoId || pred?.id || "");
      })
      .catch(() => {});
  }, [rimborso]);

  const datiConti = useMemo(() => opzioniConti(conti), [conti]);

  async function conferma() {
    if (!rimborso) return;
    if (!data) {
      toast.warning("Indica la data del rimborso.");
      focusInvalidField('[data-pt-field="rimborso-data-effettuato"]');
      return;
    }
    setSalvando(true);
    try {
      await api.rimborsoSegnaEffettuato({ id: rimborso.id, dataRimborso: data, contoId });
      toast.success("Rimborso segnato come effettuato.");
      onDone();
    } catch (e) {
      toast.error(`Operazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      opened={!!rimborso}
      onClose={onClose}
      size="sm"
      zIndex={1400}
      title={<Text fw={700}>Segna come effettuato</Text>}
      transitionProps={{ transition: "fade", duration: 160, onExited: clearRimborsoMostrato }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.stopPropagation();
      }}
    >
      {mostrato && (
        <Box className="pt-modal-shell">
          <Box className="pt-modal-scroll">
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                {mostrato.ragioneSociale} · <strong>€ {centsToEurStr(mostrato.importo)}</strong>
              </Text>
              <Box data-pt-field="rimborso-data-effettuato">
                <TextInput
                  label="Data rimborso"
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.currentTarget.value)}
                />
              </Box>
              <Select
                label="Conto di uscita"
                placeholder="Scegli…"
                data={datiConti}
                value={contoId || null}
                onChange={(v) => setContoId(v ?? "")}
                clearable
                allowDeselect={false}
                comboboxProps={{ withinPortal: true, zIndex: 1500 }}
              />
            </Stack>
          </Box>
          <FooterAzioniModale>
              <Button variant="default" onClick={onClose} disabled={salvando}>
                Annulla
              </Button>
              <Button color="accent" onClick={conferma} loading={salvando}>
                Conferma
              </Button>
          </FooterAzioniModale>
        </Box>
      )}
    </Modal>
  );
}
