import { Box, Button, Menu, Tooltip } from "@mantine/core";
import { IconChevronDown, IconMessage } from "@tabler/icons-react";
import { useState } from "react";
import type { Spedizione } from "../../lib/tauri";
import { PremiumAction, canRunPremiumAction } from "../../premium/PremiumAction";
import { usePremiumAccess } from "../../premium/PremiumAccess";
import { toast } from "../../ui/toast/store";
import {
  apriAvvisiSpedizione,
  numeroComunicazioniSpedizione,
} from "./comunicazioniSpedizione";

export function AvvisaClientiSpedizione({
  spedizioni,
  selezione = false,
}: {
  spedizioni: Spedizione[];
  selezione?: boolean;
}) {
  const premium = usePremiumAccess();
  const [menuAperto, setMenuAperto] = useState(false);
  const alcuni = numeroComunicazioniSpedizione(spedizioni);
  const tutti = numeroComunicazioniSpedizione(spedizioni, true);
  const mostraMenu = alcuni > 0 && alcuni < tutti && canRunPremiumAction(premium);
  const label = selezione ? `Avvisa clienti (${alcuni || tutti})` : "Avvisa clienti";
  const className = selezione ? "pt-azione-adattiva" : undefined;
  const variant = selezione ? "light" : "subtle";
  const size = selezione ? undefined : "compact-sm";
  const style = {
    whiteSpace: "nowrap" as const,
    ...(selezione ? { minHeight: 36, width: "100%" } : {}),
  };
  const icona = <IconMessage size={selezione ? 16 : 14} />;
  const testo = selezione ? (
    <>
      <span className="pt-azione-adattiva-label">{label}</span>
      <span className="pt-azione-adattiva-label-compatta">Avvisa</span>
    </>
  ) : label;

  async function avvisa(tutti = false) {
    try {
      await apriAvvisiSpedizione(spedizioni, { tutti });
    } catch (error) {
      toast.error(`Preparazione degli avvisi non riuscita: ${error}`);
    }
  }

  const azione = mostraMenu ? (
    <Menu position="bottom-end" withinPortal shadow="md" onChange={setMenuAperto}>
      <Menu.Target>
        <Button
          className={className}
          variant={variant}
          color="accent"
          size={size}
          style={style}
          aria-label={label}
          leftSection={icona}
          rightSection={<IconChevronDown size={14} />}
        >
          {testo}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => avvisa()}>Contatta alcuni ({alcuni})</Menu.Item>
        <Menu.Item onClick={() => avvisa(true)}>Contatta tutti ({tutti})</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  ) : (
    <PremiumAction
      className={className}
      leftSection={icona}
      buttonVariant={variant}
      buttonColor="accent"
      buttonSize={size}
      ariaLabel={label}
      lockedPresentation="modal"
      message={
        selezione
          ? "La preparazione e l’invio coordinato degli avvisi a più clienti è disponibile tra le funzionalità extra."
          : "La preparazione e l’invio coordinato degli avvisi a tutti i clienti di questa spedizione è disponibile tra le funzionalità extra."
      }
      style={style}
      onAction={() => avvisa()}
    >
      {testo}
    </PremiumAction>
  );

  return selezione ? (
    <Tooltip label={label} withArrow disabled={mostraMenu && menuAperto}>
      <Box className="pt-azione-adattiva-wrap">{azione}</Box>
    </Tooltip>
  ) : azione;
}
