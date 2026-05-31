import { useState } from "react";

const SIZE_DAYS_MAP = { S: "1", M: "3", L: "5", XL: "10" };
const TASK_STATUSES = ["Open", "In Progress", "Completed", "Open(May not need fix)"];

export default function EditTaskModal({ task, fixedStartDate, resources, rawTasks, categories, C, onSubmit, onClose }) {
  const [draft, setDraft] = useState({
    description: task["Description"] || "",
    category: task["Category"] || "",
    days: String(task["Days"] || "1"),
    complexity: task["Complexity"] || "M",
    dependsOn: task["Depends On"] || "",
    status: task["Status"] || "Open",
    assignee: task["Assignee"] || "",
    integrationEffort: task["Integration Effort"] || "",
    fixedStartDate: fixedStartDate || "",
    daysManuallySet: false,
  });
  const [error, setError] = useState("");

  function set(key, val) {
    setDraft(d => ({ ...d, [key]: val }));
  }

  const otherSerials = rawTasks
    .filter(t => t["Serial Number"] !== task["Serial Number"])
    .map(t => t["Serial Number"]);
  const filteredCategories = categories.filter(c => c !== "All");

  const inputStyle = {
    background: C.inputBg, border: `1px solid ${C.border}`, color: C.text,
    borderRadius: 8, padding: "8px 12px", fontSize: 13, width: "100%", boxSizing: "border-box",
  };
  const labelStyle = {
    fontSize: 10, letterSpacing: 2, color: C.muted, marginBottom: 6,
    fontFamily: "'DM Mono', monospace", display: "block",
  };

  function handleSubmit() {
    if (!draft.description.trim()) { setError("Description is required."); return; }
    if (!parseInt(draft.days) || parseInt(draft.days) < 1) { setError("Days must be a positive number."); return; }
    onSubmit(task["Serial Number"], draft);
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1001, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, width: 440, maxWidth: "90vw", boxShadow: "0 16px 48px rgba(0,0,0,0.4)", maxHeight: "90vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>Edit Task</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2, fontFamily: "'DM Mono', monospace" }}>#{task["Serial Number"]}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>DESCRIPTION *</label>
            <input
              autoFocus
              style={inputStyle}
              value={draft.description}
              onChange={e => set("description", e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="What needs to be done?"
            />
          </div>

          <div>
            <label style={labelStyle}>CATEGORY</label>
            <input
              list="etm-category-list"
              style={inputStyle}
              value={draft.category}
              onChange={e => set("category", e.target.value)}
              placeholder="e.g. Backend, Frontend…"
            />
            <datalist id="etm-category-list">
              {filteredCategories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>DAYS *</label>
              <input
                type="number" min={1}
                style={inputStyle}
                value={draft.days}
                onChange={e => setDraft(d => ({ ...d, days: e.target.value, daysManuallySet: true }))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>COMPLEXITY</label>
              <select
                style={inputStyle}
                value={draft.complexity}
                onChange={e => {
                  const c = e.target.value;
                  setDraft(d => ({ ...d, complexity: c, days: d.daysManuallySet ? d.days : SIZE_DAYS_MAP[c] || d.days }));
                }}
              >
                {["S", "M", "L", "XL"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>STATUS</label>
            <select style={inputStyle} value={draft.status} onChange={e => set("status", e.target.value)}>
              {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>DEPENDS ON</label>
            <input
              list="etm-sn-list"
              style={inputStyle}
              value={draft.dependsOn}
              onChange={e => set("dependsOn", e.target.value)}
              placeholder="Comma-separated serial numbers"
            />
            <datalist id="etm-sn-list">
              {otherSerials.map(sn => <option key={sn} value={sn} />)}
            </datalist>
          </div>

          <div>
            <label style={labelStyle}>ASSIGNEE</label>
            <select style={inputStyle} value={draft.assignee} onChange={e => set("assignee", e.target.value)}>
              <option value="">— unassigned</option>
              {resources.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>FIXED START DATE <span style={{ fontSize: 9, color: C.muted, letterSpacing: 0, textTransform: "none" }}>(optional — task will not start before this date)</span></label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="date"
                style={{ ...inputStyle, flex: 1 }}
                value={draft.fixedStartDate}
                onChange={e => set("fixedStartDate", e.target.value)}
              />
              {draft.fixedStartDate && (
                <button
                  onClick={() => set("fixedStartDate", "")}
                  style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}
                >Clear</button>
              )}
            </div>
          </div>

          <div>
            <label style={labelStyle}>INTEGRATION EFFORT</label>
            <input
              style={inputStyle}
              value={draft.integrationEffort}
              onChange={e => set("integrationEffort", e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        {error && <div style={{ fontSize: 11, color: C.red, marginTop: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "7px 18px", cursor: "pointer", fontSize: 12 }}
          >Cancel</button>
          <button
            onClick={handleSubmit}
            style={{ background: C.accent, border: "none", color: "#fff", borderRadius: 8, padding: "7px 18px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
          >Save Changes</button>
        </div>
      </div>
    </div>
  );
}
