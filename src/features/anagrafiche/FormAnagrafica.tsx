import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Box,
  Divider,
  NumberInput,
  Popover,
  Select,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { motion } from "framer-motion";
import type { Campo, Opzione, Registro } from "./registri";
import {
  cercaCittaSelezionata,
  type ComuneInfo,
} from "../../lib/cap-lookup";
import { CalcolaCFPopover, CFValidationBadge } from "./CalcolaCFPopover";
import { useTabSelect } from "../../ui/tabCompleta";
import { ScelteCapPopover } from "../../ui/ScelteCapPopover";
import { useScelteCap } from "../../ui/useScelteCap";

export type Valori = Record<string, string | number>;

/**
 * Griglia dei campi del form con logica di auto-fill integrata.
 * Condivisa tra il RegistroView e i modali di creazione rapida (es. in OrdineEditor).
 */
export function FormCampiGrid({
  registro,
  valori,
  errori = {},
  disabilitati = new Set(),
  rifOpzioni = {},
  setValori,
  setErrori,
}: {
  registro: Registro;
  valori: Valori;
  errori?: Record<string, string>;
  disabilitati?: Set<string>;
  rifOpzioni?: Record<string, Opzione[]>;
  setValori: React.Dispatch<React.SetStateAction<Valori>> | ((updater: (s: Valori) => Valori) => void);
  setErrori?: React.Dispatch<React.SetStateAction<Record<string, string>>> | ((updater: (e: Record<string, string>) => Record<string, string>) => void);
}) {
  const {
    suggerimentiCitta, capAmbiguo, capCittaMultiplo, capPopoverAperto,
    setCapPopoverAperto, dopoSceltaComune, gestisciCap, suggerisciCitta,
  } = useScelteCap();

  // Set di campi appena auto-compilati (per flash giallo, resettato dopo 500ms).
  const [campiAutoFilled, setCampiAutoFilled] = useState<Set<string>>(new Set());
  const autoFillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ha un campo cap con autoFill?
  const haAutoFillCAP = useMemo(
    () => registro.campi.some((c) => c.autoFill === "cap"),
    [registro],
  );

  /** Auto-compila città/prov/regione e mostra il flash giallo. */
  const autoFillDaComune = useCallback(
    (
      info: ComuneInfo,
      opzioni: { capSelezionato?: string; mostraCapMultipli?: boolean } = {},
    ) => {
      const aggiornamenti: Record<string, string | number> = {
        citta: info.nome,
        prov: info.sigla,
        regione: info.regione,
      };
      // Un CAP digitato è già una scelta esplicita; dalla città, invece, si
      // autocompila soltanto quando il comune possiede un unico CAP.
      if (opzioni.capSelezionato) {
        aggiornamenti.cap = opzioni.capSelezionato;
      } else if (info.cap.length === 1) {
        aggiornamenti.cap = info.cap[0];
      }
      setValori((s) => ({ ...s, ...aggiornamenti }));

      // Flash giallo sui campi modificati.
      const chiavi = new Set(Object.keys(aggiornamenti));
      setCampiAutoFilled(chiavi);
      if (autoFillTimerRef.current) clearTimeout(autoFillTimerRef.current);
      autoFillTimerRef.current = setTimeout(() => setCampiAutoFilled(new Set()), 500);

      dopoSceltaComune(info, opzioni.mostraCapMultipli);
    },
    [dopoSceltaComune, setValori],
  );

  /** Gestisce il cambio del campo CAP: lookup → auto-fill o suggerimenti. */
  const onCAPChange = useCallback(
    (v: string | number) => {
      const cap = String(v);
      gestisciCap(cap, (comune) => autoFillDaComune(comune, { capSelezionato: cap }));
    },
    [autoFillDaComune, gestisciCap],
  );

  /** Gestisce l'input nel campo città: autocomplete. */
  const onCittaInput = useCallback((query: string) => {
    suggerisciCitta(query);
  }, [suggerisciCitta]);

  /** Quando l'utente seleziona un suggerimento città. */
  const onSelectCitta = useCallback(
    (nome: string) => {
      const info = cercaCittaSelezionata(nome);
      if (info) {
        autoFillDaComune(info, { mostraCapMultipli: true });
      }
    },
    [autoFillDaComune],
  );

  /** Callback per inserire il CF calcolato dal popover. */
  const onUsaCF = useCallback(
    (cf: string) => {
      setValori((s) => ({ ...s, cf: cf.toUpperCase() }));
    },
    [setValori],
  );

  return (
    <Box style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {registro.campi.map((c) => {
        const isCAPConAutoFill = c.autoFill === "cap";

        // Intercetta onChange per il campo CAP con auto-fill.
        const handleChange = (v: string | number) => {
          const next = c.tipo === "cf" && typeof v === "string" ? v.toUpperCase() : v;
          setValori((s) => ({ ...s, [c.key]: next }));
          if (setErrori && errori[c.key]) setErrori((e) => ({ ...e, [c.key]: "" }));
          if (isCAPConAutoFill) onCAPChange(next);
        };

        const campoNode = (
          <CampoForm
            campo={c}
            valore={valori[c.key]}
            errore={errori[c.key]}
            disabled={disabilitati.has(c.key)}
            rifOpzioni={c.rifEntity ? rifOpzioni[c.rifEntity] ?? [] : undefined}
            onChange={handleChange}
            // FASE 8 props
            nomeRecord={c.azione === "calcola-cf" ? String(valori.nome ?? "") : undefined}
            onUsaCF={c.azione === "calcola-cf" ? onUsaCF : undefined}
            suggerimentiCitta={
              c.key === "citta" && haAutoFillCAP ? suggerimentiCitta : undefined
            }
            onCittaInput={c.key === "citta" && haAutoFillCAP ? onCittaInput : undefined}
            onSelectCitta={c.key === "citta" && haAutoFillCAP ? onSelectCitta : undefined}
            autoFilled={campiAutoFilled.has(c.key)}
          />
        );

        // Se è il campo CAP con disambiguazione, wrap con Popover suggerimenti.
        const contenuto =
          isCAPConAutoFill &&
          ((capAmbiguo?.length ?? 0) > 1 ||
            (capCittaMultiplo?.cap.length ?? 0) > 1) ? (
            <Popover
              opened={capPopoverAperto}
              onChange={setCapPopoverAperto}
              position="bottom-start"
              shadow="md"
              radius="md"
              width={280}
              withArrow
              zIndex={1400}
            >
              {/* CampoForm è un componente memo e non espone un ref DOM: il wrapper
                  reale è necessario a Floating UI per ancorare correttamente il menu. */}
              <Popover.Target>
                <Box>{campoNode}</Box>
              </Popover.Target>
              {/* L'Escape resta confinato al popover e non chiude il modale ospite. */}
              <ScelteCapPopover
                capCittaMultiplo={capCittaMultiplo}
                capAmbiguo={capAmbiguo}
                onScegli={autoFillDaComune}
                proteggiEscape
              />
            </Popover>
          ) : (
            campoNode
          );

        return (
          <Box key={c.key} data-pt-field={c.key} style={{ gridColumn: c.half ? "auto" : "1 / -1" }}>
            {contenuto}
          </Box>
        );
      })}
    </Box>
  );
}

