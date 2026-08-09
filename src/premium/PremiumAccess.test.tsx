import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RemoteControlStatus } from "../lib/tauri";
import {
  canOpenPremiumRoute,
  premiumAccessFromStatus,
  PremiumAccessProvider,
  PremiumOnly,
} from "./PremiumAccess";
import {
  canRunPremiumAction,
  premiumActionMotion,
  titoloContestualePaywall,
} from "./PremiumAction";

function status(premiumEnabled: boolean): RemoteControlStatus {
  return {
    disabled: false,
    message: "",
    updatedAt: "2026-07-23T00:00:00Z",
    fromCache: false,
    premiumEnabled,
  };
}

describe("accesso premium", () => {
  it("resta chiuso finché lo stato firmato non è caricato", () => {
    const access = premiumAccessFromStatus(null);
    expect(access).toEqual({ enabled: false, loaded: false, fromCache: true });
    expect(canOpenPremiumRoute(access)).toBe(false);
  });

  it("resta chiuso se il campo premium manca", () => {
    const senzaPremium = {
      disabled: false,
      message: "",
      updatedAt: "",
      fromCache: true,
    } as RemoteControlStatus;

    expect(premiumAccessFromStatus(senzaPremium).enabled).toBe(false);
  });

  it("espone il contenuto soltanto quando il premium locale è attivo", () => {
    const locked = renderToStaticMarkup(
      <PremiumAccessProvider status={status(false)}>
        <PremiumOnly>
          <span>riservato</span>
        </PremiumOnly>
      </PremiumAccessProvider>
    );
    const unlocked = renderToStaticMarkup(
      <PremiumAccessProvider status={status(true)}>
        <PremiumOnly>
          <span>riservato</span>
        </PremiumOnly>
      </PremiumAccessProvider>
    );

    expect(locked).not.toContain("riservato");
    expect(unlocked).toContain("riservato");
    expect(canOpenPremiumRoute(premiumAccessFromStatus(status(true)))).toBe(true);
  });

  it("reagisce alle variazioni runtime e applica lo stesso gate a rotte e azioni", () => {
    const pending = premiumAccessFromStatus(null);
    const locked = premiumAccessFromStatus(status(false));
    const unlocked = premiumAccessFromStatus(status(true));
    const revoked = premiumAccessFromStatus(status(false));

    expect([pending, locked, unlocked, revoked].map(canOpenPremiumRoute)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect([pending, locked, unlocked, revoked].map(canRunPremiumAction)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it("azzera le micro-animazioni con Riduci animazioni", () => {
    expect(premiumActionMotion(true, true)).toEqual({
      hover: undefined,
      tap: undefined,
      transition: { duration: 0 },
    });
    expect(premiumActionMotion(false, true).hover).toEqual({
      opacity: 0.88,
      scale: 1.015,
    });
  });

  it("adatta il messaggio principale del paywall al contesto", () => {
    expect(
      titoloContestualePaywall(
        "Stampa scheda cliente",
        "Richiede un pagamento aggiuntivo.",
      ),
    ).toContain("Schede cliente");
    expect(
      titoloContestualePaywall(
        "Funzionalità extra",
        "Invio coordinato dei solleciti a più clienti.",
      ),
    ).toContain("Solleciti");
    expect(
      titoloContestualePaywall(
        "Centro comunicazioni",
        "Richiede un pagamento aggiuntivo.",
      ),
    ).toContain("comunicazioni");
  });
});
