import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Popover,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconLock,
  IconSend,
  IconSparkles,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import {
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useAnimazioniRidotte } from "../ui/motion";
import { usePremiumAccess, type PremiumAccess } from "./PremiumAccess";

const TESTO_TITOLO = "Funzionalità extra";
const TESTO_MESSAGGIO = "Richiede un pagamento aggiuntivo.";

export function titoloContestualePaywall(title: string, message: string): string {
  const contesto = `${title} ${message}`.toLocaleLowerCase("it");
  if (contesto.includes("scheda cliente")) {
    return "Schede cliente complete, pronte da stampare";
  }
  if (contesto.includes("preventiv")) {
    return "Preventivi pronti da creare e condividere";
  }
  if (contesto.includes("bollettazione")) {
    return "Dal file alle spedizioni, in pochi passaggi";
  }
  if (contesto.includes("sollecit")) {
    return "Solleciti coordinati, senza perdere scadenze";
  }
  if (contesto.includes("centro comunicazioni")) {
    return "Tutte le comunicazioni in un unico centro";
  }
  if (contesto.includes("avvis")) {
    return "Aggiorna più clienti in un solo passaggio";
  }
  return "Più strumenti per il tuo lavoro";
}

export function premiumActionMotion(reduced: boolean, locked: boolean) {
  if (reduced) {
    return {
      hover: undefined,
      tap: undefined,
      transition: { duration: 0 },
    };
  }
  return {
    hover: locked ? { opacity: 0.88, scale: 1.015 } : { scale: 1.015 },
    tap: { scale: 0.985 },
    transition: { duration: locked ? 0.18 : 0.16, ease: "easeOut" as const },
  };
}

export function canRunPremiumAction(access: PremiumAccess): boolean {
  return access.loaded && access.enabled;
}

export interface PremiumActionProps {
  children: ReactNode;
  onAction?: (event: MouseEvent<HTMLButtonElement>) => void;
  leftSection?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  message?: string;
  ariaLabel?: string;
  lockedPresentation?: "popover" | "modal";
  iconOnly?: boolean;
  buttonVariant?: string;
  buttonColor?: string;
  buttonSize?: string;
  showLock?: boolean;
  /** Disabilita temporaneamente l'azione (per esempio durante un salvataggio). */
  disabled?: boolean;
}

/** Modale paywall controllabile per superfici non-button (per esempio le voci
 * dei menu ⋯). Usa lo stesso linguaggio visivo delle azioni Premium esistenti. */
export function PremiumPaywallModal({
  opened,
  onClose,
  title = TESTO_TITOLO,
  message = TESTO_MESSAGGIO,
}: {
  opened: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
}) {
  const reduced = useAnimazioniRidotte();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size={460}
      radius={28}
      overlayProps={{ backgroundOpacity: 0.54, blur: reduced ? 0 : 7 }}
      closeButtonProps={{ "aria-label": "Chiudi", tabIndex: -1 }}
      classNames={{
        content: "pt-premium-modal",
        header: "pt-premium-modal__header",
        title: "pt-premium-modal__title",
        close: "pt-premium-modal__close",
        body: "pt-premium-modal__body",
      }}
      title={
        <Group gap={12} wrap="nowrap">
          <ThemeIcon className="pt-premium-modal__title-icon" radius={14} size={48}>
            <IconSparkles size={23} stroke={1.8} />
          </ThemeIcon>
          <Stack gap={0}>
            <Text className="pt-premium-modal__eyebrow">Strumenti avanzati</Text>
            <Text className="pt-premium-modal__heading">{title}</Text>
          </Stack>
        </Group>
      }
      transitionProps={{
        transition: "pop",
        duration: reduced ? 0 : 300,
        timingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div className="pt-premium-modal__glow" aria-hidden />
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.32, ease: "easeOut" }}
        className="pt-premium-modal__copy"
      >
        <ThemeIcon
          variant="light"
          color="yellow"
          radius="xl"
          size={72}
          mx="auto"
          mb="md"
        >
          <IconLock size={34} stroke={1.7} />
        </ThemeIcon>
        <Text className="pt-premium-modal__message-title">
          {titoloContestualePaywall(title, message)}
        </Text>
        <Text className="pt-premium-modal__message">{message}</Text>
        <div className="pt-premium-modal__accent" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </motion.div>
    </Modal>
  );
}

