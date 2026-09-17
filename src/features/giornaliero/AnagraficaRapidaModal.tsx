import type { Dispatch, SetStateAction } from "react";
import { Box, Button, Modal, Text } from "@mantine/core";

import { FormCampiGrid, type Valori } from "../anagrafiche/FormAnagrafica";
import type { Opzione, Registro } from "../anagrafiche/registri";
import { FooterAzioniModale } from "../../ui/FooterAzioniModale";

interface AnagraficaRapidaModalProps {
  opened: boolean;
  entityLabel: string;
  editMode: boolean;
  registro: Registro;
  valori: Valori;
  errori: Record<string, string>;
  rifOpzioni?: Record<string, Opzione[]>;
  loading: boolean;
  onClose: () => void;
  onExited: () => void;
  onSubmit: () => void;
  setValori: Dispatch<SetStateAction<Valori>>;
  setErrori: Dispatch<SetStateAction<Record<string, string>>>;
}

/** Editor anagrafico compatto condiviso dai riferimenti creati dentro un ordine. */
export function AnagraficaRapidaModal({
  opened,
  entityLabel,
  editMode,
  registro,
  valori,
  errori,
  rifOpzioni,
  loading,
  onClose,
  onExited,
  onSubmit,
  setValori,
  setErrori,
}: AnagraficaRapidaModalProps) {
  const nomeValido = String(valori.nome ?? "").trim().length > 0;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700}>{editMode ? `Modifica ${entityLabel}` : `Nuovo ${entityLabel}`}</Text>}
      size="md"
      zIndex={1100}
      closeOnEscape={!loading}
      closeOnClickOutside={!loading}
      transitionProps={{ transition: "fade", duration: 150, onExited }}
    >
      <Box className="pt-modal-shell">
        <Box className="pt-modal-scroll">
          <FormCampiGrid
            registro={registro}
            valori={valori}
            errori={errori}
            rifOpzioni={rifOpzioni}
            setValori={setValori}
            setErrori={setErrori}
          />
        </Box>
        <FooterAzioniModale>
            <Button variant="default" onClick={onClose}>
              Annulla
            </Button>
            <Button color="accent" loading={loading} disabled={!nomeValido} onClick={onSubmit}>
              {editMode ? "Salva" : "Crea e seleziona"}
            </Button>
        </FooterAzioniModale>
      </Box>
    </Modal>
  );
}
