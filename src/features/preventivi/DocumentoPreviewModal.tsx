import { Alert, Box, Button, Modal, Stack, Text } from "@mantine/core";
import {
  IconAlertTriangle,
  IconDownload,
  IconPhoto,
  IconPrinter,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "../../ui/toast/store";
import {
  documentoPdfBlob,
  documentoPngBlob,
  documentoSvg,
  pagineDocumento,
  salvaBlobConPercorso,
  stampaDocumento,
  type DocumentoA4,
} from "./rendererDocumenti";

type OperazioneDocumento = "pdf" | "png" | "stampa" | null;

export function DocumentoPreviewModal({
  documento,
  documentoVisuale,
  opened,
  onClose,
  titolo,
  pannelloLaterale,
  azioniExtra,
  azioniAffollate = false,
  sovrapposizionePagina,
  nascondiAzioniStandard = false,
  dentroFinestra = false,
}: {
  documento: DocumentoA4 | null;
  documentoVisuale?: DocumentoA4 | null;
  opened: boolean;
  onClose: () => void;
  titolo?: string;
  pannelloLaterale?: ReactNode;
  azioniExtra?: ReactNode;
  /** Anticipa la modalità compatta quando il footer contiene molte azioni. */
  azioniAffollate?: boolean;
  sovrapposizionePagina?: (indice: number) => ReactNode;
  /** Durante l'editing inline lascia nel footer soltanto le azioni dell'editor. */
  nascondiAzioniStandard?: boolean;
  /** Render a pagina nella Webview dedicata, senza un secondo modale interno. */
  dentroFinestra?: boolean;
}) {
  const [operazione, setOperazione] = useState<OperazioneDocumento>(null);
  const puliziaStampaRef = useRef<(() => void) | null>(null);
  const documentoDaMostrare = documentoVisuale ?? documento;
  const svgs = useMemo(
    () =>
      opened && documentoDaMostrare
        ? pagineDocumento(documentoDaMostrare).map((_, index) =>
            documentoSvg(documentoDaMostrare, index),
          )
        : [],
    [documentoDaMostrare, opened],
  );
  const bloccato = !!documento?.overflow.length;
  const pronto = !!documento && !bloccato;

  const salvaPdf = async () => {
    if (!documento || bloccato || operazione) return;
    setOperazione("pdf");
    try {
      if (await salvaBlobConPercorso(documentoPdfBlob(documento), documento.nomeFile)) {
        toast.success("PDF salvato.");
      }
    } catch (error) {
      toast.error(`Salvataggio PDF non riuscito: ${error}`);
    } finally {
      setOperazione(null);
    }
  };

  const salvaPng = async () => {
    if (!documento || bloccato || operazione) return;
    setOperazione("png");
    try {
      const blob = await documentoPngBlob(documento);
      if (await salvaBlobConPercorso(blob, documento.nomeFile.replace(/\.pdf$/i, ".png"))) {
        toast.success("Immagine salvata.");
      }
    } catch (error) {
      toast.error(`Generazione immagine non riuscita: ${error}`);
    } finally {
      setOperazione(null);
    }
  };

  const stampa = async () => {
    if (!documento || bloccato || operazione) return;
    setOperazione("stampa");
    try {
      puliziaStampaRef.current?.();
      let pulizia: (() => void) | null = null;
      pulizia = stampaDocumento(documento, () => {
        if (puliziaStampaRef.current === pulizia) puliziaStampaRef.current = null;
      });
      puliziaStampaRef.current = pulizia;
    } catch (error) {
      toast.warning(String(error));
    } finally {
      setOperazione(null);
    }
  };

  useEffect(() => {
    if (!opened) {
      puliziaStampaRef.current?.();
      puliziaStampaRef.current = null;
    }
    return () => {
      puliziaStampaRef.current?.();
      puliziaStampaRef.current = null;
    };
  }, [opened]);

  const chiudi = () => {
    puliziaStampaRef.current?.();
    puliziaStampaRef.current = null;
    onClose();
  };

  const titoloDocumento = titolo ?? documento?.titolo ?? "Anteprima documento";
  const contenuto = (
      <Box
        className="pt-modal-shell"
        style={
          dentroFinestra
            ? undefined
            : { minHeight: "min(760px, calc(100vh - 150px))" }
        }
      >
        <Box
          className={`pt-modal-scroll${pannelloLaterale ? " pt-document-preview-grid" : ""}`}
          style={{
            background: "var(--mantine-color-gray-1)",
            display: "grid",
            gridTemplateColumns: pannelloLaterale
              ? "minmax(0, 1fr) minmax(340px, 430px)"
              : "1fr",
          }}
        >
          <Stack align="center" gap="md" p="md" style={{ minWidth: 0 }}>
            {bloccato && (
              <Alert
                color="orange"
                icon={<IconAlertTriangle size={18} />}
                title="Riduci il contenuto prima di stampare o inviare"
                w="min(100%, 760px)"
              >
                <Stack gap={3}>
                  {documento?.overflow.map((messaggio) => (
                    <Text key={messaggio} size="sm">
                      {messaggio}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            )}
            {documento ? (
              <Box
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 18,
                }}
              >
                  {svgs.map((svg, index) => (
                    <Box
                      key={index}
                      className="pt-document-preview-page"
                      aria-label={`Anteprima ${documento.titolo}, pagina ${index + 1} di ${svgs.length}`}
                      style={{
                        position: "relative",
                        width: "min(100%, 760px)",
                        aspectRatio: "794 / 1123",
                        flex: "0 0 auto",
                        background: "#fff",
                        boxShadow: "0 18px 48px rgba(23,35,59,.16)",
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        style={{ position: "absolute", inset: 0 }}
                        dangerouslySetInnerHTML={{ __html: svg }}
                      />
                      {sovrapposizionePagina?.(index)}
                    </Box>
                  ))}
              </Box>
            ) : (
              <Box mih={520} />
            )}
          </Stack>
          {pannelloLaterale && (
            <Box
              className="pt-document-preview-editor"
              p="md"
              style={{
                background: "var(--surface)",
                borderLeft: "1px solid var(--mantine-color-default-border)",
              }}
            >
              {pannelloLaterale}
            </Box>
          )}
        </Box>
        <div
          className="pt-modal-footer pt-document-preview-footer"
          style={{ justifyContent: "flex-end" }}
        >
          <div
            className="pt-modal-actions pt-document-preview-actions"
            data-affollate={azioniAffollate || undefined}
          >
            {!nascondiAzioniStandard && (
              <Button variant="default" onClick={chiudi}>
                Chiudi
              </Button>
            )}
            {azioniExtra}
            {!nascondiAzioniStandard && <Button
              variant="default"
              leftSection={<IconPhoto size={16} />}
              onClick={() => void salvaPng()}
              loading={operazione === "png"}
              disabled={!pronto || !!operazione}
            >
              Salva immagine
            </Button>}
            {!nascondiAzioniStandard && <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={() => void salvaPdf()}
              loading={operazione === "pdf"}
              disabled={!pronto || !!operazione}
            >
              Salva PDF
            </Button>}
            {!nascondiAzioniStandard && <Button
              color="accent"
              leftSection={<IconPrinter size={16} />}
              onClick={() => void stampa()}
              loading={operazione === "stampa"}
              disabled={!pronto || !!operazione}
            >
              Stampa
            </Button>}
          </div>
        </div>
      </Box>
  );

  if (dentroFinestra) {
    if (!opened) return null;
    return (
      <Box
        p="lg"
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <Text fw={800} fz="xl" mb="md" style={{ flex: "0 0 auto" }}>
          {titoloDocumento}
        </Text>
        <Box className="pt-window-form">{contenuto}</Box>
      </Box>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={chiudi}
      size={
        pannelloLaterale
          ? "min(1380px, calc(100vw - 48px))"
          : "min(1160px, calc(100vw - 48px))"
      }
      title={<Text fw={700}>{titoloDocumento}</Text>}
      transitionProps={{ transition: "fade", duration: 180 }}
      closeButtonProps={{ "aria-label": "Chiudi anteprima", tabIndex: -1 }}
    >
      {contenuto}
    </Modal>
  );
}