const CampoForm = React.memo(function CampoForm({
  campo,
  valore,
  errore,
  rifOpzioni,
  disabled,
  onChange,
  nomeRecord,
  onUsaCF,
  suggerimentiCitta,
  onCittaInput,
  onSelectCitta,
  autoFilled,
}: {
  campo: Campo;
  valore: string | number;
  errore?: string;
  rifOpzioni?: Opzione[];
  disabled?: boolean;
  onChange: (v: string | number) => void;
  nomeRecord?: string;
  onUsaCF?: (cf: string) => void;
  suggerimentiCitta?: string[];
  onCittaInput?: (query: string) => void;
  onSelectCitta?: (nome: string) => void;
  autoFilled?: boolean;
}) {
  useEffect(() => {
    if (campo.tipo !== "segmented") return;
    const opzioni = campo.opzioni ?? [];
    const primo = opzioni[0]?.value ?? "";
    if (!primo) return;
    const raw = String(valore ?? "");
    if (!opzioni.some((o) => o.value === raw)) onChange(primo);
  }, [campo.tipo, campo.opzioni, valore, onChange]);

  const opzioniSelect = campo.opzioni ?? rifOpzioni ?? [];
  const tabSelect = useTabSelect(
    campo.tipo === "select" ? opzioniSelect : [],
    valore ? String(valore) : null,
    onChange,
  );

  const comune = {
    label: campo.label,
    error: errore || undefined,
    withAsterisk: campo.required,
    disabled,
  };

  const wrapAutoFill = (node: React.ReactNode) => (
    <motion.div
      initial={false}
      animate={autoFilled ? { backgroundColor: ["rgba(244,194,13,0.15)", "transparent"] } : {}}
      transition={{ duration: 0.4 }}
      style={{ borderRadius: "var(--mantine-radius-md)", width: "100%" }}
    >
      {node}
    </motion.div>
  );

  switch (campo.tipo) {
    case "sezione":
      return (
        <Box mt={4}>
          <Divider
            mb={campo.placeholder ? 4 : 8}
            labelPosition="left"
            label={
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                {campo.label}
              </Text>
            }
          />
          {campo.placeholder && (
            <Text size="xs" c="dimmed">
              {campo.placeholder}
            </Text>
          )}
        </Box>
      );
    case "textarea":
      return <Textarea {...comune} value={String(valore ?? "")} onChange={(e) => onChange(e.currentTarget.value)} autosize minRows={2} />;
    case "eur":
      return (
        <NumberInput
          {...comune}
          value={valore === "" ? "" : Number(valore)}
          onChange={(v) => onChange(v === "" ? "" : Number(v))}
          decimalScale={2}
          fixedDecimalScale
          prefix="€ "
          thousandSeparator="."
          decimalSeparator=","
          min={0}
        />
      );
    case "numero":
      return (
        <NumberInput
          {...comune}
          value={valore === "" ? "" : Number(valore)}
          onChange={(v) => onChange(v === "" ? "" : Number(v))}
          min={campo.min ?? 0}
          max={campo.max}
          allowDecimal={!campo.integer}
        />
      );
    case "segmented": {
      const opzioni = campo.opzioni ?? [];
      const raw = String(valore ?? "");
      const segmentedValue = opzioni.some((o) => o.value === raw) ? raw : opzioni[0]?.value ?? "";
      return (
        <Box>
          <Text size="sm" fw={500} mb={4}>
            {campo.label}
          </Text>
          <Box
            role="radiogroup"
            aria-label={campo.label}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.max(1, opzioni.length)}, minmax(0, 1fr))`,
              gap: 4,
              padding: 4,
              minHeight: 36,
              borderRadius: 8,
              background: "var(--mantine-color-gray-1)",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {opzioni.map((opzione) => {
              const active = opzione.value === segmentedValue;
              return (
                <button
                  key={opzione.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => onChange(opzione.value)}
                  style={{
                    border: 0,
                    height: 28,
                    minWidth: 0,
                    borderRadius: 7,
                    background: active ? "var(--mantine-color-body)" : "transparent",
                    boxShadow: active ? "0 1px 4px rgba(16, 24, 40, 0.18)" : "none",
                    color: "var(--mantine-color-text)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    font: "inherit",
                    fontWeight: active ? 700 : 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    transition: "background 120ms ease, box-shadow 120ms ease",
                  }}
                >
                  {opzione.label}
                </button>
              );
            })}
          </Box>
          {errore && (
            <Text size="xs" c="red" mt={4}>
              {errore}
            </Text>
          )}
        </Box>
      );
    }
    case "select":
      return (
        <Select
          {...comune}
          {...tabSelect}
          data={opzioniSelect}
          value={valore ? String(valore) : null}
          onChange={(v) => onChange(v ?? "")}
          limit={100}
          allowDeselect={false}
          nothingFoundMessage="Nessun risultato"
          placeholder="Seleziona…"
          comboboxProps={{ zIndex: 1400 }}
        />
      );
    case "cf":
      return (
        <Box>
          <TextInput
            {...comune}
            value={String(valore ?? "")}
            onChange={(e) => onChange(e.currentTarget.value.toUpperCase())}
            placeholder={campo.placeholder}
            maxLength={16}
            rightSection={
              campo.azione === "calcola-cf" && onUsaCF ? (
                <CalcolaCFPopover
                  nomeRecord={nomeRecord ?? ""}
                  onUsaCF={onUsaCF}
                />
              ) : undefined
            }
          />
          <CFValidationBadge valoreCF={String(valore ?? "")} />
        </Box>
      );
    default: {
      if (campo.key === "citta" && suggerimentiCitta && onCittaInput && onSelectCitta) {
        return wrapAutoFill(
          <Autocomplete
            {...comune}
            value={String(valore ?? "")}
            onChange={(v) => {
              onChange(v);
              onCittaInput(v);
            }}
            onOptionSubmit={(v) => onSelectCitta(v)}
            onKeyDown={(e) => {
              if (e.key === "Tab" && suggerimentiCitta && suggerimentiCitta.length > 0) {
                const first = suggerimentiCitta[0];
                onChange(first);
                onSelectCitta(first);
              }
            }}
            data={suggerimentiCitta}
            placeholder={campo.placeholder}
            limit={10}
            comboboxProps={{
              withinPortal: true,
              zIndex: 1500,
              position: "bottom-start",
              middlewares: { flip: false, shift: { padding: 8 } },
            }}
          />,
        );
      }
      return wrapAutoFill(
        <TextInput
          {...comune}
          value={String(valore ?? "")}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder={campo.placeholder}
          maxLength={campo.tipo === "cap" ? 5 : campo.tipo === "prov" ? 2 : undefined}
        />,
      );
    }
  }
}, (prev, next) => {
  return (
    prev.valore === next.valore &&
    prev.errore === next.errore &&
    prev.disabled === next.disabled &&
    prev.autoFilled === next.autoFilled &&
    prev.suggerimentiCitta === next.suggerimentiCitta &&
    prev.rifOpzioni === next.rifOpzioni &&
    prev.nomeRecord === next.nomeRecord &&
    prev.campo.key === next.campo.key &&
    prev.campo.tipo === next.campo.tipo &&
    prev.campo.opzioni === next.campo.opzioni
  );
});