/**
 * Azione scopribile: quando il PC non è autorizzato non esegue `onAction`, ma
 * resta focalizzabile e spiega il paywall con un popover accessibile.
 */
export function PremiumAction({
  children,
  onAction,
  leftSection,
  className,
  style,
  title = TESTO_TITOLO,
  message = TESTO_MESSAGGIO,
  ariaLabel,
  lockedPresentation = "popover",
  iconOnly = false,
  buttonVariant,
  buttonColor,
  buttonSize,
  showLock = true,
  disabled = false,
}: PremiumActionProps) {
  const access = usePremiumAccess();
  const reduced = useAnimazioniRidotte();
  const [opened, setOpened] = useState(false);
  const locked = !canRunPremiumAction(access);
  const motionState = premiumActionMotion(reduced, locked);

  useEffect(() => {
    if (!locked) setOpened(false);
  }, [locked]);

  const activate = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (locked) {
      event.preventDefault();
      event.stopPropagation();
      setOpened(true);
      return;
    }
    onAction?.(event);
  };

  const indicatoreBlocco = locked && showLock ? (
        <motion.span
          className="pt-premium-action-lock"
          aria-hidden
          animate={
            reduced
              ? undefined
              : opened
                ? { opacity: 1, scale: 1.08, rotate: -6 }
                : { opacity: 0.75, scale: 1, rotate: 0 }
          }
          transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
          style={
            iconOnly
              ? {
                  alignItems: "center",
                  background: "var(--mantine-color-yellow-1)",
                  borderRadius: 99,
                  color: "var(--mantine-color-yellow-8)",
                  display: "inline-flex",
                  height: 15,
                  justifyContent: "center",
                  position: "absolute",
                  right: -5,
                  top: -5,
                  width: 15,
                }
              : { display: "inline-flex" }
          }
        >
          <IconLock size={iconOnly ? 10 : 15} stroke={1.9} />
        </motion.span>
      ) : null;

  const contenutoTrigger = (
    <>
      {leftSection}
      {!iconOnly && <span>{children}</span>}
      {indicatoreBlocco}
    </>
  );

  const trigger = iconOnly ? (
    <ActionIcon
      type="button"
      className={className}
      aria-label={ariaLabel}
      aria-disabled={disabled || locked}
      disabled={disabled}
      data-premium-locked={locked || undefined}
      variant="subtle"
      color="gray"
      size={typeof style?.width === "number" ? style.width : "md"}
      onClick={activate}
      onBlur={
        lockedPresentation === "popover" ? () => setOpened(false) : undefined
      }
      style={{
        cursor: disabled ? "not-allowed" : locked ? "help" : "pointer",
        opacity: disabled || locked ? 0.78 : 1,
        overflow: "visible",
        position: "relative",
        ...style,
      }}
    >
      {contenutoTrigger}
    </ActionIcon>
  ) : buttonVariant ? (
    <Button
      type="button"
      className={className}
      aria-label={ariaLabel}
      aria-disabled={disabled || locked}
      disabled={disabled}
      data-premium-locked={locked || undefined}
      variant={buttonVariant}
      color={buttonColor}
      size={buttonSize}
      leftSection={leftSection}
      rightSection={indicatoreBlocco}
      onClick={activate}
      onBlur={
        lockedPresentation === "popover" ? () => setOpened(false) : undefined
      }
      style={style}
    >
      {children}
    </Button>
  ) : (
    <motion.button
      type="button"
      className={className}
      aria-label={ariaLabel}
      aria-disabled={disabled || locked}
      disabled={disabled}
      data-premium-locked={locked || undefined}
      onClick={activate}
      onBlur={
        lockedPresentation === "popover" ? () => setOpened(false) : undefined
      }
      whileHover={motionState.hover}
      whileTap={motionState.tap}
      transition={motionState.transition}
      style={{
        appearance: "none",
        minHeight: 36,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "7px 12px",
        borderRadius: 8,
        border: "1px solid var(--mantine-color-gray-3)",
        background: "var(--mantine-color-body)",
        color: "var(--mantine-color-text)",
        font: "inherit",
        fontWeight: 600,
        lineHeight: 1.2,
        cursor: disabled ? "not-allowed" : locked ? "help" : "pointer",
        opacity: disabled || locked ? 0.78 : 1,
        transformOrigin: "center",
        willChange: reduced ? undefined : "transform, opacity",
        position: "relative",
        ...style,
      }}
    >
      {contenutoTrigger}
    </motion.button>
  );

  if (lockedPresentation === "modal") {
    return (
      <>
        {trigger}
        <Modal
          opened={locked && opened}
          onClose={() => setOpened(false)}
          centered
          size={460}
          radius={28}
          overlayProps={{
            backgroundOpacity: 0.54,
            blur: reduced ? 0 : 7,
          }}
          closeButtonProps={{ "aria-label": "Chiudi", tabIndex: -1 }}
          classNames={{
            content: "pt-premium-modal",
            header: "pt-premium-modal__header",
            title: "pt-premium-modal__title",
            close: "pt-premium-modal__close",
            body: "pt-premium-modal__body",
          }}
          title={
            <Group gap={12} wrap="nowrap">
              <motion.div
                initial={reduced ? false : { opacity: 0, scale: 0.7, rotate: -14 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ duration: reduced ? 0 : 0.36, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <ThemeIcon
                  className="pt-premium-modal__title-icon"
                  radius={14}
                  size={48}
                >
                  <IconSparkles size={23} stroke={1.8} />
                </ThemeIcon>
              </motion.div>
              <Stack gap={0}>
                <Text className="pt-premium-modal__eyebrow">Strumenti avanzati</Text>
                <Text className="pt-premium-modal__heading">{title}</Text>
              </Stack>
            </Group>
          }
          transitionProps={{
            transition: "pop",
            duration: reduced ? 0 : 300,
            timingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <div className="pt-premium-modal__glow" aria-hidden />
          <motion.div
            initial={reduced ? false : "hidden"}
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: {
                  delayChildren: 0.08,
                  staggerChildren: 0.08,
                },
              },
            }}
          >
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 16, scale: 0.9 },
                visible: {
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  transition: { duration: reduced ? 0 : 0.44, ease: [0.16, 1, 0.3, 1] },
                },
              }}
              className="pt-premium-modal__visual"
            >
              <div className="pt-premium-modal__orbit pt-premium-modal__orbit--outer" />
              <div className="pt-premium-modal__orbit pt-premium-modal__orbit--inner" />
              <motion.div
                className="pt-premium-modal__plane-wrap"
                animate={
                  reduced
                    ? { x: 0, y: 0, rotate: -5 }
                    : {
                        x: [-2, 4, -2],
                        y: [3, -5, 3],
                        rotate: [-7, 1, -7],
                      }
                }
                transition={{
                  duration: 3.6,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <IconSend size={42} stroke={1.65} />
              </motion.div>
              {[0, 1, 2, 3].map((indice) => (
                <motion.span
                  key={indice}
                  aria-hidden
                  className={`pt-premium-modal__spark pt-premium-modal__spark--${indice + 1}`}
                  animate={
                    reduced
                      ? { opacity: 0.82 }
                      : {
                          opacity: [0.25, 1, 0.25],
                          scale: [0.72, 1.12, 0.72],
                          rotate: [0, 16, 0],
                        }
                  }
                  transition={{
                    duration: 2.1 + indice * 0.18,
                    delay: indice * 0.3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                >
                  <IconSparkles size={[21, 15, 13, 10][indice]} stroke={2} />
                </motion.span>
              ))}
            </motion.div>

            <motion.div
              variants={{
                hidden: { opacity: 0, y: 10 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: reduced ? 0 : 0.34, ease: "easeOut" },
                },
              }}
              className="pt-premium-modal__copy"
            >
              <Text className="pt-premium-modal__message-title">
                {titoloContestualePaywall(title, message)}
              </Text>
              <Text className="pt-premium-modal__message">
                {message}
              </Text>
              <div className="pt-premium-modal__accent" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </motion.div>
          </motion.div>
        </Modal>
      </>
    );
  }

  return (
    <Popover
      opened={locked && opened}
      onChange={setOpened}
      position="bottom"
      withArrow
      shadow="md"
      width={260}
      withinPortal
    >
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6} align="center" ta="center">
          <ThemeIcon variant="light" color="yellow" radius="xl" size="lg">
            <IconLock size={18} />
          </ThemeIcon>
          <Text fw={700} size="sm">
            {title}
          </Text>
          <Text c="dimmed" size="xs">
            {message}
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
