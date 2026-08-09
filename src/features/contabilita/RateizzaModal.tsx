// Dialog "Rateizza" (FASE 3): divide un importo di un ordine in N rate attese.
// Dato l'importo da rateizzare e il numero di rate (default 2), calcola parti uguali
// (l'ultima quadra i centesimi) con scadenze a cadenza mensile o ogni N giorni;
// l'anteprima è modificabile a mano. Conferma → sostituisce gli attesi saldo/rata oppure,
// in modalità "aggiungi", conserva lo scadenzario e aggiunge rate per il solo scoperto.
import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { api, type RataInput } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { centsToEurStr, eurToCents } from "../../lib/money";
import { focusInvalidField } from "../../ui/focusInvalid";
import {
  aggiungiGiorniRate,
  calcolaRate,
  dataLocaleOggi,
  differenzaGiorni,
  offsetSpedizione,
} from "./rateizzazione";

export interface RateizzaTarget {
  /** Se presente, rateizza sul backend; altrimenti usa `onLocalSave` (ordine non salvato). */
  ordineId?: string;
  numero?: string;
  /** `aggiungi` conserva lo scadenzario esistente e crea rate solo per la parte scoperta. */
  modalita?: "sostituisci" | "aggiungi";
  /** Se il saldo era già rateizzato, conserva solo il numero di rate del piano precedente. */
  numeroRateIniziale?: number;
  /** Importo del saldo da rateizzare, in centesimi. */
  importo: number;
  /** L'ordine salvato ha prodotti/acconto non ancora confermati: applica il piano solo
   * localmente e materializzalo quando l'utente salva l'ordine. */
  rimandaRiallineamento?: boolean;
  /** Data dell'acconto (ISO): con la spunta «dopo la spedizione» disattivata, la prima
   * scadenza parte da qui + 30 giorni. FASE 7. */
  accontoData?: string;
  /** Tipo del conto del saldo/rata che stiamo sostituendo. */
  contoTipo?: string;
  /** Tipo del conto proposto per le rate successive, quando la prima eredita un transito. */
  contoRateSuccessiveTipo?: string;
}

export function RateizzaModal({
  target,
  onClose,
  onSaved,
  onLocalSave,
}: {
  target: RateizzaTarget | null;
  onClose: () => void;
  onSaved: () => void;
  /** Per ordini non ancora salvati: ricevi le rate da applicare localmente + se sono legate
   * alla spedizione (prima scadenza = spedizione + 7gg, riallineata all'invio). */
  onLocalSave?: (rate: RataInput[], daSpedizione: boolean) => void;
}) {
  const [mostrato, setMostrato] = useState<RateizzaTarget | null>(target);
  useEffect(() => {
    if (target) setMostrato(target);
  }, [target]);

  return (
    <Modal
      opened={!!target}
      onClose={onClose}
      size="lg"
      zIndex={1300}
      title={
        <Group gap="sm">
          <Text fw={700}>{mostrato?.modalita === "aggiungi" ? "Aggiungi rate" : "Rateizza il saldo"}</Text>
          {mostrato?.numero && (
            <Text size="sm" c="dimmed">
              Ordine {mostrato.numero}
            </Text>
          )}
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: () => setMostrato(null) }}
    >
      {mostrato && <Form target={mostrato} onClose={onClose} onSaved={onSaved} onLocalSave={onLocalSave} />}
    </Modal>
  );
}

