import type { ReactNode } from "react";

export function FooterAzioniModale({ children }: { children: ReactNode }) {
  return <div className="pt-modal-footer" style={{ justifyContent: "flex-end" }}>
    <div className="pt-modal-actions">{children}</div>
  </div>;
}
