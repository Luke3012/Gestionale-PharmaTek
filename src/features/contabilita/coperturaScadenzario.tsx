import { Badge, Box, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconArrowRight,
  IconCalendarDollar,
  IconCashBanknote,
  IconPackage,
  IconReceiptRefund,
  type Icon,
} from "@tabler/icons-react";
import { api, type RecordDto } from "../../lib/tauri";
import { centsToEurStr } from "../../lib/money";
import { dialog } from "../../ui/dialog/store";
import { ripartisciImportoProporzionale } from "./riallineaSaldo";

export type VoceCopertura = {
  id: string;
  tipo: "acconto" | "saldo" | "rata";
  importo: number;
  saldato: boolean;
  scadenza?: string;
};

export type SceltaCopertura = "dilaziona" | "riduci" | "ignora" | "rimborso" | "correggi" | null;
export type ImpattoRimborsoIncasso = {
  importoAttuale: number;
  importoDopo: number;
  esistente: boolean;
};

function ImpattoAzione({
  titolo,
  descrizione,
  prima,
  dopo,
  differenza,
  color,
  Icona,
}: {
  titolo: string;
  descrizione: string;
  prima: number;
  dopo: number;
  differenza: number;
  color: string;
  Icona: Icon;
}) {
  const segno = differenza >= 0 ? "+" : "−";
  return (
    <Paper className="pt-dialog-card" withBorder radius="md" p="sm" style={{ width: "100%" }}>
      <Group justify="space-between" align="center" gap="md" wrap="wrap">
        {/* Sinistra: Icona + Titolo + Descrizione */}
        <Group gap="sm" wrap="nowrap" align="center" style={{ flex: "1 1 300px", minWidth: 0 }}>
          <ThemeIcon color={color} variant="light" radius="xl" size={38} style={{ flexShrink: 0 }}>
            <Icona size={20} />
          </ThemeIcon>
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text fw={700} size="sm">
              {titolo}
            </Text>
            <Text size="xs" c="dimmed" mt={2}>
              {descrizione}
            </Text>
          </Box>
        </Group>

        {/* Destra: Impatto economico */}
        <Group gap={8} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
          <Text size="sm" c="dimmed" td="line-through">
            € {centsToEurStr(prima)}
          </Text>
          <IconArrowRight size={14} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
          <Text size="sm" fw={700}>
            € {centsToEurStr(dopo)}
          </Text>
          <Badge color={color} variant="light" size="sm" style={{ flexShrink: 0 }}>
            {segno}€ {centsToEurStr(Math.abs(differenza))}
          </Badge>
        </Group>
      </Group>
    </Paper>
  );
}

export async function totaleOrdineCents(ordineId: string): Promise<number> {
  const righe = await api.recordsList("riga_ordine");
  return righe
    .filter((r) => r.data.ordine_id === ordineId)
    .reduce((tot, r) => {
      const prezzo = typeof r.data.prezzo === "number" ? r.data.prezzo : 0;
      const qta = typeof r.data.qta === "number" ? r.data.qta : 1;
      return tot + prezzo * qta;
    }, 0);
}

function ordinaAperti(a: VoceCopertura, b: VoceCopertura): number {
  return (a.scadenza || "9999-12-31").localeCompare(b.scadenza || "9999-12-31") || a.id.localeCompare(b.id);
}

export function ultimaRataAperta(voci: VoceCopertura[]): VoceCopertura | null {
  const aperte = voci
    .filter((v) => !v.saldato && (v.tipo === "saldo" || v.tipo === "rata"))
    .sort(ordinaAperti);
  return aperte[aperte.length - 1] ?? null;
}

export type AdeguamentoAltreRate = {
  aggiornamenti: Array<{ id: string; importo: number }>;
  eliminazioni: string[];
};

/**
 * Mantiene fisso l'importo appena digitato e ripartisce il residuo fra tutte le
 * altre rate aperte. Restituisce `null` quando le altre rate non possono assorbire
 * la differenza senza rendere negativo lo scadenzario.
 */
