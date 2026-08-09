import type { RefObject } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconCalendarRepeat,
  IconCashBanknote,
  IconPencil,
  IconPlus,
  IconReceiptRefund,
  IconTruckDelivery,
} from "@tabler/icons-react";
import type { Pagamento } from "../../lib/tauri";
import { centsToEurStr } from "../../lib/money";
import type { PagamentoModalTarget } from "../contabilita/PagamentoModal";
import { tipoPagamentoLabel } from "../contabilita/statiPagamento";
import { centsDi } from "./ordineEditorModel";
import {
  formatDataScadenzario,
  offsetScadenzaDaSpedizione,
  scaduta,
} from "./ordineScadenzario";

export interface RigaScadenzarioEditor {
  key: string;
  tipo: Pagamento["tipo"];
  importo: number;
  saldato: boolean;
  scadenza: string;
  data: string;
  verificato: boolean;
  contoNome: string;
  contoId: string;
  contoTipo: string;
  scadDaSpedizione?: boolean;
  scadRelGiorni?: number;
  bozza: boolean;
  pagamento: Pagamento | null;
}

interface PagamentoScadenzarioPanelProps {
  containerRef: RefObject<HTMLDivElement | null>;
  evidenziato: boolean;
  ordineId: string | null;
  categoria: string;
  codTutto: boolean;
  acconto: number | "";
  accontoIncassato: boolean;
  accontoData: string;
  accontoDisabled?: boolean;
  totale: number;
  incassato: number;
  residuo: number;
  righe: RigaScadenzarioEditor[];
  optionsConti: Array<{ value: string; label: string }>;
  importoRateizzabile: number;
  saldoAttesoCorrente: number;
  scopertoScadenzario: number;
  prossimaRataDaSaldare: Pagamento | null;
  azioneAggiungiPagamento: PagamentoModalTarget | null;
  rimborsoLabel: string | null;
  onAccontoChange: (value: number | "") => void;
  onAccontoFocus: () => void;
  onToggleCod: () => void;
  onAccontoIncassatoChange: (value: boolean) => void;
  onAccontoDataChange: (value: string) => void;
  onApriPagamento: (target: PagamentoModalTarget) => void;
  onAggiornaContoBozza: (key: string, contoId: string) => void;
  onAggiornaScadenzaBozza: (key: string, value: string) => void;
  onAggiornaScadDaSpedizioneBozza: (key: string, value: boolean) => void;
  onApriRateizzazione: (importo: number, modalita?: "sostituisci" | "aggiungi") => void;
  onApriRimborso: () => void;
}

