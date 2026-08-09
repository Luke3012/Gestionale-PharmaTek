import { Button, Group } from "@mantine/core";
import {
  IconDeviceFloppy,
  IconPencil,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  api,
  type ConfigurazioneDocumenti,
  type SchedaCliente,
  type SchedaClienteCampi,
  type SchedaClienteSalvaInput,
} from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { DocumentoPreviewModal } from "./DocumentoPreviewModal";
import { creaDocumentoSchedaCliente } from "./rendererDocumenti";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { mergeRealtimeSelettivo } from "../../lib/mergeRealtime";

const EVENTI_SCHEDA_APERTA = [
  "scheda_cliente:salvato",
  "ordine:salvato",
  "riga_ordine:salvato",
  "pagamento:salvato",
] as const;

function campiDaScheda(scheda: SchedaCliente): SchedaClienteCampi {
  return {
    dataRicezione: scheda.dataRicezione,
    pazienti: scheda.pazienti,
    infoSpedizione: scheda.infoSpedizione,
    contatti: scheda.contatti,
    intestatarioNome: scheda.intestatarioNome,
    intestatarioCodiceFiscale: scheda.intestatarioCodiceFiscale,
    intestatarioDataNascita: scheda.intestatarioDataNascita,
    intestatarioLuogoNascita: scheda.intestatarioLuogoNascita,
    intestatarioIndirizzo: scheda.intestatarioIndirizzo,
    importoTotale: scheda.importoTotale,
    importoAcconto: scheda.importoAcconto,
    dataContabileValuta: scheda.dataContabileValuta,
    modalitaSaldo: scheda.modalitaSaldo || "bonifico",
    note: scheda.note,
    preventivoWhatsapp: scheda.preventivoWhatsapp,
    preventivoEmail: scheda.preventivoEmail,
    mantenimento: scheda.mantenimento,
    npp: scheda.npp,
    pazienteNuovo: scheda.pazienteNuovo,
  };
}

function aggiorna<K extends keyof SchedaClienteCampi>(
  setCampi: React.Dispatch<React.SetStateAction<SchedaClienteCampi | null>>,
  key: K,
  value: SchedaClienteCampi[K],
) {
  setCampi((correnti) => (correnti ? { ...correnti, [key]: value } : correnti));
}