export function calcolaAdeguamentoAltreRate(
  voci: VoceCopertura[],
  voceFissaId: string,
  totaleOrdine: number
): AdeguamentoAltreRate | null {
  const regolabili = voci.filter(
    (voce) => voce.id !== voceFissaId && !voce.saldato && (voce.tipo === "saldo" || voce.tipo === "rata")
  );
  if (regolabili.length === 0) return null;

  const idsRegolabili = new Set(regolabili.map((voce) => voce.id));
  const importoFisso = voci
    .filter((voce) => !idsRegolabili.has(voce.id))
    .reduce((sum, voce) => sum + Math.max(0, Math.floor(voce.importo)), 0);
  const targetRegolabili = Math.floor(totaleOrdine) - importoFisso;
  if (targetRegolabili < 0) return null;

  const quote = ripartisciImportoProporzionale(
    targetRegolabili,
    regolabili.map((voce) => voce.importo)
  );
  const aggiornamenti: Array<{ id: string; importo: number }> = [];
  const eliminazioni: string[] = [];
  regolabili.forEach((voce, index) => {
    const importo = quote[index] ?? 0;
    if (importo <= 0) eliminazioni.push(voce.id);
    else if (importo !== voce.importo) aggiornamenti.push({ id: voce.id, importo });
  });
  return { aggiornamenti, eliminazioni };
}

export function accontoPrevistoDopoModifica(args: {
  tipoPrima: VoceCopertura["tipo"];
  saldatoPrima: boolean;
  tipoDopo: VoceCopertura["tipo"];
  importoDopo: number;
}): number | null {
  if (args.tipoPrima !== "acconto" && args.tipoDopo !== "acconto") {
    return null;
  }
  if (args.saldatoPrima && args.tipoPrima === "acconto" && args.tipoDopo === "acconto") {
    return null;
  }
  return args.tipoDopo === "acconto" ? Math.max(0, Math.floor(args.importoDopo)) : 0;
}

export function importoCoperto(voci: Pick<VoceCopertura, "importo">[]): number {
  return voci.reduce((sum, v) => sum + Math.max(0, v.importo), 0);
}

/**
 * Regola comune per decidere se una discrepanza rimasta dopo gli automatismi
 * deve fermare il salvataggio sul modale. Le eccezioni esplicite del movimento
 * sono il primo acconto parziale e un incasso non superiore al residuo (che
 * riduce automaticamente le rate ancora aperte).
 */
export function deveMostrareAdeguamentoImporto(args: {
  totale: number;
  coperto: number;
  primoAccontoParziale?: boolean;
  incasso?: { importo: number; rimanenza: number };
}): boolean {
  if (args.incasso) return args.incasso.importo > args.incasso.rimanenza;
  if (args.primoAccontoParziale) return false;
  return args.coperto !== args.totale;
}

function totaleDaRighe(righe: RecordDto[]): number {
  return righe.reduce((tot, r) => {
    const prezzo = typeof r.data.prezzo === "number" ? r.data.prezzo : 0;
    const qta = typeof r.data.qta === "number" ? Math.max(1, Math.floor(r.data.qta)) : 1;
    return tot + prezzo * qta;
  }, 0);
}

async function impostaTotaleRiga(riga: RecordDto, totaleRiga: number): Promise<void> {
  const qta = typeof riga.data.qta === "number" ? Math.max(1, Math.floor(riga.data.qta)) : 1;
  const totale = Math.max(0, Math.floor(totaleRiga));
  if (qta <= 1 || totale % qta === 0) {
    await api.recordUpdate("riga_ordine", riga.id, {
      qta,
      prezzo: qta <= 1 ? totale : Math.floor(totale / qta),
    });
    return;
  }

  const base = Math.floor(totale / qta);
  const resto = totale - base * qta;
  const qtaBase = qta - resto;
  await api.recordUpdate("riga_ordine", riga.id, { qta: resto, prezzo: base + 1 });
  if (qtaBase > 0) {
    await api.recordCreate("riga_ordine", {
      ...riga.data,
      qta: qtaBase,
      prezzo: base,
    });
  }
}

