// Esportazione + STAMPA UNIVERSALE e riusabile di una tabella (Crediti, Rimborsi,
// Giornaliero e — in futuro — Ordini, Spedizioni, …).
//
// Un bottone-icona (sta accanto a "Colonne", niente spazio in più) apre un modale di
// ANTEPRIMA: mostra le prime righe come usciranno, con una checkbox per colonna
// (pre-spuntate = le colonne attualmente visibili nella vista) e la scelta
// dell'ORIENTAMENTO (verticale/orizzontale, proposto in base al numero di colonne).
// Da lì due azioni: **Salva Excel** (.xlsx col dialog nativo + nome proposto) e
// **Stampa** (dialog di stampa del sistema → anche "Salva come PDF"). L'export rispetta
// i FILTRI perché la vista passa già le `righe` filtrate e ordinate.
import { useEffect, useMemo, useState } from "react";
import { formattaDataFileItaliana, oggiIso } from "../../lib/date";
import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import type { ReactNode } from "react";
import { IconFileExport, IconFileSpreadsheet, IconPrinter } from "@tabler/icons-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, inTauri } from "../../lib/tauri";
import { toast } from "../toast/store";
import { centsToEurStr } from "../../lib/money";
import { formattaDataIsoItaliana as formatData } from "../../lib/date";
import { useModalSnapshot } from "../useModalSnapshot";
import { setConToggle } from "../../lib/set";

type TipoCella = "testo" | "euro" | "data" | "numero";
export type Orientamento = "verticale" | "orizzontale";

/** Definizione di una colonna esportabile (riusabile da qualsiasi vista). */
export interface ColonnaExport<T> {
  key: string;
  label: string;
  /** Tipo cella (default "testo"). `euro` = numero in **centesimi** (sommabile). */
  tipo?: TipoCella;
  /** Includi la colonna nella riga Totali (solo euro/numero). */
  totale?: boolean;
  /** Valore grezzo: euro→centesimi, data→ISO `yyyy-mm-dd`, numero→numero, testo→stringa. */
  valore: (r: T) => string | number;
  /** Pre-spuntata all'apertura (default true). Le viste passano `visibile` qui. */
  preSel?: boolean;
}

/** Metadati di export agganciabili a una definizione di colonna di una vista. */
export interface MetaExport<T> {
  tipo?: TipoCella;
  totale?: boolean;
  valore: (r: T) => string | number;
}

function isNumerica<T>(c: ColonnaExport<T>): boolean {
  return c.tipo === "euro" || c.tipo === "numero";
}

/** Testo della cella per l'anteprima e la stampa (come apparirà). */
function testoCella<T>(c: ColonnaExport<T>, r: T): string {
  const v = c.valore(r);
  switch (c.tipo) {
    case "euro":
      // Vuoto resta vuoto (no "€ 0,00"): coerente con la cella Excel lasciata vuota.
      return v === "" || v == null ? "" : `€ ${centsToEurStr(Number(v) || 0)}`;
    case "data":
      return formatData(String(v));
    case "numero":
      return String(v ?? "");
    default:
      return String(v ?? "");
  }
}

/** Valore grezzo della cella per l'Excel (numero o stringa già formattata). */
function valoreCella<T>(c: ColonnaExport<T>, r: T): string | number {
  const v = c.valore(r);
  switch (c.tipo) {
    case "euro":
      // Vuoto → cella vuota nell'Excel (non 0); altrimenti centesimi → euro sommabili.
      return v === "" || v == null ? "" : (Number(v) || 0) / 100;
    case "data":
      return formatData(String(v));
    case "numero":
      return Number(v) || 0;
    default:
      return String(v ?? "");
  }
}

/**
 * Costruisce le `ColonnaExport` dalle definizioni di colonna di una vista che
 * portano `esporta`, marcando come pre-spuntate quelle attualmente `visibili`.
 * `defs` va passato nell'ordine di visualizzazione (così l'output segue le colonne).
 */
function colonneEsportabili<T>(
  defs: { key: string; label: string; esporta?: MetaExport<T> }[],
  visibili: Set<string>
): ColonnaExport<T>[] {
  return defs
    .filter((d) => d.esporta)
    .map((d) => ({
      key: d.key,
      label: d.label,
      tipo: d.esporta!.tipo,
      totale: d.esporta!.totale,
      valore: d.esporta!.valore,
      preSel: visibili.has(d.key),
    }));
}

