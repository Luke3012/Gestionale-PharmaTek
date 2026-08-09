// Hub Contabilità a tab (UI-SPEC §7.6): Crediti · Distinte Corrieri · Provvigioni · Rimborsi.
import { useEffect, useState } from "react";
import { Box, Tabs } from "@mantine/core";
import { IconCoin, IconReceiptRefund, IconTruckDelivery, IconWallet } from "@tabler/icons-react";
import { useDeepLink } from "../../shell/navigazione";
import { Pagina } from "../../pages/Pagina";
import { ProvvigioniView } from "./ProvvigioniView";
import { PagamentiView } from "./PagamentiView";
import { DistinteView } from "./DistinteView";
import { RimborsiView } from "./RimborsiView";
import { durataSwitchTabelleMs, useAnimazioniRidotte } from "../../ui/motion";

const TAB_STORAGE = "pt.contabilita.tab";

export function ContabilitaHub() {
  // Un deep-link conosce già la scheda di destinazione: usalo anche al primissimo
  // render, evitando di avviare per un frame la scheda ricordata in precedenza.
  const { link: deepLink, consuma } = useDeepLink("/contabilita");
  const tabIniziale = () =>
    deepLink ? deepLink.tab ?? "pagamenti" : localStorage.getItem(TAB_STORAGE) || "pagamenti";
  // Default Pagamenti, ma ricorda l'ultimo tab aperto dall'utente.
  const [tab, setTab] = useState<string | null>(tabIniziale);
  const ridotte = useAnimazioniRidotte();
  // La logica del reveal resta disponibile, ma per gli switch fra tabelle la durata
  // condivisa è 0 ms: il pannello nuovo diventa quindi visibile nello stesso commit.
  const [tabVisibile, setTabVisibile] = useState<string | null>(tab);
  useEffect(() => {
    if (ridotte || durataSwitchTabelleMs === 0) {
      setTabVisibile(tab);
      return;
    }
    const r = requestAnimationFrame(() => setTabVisibile(tab));
    return () => cancelAnimationFrame(r);
  }, [tab, ridotte]);
  // All'ingresso monta soltanto la scheda visibile: le quattro viste contabili
  // eseguono query indipendenti e caricarle tutte insieme rallenta inutilmente il
  // primo reveal. Una volta visitata, una scheda resta montata e conserva filtri/stato.
  const [tabVisitati, setTabVisitati] = useState<Set<string>>(
    () => new Set([tabIniziale()])
  );

  // Filtro iniziale da Spotlight/Dashboard per la sotto-vista di destinazione.
  const [filtroDistinte, setFiltroDistinte] = useState<{ nonce: number; cerca: string }>();
  const [filtroCrediti, setFiltroCrediti] = useState<{
    nonce: number;
    cerca?: string;
    stati?: string[];
    spedito?: "spediti" | "non";
    conto?: { id?: string; nome?: string };
    contoIds?: string[];
    spedizioneLotti?: string[];
    agenteIds?: string[];
    medicoIds?: string[];
    linee?: string[];
    dal?: string;
    al?: string;
  }>();
  const [filtroProvv, setFiltroProvv] = useState<{ nonce: number; dal?: string; al?: string; agenteId?: string; ordina?: "maturato" | "potenziale" | "nome" } | undefined>();
  const [filtroRimborsi, setFiltroRimborsi] = useState<{ nonce: number; stati?: string[]; origini?: string[]; dal?: string; al?: string }>();
  // Nonce: incrementati da un deep-link «azione» per aprire la modale di creazione
  // (Nuovo rimborso / Nuova distinta) nella vista di destinazione.
  const [apriNuovoRimborso, setApriNuovoRimborso] = useState(0);
  const [apriNuovaDistinta, setApriNuovaDistinta] = useState(0);

  function cambiaTab(v: string | null) {
    setTab(v);
    if (v) {
      localStorage.setItem(TAB_STORAGE, v);
      setTabVisitati((correnti) => {
        if (correnti.has(v)) return correnti;
        const prossimi = new Set(correnti);
        prossimi.add(v);
        return prossimi;
      });
    }
  }

  // Deep-link da Spotlight/Dashboard: apre il tab giusto e applica i filtri
  // (Crediti: nome/stati/spedito · Distinte: corriere · Provvigioni: periodo/agente).
  useEffect(() => {
    if (!deepLink) return;
    const dest = deepLink.tab ?? "pagamenti";
    if (deepLink.tab) cambiaTab(deepLink.tab);
    if (dest === "distinte") {
      setFiltroDistinte((prev) => ({
        nonce: (prev?.nonce ?? 0) + 1,
        cerca: deepLink.cerca ?? "",
      }));
    }
    if (dest === "pagamenti") {
      setFiltroCrediti((prev) => ({
        nonce: (prev?.nonce ?? 0) + 1,
        cerca: deepLink.cerca,
        stati: deepLink.statiPagamento,
        spedito: deepLink.spedito,
        conto: deepLink.contoId || deepLink.contoNome ? { id: deepLink.contoId, nome: deepLink.contoNome } : undefined,
        contoIds: deepLink.contoIds,
        spedizioneLotti: deepLink.spedizioneLotti,
        agenteIds: deepLink.agenteIds,
        medicoIds: deepLink.medicoIds,
        linee: deepLink.linee,
        dal: deepLink.dal,
        al: deepLink.al,
      }));
    }
    if (dest === "provvigioni" && (deepLink.dal || deepLink.al || deepLink.agenteId || deepLink.provvigioniOrdina)) {
      setFiltroProvv((prev) => ({
        nonce: (prev?.nonce ?? 0) + 1,
        dal: deepLink.dal,
        al: deepLink.al,
        agenteId: deepLink.agenteId,
        ordina: deepLink.provvigioniOrdina,
      }));
    }
    if (dest === "rimborsi") {
      setFiltroRimborsi((prev) => ({
        nonce: (prev?.nonce ?? 0) + 1,
        stati: deepLink.rimborsoStati,
        origini: deepLink.rimborsoOrigini,
        dal: deepLink.dal,
        al: deepLink.al,
      }));
    }
    if (deepLink.azione === "nuovo_rimborso") setApriNuovoRimborso((k) => k + 1);
    if (deepLink.azione === "nuova_distinta") setApriNuovaDistinta((k) => k + 1);
    consuma();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink]);

  return (
    <Pagina titolo="Contabilità" differita>
      <Tabs
        value={tab}
        onChange={cambiaTab}
        style={{ height: "100%", display: "flex", flexDirection: "column" }}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="pagamenti" leftSection={<IconWallet size={16} />}>
            Crediti
          </Tabs.Tab>
          <Tabs.Tab value="distinte" leftSection={<IconTruckDelivery size={16} />}>
            Distinte Corrieri
          </Tabs.Tab>
          <Tabs.Tab value="provvigioni" leftSection={<IconCoin size={16} />}>
            Provvigioni
          </Tabs.Tab>
          <Tabs.Tab value="rimborsi" leftSection={<IconReceiptRefund size={16} />}>
            Rimborsi
          </Tabs.Tab>
        </Tabs.List>

        <Box style={{ flex: 1, minHeight: 0 }}>
          <Tabs.Panel value="provvigioni" style={{ height: "100%" }}>
            {tabVisitati.has("provvigioni") ? (
              <ProvvigioniView
                attiva={((ridotte || durataSwitchTabelleMs === 0) ? tab : tabVisibile) === "provvigioni"}
                filtroIniziale={filtroProvv}
              />
            ) : null}
          </Tabs.Panel>
          <Tabs.Panel value="pagamenti" style={{ height: "100%" }}>
            {tabVisitati.has("pagamenti") ? (
              <PagamentiView
                attiva={((ridotte || durataSwitchTabelleMs === 0) ? tab : tabVisibile) === "pagamenti"}
                filtroIniziale={filtroCrediti}
              />
            ) : null}
          </Tabs.Panel>
          <Tabs.Panel value="distinte" style={{ height: "100%" }}>
            {tabVisitati.has("distinte") ? (
              <DistinteView
                attiva={((ridotte || durataSwitchTabelleMs === 0) ? tab : tabVisibile) === "distinte"}
                filtroIniziale={filtroDistinte}
                apriNuova={apriNuovaDistinta}
              />
            ) : null}
          </Tabs.Panel>
          <Tabs.Panel value="rimborsi" style={{ height: "100%" }}>
            {tabVisitati.has("rimborsi") ? (
              <RimborsiView
                attiva={((ridotte || durataSwitchTabelleMs === 0) ? tab : tabVisibile) === "rimborsi"}
                apriNuovo={apriNuovoRimborso}
                filtroIniziale={filtroRimborsi}
              />
            ) : null}
          </Tabs.Panel>
        </Box>
      </Tabs>
    </Pagina>
  );
}