function Form({
  target,
  onClose,
  onSaved,
  onLocalSave,
}: {
  target: RateizzaTarget;
  onClose: () => void;
  onSaved: () => void;
  onLocalSave?: (rate: RataInput[], daSpedizione: boolean) => void;
}) {
  const totaleCents = target.importo;
  const numeroRateIniziale = Math.max(1, target.numeroRateIniziale ?? 2);
  const [numRate, setNumRate] = useState<number | "">(numeroRateIniziale);
  const [cadenza, setCadenza] = useState<"mensile" | "giorni">("mensile");
  const [giorni, setGiorni] = useState<number | "">(30);
  // Default: prima scadenza legata alla spedizione (+7gg, riallineata all'invio). Togliendo
  // la spunta, la prima scadenza è fissa a 30 giorni dopo l'acconto.
  const [daSpedizione, setDaSpedizione] = useState(true);
  const primaRataTransito = target.contoTipo === "contrassegno" || target.contoTipo === "assegno";
  const baseOffset = offsetSpedizione(target.contoTipo);
  const baseOffsetSuccessive = primaRataTransito ? offsetSpedizione(target.contoRateSuccessiveTipo) : baseOffset;

  // `inizio` è l'ancora delle scadenze in anteprima. Con la spunta attiva è provvisorio
  // (oggi + baseOffset): conta solo la spaziatura fra le rate, l'ancora vera la fissa la spedizione.
  const inizioSped = aggiungiGiorniRate(dataLocaleOggi(), baseOffset);
  const inizioFisso = aggiungiGiorniRate(target.accontoData || dataLocaleOggi(), 30);
  const [inizio, setInizio] = useState(daSpedizione ? inizioSped : inizioFisso);
  const [rate, setRate] = useState<RataInput[]>(() =>
    calcolaRate(
      totaleCents,
      numeroRateIniziale,
      daSpedizione ? inizioSped : inizioFisso,
      "mensile",
      30
    )
  );
  const [salvando, setSalvando] = useState(false);

  // Cambiando modalità, riporta l'ancora al default coerente.
  useEffect(() => {
    setInizio(daSpedizione ? inizioSped : inizioFisso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daSpedizione]);

  useEffect(() => {
    const n = numRate === "" ? 0 : Number(numRate);
    const g = giorni === "" ? 30 : Number(giorni);
    setRate(calcolaRate(totaleCents, n, inizio, cadenza, g));
  }, [totaleCents, numRate, cadenza, giorni, inizio]);

  const sommaRate = useMemo(() => rate.reduce((s, r) => s + r.importo, 0), [rate]);
  const quadra = rate.length > 0 && sommaRate === totaleCents;

  function aggiornaRata(i: number, patch: Partial<RataInput>) {
    setRate((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function conferma() {
    if (rate.length === 0) {
      toast.warning("Indica il numero di rate.");
      focusInvalidField('[data-pt-field="rateizza-numero"]');
      return;
    }
    if (!quadra) {
      toast.warning("La somma delle rate deve essere uguale all'importo da rateizzare.");
      focusInvalidField('[data-pt-field="rateizza-rata-importo"]');
      return;
    }
    const primaSenzaScadenza = rate.findIndex((r) => !r.scadenza);
    if (primaSenzaScadenza >= 0) {
      toast.warning("Ogni rata deve avere una scadenza.");
      focusInvalidField(`[data-pt-row="rate-${primaSenzaScadenza}"] [data-pt-field="rateizza-rata-scadenza"]`);
      return;
    }
    // Ordine non ancora salvato, oppure ordine esistente con righe/importi ancora in
    // bozza: applica localmente e materializza solo al salvataggio effettivo.
    if (!target.ordineId || target.rimandaRiallineamento) {
      onLocalSave?.(rate, daSpedizione);
      return;
    }
    setSalvando(true);
    try {
      if (target.modalita === "aggiungi") {
        await api.pagamentiAggiungiRate(target.ordineId, rate, daSpedizione);
        toast.success("Rate aggiunte.");
      } else {
        await api.pagamentiRateizza(target.ordineId, rate, daSpedizione);
        toast.success("Saldo rateizzato.");
      }
      onSaved();
    } catch (e) {
      toast.error(`Rateizzazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Box className="pt-modal-shell">
      <Box className="pt-modal-scroll">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Importo da rateizzare: <b>€ {centsToEurStr(totaleCents)}</b>
          </Text>

          <Checkbox
            checked={daSpedizione}
            onChange={(e) => setDaSpedizione(e.currentTarget.checked)}
            label={`Prima scadenza ~${baseOffset} giorni dopo la spedizione`}
            description={
              primaRataTransito
                ? `All'invio la prima rata resta a +${baseOffset} giorni sul conto di transito; le successive seguono il conto dell'ordine e la cadenza scelta.`
                : `All'invio della spedizione la prima rata si fissa a +${baseOffset} giorni. Le altre seguono la cadenza scelta. Togli la spunta per partire da 30 giorni dopo l'acconto.`
            }
          />

          <Group grow align="flex-end">
            <Box data-pt-field="rateizza-numero">
              <NumberInput
                label="Numero rate"
                value={numRate}
                onChange={(v) => setNumRate(v === "" ? "" : Number(v))}
                min={1}
                max={60}
                allowDecimal={false}
              />
            </Box>
            <Box>
              <Text size="sm" fw={500} mb={4}>
                Cadenza
              </Text>
              <SegmentedControl
                fullWidth
                value={cadenza}
                onChange={(v) => setCadenza(v as "mensile" | "giorni")}
                data={[
                  { value: "mensile", label: "Mensile" },
                  { value: "giorni", label: "Ogni N giorni" },
                ]}
              />
            </Box>
            {cadenza === "giorni" ? (
              <NumberInput
                label="Giorni tra le rate"
                value={giorni}
                onChange={(v) => setGiorni(v === "" ? "" : Number(v))}
                min={1}
                max={365}
                allowDecimal={false}
              />
            ) : daSpedizione ? (
              <TextInput label="Prima scadenza" value={`≈ spedizione + ${baseOffset}gg`} disabled />
            ) : (
              <TextInput
                label="Prima scadenza"
                type="date"
                value={inizio}
                onChange={(e) => setInizio(e.currentTarget.value)}
              />
            )}
          </Group>
          {cadenza === "giorni" &&
            (daSpedizione ? (
              <TextInput label="Prima scadenza" value={`≈ spedizione + ${baseOffset}gg`} disabled />
            ) : (
              <TextInput
                label="Prima scadenza"
                type="date"
                value={inizio}
                onChange={(e) => setInizio(e.currentTarget.value)}
              />
            ))}

          <Divider label="Anteprima rate (modificabile)" labelPosition="left" my={4} />

          <Stack gap={6}>
            {rate.map((r, i) => (
              <Group key={i} gap="sm" wrap="nowrap" align="flex-end" data-pt-row={`rate-${i}`}>
                <Text size="sm" w={32} c="dimmed">
                  #{i + 1}
                </Text>
                <Box data-pt-field="rateizza-rata-importo">
                  <NumberInput
                    aria-label={`Importo rata ${i + 1}`}
                    value={r.importo / 100}
                    onChange={(v) => aggiornaRata(i, { importo: v === "" ? 0 : eurToCents(Number(v)) })}
                    prefix="€ "
                    decimalScale={2}
                    fixedDecimalScale
                    thousandSeparator="."
                    decimalSeparator=","
                    min={0}
                    w={150}
                  />
                </Box>
                {daSpedizione ? (
                  <TextInput
                    aria-label={`Scadenza rata ${i + 1}`}
                    value={`≈ spedizione + ${(i === 0 ? baseOffset : baseOffsetSuccessive) + differenzaGiorni(r.scadenza, inizio)}gg`}
                    disabled
                    style={{ flex: 1 }}
                  />
                ) : (
                  <Box data-pt-field="rateizza-rata-scadenza" style={{ flex: 1 }}>
                    <TextInput
                      aria-label={`Scadenza rata ${i + 1}`}
                      type="date"
                      value={r.scadenza}
                      onChange={(e) => aggiornaRata(i, { scadenza: e.currentTarget.value })}
                    />
                  </Box>
                )}
              </Group>
            ))}
          </Stack>

          <Text size="sm" c={quadra ? "dimmed" : "red"}>
            Somma rate: <b>€ {centsToEurStr(sommaRate)}</b>
            {!quadra && rate.length > 0 && <> / € {centsToEurStr(totaleCents)}</>}
          </Text>
        </Stack>
      </Box>

      <div className="pt-modal-footer" style={{ justifyContent: "flex-end" }}>
        <div className="pt-modal-actions">
        <Button variant="default" onClick={onClose} disabled={salvando}>
          Annulla
        </Button>
        <Button color="accent" onClick={conferma} loading={salvando} disabled={salvando}>
          {target.modalita === "aggiungi" ? "Aggiungi rate" : "Rateizza"}
        </Button>
        </div>
      </div>
    </Box>
  );
}
