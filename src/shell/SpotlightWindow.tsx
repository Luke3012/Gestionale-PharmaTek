// Barra di ricerca globale "Spotlight" (FASE 6A): finestra Tauri a sé,
// trasparente e senza bordi, richiamata dalla scorciatoia globale (o Ctrl+K) e
// mostrata sopra qualsiasi cosa, senza richiamare la finestra principale.
// Si chiude con Esc o quando perde il focus (clic fuori). Ogni risultato è
// azionabile: apre l'ordine, il riepilogo dell'entità, o porta la finestra
// principale nel punto giusto.
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Box, Group, Kbd, Paper, ScrollArea, Text, TextInput, ThemeIcon } from "@mantine/core";
import {
  IconFileDollar,
  IconHistory,
  IconSearch,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { api, inTauri, type Identity } from "../lib/tauri";
import {
  caricaDatiRicerca,
  chiaveBersaglio,
  costruisciSuggeriti,
  costruisciVoci,
  DATI_VUOTI,
  tracciabile,
  type DatiRicerca,
  type VoceRicerca,
} from "./ricerca";
import { registraUso } from "./frecency";
import { nascondiFinestraCorrente, vaiAllaPrincipale } from "./navigazione";
import { apriFinestraOrdine } from "../features/giornaliero/apriFinestra";
import { apriFinestraPagamento } from "../features/contabilita/apriFinestraPagamento";
import { apriFinestraPromemoria } from "../features/promemoria/apriFinestraPromemoria";
import { apriFinestraPreventivo } from "../features/preventivi/apriFinestraPreventivo";
import {
  apriFinestraNotifiche,
  apriFinestraCestino,
  apriFinestraCentroComunicazioni,
  apriFinestraInfo,
} from "./apriPannelli";
import { apriFinestraRiepilogo } from "./apriRiepilogo";
import { usePrefs } from "../lib/prefs";
import { inviaMessaggio } from "../features/notifiche/messaggi";
import { dur, easeOut, useAnimazioniRidotte } from "../ui/motion";
import { useRicaricaSuEventi } from "../lib/useRicaricaSuEventi";
import { usePremiumAccess } from "../premium/PremiumAccess";

const EVENTO_RICERCA_INVALIDATA = "pt:ricerca-invalidata";
const MAX_ETA_INDICE_MS = 30_000;
const EVENTI_RICARICA = [
  "ordine:salvato",
  "preventivo:salvato",
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
  "prodotto:salvato",
  "corriere:salvato",
  "distinta:salvato",
  "spedizione:salvato",
  "pagamento:salvato",
  "promemoria:salvato",
  EVENTO_RICERCA_INVALIDATA,
  "pt:proiezione-ricostruita",
  "pt:data-wiped",
] as const;

export function SpotlightWindow() {
  const { anno, zoomUI } = usePrefs();
  const zoomFactor = zoomUI || 1;
  const ridotte = useAnimazioniRidotte();
  const premium = usePremiumAccess();
  const [q, setQ] = useState("");
  const qDifferita = useDeferredValue(q);
  const [sel, setSel] = useState(0);
  const [dati, setDati] = useState<DatiRicerca>(DATI_VUOTI);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  const identityRef = useRef<Identity | null>(null);
  const reloadTimerRef = useRef<number | null>(null);
  const datiCaricatiRef = useRef(false);
  const indiceSporcoRef = useRef(false);
  const ultimoCaricamentoRef = useRef(0);
  const caricamentoInCorsoRef = useRef(false);
  const ricaricaTraPocoRef = useRef<() => void>(() => {});
  // L'hover col mouse seleziona la voce, MA lo scroll da tastiera (frecce) fa scorrere la
  // lista sotto il cursore fermo, scatenando `onMouseEnter` su una riga che «passa di sotto»
  // → la selezione veniva rubata da una voce a caso. Abilitiamo la selezione-da-hover solo
  // dopo un reale movimento del mouse; ogni navigazione da tastiera la disattiva.
  const hoverAttivo = useRef(true);

  // Identità (per aprire le finestre Ordine/Riepilogo): caricata una volta.
  useEffect(() => {
    api.whoami().then((i) => (identityRef.current = i)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow, LogicalSize }) => {
      const win = getCurrentWindow();
      const w = Math.round(640 * zoomFactor);
      const h = Math.round(460 * zoomFactor);
      await win.setSize(new LogicalSize(w, h)).catch(() => {});
      await win.center().catch(() => {});
    });
  }, [zoomFactor]);

  const ricarica = useCallback(() => {
    if (caricamentoInCorsoRef.current) {
      indiceSporcoRef.current = true;
      return;
    }
    caricamentoInCorsoRef.current = true;
    caricaDatiRicerca(anno)
      .then((next) =>
        startTransition(() => {
          datiCaricatiRef.current = true;
          indiceSporcoRef.current = false;
          ultimoCaricamentoRef.current = Date.now();
          setDati(next);
        })
      )
      .catch(() => {})
      .finally(() => {
        caricamentoInCorsoRef.current = false;
        if (indiceSporcoRef.current) ricaricaTraPocoRef.current();
      });
  }, [anno]);

  const ricaricaTraPoco = useCallback(() => {
    if (reloadTimerRef.current != null) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      ricarica();
    }, 250);
  }, [ricarica]);

  useEffect(() => {
    ricaricaTraPocoRef.current = ricaricaTraPoco;
  }, [ricaricaTraPoco]);

  // Warm-up cache all'avvio (la finestra nasce nascosta: i dati sono pronti).
  useEffect(() => ricarica(), [ricarica]);
  useEffect(() => {
    if (premium.loaded) ricaricaTraPoco();
  }, [premium.enabled, premium.loaded, ricaricaTraPoco]);

  // La finestra Spotlight resta viva anche quando è nascosta: aggiorna l'indice
  // in background, senza ricaricare a ogni singolo record.
  useRicaricaSuEventi(EVENTI_RICARICA, () => {
    indiceSporcoRef.current = true;
    ricaricaTraPoco();
  });

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current != null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, [ricaricaTraPoco]);

  async function nascondi() {
    await nascondiFinestraCorrente();
  }

  function resetVista() {
    setQ("");
    setSel(0);
    requestAnimationFrame(() => {
      scrollViewportRef.current?.scrollTo({ top: 0, left: 0 });
      inputRef.current?.focus();
      requestAnimationFrame(() => scrollViewportRef.current?.scrollTo({ top: 0, left: 0 }));
    });
  }

  // Apertura/chiusura legate al focus della finestra: quando riceve il focus è una
  // nuova apertura → azzera la query, rifà il focus sull'input e aggiorna i dati;
  // quando lo perde (clic fuori) si nasconde.
  useEffect(() => {
    if (!inTauri) return;
    let off: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      off = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) {
          resetVista();
          const vecchio = Date.now() - ultimoCaricamentoRef.current > MAX_ETA_INDICE_MS;
          if (!datiCaricatiRef.current || indiceSporcoRef.current || vecchio) ricaricaTraPoco();
        } else {
          getCurrentWindow().hide();
        }
      });
    })();
    return () => off?.();
  }, [ricarica]);

  // A barra vuota mostra i «Suggeriti» e poi i comandi, senza la vecchia sezione "Adesso".
  const vociBase = useMemo(() => {
    const base = costruisciVoci(qDifferita, dati, {
      preventiviAbilitati: premium.loaded && premium.enabled,
      bollettazioneAbilitata: premium.loaded && premium.enabled,
    });
    const query = qDifferita.trim().toLocaleLowerCase("it");
    if (
      premium.loaded &&
      premium.enabled &&
      (!query || "nuovo preventivo".includes(query))
    ) {
      const voceNuovoPreventivo: VoceRicerca = {
        id: "c-nuovo-preventivo",
        gruppo: "Comandi",
        label: "Nuovo preventivo",
        Ico: IconFileDollar,
        bersaglio: { t: "preventivo_nuovo" },
      };
      const indiceNuovoOrdine = base.findIndex((voce) => voce.id === "c-nuovo");
      if (indiceNuovoOrdine >= 0) {
        base.splice(indiceNuovoOrdine + 1, 0, voceNuovoPreventivo);
      } else {
        base.unshift(voceNuovoPreventivo);
      }
    }
    if (
      premium.loaded &&
      premium.enabled &&
      (!query || "centro comunicazioni".includes(query))
    ) {
      const voceCentroComunicazioni: VoceRicerca = {
        id: "c-centro-comunicazioni",
        gruppo: "Comandi",
        label: "Centro comunicazioni",
        Ico: IconHistory,
        bersaglio: { t: "centro_comunicazioni" },
      };
      const dopoComandiRapidi = base.findIndex(
        (voce) => voce.gruppo !== "Comandi rapidi",
      );
      base.splice(
        dopoComandiRapidi >= 0 ? dopoComandiRapidi : base.length,
        0,
        voceCentroComunicazioni,
      );
    }
    if (qDifferita.trim() !== "") return base;
    const sugg = costruisciSuggeriti(dati);
    const viste = new Set<string>();
    const pushPulite = (arr: VoceRicerca[]) => {
      const out: VoceRicerca[] = [];
      for (const v of arr) {
        const k = v.dedupeKey ?? chiaveBersaglio(v.bersaglio) ?? v.id;
        if (viste.has(k)) continue;
        viste.add(k);
        out.push(v);
      }
      return out;
    };
    return [...pushPulite(sugg), ...pushPulite(base)];
  }, [qDifferita, dati, premium]);

  // La lista viene raggruppata visivamente: tastiera, Tab e Invio devono usare lo
  // stesso identico ordine visuale, non quello precedente al raggruppamento.
  const gruppi = useMemo(() => {
    const out: { nome: string; voci: { voce: VoceRicerca; i: number }[] }[] = [];
    for (const voce of vociBase) {
      let gruppo = out.find((g) => g.nome === voce.gruppo);
      if (!gruppo) {
        gruppo = { nome: voce.gruppo, voci: [] };
        out.push(gruppo);
      }
      gruppo.voci.push({ voce, i: -1 });
    }
    let i = 0;
    for (const gruppo of out) {
      for (const elemento of gruppo.voci) elemento.i = i++;
    }
    return out;
  }, [vociBase]);
  const voci = useMemo(() => gruppi.flatMap((g) => g.voci.map(({ voce }) => voce)), [gruppi]);

  useEffect(() => {
    setSel((s) => {
      return Math.min(s, Math.max(0, voci.length - 1));
    });
  }, [voci]);

  // Scorri la lista per tenere la voce selezionata sempre in vista (frecce su/giù).
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function seleziona(next: number) {
    const clamped = Math.max(0, Math.min(next, voci.length - 1));
    setSel(clamped);
  }

  async function esegui(v: VoceRicerca) {
    if (v.disabled) return;
    if (v.completion && v.completion !== q) {
      setQ(v.completion);
      setSel(0);
      return;
    }
    const b = v.bersaglio;
    // Frecency: traccia solo ordini/anagrafiche/comandi (per i «Suggeriti» in cima).
    if (tracciabile(v.id)) registraUso(v.id);
    const identity = identityRef.current ?? (await api.whoami().catch(() => null)) ?? undefined;
    identityRef.current = identity ?? null;
    switch (b.t) {
      case "naviga":
        await vaiAllaPrincipale({
          path: b.path,
          tab: b.tab,
          cerca: b.cerca,
          apriId: b.apriId,
          dal: b.dal,
          al: b.al,
          stati: b.stati,
          spedito: b.spedito,
          regione: b.regione,
          agente: b.agente,
          marcatori: b.marcatori,
          statiPagamento: b.statiPagamento,
          contoId: b.contoId,
          contoNome: b.contoNome,
          contoIds: b.contoIds,
          spedizioneLotti: b.spedizioneLotti,
          agenteIds: b.agenteIds,
          medicoIds: b.medicoIds,
          linee: b.linee,
          corriereNomi: b.corriereNomi,
          rimborsoStati: b.rimborsoStati,
          rimborsoOrigini: b.rimborsoOrigini,
          produzioneAcconto: b.produzioneAcconto,
          mostraAltreSpedizioni: b.mostraAltreSpedizioni,
          provvigioniOrdina: b.provvigioniOrdina,
          agenteId: b.agenteId,
          critici: b.critici,
          azione: b.azione,
        });
        break;
      case "sync":
        try {
          await api.forceSync();
        } catch (e) {
          console.error("Sync non riuscita da Spotlight:", e);
        }
        break;
      case "ordine":
        await apriFinestraOrdine(b.id, b.numero, identity, undefined, undefined, b.focus);
        break;
      case "ordine_nuovo":
        await apriFinestraOrdine(null, undefined, identity);
        break;
      case "preventivo_nuovo":
        if (premium.enabled) {
          await apriFinestraPreventivo(null, undefined, identity);
        }
        break;
      case "preventivo":
        if (premium.enabled) {
          await apriFinestraPreventivo(
            b.ordineId,
            b.numero,
            identity,
            "anteprima",
          );
        }
        break;
      case "pagamento":
        await apriFinestraPagamento(b.id, identity);
        break;
      case "promemoria":
        await apriFinestraPromemoria(identity);
        break;
      case "promemoria_apri":
        await apriFinestraPromemoria(identity, undefined, b.id);
        break;
      case "notifiche":
        await apriFinestraNotifiche(identity);
        break;
      case "cestino":
        await apriFinestraCestino();
        break;
      case "entita":
        // Spotlight è già una finestra separata e mantiene il comportamento storico:
        // i riepiloghi aperti da qui sono sempre finestre, indipendentemente dalla preferenza.
        await apriFinestraRiepilogo(b.tipo, b.id, b.nome, identity);
        break;
      case "info":
        await apriFinestraInfo(b.target);
        break;
      case "centro_comunicazioni":
        await apriFinestraCentroComunicazioni();
        break;
      case "messaggio_compose":
        await apriFinestraNotifiche(identity, { destId: b.destinatario, destNome: b.destinatarioNome });
        break;
      case "messaggio_invia":
        await inviaMessaggio({ destinatario: b.destinatario, destinatarioNome: b.destinatarioNome, testo: b.testo }, identity);
        if (inTauri) {
          await api.notificheCheck().catch(() => {});
        }
        break;
    }
    await nascondi();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape" || (e.ctrlKey && (e.key === "k" || e.key === "K"))) {
      // Esc o di nuovo Ctrl+K chiudono la barra (coerente col toggle globale).
      e.preventDefault();
      void nascondi();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      hoverAttivo.current = false;
      seleziona(sel + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      hoverAttivo.current = false;
      seleziona(sel - 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const completion = voci[sel]?.completion;
      if (completion && completion !== q) {
        setQ(completion);
        setSel(0);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const v = voci[sel];
      if (v) void esegui(v);
    }
  }

  return (
    <Box style={{ height: "100vh", padding: 12 }}>
      <motion.div
        initial={ridotte ? false : { opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: ridotte ? 0 : dur.fast, ease: easeOut }}
        style={{ height: "100%" }}
      >
        <Paper
          radius="lg"
          shadow="md"
          withBorder
          style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          <TextInput
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={onKey}
            placeholder="Cerca ordini, preventivi, clienti, medici… oppure un comando"
            leftSection={<IconSearch size={18} />}
            rightSection={<Kbd>Esc</Kbd>}
            rightSectionWidth={50}
            variant="unstyled"
            size="md"
            data-autofocus
            px="md"
            styles={{ input: { height: 52, fontSize: 16 } }}
          />
          <Box style={{ borderTop: "1px solid var(--border)" }} />
          <ScrollArea viewportRef={scrollViewportRef} style={{ flex: 1 }} onMouseMove={() => (hoverAttivo.current = true)}>
            {voci.length === 0 ? (
              <Text c="dimmed" size="sm" p="md" ta="center">
                Nessun risultato.
              </Text>
            ) : (
              <Box p={6}>
                {gruppi.map((g) => (
                  <Box key={g.nome} mb={4}>
                    <Text size="xs" c="dimmed" fw={600} px="sm" py={4} tt="uppercase">
                      {g.nome}
                    </Text>
                    {g.voci.map(({ voce, i }) => (
                      <motion.div
                        key={voce.id}
                        initial={ridotte ? false : { opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: ridotte ? 0 : dur.fast, ease: easeOut }}
                      >
                        <Group
                          ref={i === sel ? selRef : undefined}
                          gap="sm"
                          wrap="nowrap"
                          px="sm"
                          py={8}
                          onMouseEnter={() => {
                            if (hoverAttivo.current) seleziona(i);
                          }}
                          onClick={voce.disabled ? undefined : () => void esegui(voce)}
                          style={{
                            borderRadius: 8,
                            cursor: voce.disabled ? "default" : "pointer",
                            opacity: voce.disabled ? 0.72 : 1,
                            background: i === sel ? "var(--bg)" : "transparent",
                          }}
                        >
                          <ThemeIcon variant="light" color="gray" size={30} radius="md">
                            <voce.Ico size={17} />
                          </ThemeIcon>
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" fw={500} truncate>
                              {voce.label}
                            </Text>
                            {voce.sub && (
                              <Text size="xs" c="dimmed" truncate>
                                {voce.sub}
                              </Text>
                            )}
                            {i === sel && voce.dettagli && voce.dettagli.length > 0 && (
                              <Text size="xs" c="dimmed" truncate>
                                {voce.dettagli.slice(0, 3).join(" · ")}
                              </Text>
                            )}
                          </Box>
                          {i === sel && voce.completion && voce.completion !== q && (
                            <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                              <Kbd>Tab</Kbd>
                            </Group>
                          )}
                        </Group>
                      </motion.div>
                    ))}
                  </Box>
                ))}
              </Box>
            )}
          </ScrollArea>
        </Paper>
      </motion.div>
    </Box>
  );
}