export function SchedaClienteModal({
  ordineId,
  ordineNumero,
  opened,
  onClose,
}: {
  ordineId: string | null;
  ordineNumero?: string;
  opened: boolean;
  onClose: () => void;
}) {
  const [scheda, setScheda] = useState<SchedaCliente | null>(null);
  const [campi, setCampi] = useState<SchedaClienteCampi | null>(null);
  const [baseline, setBaseline] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [modalitaModifica, setModalitaModifica] = useState(false);
  const [configDocumenti, setConfigDocumenti] =
    useState<ConfigurazioneDocumenti | null>(null);

  useEffect(() => {
    if (!opened || !ordineId) {
      setScheda(null);
      setCampi(null);
      setConfigDocumenti(null);
      setBaseline("");
      setModalitaModifica(false);
      return;
    }
    let attivo = true;
    setScheda(null);
    setCampi(null);
    Promise.all([
      api.schedaClienteGet(ordineId),
      api.configurazioneDocumentiGet(),
    ])
      .then(([result, config]) => {
        if (!attivo) return;
        const next = campiDaScheda(result);
        setScheda(result);
        setCampi(next);
        setBaseline(JSON.stringify(next));
        setConfigDocumenti(config);
      })
      .catch((error) => {
        if (attivo) toast.error(`Caricamento scheda cliente non riuscito: ${error}`);
      });
    return () => {
      attivo = false;
    };
  }, [opened, ordineId]);

  const dirty = !!campi && JSON.stringify(campi) !== baseline;

  useRicaricaSuEventi(
    EVENTI_SCHEDA_APERTA,
    async () => {
      if (!opened || !ordineId || salvando || !scheda || !campi) return;
      try {
        const remota = await api.schedaClienteGet(ordineId);
        const campiRemoti = campiDaScheda(remota);
        if (
          remota.revision === scheda.revision &&
          remota.ordineRevision === scheda.ordineRevision &&
          JSON.stringify(campiRemoti) === JSON.stringify(campiDaScheda(scheda))
        ) {
          return;
        }
        const base = campiDaScheda(scheda) as SchedaClienteCampi &
          Record<string, unknown>;
        const locale = campi as SchedaClienteCampi & Record<string, unknown>;
        const remoto = campiRemoti as SchedaClienteCampi & Record<string, unknown>;
        const merge = mergeRealtimeSelettivo(base, locale, remoto);
        setScheda(remota);
        setCampi(merge.valori);
        setBaseline(JSON.stringify(remoto));
        if (merge.aggiornati.length > 0) {
          toast.info(
            "Scheda aggiornata con i dati arrivati da un’altra postazione.",
          );
        }
      } catch {
        // Le revisioni vengono comunque ricontrollate dal salvataggio atomico.
      }
    },
    100,
  );
  const numero = scheda?.ordineNumero || ordineNumero || "";
  const documento = useMemo(
    () =>
      opened && campi
        ? creaDocumentoSchedaCliente(
            numero,
            campi,
            configDocumenti ?? undefined,
            {
              medicoNome: scheda?.medicoNome,
              agenteNome: scheda?.agenteNome,
            },
          )
        : null,
    [campi, configDocumenti, numero, opened, scheda?.agenteNome, scheda?.medicoNome],
  );
  const documentoVisuale = useMemo(
    () =>
      opened && campi && modalitaModifica
        ? creaDocumentoSchedaCliente(
            numero,
            campi,
            configDocumenti ?? undefined,
            {
              nascondiValoriEditabili: true,
              medicoNome: scheda?.medicoNome,
              agenteNome: scheda?.agenteNome,
            },
          )
        : null,
    [campi, configDocumenti, modalitaModifica, numero, opened, scheda?.agenteNome, scheda?.medicoNome],
  );
  const mancanti = useMemo(() => {
    if (!campi) return [];
    return [
      !campi.dataRicezione ? "data ricezione" : "",
      !campi.pazienti ? "nome paziente" : "",
      !campi.infoSpedizione ? "informazioni di spedizione" : "",
      !campi.contatti ? "contatti" : "",
      !campi.intestatarioNome ? "intestatario fattura" : "",
      !campi.intestatarioIndirizzo ? "indirizzo intestatario" : "",
    ].filter(Boolean);
  }, [campi]);

  async function salva() {
    if (!scheda || !campi || salvando) return;
    setSalvando(true);
    try {
      const input: SchedaClienteSalvaInput = {
        ordineId: scheda.ordineId,
        ordineRevision: scheda.ordineRevision,
        schedaRevision: scheda.revision || undefined,
        ...campi,
      };
      const result = await api.schedaClienteSalva(input);
      const next = campiDaScheda(result);
      setScheda(result);
      setCampi(next);
      setBaseline(JSON.stringify(next));
      setModalitaModifica(false);
      toast.success("Scheda cliente salvata.");
    } catch (error) {
      toast.error(`Salvataggio scheda cliente non riuscito: ${error}`);
    } finally {
      setSalvando(false);
    }
  }

  function annullaModifiche() {
    if (scheda) setCampi(campiDaScheda(scheda));
    setModalitaModifica(false);
  }

  async function richiediChiusura() {
    if (dirty) {
      const conferma = await dialog.confirm(
        "Uscire senza salvare?",
        "Le modifiche alla scheda cliente andranno perse.",
        { conferma: "Esci comunque", annulla: "Resta" },
      );
      if (!conferma) return;
    }
    setScheda(null);
    setCampi(null);
    setConfigDocumenti(null);
    setBaseline("");
    onClose();
  }

  return (
    <DocumentoPreviewModal
      opened={opened}
      documento={documento}
      documentoVisuale={documentoVisuale}
      onClose={() => void richiediChiusura()}
      titolo={`Scheda cliente${numero ? ` · ordine ${numero}` : ""}`}
      sovrapposizionePagina={(indice) =>
        indice === 0 && campi && modalitaModifica ? (
          <SchedaClienteOverlay
            campi={campi}
            setCampi={setCampi}
            mancanti={new Set(mancanti)}
          />
        ) : null
      }
      nascondiAzioniStandard={modalitaModifica}
      azioniExtra={
        modalitaModifica ? (
          <Group gap="xs" wrap="nowrap">
            <Button
              variant="default"
              leftSection={<IconX size={16} />}
              onClick={annullaModifiche}
              disabled={salvando}
            >
              Annulla modifiche
            </Button>
            <Button
              color="accent"
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={() => void salva()}
              loading={salvando}
              disabled={!dirty}
            >
              Salva modifiche
            </Button>
          </Group>
        ) : (
          <Button
            variant="default"
            leftSection={<IconPencil size={16} />}
            onClick={() => setModalitaModifica(true)}
            disabled={!campi}
          >
            Modifica
          </Button>
        )
      }
    />
  );
}