export function PagamentoScadenzarioPanel({
  containerRef,
  evidenziato,
  ordineId,
  categoria,
  codTutto,
  acconto,
  accontoIncassato,
  accontoData,
  accontoDisabled = false,
  totale,
  incassato,
  residuo,
  righe,
  optionsConti,
  importoRateizzabile,
  saldoAttesoCorrente,
  scopertoScadenzario,
  prossimaRataDaSaldare,
  azioneAggiungiPagamento,
  rimborsoLabel,
  onAccontoChange,
  onAccontoFocus,
  onToggleCod,
  onAccontoIncassatoChange,
  onAccontoDataChange,
  onApriPagamento,
  onAggiornaContoBozza,
  onAggiornaScadenzaBozza,
  onAggiornaScadDaSpedizioneBozza,
  onApriRateizzazione,
  onApriRimborso,
}: PagamentoScadenzarioPanelProps) {
  return (
    <Card
      ref={containerRef}
      withBorder
      radius="md"
      p="sm"
      bg="var(--bg)"
      style={{
        borderColor: evidenziato ? "var(--mantine-color-red-5)" : undefined,
        boxShadow: evidenziato
          ? "0 0 0 3px rgba(250, 82, 82, 0.18), 0 14px 34px rgba(250, 82, 82, 0.16)"
          : undefined,
        transition: "border-color 180ms ease, box-shadow 180ms ease",
      }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <NumberInput
              label="Acconto previsto"
              description={codTutto ? "nessuno (COD)" : ordineId ? "nello scadenzario" : "concordato"}
              value={acconto}
              onChange={(value) => onAccontoChange(value === "" ? "" : Number(value))}
              onFocus={onAccontoFocus}
              prefix="€ "
              decimalScale={2}
              fixedDecimalScale
              thousandSeparator="."
              decimalSeparator=","
              min={0}
              max={totale / 100}
              w={150}
              disabled={codTutto || accontoDisabled}
              size="sm"
            />

            {categoria === "Keriba" && !ordineId && (
              <Button
                variant={codTutto ? "filled" : "light"}
                color="grape"
                size="sm"
                leftSection={<IconTruckDelivery size={14} />}
                onClick={onToggleCod}
              >
                Salda tutto alla consegna
              </Button>
            )}

            {!ordineId && !codTutto && centsDi(acconto) > 0 && (
              <Checkbox
                size="sm"
                label="già incassato"
                checked={accontoIncassato}
                onChange={(event) => onAccontoIncassatoChange(event.currentTarget.checked)}
                style={{ marginBottom: 6 }}
              />
            )}

            {!ordineId && !codTutto && centsDi(acconto) > 0 && accontoIncassato && (
              <TextInput
                size="sm"
                type="date"
                aria-label="Data incasso acconto"
                value={accontoData}
                onChange={(event) => onAccontoDataChange(event.currentTarget.value)}
                w={130}
              />
            )}
          </Group>

          <Group gap="xl" wrap="nowrap" style={{ alignSelf: "center", textAlign: "right" }}>
            <Box>
              <Text size="sm" c="dimmed">Importo</Text>
              <Text fw={700} fz="md" className="tabular">€ {centsToEurStr(totale)}</Text>
            </Box>
            <Box>
              <Text size="sm" c="dimmed">Incassato</Text>
              <Text fw={600} fz="md" className="tabular" c="teal">€ {centsToEurStr(incassato)}</Text>
            </Box>
            <Box>
              <Text size="sm" c="dimmed">Residuo</Text>
              <Text fw={700} fz="md" c={residuo > 0 ? "red" : "teal"} className="tabular">
                € {centsToEurStr(Math.max(residuo, 0))}
              </Text>
              {residuo < 0 && <Text size="xs" c="teal" fw={500}>+€ {centsToEurStr(-residuo)} extra</Text>}
            </Box>
          </Group>
        </Group>

        {righe.length > 0 && (
          <Box mt="xs" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <Text size="xs" fw={600} c="dimmed" mb={4}>
              Scadenzario {`· ${!ordineId
                ? "si crea al salvataggio"
                : righe.some((riga) => !riga.bozza)
                  ? "clicca una riga per modificarla"
                  : "provvisorio (salva per confermare)"}`}
            </Text>
            <Stack gap={2}>
              {righe.map((riga) => {
                const isScaduta = !riga.saldato && scaduta(riga.scadenza);
                return (
                  <Group
                    key={riga.key}
                    className={riga.bozza ? undefined : "pt-pagamento-row"}
                    onClick={
                      riga.bozza || !riga.pagamento
                        ? undefined
                        : () => onApriPagamento({ pagamento: riga.pagamento! })
                    }
                    justify="space-between"
                    gap="xs"
                    wrap="nowrap"
                  >
                    <Group gap={6} wrap="nowrap">
                      <Badge size="xs" variant="light" color="gray">{tipoPagamentoLabel(riga.tipo)}</Badge>
                      {riga.saldato ? (
                        <Badge size="xs" variant="light" color={riga.verificato ? "teal" : "lime"}>
                          {riga.verificato ? "saldato" : "da verificare"}
                        </Badge>
                      ) : (
                        <Badge size="xs" variant="light" color={isScaduta ? "red" : "blue"}>
                          {isScaduta ? "scaduto" : "atteso"}
                        </Badge>
                      )}

                      {riga.bozza ? (
                        riga.tipo === "acconto" ? (
                          <Group gap="xs" align="center" wrap="nowrap">
                            <Text size="xs" c="dimmed">
                              {riga.saldato
                                ? `incassato il ${formatDataScadenzario(riga.data)}`
                                : riga.scadenza
                                  ? `scad. ${formatDataScadenzario(riga.scadenza)}`
                                  : "—"}
                            </Text>
                            <Text size="xs" c="dimmed">→</Text>
                            <ContoBozzaSelect
                              value={riga.contoId}
                              options={optionsConti}
                              onChange={(contoId) => onAggiornaContoBozza(riga.key, contoId)}
                            />
                          </Group>
                        ) : (
                          <Group gap="xs" align="center" wrap="nowrap">
                            {riga.scadDaSpedizione ? (
                              <TextInput
                                size="xs"
                                value={`≈ spediz. + ${offsetScadenzaDaSpedizione(riga.contoTipo, riga.scadRelGiorni || 0)}gg`}
                                disabled
                                w={120}
                                styles={{ input: { textAlign: "center", fontWeight: 500 } }}
                              />
                            ) : (
                              <TextInput
                                size="xs"
                                type="date"
                                aria-label="Scadenza"
                                value={riga.scadenza}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => onAggiornaScadenzaBozza(riga.key, event.currentTarget.value)}
                                w={120}
                              />
                            )}
                            <Checkbox
                              size="xs"
                              aria-label="Da spedizione"
                              label="da spediz."
                              checked={!!riga.scadDaSpedizione}
                              onChange={(event) =>
                                onAggiornaScadDaSpedizioneBozza(riga.key, event.currentTarget.checked)
                              }
                              styles={{ label: { fontSize: 10, paddingLeft: 4 } }}
                            />
                            <Text size="xs" c="dimmed">→</Text>
                            <ContoBozzaSelect
                              value={riga.contoId}
                              options={optionsConti}
                              onChange={(contoId) => onAggiornaContoBozza(riga.key, contoId)}
                            />
                          </Group>
                        )
                      ) : (
                        <Text size="xs" c={isScaduta ? "red" : "dimmed"}>
                          {riga.saldato
                            ? `${formatDataScadenzario(riga.data)}${riga.contoNome ? ` · ${riga.contoNome}` : ""}`
                            : riga.scadDaSpedizione && !riga.scadenza
                              ? `≈ spediz. + ${offsetScadenzaDaSpedizione(riga.contoTipo, riga.scadRelGiorni || 0)}gg${riga.contoNome ? ` · → ${riga.contoNome}` : ""}`
                              : riga.scadenza
                                ? `scad. ${formatDataScadenzario(riga.scadenza)}${riga.contoNome ? ` · → ${riga.contoNome}` : ""}`
                                : "—"}
                        </Text>
                      )}
                    </Group>

                    <Group gap={8} wrap="nowrap">
                      <Text size="sm" className="tabular" c={riga.saldato ? "dimmed" : undefined}>
                        € {centsToEurStr(riga.importo)}
                      </Text>
                      {!riga.bozza && riga.pagamento && !riga.saldato && (
                        <Button
                          variant="light"
                          color="accent"
                          size="compact-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            onApriPagamento({ pagamento: riga.pagamento!, saldaSubito: true });
                          }}
                        >
                          Salda
                        </Button>
                      )}
                      {!riga.bozza && riga.saldato && <IconPencil size={13} color="var(--mantine-color-gray-5)" />}
                    </Group>
                  </Group>
                );
              })}
            </Stack>
          </Box>
        )}

        <Group justify="space-between" mt="xs" gap="xs">
          <Text size="sm" c="dimmed">
            {ordineId ? "" : "Salva l'ordine: acconto e saldo entrano nello scadenzario."}
          </Text>
          <Group gap="xs">
            {importoRateizzabile > 0 && saldoAttesoCorrente > 0 && (
              <Button
                variant="subtle"
                color="accent"
                size="compact-sm"
                leftSection={<IconCalendarRepeat size={15} />}
                onClick={() => onApriRateizzazione(importoRateizzabile)}
              >
                Rateizza saldo
              </Button>
            )}
            {ordineId && scopertoScadenzario > 0 && (
              <Button
                variant="subtle"
                color="accent"
                size="compact-sm"
                leftSection={<IconPlus size={15} />}
                onClick={() => onApriRateizzazione(scopertoScadenzario, "aggiungi")}
              >
                Aggiungi rate
              </Button>
            )}
            {prossimaRataDaSaldare && (
              <Button
                variant="light"
                color="accent"
                size="compact-sm"
                leftSection={<IconCashBanknote size={15} />}
                onClick={() => onApriPagamento({ pagamento: prossimaRataDaSaldare, saldaSubito: true })}
              >
                Salda prossima rata
              </Button>
            )}
            {azioneAggiungiPagamento && (
              <Button
                variant="light"
                color="accent"
                size="compact-sm"
                leftSection={<IconCashBanknote size={15} />}
                onClick={() => onApriPagamento(azioneAggiungiPagamento)}
              >
                Aggiungi pagamento
              </Button>
            )}
            {ordineId && rimborsoLabel && (
              <Button
                variant="light"
                color="grape"
                size="compact-sm"
                leftSection={<IconReceiptRefund size={15} />}
                onClick={onApriRimborso}
              >
                {rimborsoLabel}
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}

function ContoBozzaSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      variant="unstyled"
      size="xs"
      w={120}
      data={options}
      value={value}
      onChange={(next) => onChange(next || "")}
      comboboxProps={{ withinPortal: true, zIndex: 1400 }}
      styles={{
        input: {
          color: "var(--mantine-color-dimmed)",
          fontWeight: 500,
          cursor: "pointer",
          paddingRight: 14,
        },
      }}
    />
  );
}
