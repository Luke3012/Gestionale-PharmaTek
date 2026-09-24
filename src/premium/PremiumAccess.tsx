import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { RemoteControlStatus } from "../lib/tauri";

export interface PremiumAccess {
  enabled: boolean;
  loaded: boolean;
  fromCache: boolean;
}

const PREMIUM_ACCESS_LOCKED: PremiumAccess = {
  enabled: false,
  loaded: false,
  fromCache: true,
};

const PremiumAccessContext = createContext<PremiumAccess>(PREMIUM_ACCESS_LOCKED);

export function premiumAccessFromStatus(
  status: RemoteControlStatus | null | undefined
): PremiumAccess {
  if (!status) return PREMIUM_ACCESS_LOCKED;
  return {
    // Fail closed anche quando un backend/versione precedente non espone ancora
    // esplicitamente il campo: soltanto il booleano `true` abilita il Premium.
    enabled: status.premiumEnabled === true,
    loaded: true,
    fromCache: status.fromCache,
  };
}

export function PremiumAccessProvider({
  status,
  children,
}: {
  status: RemoteControlStatus | null;
  children: ReactNode;
}) {
  const value = useMemo(() => premiumAccessFromStatus(status), [status]);
  return (
    <PremiumAccessContext.Provider value={value}>
      {children}
    </PremiumAccessContext.Provider>
  );
}

export function usePremiumAccess(): PremiumAccess {
  return useContext(PremiumAccessContext);
}

/** Nasconde completamente schede, box e altre superfici premium. */
export function PremiumOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const access = usePremiumAccess();
  return <>{access.enabled ? children : fallback}</>;
}

export function canOpenPremiumRoute(access: PremiumAccess): boolean {
  return access.loaded && access.enabled;
}
