// Hub anagrafiche: switcher interno tra i registri (UI-SPEC §7.5).
// Il vecchio "Listino" è stato fuso nei Prodotti: la card "Prova prezzo" sta sopra
// la tabella e le regole di prezzo si gestiscono dentro "Modifica prodotto".
import { useEffect, useState } from "react";
import { Box, Group, ScrollArea, SegmentedControl, Stack, Text } from "@mantine/core";
import { useDeepLink } from "../../shell/navigazione";
import { Pagina } from "../../pages/Pagina";
import { REGISTRI } from "./registri";
import { RegistroView } from "./RegistroView";
import { ProvaPrezzoCard, RegoleProdotto } from "./prezzi";
import { PreferenzeContiButton } from "./PreferenzeContiModal";
import { PreferenzeAgentiButton } from "./PreferenzeAgentiModal";
import { PreferenzeProdottiButton } from "./PreferenzeProdottiModal";
import type { RecordDto } from "../../lib/tauri";
import { durataSwitchTabelleMs, useAnimazioniRidotte } from "../../ui/motion";

const TAB_STORAGE = "pt.anagrafiche.tab";

export function AnagraficheHub() {
  // Ricorda l'ultimo registro aperto (come l'hub Contabilità), invece di ripartire da capo.
  const [sel, setSel] = useState(() => {
    const s = localStorage.getItem(TAB_STORAGE);
    return s && REGISTRI.some((r) => r.entity === s) ? s : REGISTRI[0].entity;
  });
  const ridotte = useAnimazioniRidotte();
  const [selVisibile, setSelVisibile] = useState(sel);
  useEffect(() => {
    if (ridotte || durataSwitchTabelleMs === 0) {
      setSelVisibile(sel);
      return;
    }
    const r = requestAnimationFrame(() => setSelVisibile(sel));
    return () => cancelAnimationFrame(r);
  }, [sel, ridotte]);
  useEffect(() => {
    localStorage.setItem(TAB_STORAGE, sel);
  }, [sel]);
  // Quando il modale "Nuova/Modifica regola" è aperto, blocca la chiusura del modale
  // "Modifica prodotto" sottostante (Esc / click fuori non devono chiudere entrambi).
  const [regolaAperta, setRegolaAperta] = useState(false);

  // Deep-link da Spotlight: apre il registro e, se richiesto, la scheda di un record.
  const [apriRecordId, setApriRecordId] = useState<string | undefined>();
  const [apriRecordNonce, setApriRecordNonce] = useState(0);
  const { link: deepLink, consuma } = useDeepLink("/anagrafiche");
  useEffect(() => {
    if (deepLink?.tab && REGISTRI.some((r) => r.entity === deepLink.tab)) {
      setSel(deepLink.tab);
      setApriRecordId(deepLink.apriId);
      setApriRecordNonce((n) => n + 1);
      consuma();
    }
  }, [deepLink, consuma]);

  const segmenti = REGISTRI.map((r) => ({
    value: r.entity,
    label: (
      <Group gap={6} wrap="nowrap">
        <r.Icon size={15} />
        <span>{r.etichetta}</span>
      </Group>
    ),
  }));
  const registro = REGISTRI.find((r) => r.entity === sel);

  return (
    <Pagina titolo="Anagrafiche" differita>
      <Stack gap="md" style={{ height: "100%" }}>
        <ScrollArea type="never">
          <SegmentedControl
            value={sel}
            onChange={(v) => {
              setSel(v);
              setApriRecordId(undefined); // cambio manuale: niente riapertura schede deep-link
            }}
            data={segmenti}
          />
        </ScrollArea>
        <Box style={{ flex: 1, minHeight: 0 }}>
          {!registro ? null : registro.entity === "conto" ? (
            <RegistroView
              key={registro.entity}
              attiva={((ridotte || durataSwitchTabelleMs === 0) ? sel : selVisibile) === registro.entity}
              registro={registro}
              apriRecordId={apriRecordId}
              apriRecordNonce={apriRecordNonce}
              bloccato={(r: RecordDto) => r.data.builtin === true}
              azioneExtra={<PreferenzeContiButton />}
            />
          ) : registro.entity === "corriere" ? (
            <RegistroView
              key={registro.entity}
              attiva={((ridotte || durataSwitchTabelleMs === 0) ? sel : selVisibile) === registro.entity}
              registro={registro}
              apriRecordId={apriRecordId}
              apriRecordNonce={apriRecordNonce}
              nonEliminabile={(r: RecordDto) => r.data.builtin === true}
              campiDisabilitati={(rec) => (rec?.data.builtin === true ? ["profilo"] : [])}
            />
          ) : registro.entity === "prodotto" ? (
            <RegistroView
              key={registro.entity}
              attiva={((ridotte || durataSwitchTabelleMs === 0) ? sel : selVisibile) === registro.entity}
              registro={registro}
              apriRecordId={apriRecordId}
              apriRecordNonce={apriRecordNonce}
              modalSize="lg"
              bloccaChiusura={regolaAperta}
              intestazione={<ProvaPrezzoCard />}
              azioneExtra={<PreferenzeProdottiButton />}
              modalExtra={(rec) =>
                rec ? (
                  <RegoleProdotto prodottoId={rec.id} onAperturaChange={setRegolaAperta} />
                ) : (
                  <Text size="sm" c="dimmed">
                    Salva il prodotto per aggiungere le sue regole di prezzo.
                  </Text>
                )
              }
            />
          ) : registro.entity === "agente" ? (
            <RegistroView
              key={registro.entity}
              attiva={((ridotte || durataSwitchTabelleMs === 0) ? sel : selVisibile) === registro.entity}
              registro={registro}
              apriRecordId={apriRecordId}
              apriRecordNonce={apriRecordNonce}
              azioneExtra={<PreferenzeAgentiButton />}
            />
          ) : (
            <RegistroView
              key={registro.entity}
              attiva={((ridotte || durataSwitchTabelleMs === 0) ? sel : selVisibile) === registro.entity}
              registro={registro}
              apriRecordId={apriRecordId}
              apriRecordNonce={apriRecordNonce}
            />
          )}
        </Box>
      </Stack>
    </Pagina>
  );
}