export async function adeguaTotaleOrdine(ordineId: string, totaleTarget: number): Promise<boolean> {
  if (!ordineId) return false;
  const tutte = await api.recordsList("riga_ordine");
  const righe = tutte.filter((r) => r.data.ordine_id === ordineId);
  const totaleAttuale = totaleDaRighe(righe);
  const target = Math.max(0, Math.floor(totaleTarget));
  if (target === totaleAttuale) return false;

  if (target > totaleAttuale) {
    const rigaDaAdeguare = [...righe].reverse().find((r) => {
      const prodottoId = typeof r.data.prodotto_id === "string" ? r.data.prodotto_id : "";
      const prodottoNome = typeof r.data.prodotto_nome === "string" ? r.data.prodotto_nome : "";
      return prodottoId || prodottoNome.trim();
    });
    if (!rigaDaAdeguare) return false;

    const prezzo = typeof rigaDaAdeguare.data.prezzo === "number" ? rigaDaAdeguare.data.prezzo : 0;
    const qta = typeof rigaDaAdeguare.data.qta === "number" ? Math.max(1, Math.floor(rigaDaAdeguare.data.qta)) : 1;
    await impostaTotaleRiga(rigaDaAdeguare, prezzo * qta + (target - totaleAttuale));
    return true;
  }

  let residuoDaAllocare = target;
  for (const riga of righe) {
    const prezzo = typeof riga.data.prezzo === "number" ? riga.data.prezzo : 0;
    const qta = typeof riga.data.qta === "number" ? Math.max(1, Math.floor(riga.data.qta)) : 1;
    const totaleRigaAttuale = prezzo * qta;
    const totaleRigaTarget = Math.min(totaleRigaAttuale, residuoDaAllocare);
    residuoDaAllocare -= totaleRigaTarget;
    if (totaleRigaTarget !== totaleRigaAttuale) {
      await impostaTotaleRiga(riga, totaleRigaTarget);
    }
  }

  const ordine = await api.recordGet("ordine", ordineId);
  const acconto = typeof ordine?.data.acconto === "number" ? ordine.data.acconto : 0;
  if (ordine && acconto > target) {
    await api.recordUpdate("ordine", ordineId, { acconto: target });
  }
  return true;
}