/** Colonne esportabili nello stesso ordine e con la stessa visibilità della tabella. */
export function useColonneEsportabili<T>(colonne: {
  tutte: readonly { def: { key: string; label: string; esporta?: MetaExport<T> } }[];
  visibili: readonly { key: string }[];
}) {
  return useMemo(
    () =>
      colonneEsportabili(
        colonne.tutte.map((voce) => voce.def),
        new Set(colonne.visibili.map((colonna) => colonna.key)),
      ),
    [colonne.tutte, colonne.visibili],
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function joinPath(dir: string, file: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${file}`;
}

/** Stampa la tabella aprendo il dialog di stampa del sistema (iframe nascosto). */
function stampaTabella<T>(
  titolo: string,
  colonne: ColonnaExport<T>[],
  righe: T[],
  orientamento: Orientamento
): void {
  const conTotali = colonne.some((c) => c.totale);
  const totali = colonne.map((c) =>
    c.totale ? righe.reduce((s, r) => s + (Number(c.valore(r)) || 0), 0) : 0
  );
  const thead = colonne
    .map((c) => `<th class="${isNumerica(c) ? "num" : ""}">${escapeHtml(c.label)}</th>`)
    .join("");
  const tbody = righe
    .map(
      (r) =>
        `<tr>${colonne
          .map((c) => `<td class="${isNumerica(c) ? "num" : ""}">${escapeHtml(testoCella(c, r)) || "—"}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const trTot = conTotali
    ? `<tr class="tot">${colonne
        .map((c, i) => {
          if (c.totale) return `<td class="num">€ ${escapeHtml(centsToEurStr(totali[i]))}</td>`;
          // "TOTALE" nella prima colonna non sommata.
          const prima = colonne.findIndex((x) => !x.totale);
          return `<td>${i === prima ? "TOTALE" : ""}</td>`;
        })
        .join("")}</tr>`
    : "";
  const oggi = formatData(oggiIso());
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8">
    <title>${escapeHtml(titolo)}</title>
    <style>
      /*
       * WebView2 stampa l'URL (tauri.localhost) nel piè di pagina quando @page
       * lascia spazio ai margini del browser. Il margine pagina a zero sopprime
       * intestazioni e piè di pagina automatici; il margine visivo resta sul body.
       */
      @page { size: A4 ${orientamento === "orizzontale" ? "landscape" : "portrait"}; margin: 0; }
      * { box-sizing: border-box; }
      body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 12mm; }
      h1 { font-size: 16px; margin: 0 0 2px; }
      .meta { color: #666; font-size: 11px; margin-bottom: 10px; }
      table { border-collapse: collapse; width: 100%; font-size: 11px; }
      th, td { border: 1px solid #b3b3b3; padding: 4px 7px; text-align: left; vertical-align: top; }
      th { background: #f1f3f5; font-weight: 600; }
      td.num, th.num { text-align: right; white-space: nowrap; }
      tr:nth-child(even) td { background: #fafafa; }
      tr.tot td { font-weight: 700; border-top: 2px solid #333; background: #fff; }
    </style></head><body>
      <h1>${escapeHtml(titolo)}</h1>
      <div class="meta">${righe.length} righe · ${oggi}</div>
      <table><thead><tr>${thead}</tr></thead><tbody>${tbody}${trTot}</tbody></table>
    </body></html>`;

  const ifr = document.createElement("iframe");
  ifr.setAttribute("aria-hidden", "true");
  ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  ifr.srcdoc = html;
  ifr.onload = () => {
    try {
      ifr.contentWindow?.focus();
      ifr.contentWindow?.print();
    } finally {
      // Rimuove l'iframe dopo che il dialog di stampa è stato gestito.
      setTimeout(() => ifr.remove(), 1500);
    }
  };
  document.body.appendChild(ifr);
}

export function EsportaTabella<T>({
  nomeBase,
  foglio,
  titolo,
  colonne,
  righe,
  disabled,
  variante = "bottone",
  etichetta = "Esporta / Stampa",
  etichettaCompatta,
  adattivo = false,
  colonneFisse = false,
  orientamentoFisso,
  aperto: apertoProp,
  onApertoChange,
  senzaTrigger = false,
  salvaCustom,
  titoloModale,
  nomeCompleto = false,
  size,
  onSuccess,
  onExcelSuccess,
  primaDiSalvareExcel,
  dopoSalvataggioExcel,
  splitExcel,
}: {
  /** Base del nome file: `crediti` → `crediti-11-06-2026.xlsx`. */
  nomeBase: string;
  /** Nome del foglio Excel (es. "Crediti"). */
  foglio: string;
  /** Titolo in cima alla stampa (default = `foglio`). */
  titolo?: string;
  /** Tutte le colonne esportabili; quelle con `preSel !== false` partono spuntate. */
  colonne: ColonnaExport<T>[];
  /** Righe GIÀ filtrate e ordinate (quelle visibili nella vista). */
  righe: T[];
  disabled?: boolean;
  /** `bottone` = etichettato (default, coerente con Provvigioni); `icona` = compatto. */
  variante?: "bottone" | "icona";
  /** Etichetta del bottone (solo `variante="bottone"`). */
  etichetta?: string;
  /** Etichetta breve usata nella fascia compatta (es. solo il nome del corriere). */
  etichettaCompatta?: string;
  /** Nasconde la sola etichetta quando il contenitore non ha spazio, mantenendo l'icona. */
  adattivo?: boolean;
  /** Se true, nasconde la scelta colonne: si esportano SEMPRE tutte (es. distinta corriere). */
  colonneFisse?: boolean;
  /** Se impostato, forza l'orientamento e ne nasconde il selettore. */
  orientamentoFisso?: Orientamento;
  /** Apertura **controllata** dall'esterno (per pilotare l'anteprima da un Menu). */
  aperto?: boolean;
  onApertoChange?: (v: boolean) => void;
  /** Non rende il bottone trigger: l'apertura arriva solo da `aperto` (modalità controllata). */
  senzaTrigger?: boolean;
  /** Salvataggio Excel personalizzato (riceve il path scelto): scavalca `grigliaExport`.
   * Usato dalla Produzione per generare i file Laboratorio/Diagnostica col loro formato dedicato,
   * pur riusando questo modale globale (anteprima + colonne) come schermata di export. */
  salvaCustom?: (path: string) => Promise<void>;
  /** Titolo del modale (default "Esporta o stampa"). */
  titoloModale?: string;
  /** Se true, `nomeBase` è già il nome file completo (NON gli si aggiunge la data odierna).
   * Usato dalla Produzione, dove il nome contiene già linea/data invio/n° ordini. */
  nomeCompleto?: boolean;
  size?: any;
  /** Callback invocato all'avvenuto salvataggio o stampa */
  onSuccess?: () => void;
  /** Callback invocato solo dopo un salvataggio Excel riuscito. */
  onExcelSuccess?: () => void | Promise<void>;
  /** Preflight opzionale eseguito subito prima della scelta del percorso.
   * Può restituire righe rilette dal database da usare al posto dell'anteprima. */
  primaDiSalvareExcel?: () => void | T[] | Promise<void | T[]>;
  /** Cleanup opzionale eseguito sempre al termine del tentativo di export Excel. */
  dopoSalvataggioExcel?: () => void | Promise<void>;
  /** Split opzionale dell'Excel: se le righe superano il limite, chiede una cartella e
   * genera piu file. Pensato per tracciati con limite righe totale (es. Aruba: 1 header
   * + 499 righe dati = 500 righe totali). */
  splitExcel?: {
    maxRigheDatiPerFile: number;
    defaultAttivo?: boolean;
    label?: string;
    descrizione?: string;
  };
}) {
  const [apertoInterno, setApertoInterno] = useState(false);
  const controllato = apertoProp !== undefined;
  const aperto = controllato ? apertoProp : apertoInterno;
  const setAperto = (v: boolean) => {
    if (!controllato) setApertoInterno(v);
    onApertoChange?.(v);
  };
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [orientamento, setOrientamento] = useState<Orientamento>("verticale");
  const [esportando, setEsportando] = useState(false);
  const [splitAttivo, setSplitAttivo] = useState(splitExcel?.defaultAttivo ?? true);

  // Nelle aperture controllate il parent può azzerare subito righe/colonne quando riceve
  // `false`. Conserviamo l'ultimo contenuto visibile fino alla fine del fade-out, così il
  // modale non si restringe un istante prima di sparire.
  const contenutoCorrente = useMemo(
    () => ({ colonne, righe, colonneFisse, orientamentoFisso, splitExcel, titoloModale }),
    [colonne, righe, colonneFisse, orientamentoFisso, splitExcel, titoloModale]
  );
  const [contenutoSnapshot, clearContenutoSnapshot] = useModalSnapshot(
    aperto ? contenutoCorrente : null
  );
  const contenutoMostrato = aperto ? contenutoCorrente : contenutoSnapshot ?? contenutoCorrente;
  const colonneMostrate = contenutoMostrato.colonne;
  const righeMostrate = contenutoMostrato.righe;
  const colonneFisseMostrate = contenutoMostrato.colonneFisse;
  const orientamentoFissoMostrato = contenutoMostrato.orientamentoFisso;
  const splitExcelMostrato = contenutoMostrato.splitExcel;

  const scelte = useMemo(() => colonneMostrate.filter((c) => sel.has(c.key)), [colonneMostrate, sel]);
  const splitNecessario = !!splitExcelMostrato && righeMostrate.length > splitExcelMostrato.maxRigheDatiPerFile;
  const splitUsato = splitNecessario && splitAttivo;
  const nFileSplit = splitExcelMostrato ? Math.ceil(righeMostrate.length / splitExcelMostrato.maxRigheDatiPerFile) : 1;
  // Anteprima COMPLETA (nessun limite di righe): la lista è dentro una ScrollArea con altezza
  // massima, quindi resta navigabile anche con tante righe senza tagliarne nessuna.
  const anteprima = righeMostrate;

  // All'apertura: (ri)allinea la selezione alle colonne visibili e propone l'orientamento
  // in base a quante colonne ci sono (molte → orizzontale, poche → verticale).
  useEffect(() => {
    if (!aperto) return;
    // Colonne fisse → tutte selezionate; altrimenti quelle visibili/preSel.
    const visibili = colonneFisse ? colonne : colonne.filter((c) => c.preSel !== false);
    setSel(new Set(visibili.map((c) => c.key)));
    setOrientamento(orientamentoFisso ?? (visibili.length > 6 ? "orizzontale" : "verticale"));
    setSplitAttivo(splitExcel?.defaultAttivo ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aperto]);

  function toggle(key: string) {
    setSel((corrente) => setConToggle(corrente, key));
  }

  async function salvaExcel() {
    if (!inTauri) {
      toast.warning("Il salvataggio Excel è disponibile solo nell'app desktop.");
      return;
    }
    if (scelte.length === 0) {
      toast.warning("Seleziona almeno una colonna.");
      return;
    }
    setEsportando(true);
    try {
      const righeAggiornate = await primaDiSalvareExcel?.();
      const righeDaEsportare = Array.isArray(righeAggiornate) ? righeAggiornate : righe;
      // `nomeCompleto` (Produzione) → il nome è già descrittivo (linea + data invio + n°):
      // non gli aggiungiamo la data odierna (niente doppia data nel file).
      const baseNome = nomeCompleto
        ? nomeBase
        : `${nomeBase}-${formattaDataFileItaliana(oggiIso())}`;
      const cols = scelte.map((c) => ({ label: c.label, tipo: c.tipo ?? "testo", totale: !!c.totale }));
      const rows = righeDaEsportare.map((r) => scelte.map((c) => valoreCella(c, r)));

      if (splitUsato && splitExcel) {
        if (salvaCustom) {
          toast.warning("Lo split automatico non è disponibile per questo formato dedicato.");
          return;
        }
        const dir = await open({
          directory: true,
          title: `Scegli dove salvare i ${nFileSplit} file Excel`,
        });
        if (!dir || typeof dir !== "string") return;
        for (let i = 0; i < nFileSplit; i++) {
          const parte = rows.slice(i * splitExcel.maxRigheDatiPerFile, (i + 1) * splitExcel.maxRigheDatiPerFile);
          const path = joinPath(dir, `${baseNome}-parte-${String(i + 1).padStart(2, "0")}-di-${String(nFileSplit).padStart(2, "0")}.xlsx`);
          await api.grigliaExport({
            path,
            foglio,
            colonne: cols,
            righe: parte,
            orizzontale: orientamento === "orizzontale",
            simboloEuro: !colonneFisse,
          });
        }
      } else {
        const path = await save({
          defaultPath: `${baseNome}.xlsx`,
          filters: [{ name: "Excel", extensions: ["xlsx"] }],
        });
        if (!path) return;
        if (salvaCustom) {
          // Formato dedicato (Produzione: Laboratorio/Diagnostica): il modale fa solo da
          // anteprima + scelta path; il file lo scrive il backend specializzato.
          await salvaCustom(path);
        } else {
        await api.grigliaExport({
          path,
          foglio,
          colonne: cols,
          righe: rows,
          orizzontale: orientamento === "orizzontale",
          // Distinta corriere (colonne fisse) = numero nudo come il file legacy; gli altri
          // export mostrano «€» nelle celle importo.
          simboloEuro: !colonneFisse,
        });
        }
      }
      toast.success(
        splitUsato
          ? `Esportate ${righeDaEsportare.length} righe in ${nFileSplit} file Excel.`
          : `Esportate ${righeDaEsportare.length} righe in Excel.`
      );
      setAperto(false);
      await onExcelSuccess?.();
      onSuccess?.();
    } catch (e) {
      toast.error(`Export non riuscito: ${e}`);
    } finally {
      await Promise.resolve(dopoSalvataggioExcel?.()).catch((e: unknown) => {
        console.warn("Cleanup post-export non riuscito:", e);
      });
      setEsportando(false);
    }
  }

  function stampa() {
    if (scelte.length === 0) {
      toast.warning("Seleziona almeno una colonna.");
      return;
    }
    stampaTabella(titolo ?? foglio, scelte, righe, orientamento);
    setAperto(false);
    onSuccess?.();
  }

  const inattivo = disabled || righe.length === 0;
  const previewMaxHeight = colonneFisseMostrate ? "min(58dvh, 560px)" : "min(46dvh, 430px)";
  const trigger: ReactNode =
    variante === "icona" ? (
      <ActionIcon
        variant="default"
        size={36}
        radius="sm"
        onClick={() => setAperto(true)}
        disabled={inattivo}
        aria-label="Esporta o stampa"
      >
        <IconFileExport size={18} />
      </ActionIcon>
    ) : (
      <Button
        variant="light"
        color="accent"
        className={adattivo ? "pt-azione-adattiva" : undefined}
        leftSection={<IconFileExport size={18} />}
        onClick={() => setAperto(true)}
        disabled={inattivo}
        size={size}
        aria-label={etichetta}
        style={{ flexShrink: 0 }}
      >
        <span className={adattivo ? "pt-azione-adattiva-label" : undefined}>{etichetta}</span>
        {adattivo && etichettaCompatta && (
          <span className="pt-azione-adattiva-label-compatta">{etichettaCompatta}</span>
        )}
      </Button>
    );

  return (
    <>
      {!senzaTrigger && (
        <Tooltip label={etichetta || "Esporta o stampa"} withArrow>
          <Box className={adattivo ? "pt-azione-adattiva-wrap" : undefined} style={{ display: "inline-block", minWidth: 0 }}>
            {trigger}
          </Box>
        </Tooltip>
      )}

      <Modal
        opened={aperto}
        onClose={() => setAperto(false)}
        size="auto"
        zIndex={1300}
        centered
        transitionProps={{ transition: "fade", duration: 160, onExited: clearContenutoSnapshot }}
        styles={{
          inner: { padding: 16 },
          content: {
            width: "fit-content",
            minWidth: "min(560px, calc(100vw - 32px))",
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "calc(100dvh - 32px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
          header: { flexShrink: 0 },
          body: {
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
            paddingTop: 0,
          },
        }}
        title={
          <Group gap="xs">
            <ThemeIcon size={28} radius="md" variant="light" color="teal">
              <IconFileExport size={16} />
            </ThemeIcon>
            <Text fw={600}>{contenutoMostrato.titoloModale ?? "Esporta o stampa"}</Text>
          </Group>
        }
        // Impedisce che ESC si propaghi al modal padre (es. ExportArubaModal),
        // chiudendo solo questo pannello di anteprima e non anche quello esterno.
        onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }}
      >
        <Stack
          gap="md"
          style={{
            minHeight: 0,
            maxHeight: "calc(100dvh - 116px)",
            overflow: "hidden",
          }}
        >
          {!colonneFisseMostrate && (
            <Box style={{ flexShrink: 0, maxHeight: "min(170px, 22dvh)", overflow: "auto", paddingRight: 4 }}>
              <Text size="sm" fw={600} mb={6}>
                Colonne da includere
              </Text>
              <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs" verticalSpacing={4}>
                {colonneMostrate.map((c) => (
                  <Checkbox
                    key={c.key}
                    size="sm"
                    label={c.label}
                    checked={sel.has(c.key)}
                    onChange={() => toggle(c.key)}
                  />
                ))}
              </SimpleGrid>
            </Box>
          )}

          <Group justify="space-between" align="flex-end" style={{ flexShrink: 0 }}>
            {!orientamentoFissoMostrato ? (
              <Box>
                <Text size="sm" fw={600} mb={6}>
                  Orientamento (stampa / Excel)
                </Text>
                <SegmentedControl
                  size="xs"
                  value={orientamento}
                  onChange={(v) => setOrientamento(v as Orientamento)}
                  data={[
                    { value: "verticale", label: "Verticale" },
                    { value: "orizzontale", label: "Orizzontale" },
                  ]}
                />
              </Box>
            ) : (
              <Box />
            )}
            <Text size="xs" c="dimmed">
              {righeMostrate.length} righe · {scelte.length} colonne
            </Text>
          </Group>

          {splitNecessario && splitExcelMostrato && (
            <Switch
              style={{ flexShrink: 0 }}
              checked={splitAttivo}
              onChange={(e) => setSplitAttivo(e.currentTarget.checked)}
              label={<Text fw={600} size="sm">{splitExcelMostrato.label ?? "Dividi in piu file Excel"}</Text>}
              description={
                <Text size="xs" c="dimmed">
                  {splitExcelMostrato.descrizione ??
                    `Con ${righeMostrate.length} righe verranno creati ${nFileSplit} file da massimo ${splitExcelMostrato.maxRigheDatiPerFile} righe dati ciascuno.`}
                </Text>
              }
              color="teal"
              size="sm"
            />
          )}

          <Box style={{ minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Text size="sm" fw={600} mb={6}>
              Anteprima
            </Text>
            <Box
              style={{
                minHeight: 0,
                maxHeight: previewMaxHeight,
                maxWidth: "calc(100vw - 72px)",
                overflow: "auto",
                border: "1px solid var(--mantine-color-gray-3)",
                borderRadius: 6,
              }}
            >
              <Table
                striped
                withColumnBorders
                stickyHeader
                fz="xs"
                style={{ minWidth: "max-content", border: 0 }}
              >
                <Table.Thead>
                  <Table.Tr>
                    {scelte.map((c) => (
                      <Table.Th key={c.key} style={{ whiteSpace: "nowrap", textAlign: isNumerica(c) ? "right" : "left" }}>
                        {c.label}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {anteprima.map((r, i) => (
                    <Table.Tr key={i}>
                      {scelte.map((c) => (
                        <Table.Td
                          key={c.key}
                          className={isNumerica(c) ? "tabular" : undefined}
                          style={{ whiteSpace: "nowrap", textAlign: isNumerica(c) ? "right" : "left" }}
                        >
                          {testoCella(c, r) || "—"}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
            {scelte.some((c) => c.totale) && (
              <Text size="xs" c="dimmed" mt={6} style={{ flexShrink: 0 }}>
                In fondo viene aggiunta una riga <b>Totali</b> per le colonne importo.
              </Text>
            )}
          </Box>

          <Group justify="flex-end" gap="sm" style={{ flexShrink: 0 }}>
            <Button variant="default" onClick={() => setAperto(false)}>
              Annulla
            </Button>
            <Button
              variant="light"
              color="gray"
              leftSection={<IconPrinter size={16} />}
              onClick={stampa}
              disabled={scelte.length === 0}
            >
              Stampa
            </Button>
            <Button
              color="teal"
              leftSection={<IconFileSpreadsheet size={16} />}
              onClick={salvaExcel}
              loading={esportando}
              disabled={scelte.length === 0}
            >
              {splitUsato ? "Scegli cartella…" : "Salva Excel…"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
