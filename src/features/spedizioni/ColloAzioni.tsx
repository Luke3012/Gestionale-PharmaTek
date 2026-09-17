// Azioni compatte sul singolo collo (FASE 4B): note di spedizione (popover, per non
// invadere l'UI). Salvate sulla spedizione e usate nella distinta corriere.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Autocomplete,
  Button,
  Group,
  Indicator,
  SimpleGrid,
  Popover,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Textarea,
  Tooltip,
  Select,
  NumberInput,
  TextInput,
} from "@mantine/core";
import { IconCurrencyEuro, IconEdit, IconNote } from "@tabler/icons-react";
import { api, type Spedizione } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { eurToCents } from "../../lib/money";
import { aggiungiGiorniIso } from "../../lib/date";
import { useCloseOnScroll } from "../../lib/closeOnScroll";
import {
  cercaPerCAP,
  cercaCittaSelezionata,
  nomiCittaSuggeriti,
  type ComuneInfo,
} from "../../lib/cap-lookup";
import { NumeriLottoInput } from "../../ui/NumeriLottoInput";
import { normalizzaColliPesoCorriere } from "./profiliCorriere";
import {
  rigaHaDatiVaccino,
  spedizioneHaDatiVaccino,
} from "./datiVaccino";
import { EuroInput } from "../../ui/EuroInput";
import { èContoTransito } from "../contabilita/contoPreferito";
import { useAggiornaLayoutPopover } from "../../ui/usePopoverVerticalLayout";

type DatiSpedizioneForm = {
  cliente: string;
  indirizzo: string;
  cap: string;
  citta: string;
  prov: string;
  regione: string;
  telefono: string;
  email: string;
  colli: number | "";
  peso: number | "";
  preavviso: boolean;
  numeroManuale: string;
  lotti: Record<string, string>;
};

type PopoverPosition = "bottom-end" | "bottom-start" | "top-end" | "top-start" | "left-start" | "left-end";

function formDaSpedizione(s: Spedizione): DatiSpedizioneForm {
  const valori = normalizzaColliPesoCorriere(s.corriereProfilo, s.colli || 1, s.peso || 1);
  return {
    cliente: s.clienteNome || "",
    indirizzo: s.indirizzo || "",
    cap: s.cap || "",
    citta: s.citta || "",
    prov: s.prov || "",
    regione: s.regione || "",
    telefono: s.telefono || "",
    email: s.email || "",
    colli: valori.colli,
    peso: valori.peso,
    preavviso: !!s.preavviso,
    numeroManuale: s.numero || "",
    lotti: Object.fromEntries(s.righe.map((r) => [r.rigaId, r.numero || ""])),
  };
}

/** Modifica i dati del collo effettuato senza toccare ordine/anagrafica.
 * I numeri lotto restano sulle righe, così seguono il prodotto anche dopo un annullo. */