const SCALA_X = 100 / 794;
const SCALA_Y = 100 / 1123;

function posizioneCarta(x: number, y: number, width: number, height: number): CSSProperties {
  return {
    left: `${x * SCALA_X}%`,
    top: `${y * SCALA_Y}%`,
    width: `${width * SCALA_X}%`,
    height: `${height * SCALA_Y}%`,
  };
}

function SchedaClienteOverlay({
  campi,
  setCampi,
  mancanti,
}: {
  campi: SchedaClienteCampi;
  setCampi: React.Dispatch<React.SetStateAction<SchedaClienteCampi | null>>;
  mancanti: Set<string>;
}) {
  const campo = (
    key: keyof SchedaClienteCampi,
    x: number,
    y: number,
    width: number,
    height = 28,
    tipo: "text" | "date" | "number" | "textarea" = "text",
    missing = false,
  ) => {
    const comune = {
      className: "pt-scheda-inline-field",
      style: posizioneCarta(x, y, width, height),
      value:
        tipo === "number"
          ? (Number(campi[key]) / 100).toFixed(2)
          : String(campi[key] ?? ""),
      "data-missing": missing || undefined,
      "data-empty": !String(campi[key] ?? "").trim() || undefined,
      "aria-label": String(key),
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const value = event.currentTarget.value;
        aggiorna(
          setCampi,
          key,
          (tipo === "number"
            ? Math.max(0, Math.round(Number(value || 0) * 100))
            : value) as never,
        );
      },
    };
    return tipo === "textarea" ? (
      <textarea key={key} {...comune} />
    ) : (
      <input key={key} {...comune} type={tipo} step={tipo === "number" ? "0.01" : undefined} />
    );
  };

  const casella = (
    key: "preventivoWhatsapp" | "preventivoEmail" | "mantenimento" | "npp" | "pazienteNuovo",
    x: number,
    y: number,
  ) => (
    <button
      key={key}
      type="button"
      className="pt-scheda-inline-check"
      style={posizioneCarta(x, y, 42, 34)}
      aria-label={key}
      aria-pressed={campi[key]}
      onClick={() => aggiorna(setCampi, key, !campi[key])}
    />
  );

  const saldo = (value: string, y: number) => (
    <button
      key={value}
      type="button"
      className="pt-scheda-inline-check"
      style={posizioneCarta(704, y, 42, 34)}
      aria-label={`Saldo ${value}`}
      aria-pressed={campi.modalitaSaldo === value}
      onClick={() => aggiorna(setCampi, "modalitaSaldo", value)}
    />
  );

  return (
    <div className="pt-scheda-inline-overlay">
      {campo("dataRicezione", 194, 165, 500, 27, "date", mancanti.has("data ricezione"))}
      {campo("pazienti", 194, 205, 500, 27, "text", mancanti.has("nome paziente"))}
      {campo("infoSpedizione", 194, 278, 548, 58, "textarea", mancanti.has("informazioni di spedizione"))}
      {campo("contatti", 132, 369, 610, 27, "text", mancanti.has("contatti"))}
      {campo("intestatarioNome", 214, 484, 528, 27, "text", mancanti.has("intestatario fattura"))}
      {campo("intestatarioCodiceFiscale", 270, 524, 472, 27)}
      {campo("intestatarioIndirizzo", 264, 564, 478, 27, "text", mancanti.has("indirizzo intestatario"))}
      {campo("importoTotale", 264, 643, 145, 34, "number")}
      {saldo("bonifico", 668)}
      {saldo("contrassegno", 702)}
      {saldo("assegno", 736)}
      {campo("note", 102, 797, 640, 88, "textarea")}
      {casella("preventivoWhatsapp", 365, 920)}
      {casella("preventivoEmail", 365, 954)}
      {casella("mantenimento", 704, 920)}
      {casella("npp", 704, 954)}
      {casella("pazienteNuovo", 704, 988)}
    </div>
  );
}
