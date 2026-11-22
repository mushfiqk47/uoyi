import { useMemo, useState } from "react";
import { Check, Copy, LayoutTemplate, Pencil, Save, Search, Sparkles, Star, Trash2 } from "lucide-react";
import type { Project } from "../../lib/types";
import { useStore } from "../../store";
import { Field, Modal } from "../../components/ui";
import { missingPremadeTemplates } from "../../lib/templates";
import { Section } from "./shared";

export function TemplatesPanel({ project }: { project: Project }) {
  const { templates, saveTemplate, applyTemplate, restorePremadeTemplates, updateTemplate, overwriteTemplate, duplicateTemplate, deleteTemplate, settings, updateSettings, toast } = useStore();
  const [q, setQ] = useState("");
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const missingCount = useMemo(() => missingPremadeTemplates(templates).length, [templates]);
  const shown = templates
    .filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);

  return (
    <>
      <Section
        title="Templates"
        wide
        aside={
          <div className="row">
            {missingCount > 0 && (
              <button
                className="btn ghost sm"
                onClick={() => {
                  const n = restorePremadeTemplates();
                  if (n > 0) toast(`Added ${n} premade template${n === 1 ? "" : "s"}`, "success");
                }}
              >
                <Sparkles className="ic" /> Add premade
              </button>
            )}
            <button className="btn accent sm" onClick={() => setNaming({ id: null, name: project.name || "New template" })}>
              <Save className="ic" /> Save look
            </button>
          </div>
        }
      >
        <p className="insp-help">One-click viral layouts, caption styles, and hooks. Save your own look or pick a premade preset below.</p>
        {templates.length > 3 && (
          <label className="search">
            <Search className="ic" />
            <input className="input" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search templates" />
          </label>
        )}
      </Section>
      <Section title={`Looks (${shown.length})`} wide>
        {templates.length === 0 ? (
          <div className="tpl-empty">
            <LayoutTemplate className="ic" />
            <span>No templates yet</span>
          </div>
        ) : (
          <div className="tpl-list">
            {shown.map((t) => (
              <div key={t.id} className={`tpl-item${project.templateId === t.id ? " on" : ""}`}>
                <div className="tpl-swatch" data-mode={t.layout.mode} style={{ ["--hl" as string]: t.captionStyle.highlight }}>
                  <i />
                  <b />
                </div>
                <div className="grow tpl-text">
                  <b>{t.name}</b>
                  <small>
                    {t.layout.mode === "split" ? "Facecam + game" : t.layout.mode === "fit" ? "Fit" : "Fill"}
                    {` · ${t.captionStyle.font === "bebas" ? "Bebas" : t.captionStyle.font === "tiktok" ? "TikTok" : "Inter"}`}
                    {t.overlay.platform !== "off" && ` · ${t.overlay.platform === "tiktok" ? "TikTok" : t.overlay.platform === "shorts" ? "Shorts" : "Reels"}`}
                    {settings.defaultTemplateId === t.id && " · Default"}
                  </small>
                </div>
                <button className={`btn plain icon sm star${t.favorite ? " on" : ""}`} aria-pressed={t.favorite} aria-label="Favourite" onClick={() => updateTemplate(t.id, { favorite: !t.favorite })}>
                  <Star className="ic" />
                </button>
                <div className="tpl-actions">
                  <button className="btn ghost sm" onClick={() => { applyTemplate(t.id); toast(`Applied “${t.name}”`, "success"); }}>
                    <Check className="ic" /> Apply
                  </button>
                  <button className="btn plain icon sm" title="Overwrite with this project's look" aria-label="Overwrite" onClick={() => { overwriteTemplate(t.id); toast(`Updated “${t.name}”`, "success"); }}>
                    <Save className="ic" />
                  </button>
                  <button className="btn plain icon sm" title="Rename" aria-label="Rename" onClick={() => setNaming({ id: t.id, name: t.name })}>
                    <Pencil className="ic" />
                  </button>
                  <button className="btn plain icon sm" title="Duplicate" aria-label="Duplicate" onClick={() => duplicateTemplate(t.id)}>
                    <Copy className="ic" />
                  </button>
                  <button
                    className="btn plain sm"
                    title="Use for every new clip"
                    onClick={() => updateSettings({ defaultTemplateId: settings.defaultTemplateId === t.id ? null : t.id })}
                  >
                    {settings.defaultTemplateId === t.id ? "Unset default" : "Set default"}
                  </button>
                  <button className="btn plain icon sm" title="Delete" aria-label="Delete" onClick={() => setConfirmDelete(t.id)}>
                    <Trash2 className="ic" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      {naming && (
        <Modal
          title={naming.id ? "Rename template" : "Save as a template"}
          onClose={() => setNaming(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setNaming(null)}>Cancel</button>
              <button
                className="btn accent"
                disabled={!naming.name.trim()}
                onClick={() => {
                  const name = naming.name.trim().slice(0, 60);
                  if (naming.id) updateTemplate(naming.id, { name });
                  else {
                    saveTemplate(name);
                    toast(`Saved “${name}”`, "success");
                  }
                  setNaming(null);
                }}
              >
                Save
              </button>
            </>
          }
        >
          <Field label="Name">
            <input className="input" autoFocus value={naming.name} maxLength={60} onChange={(e) => setNaming({ ...naming, name: e.target.value })} />
          </Field>
        </Modal>
      )}
      {confirmDelete && (
        <Modal
          title="Delete this template?"
          description="Projects that used it keep their look."
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Keep it</button>
              <button className="btn danger" onClick={() => { deleteTemplate(confirmDelete); setConfirmDelete(null); }}>Delete</button>
            </>
          }
        />
      )}
    </>
  );
}