export async function chiediCoperturaScadenzario(args: {
  totale: number;
  coperto: number;
  puoDilazionare?: boolean;
  incasso?: { importo: number; rimanenza: number; rimborso?: ImpattoRimborsoIncasso };
  rimborsoDaAdeguare?: { importoAttuale: number; importoDopo: number };
}): Promise<SceltaCopertura> {
  if (args.incasso && args.incasso.importo > args.incasso.rimanenza) {
    const eccedenza = args.incasso.importo - args.incasso.rimanenza;
    const rimborso = args.incasso.rimborso ?? {
      importoAttuale: 0,
      importoDopo: eccedenza,
      esistente: false,
    };
    return dialog.open<SceltaCopertura>({
      tipo: "question",
      titolo: "Incasso superiore al residuo",
      valoreAnnulla: null,
      contenuto: (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            L'incasso supera il residuo dell'ordine di <b>€ {centsToEurStr(eccedenza)}</b>.
          </Text>
          <Text size="xs" c="dimmed" fw={600}>
            Scegli come registrare la differenza:
          </Text>
        </Stack>
      ),
      bottoni: [
        { label: "Torna a correggere", variante: "secondario", value: null },
        {
          label: "Aumenta prezzo finale",
          posizione: "contenuto",
          contenutoAzione: (
            <ImpattoAzione
              titolo="Aumenta il prezzo finale dell'ordine"
              descrizione="Mantiene l'intero incasso e aumenta dello stesso extra il totale dei prodotti."
              prima={args.totale}
              dopo={args.totale + eccedenza}
              differenza={eccedenza}
              color="blue"
              Icona={IconPackage}
            />
          ),
          variante: "informativo",
          value: "riduci",
        },
        {
          label: rimborso.esistente ? "Aggiorna il rimborso richiesto" : "Mantieni e crea rimborso",
          posizione: "contenuto",
          contenutoAzione: (
            <ImpattoAzione
              titolo={
                rimborso.esistente
                  ? "Mantieni l'eccedenza e aggiorna il rimborso"
                  : "Mantieni l'eccedenza e crea il rimborso"
              }
              descrizione={
                rimborso.esistente
                  ? "Registra l'intero incasso e adegua il rimborso richiesto già collegato all'ordine."
                  : "Registra l'intero incasso e crea un rimborso richiesto collegato all'ordine."
              }
              prima={rimborso.importoAttuale}
              dopo={rimborso.importoDopo}
              differenza={rimborso.importoDopo - rimborso.importoAttuale}
              color="grape"
              Icona={IconReceiptRefund}
            />
          ),
          variante: "primario",
          value: "rimborso",
        },
        ...(args.incasso.rimanenza > 0
          ? ([
              {
                label: "Correggi al residuo",
                posizione: "contenuto",
                contenutoAzione: (
                  <ImpattoAzione
                    titolo="Correggi l'incasso al residuo"
                    descrizione="Registra soltanto quanto resta da saldare e non genera eccedenze."
                    prima={args.incasso.importo}
                    dopo={args.incasso.rimanenza}
                    differenza={-eccedenza}
                    color="teal"
                    Icona={IconCashBanknote}
                  />
                ),
                variante: "primario",
                value: "correggi",
              },
            ] as const)
          : []),
      ],
    });
  }

  const scoperto = Math.max(0, args.totale - args.coperto);
  const eccesso = Math.max(0, args.coperto - args.totale);
  const sovraCoperto = eccesso > 0;
  return dialog.open<SceltaCopertura>({
    tipo: "question",
    titolo: sovraCoperto ? "Scadenzario da adeguare" : "Scadenzario incompleto",
    valoreAnnulla: null,
    contenuto: (
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {sovraCoperto ? (
            <>
              Lo scadenzario supera il totale prodotti di <b>€ {centsToEurStr(eccesso)}</b>.
            </>
          ) : (
            <>
              Allo scadenzario mancano <b>€ {centsToEurStr(scoperto)}</b>.
            </>
          )}
        </Text>
        <Text size="xs" c="dimmed" fw={600}>
          Scegli come riallineare i valori:
        </Text>
      </Stack>
    ),
    bottoni: [
      { label: "Torna a correggere", variante: "secondario", value: null },
      {
        label: "Adegua importo prodotti",
        posizione: "contenuto",
        contenutoAzione: (
          <ImpattoAzione
            titolo="Adegua importo prodotti"
            descrizione={
              sovraCoperto
                ? "Aumenta il totale dei prodotti fino alla copertura attuale."
                : "Riduce il totale dei prodotti alla copertura attuale."
            }
            prima={args.totale}
            dopo={args.coperto}
            differenza={args.coperto - args.totale}
            color="blue"
            Icona={IconPackage}
          />
        ),
        variante: "informativo",
        value: "riduci",
      },
      ...(sovraCoperto && args.rimborsoDaAdeguare
        ? ([
            {
              label: "Adegua rimborso attuale",
              posizione: "contenuto",
              contenutoAzione: (
                <ImpattoAzione
                  titolo="Adegua rimborso attuale"
                  descrizione="Mantiene invariati prodotti e incassi e aggiorna il rimborso richiesto alla nuova eccedenza."
                  prima={args.rimborsoDaAdeguare.importoAttuale}
                  dopo={args.rimborsoDaAdeguare.importoDopo}
                  differenza={
                    args.rimborsoDaAdeguare.importoDopo - args.rimborsoDaAdeguare.importoAttuale
                  }
                  color="grape"
                  Icona={IconReceiptRefund}
                />
              ),
              variante: "primario",
              value: "rimborso",
            },
          ] as const)
        : []),
      ...(args.puoDilazionare
        ? ([
            {
              label: sovraCoperto ? "Adegua rate" : "Dilaziona sulle rate",
              posizione: "contenuto",
              contenutoAzione: (
                <ImpattoAzione
                  titolo={sovraCoperto ? "Adegua rate" : "Dilaziona sulle rate"}
                  descrizione={
                    sovraCoperto
                      ? "Riduce le rate aperte fino al residuo corretto."
                      : "Sposta la differenza sull'ultima rata aperta, senza creare nuove scadenze."
                  }
                  prima={args.coperto}
                  dopo={args.totale}
                  differenza={args.totale - args.coperto}
                  color="yellow"
                  Icona={IconCalendarDollar}
                />
              ),
              variante: "primario",
              value: "dilaziona",
            },
          ] as const)
        : []),
      sovraCoperto
        ? { label: "Lascia così", variante: "ignora", value: "ignora" }
        : {
            label: "Crea rata per il resto",
            posizione: "contenuto",
            contenutoAzione: (
              <ImpattoAzione
                titolo="Crea una nuova rata per il resto"
                descrizione="Mantiene la modifica fatta e aggiunge la differenza come nuova rata residua."
                prima={args.coperto}
                dopo={args.totale}
                differenza={scoperto}
                color="teal"
                Icona={IconCalendarDollar}
              />
            ),
            variante: "primario",
            value: "ignora",
          },
    ],
  });
}
