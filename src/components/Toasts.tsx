import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useToastStore } from "../store";

export function Toasts() {
  const { toasts, dismissToast } = useToastStore();
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? TriangleAlert : Info;
        return (
          <div key={t.id} className={`toast ${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            <Icon className="ic" />
            <span className="grow">{t.text}</span>
            {t.action && (
              <button
                className="btn ghost sm"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="btn plain icon sm" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              <X className="ic" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