export function DatiSpedizionePopover({
  spedizione,
  onSalvato,
}: {
  spedizione: Spedizione;
  onSalvato: (spedizione?: Spedizione) => void;
}) {
  const [aperto, setAperto] = useState(false);
  const [form, setForm] = useState<DatiSpedizioneForm>(() => formDaSpedizione(spedizione));
  const [salvando, setSalvando] = useState(false);
  const [suggerimentiCitta, setSuggerimentiCitta] = useState<string[]>([]);
  const [capCittaMultiplo, setCapCittaMultiplo] =
    useState<ComuneInfo | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<{ position: PopoverPosition; width: number; maxHeight: string }>({
    position: "bottom-end",
    width: 620,
    maxHeight: "min(62dvh, 560px)",
  });
  const manuale = spedizione.righe.length === 0;
  const haDatiVaccino = spedizioneHaDatiVaccino(spedizione);

  const aggiornaLayout = useCallback(() => {
    const rect = targetRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 1024;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 768;
    const padding = 16;
    const footerEHeader = 60;
    const topBarHeight = 60;
    const width = Math.max(320, Math.min(620, viewportW - padding * 2));

    // Spazio verticale totale dello schermo sotto la topbar
    const spazioVerticaleSchermo = viewportH - topBarHeight - padding * 2;
    const spazioVerticale = Math.max(240, spazioVerticaleSchermo - footerEHeader);

    // Posizionamento a sinistra: left-start se il bottone è nella metà superiore, left-end altrimenti
    const sotto = rect.top < (viewportH / 2);

    setLayout({
      position: (sotto ? "left-start" : "left-end") as PopoverPosition,
      width,
      maxHeight: `${Math.min(560, Math.floor(spazioVerticale))}px`,
    });
  }, []);

  useEffect(() => {
    setForm(formDaSpedizione(spedizione));
    setCapCittaMultiplo(null);
  }, [spedizione, aperto]);

  useAggiornaLayoutPopover(aperto, aggiornaLayout);

  useCloseOnScroll(aperto, setAperto);

  useEffect(() => {
    if (!aperto) return;

    const preventDefault = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest(".mantine-Popover-dropdown")) {
        return;
      }
      e.preventDefault();
    };

    const preventScrollKeys = (e: KeyboardEvent) => {
      const keys = ["ArrowUp", "ArrowDown", "Space", "PageUp", "PageDown", "Home", "End"];
      if (keys.includes(e.key)) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.closest(".mantine-Popover-dropdown") ||
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA")
        ) {
          return;
        }
        e.preventDefault();
      }
    };

    window.addEventListener("wheel", preventDefault, { passive: false });
    window.addEventListener("touchmove", preventDefault, { passive: false });
    window.addEventListener("keydown", preventScrollKeys, { passive: false });

    return () => {
      window.removeEventListener("wheel", preventDefault);
      window.removeEventListener("touchmove", preventDefault);
      window.removeEventListener("keydown", preventScrollKeys);
    };
  }, [aperto]);

  const setF = <K extends keyof DatiSpedizioneForm>(k: K, v: DatiSpedizioneForm[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const setLotto = (rigaId: string, numero: string) =>
    setForm((s) => ({ ...s, lotti: { ...s.lotti, [rigaId]: numero } }));

  const applicaComune = (nome: string) => {
    const info = cercaCittaSelezionata(nome);
    if (!info) return;
    setForm((s) => ({
      ...s,
      citta: info.nome,
      prov: info.sigla,
      regione: info.regione,
      cap: info.cap.length === 1 ? info.cap[0] : s.cap,
    }));
    setCapCittaMultiplo(info.cap.length > 1 ? info : null);
  };

  const cambiaCap = (cap: string) => {
    setF("cap", cap);
    setCapCittaMultiplo(null);
    if (!/^\d{5}$/.test(cap)) return;
    const ris = cercaPerCAP(cap);
    if (!ris) return;
    const info = ris.comuni[0];
    setForm((s) => ({
      ...s,
      cap,
      citta: info.nome,
      prov: info.sigla,
      regione: info.regione,
    }));
  };

  async function salva() {
    if (!form.cliente.trim()) {
      toast.warning("Indica il destinatario del collo.");
      return;
    }
    setSalvando(true);
    try {
      const richiesti = !manuale && !haDatiVaccino
        ? 1
        : form.colli === ""
          ? 1
          : Number(form.colli);
      const pesoRichiesto = form.peso === "" ? richiesti : Number(form.peso);
      const { colli, peso } = normalizzaColliPesoCorriere(
        spedizione.corriereProfilo,
        richiesti,
        pesoRichiesto
      );
      await api.recordUpdate("spedizione", spedizione.id, {
        dest_cliente: form.cliente.trim(),
        dest_indirizzo: form.indirizzo.trim(),
        dest_cap: form.cap.trim(),
        dest_citta: form.citta.trim(),
        dest_prov: form.prov.trim(),
        dest_regione: form.regione.trim(),
        dest_telefono: form.telefono.trim(),
        dest_email: form.email.trim(),
        colli,
        peso,
        preavviso: form.preavviso,
        ...(manuale ? { numero: form.numeroManuale.trim() } : {}),
      });
      await Promise.all(
        spedizione.righe.filter(rigaHaDatiVaccino).map((r) =>
          api.recordUpdate("riga_ordine", r.rigaId, {
            numero: (form.lotti[r.rigaId] || "").trim(),
          })
        )
      );
      const aggiornata: Spedizione = {
        ...spedizione,
        clienteNome: form.cliente.trim(),
        indirizzo: form.indirizzo.trim(),
        cap: form.cap.trim(),
        citta: form.citta.trim(),
        prov: form.prov.trim(),
        regione: form.regione.trim(),
        telefono: form.telefono.trim(),
        email: form.email.trim(),
        colli,
        peso,
        preavviso: form.preavviso,
        numero: manuale
          ? form.numeroManuale.trim()
          : spedizione.righe
              .filter(rigaHaDatiVaccino)
              .map((r) => (form.lotti[r.rigaId] || "").trim())
              .filter(Boolean)
              .join(" + "),
        righe: spedizione.righe.map((r) => ({
          ...r,
          numero: rigaHaDatiVaccino(r)
            ? (form.lotti[r.rigaId] || "").trim()
            : "",
        })),
      };
      toast.success("Dati spedizione salvati.");
      setAperto(false);
      onSalvato(aggiornata);
    } catch (e) {
      toast.error(`Salvataggio dati spedizione non riuscito: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Popover
      opened={aperto}
      onChange={setAperto}
      position={layout.position}
      withinPortal
      width={layout.width}
      trapFocus
      shadow="md"
      radius="md"
      zIndex={1450}
      offset={16}
      middlewares={{
        flip: {
          fallbackPlacements: ["left-end", "left-start", "top-end", "bottom-end"],
          padding: { top: 72, bottom: 12, left: 12, right: 12 }
        },
        shift: {
          padding: { top: 72, bottom: 12, left: 12, right: 12 },
          mainAxis: true
        },
      }}
    >
      <Popover.Target>
        <div ref={targetRef} style={{ display: "inline-flex" }}>
          <Tooltip label="Modifica dati spedizione" withinPortal>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Modifica dati spedizione"
              onClick={() => setAperto((v) => !v)}
            >
              <IconEdit size={16} />
            </ActionIcon>
          </Tooltip>
        </div>
      </Popover.Target>
      <Popover.Dropdown
        p={0}
        style={{ overflow: "hidden", maxWidth: "calc(100vw - 32px)" }}
        onWheelCapture={(e) => e.stopPropagation()}
        onTouchMoveCapture={(e) => e.stopPropagation()}
      >
        <Stack gap={0}>
          <ScrollArea.Autosize
            mah={layout.maxHeight}
            type="auto"
            scrollbars="y"
            p="sm"
            styles={{ viewport: { overscrollBehavior: "contain" } }}
            onWheelCapture={(e) => e.stopPropagation()}
            onTouchMoveCapture={(e) => e.stopPropagation()}
          >
          <Stack gap="xs">
          <Text size="sm" fw={500}>
            Modifica dati spedizione
          </Text>
          <TextInput
            label="Destinatario"
            value={form.cliente}
            onChange={(e) => setF("cliente", e.currentTarget.value)}
            required
          />
          <TextInput
            label="Indirizzo"
            value={form.indirizzo}
            onChange={(e) => setF("indirizzo", e.currentTarget.value)}
          />
          <SimpleGrid cols={4} spacing="xs">
            <Popover
              opened={!!capCittaMultiplo}
              onChange={(value) => {
                if (!value) setCapCittaMultiplo(null);
              }}
              position="bottom-start"
              withinPortal
              width={260}
              shadow="md"
              radius="md"
              zIndex={1650}
            >
              <Popover.Target>
                <TextInput
                  label="CAP"
                  value={form.cap}
                  onChange={(e) => cambiaCap(e.currentTarget.value)}
                  maxLength={5}
                />
              </Popover.Target>
              <Popover.Dropdown p="xs" data-mantine-stop-propagation="true">
                <Text size="xs" fw={600} c="dimmed" mb={4}>
                  Più CAP per {capCittaMultiplo?.nome}:
                </Text>
                <Stack gap={2}>
                  {capCittaMultiplo?.cap.map((cap) => (
                    <Button
                      key={cap}
                      variant="subtle"
                      size="xs"
                      justify="flex-start"
                      fullWidth
                      onClick={() => {
                        setF("cap", cap);
                        setCapCittaMultiplo(null);
                      }}
                    >
                      {cap} — {capCittaMultiplo.nome} ({capCittaMultiplo.sigla})
                    </Button>
                  ))}
                </Stack>
              </Popover.Dropdown>
            </Popover>
            <Autocomplete
              label="Citta"
              value={form.citta}
              onChange={(v) => {
                setF("citta", v);
                setSuggerimentiCitta(nomiCittaSuggeriti(v, 10));
              }}
              onOptionSubmit={applicaComune}
              onKeyDown={(e) => {
                if (e.key === "Tab" && suggerimentiCitta.length > 0) {
                  const primo = suggerimentiCitta[0];
                  setF("citta", primo);
                  applicaComune(primo);
                }
              }}
              data={suggerimentiCitta}
              limit={10}
              comboboxProps={{
                withinPortal: true,
                zIndex: 1600,
                position: "bottom-start",
                middlewares: { flip: false, shift: { padding: 8 } },
              }}
            />
            <TextInput label="Prov" value={form.prov} onChange={(e) => setF("prov", e.currentTarget.value)} />
            <TextInput label="Regione" value={form.regione} onChange={(e) => setF("regione", e.currentTarget.value)} />
          </SimpleGrid>
          <SimpleGrid cols={2} spacing="xs">
            <TextInput label="Telefono" value={form.telefono} onChange={(e) => setF("telefono", e.currentTarget.value)} />
            <TextInput label="E-mail" value={form.email} onChange={(e) => setF("email", e.currentTarget.value)} />
          </SimpleGrid>
          <Group gap="sm" align="flex-end" wrap="nowrap">
            {(manuale || haDatiVaccino) && (
              <NumberInput
                label="Colli"
                value={form.colli}
                onChange={(v) => setF("colli", v === "" ? "" : Number(v))}
                disabled={spedizione.corriereProfilo === "corriere_a"}
                min={1}
                w={86}
              />
            )}
            <NumberInput
              label="Peso"
              value={form.peso}
              onChange={(v) => setF("peso", v === "" ? "" : Number(v))}
              disabled={spedizione.corriereProfilo === "corriere_a"}
              min={1}
              w={86}
            />
            <Switch
              label="Preavviso telefonico"
              checked={form.preavviso}
              onChange={(e) => setF("preavviso", e.currentTarget.checked)}
              mb={6}
            />
          </Group>
          {manuale ? (
            <TextInput
              label="Numero/lotto"
              value={form.numeroManuale}
              onChange={(e) => setF("numeroManuale", e.currentTarget.value)}
            />
          ) : haDatiVaccino ? (
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Numeri/lotti prodotti
              </Text>
              {spedizione.righe.filter(rigaHaDatiVaccino).map((r) => (
                <Group key={r.rigaId} gap="xs" wrap="nowrap">
                  <Text size="xs" truncate style={{ flex: 1, minWidth: 0 }}>
                    {r.prodottoNome || "(prodotto)"}
                    {r.qta > 1 ? ` x${r.qta}` : ""}
                  </Text>
                  <NumeriLottoInput
                    size="xs"
                    w={150}
                    aria-label={`Numero/lotto di ${r.prodottoNome || "prodotto"}`}
                    leftSection={<Text size="xs" c="dimmed">N</Text>}
                    value={form.lotti[r.rigaId] || ""}
                    quantita={r.qta}
                    onChange={(numero) => setLotto(r.rigaId, numero)}
                  />
                </Group>
              ))}
            </Stack>
          ) : null}
          </Stack>
          </ScrollArea.Autosize>
          <Group
            justify="flex-end"
            gap="xs"
            p="sm"
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
              background: "var(--mantine-color-body)",
              flexShrink: 0,
            }}
          >
            <Button size="compact-sm" variant="default" onClick={() => setAperto(false)} disabled={salvando}>
              Annulla
            </Button>
            <Button size="compact-sm" color="accent" loading={salvando} onClick={salva}>
              Salva
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Modifica le note di spedizione del collo (salvate sulla spedizione). */
export function NoteSpedizionePopover({
  spedizioneId,
  nota,
  onSalvato,
}: {
  spedizioneId: string;
  nota: string;
  onSalvato: () => void;
}) {
  const [aperto, setAperto] = useState(false);
  useCloseOnScroll(aperto, setAperto);
  const [testo, setTesto] = useState(nota);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setTesto(nota), [nota, aperto]);

  async function salva() {
    setSalvando(true);
    try {
      await api.recordUpdate("spedizione", spedizioneId, { note: testo.trim() });
      toast.success("Note di spedizione salvate.");
      setAperto(false);
      onSalvato();
    } catch (e) {
      toast.error(`Salvataggio note non riuscito: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Popover opened={aperto} onChange={setAperto} position="bottom-end" withinPortal width={300} trapFocus>
      <Popover.Target>
        <Tooltip label="Note di spedizione" withinPortal>
          <Indicator size={7} color="teal" disabled={!nota} offset={4}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Note di spedizione"
              onClick={() => setAperto((v) => !v)}
            >
              <IconNote size={16} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Note di spedizione
          </Text>
          <Textarea
            value={testo}
            onChange={(e) => setTesto(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={5}
            placeholder="Cosa vuole il cliente?"
          />
          <AzioniSalvataggioPopover salvando={salvando} onAnnulla={() => setAperto(false)} onSalva={salva} />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function aggiungiGiorni(iso: string, giorni: number): string {
  return aggiungiGiorniIso(iso || new Date().toISOString().split("T")[0], giorni);
}

export function ContrassegnoSpedizionePopover({
  spedizioneId,
  ordineId,
  spedizioneData,
  mezzo,
  contrassegno,
  onSalvato,
}: {
  spedizioneId: string;
  ordineId?: string;
  spedizioneData: string;
  mezzo: string;
  contrassegno: number;
  onSalvato: () => void;
}) {
  const [aperto, setAperto] = useState(false);
  useCloseOnScroll(aperto, setAperto);
  const [mezzoSelezionato, setMezzoSelezionato] = useState(mezzo || "");
  const [importoStr, setImportoStr] = useState<number | "">(contrassegno / 100);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setMezzoSelezionato(mezzo || "");
    setImportoStr(contrassegno / 100);
  }, [mezzo, contrassegno, aperto]);

  async function salva() {
    setSalvando(true);
    try {
      const targetCOD = mezzoSelezionato === "" ? 0 : eurToCents(Number(importoStr || 0));

      // 1. Aggiorna la spedizione
      await api.recordUpdate("spedizione", spedizioneId, {
        mezzo: mezzoSelezionato,
        contrassegno: targetCOD,
      });

      // 2. Se c'è un ordine, allinea i pagamenti attesi
      if (ordineId) {
        const allPagamenti = await api.pagamentiOrdine(ordineId);
        const unpaid = allPagamenti.filter(
          (p) => !p.saldato && (p.tipo === "saldo" || p.tipo === "rata" || p.tipo === "acconto")
        );

        const allConti = await api.recordsList("conto");
        const pi = allConti.find((c) => c.data.predefinito_incassi === true);
        const defaultBankConto =
          pi ||
          allConti.find((c) => !èContoTransito(c.data.tipo));
        const defaultBankContoId = defaultBankConto?.id || "";

        // Trova il pagamento associato a questa spedizione:
        // 1. Per spedizioneId esplicito
        // 2. Altrimenti il primo pagamento a transito non legato a un'altra spedizione
        // 3. Fallback sul primo pagamento libero o sul primo non saldato
        let targetPagamento = unpaid.find((p) => p.spedizioneId === spedizioneId);
        if (!targetPagamento) {
          targetPagamento = unpaid.find(
            (p) => èContoTransito(p.contoTipo) && (!p.spedizioneId || p.spedizioneId === spedizioneId)
          ) || unpaid.find((p) => !p.spedizioneId) || unpaid[0];
        }

        if (mezzoSelezionato === "") {
          // Disattivato contrassegno per questa spedizione:
          if (targetPagamento && èContoTransito(targetPagamento.contoTipo)) {
            const newScad = aggiungiGiorni(spedizioneData, 7);
            await api.recordUpdate("pagamento", targetPagamento.id, {
              conto_id: defaultBankContoId,
              scadenza: newScad,
              scad_da_spedizione: true,
              scad_rel_giorni: targetPagamento.scadRelGiorni,
              spedizione_id: "",
            });
          }
        } else {
          // Imposta pagamento a conto contrassegno/assegno, importo = targetCOD, scadenza = spedizione + 30gg
          const transitConto = allConti.find((c) => c.data.tipo === mezzoSelezionato);
          const transitContoId = transitConto?.id || "";

          if (targetPagamento) {
            const oldImporto = targetPagamento.importo;
            const diff = targetCOD - oldImporto;

            await api.recordUpdate("pagamento", targetPagamento.id, {
              conto_id: transitContoId,
              importo: targetCOD,
              scadenza: aggiungiGiorni(spedizioneData, 30),
              scad_da_spedizione: true,
              scad_rel_giorni: 0,
              spedizione_id: spedizioneId,
            });

            // Se l'importo è cambiato, assorbi la differenza dalle rate LIBERE (non legate ad altre spedizioni)
            if (diff !== 0) {
              const liberi = unpaid.filter(
                (p) => p.id !== targetPagamento!.id && !p.spedizioneId
              );
              if (diff > 0) {
                // Il contrassegno è aumentato: riduci le rate libere
                let daRidurre = diff;
                for (const p of liberi) {
                  if (daRidurre <= 0) break;
                  if (p.importo <= daRidurre) {
                    daRidurre -= p.importo;
                    await api.pagamentoElimina(p.id);
                  } else {
                    await api.recordUpdate("pagamento", p.id, {
                      importo: p.importo - daRidurre,
                    });
                    daRidurre = 0;
                  }
                }
              } else {
                // Il contrassegno è diminuito: aumenta la prima rata libera o crea una nuova rata ordinaria
                const daAggiungere = -diff;
                if (liberi.length > 0) {
                  await api.recordUpdate("pagamento", liberi[0].id, {
                    importo: liberi[0].importo + daAggiungere,
                  });
                } else {
                  const pag = await api.pagamentoRegistra({
                    ordineId,
                    tipo: "rata",
                    importo: daAggiungere,
                    saldato: false,
                    scadenza: aggiungiGiorni(spedizioneData, 7),
                    contoId: defaultBankContoId,
                  });
                  await api.recordUpdate("pagamento", pag.id, {
                    scad_da_spedizione: true,
                    scad_rel_giorni: 0,
                  });
                }
              }
            }
          } else {
            const pag = await api.pagamentoRegistra({
              ordineId,
              tipo: "rata",
              importo: targetCOD,
              saldato: false,
              scadenza: aggiungiGiorni(spedizioneData, 30),
              contoId: transitContoId,
            });
            await api.recordUpdate("pagamento", pag.id, {
              scad_da_spedizione: true,
              scad_rel_giorni: 0,
              spedizione_id: spedizioneId,
            });
          }
        }
      }

      toast.success("Contrassegno modificato e pagamenti riallineati.");
      setAperto(false);
      onSalvato();
    } catch (e) {
      toast.error(`Salvataggio contrassegno non riuscito: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Popover opened={aperto} onChange={setAperto} position="bottom-end" withinPortal width={300} trapFocus>
      <Popover.Target>
        <Tooltip label="Modifica contrassegno" withinPortal>
          <Indicator size={7} color="grape" disabled={!mezzo} offset={4}>
            <ActionIcon
              variant="subtle"
              color={mezzo ? "grape" : "gray"}
              aria-label="Modifica contrassegno"
              onClick={() => setAperto((v) => !v)}
            >
              <IconCurrencyEuro size={16} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Modifica Contrassegno
          </Text>
          <Select
            label="Metodo di incasso"
            value={mezzoSelezionato}
            onChange={(val) => setMezzoSelezionato(val || "")}
            data={[
              { value: "", label: "Prepagato (Nessuno)" },
              { value: "contrassegno", label: "Contrassegno (Contanti)" },
              { value: "assegno", label: "Assegno" },
            ]}
            comboboxProps={{ withinPortal: false }}
          />
          {mezzoSelezionato !== "" && (
            <EuroInput
              label="Importo"
              value={importoStr}
              onChange={(val) => setImportoStr(val === "" ? "" : Number(val))}
              min={0}
            />
          )}
          <Text size="xs" c="dimmed">
            I pagamenti attesi del saldo verranno bilanciati e ricalcolati di conseguenza.
          </Text>
          <AzioniSalvataggioPopover salvando={salvando} onAnnulla={() => setAperto(false)} onSalva={salva} />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function AzioniSalvataggioPopover({ salvando, onAnnulla, onSalva }: { salvando: boolean; onAnnulla: () => void; onSalva: () => void }) {
  return <Group justify="flex-end" gap="xs">
    <Button size="compact-sm" variant="default" onClick={onAnnulla}>Annulla</Button>
    <Button size="compact-sm" color="accent" loading={salvando} onClick={onSalva}>Salva</Button>
  </Group>;
}
