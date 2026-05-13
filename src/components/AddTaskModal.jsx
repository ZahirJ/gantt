import { useState } from "react";

const SIZE_DAYS_MAP = { S: "1", M: "3", L: "5", XL: "10" };
const TASK_STATUSES = ["Open", "In Progress", "Open(May not need fix)"];

export default function AddTaskModal({ initialSerial, resources, rawTasks, categories, C, onSubmit, onClose }) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState({
    serial: initialSerial,
    description: "",
    category: "",
    days: "3",
    complexity: "M",
    dependsOn: "",
    status: "Open",
    assignee: "",
    integrationEffort: "",
    daysManuallySet: false,
  });
  const [error, setError] = useState("");

  function set(key, val) {
    setDraft(d => ({ ...d, [key]: val }));
  }

  function handleNext() {
    if (step === 1 && !draft.description.trim()) {
      setError("Description is required.");
      return;
    }
    if (step === 2 && (parseInt(draft.days) < 1 || !parseInt(draft.days))) {
      setError("Days must be a positive number.");
      return;
    }
    setError("");
    setStep(s => s + 1);
  }

  function handleBack() {
    setError("");
    setStep(s => s - 1);
  }

  const existingSerials = rawTasks.map(t => t["Serial Number"]);
  const filteredCategories = categories.filter(c => c !== "All");

  const inputStyle = {
    background: C.inputBg, border: `1px solid ${C.border}`, color: C.text,
    borderRadius: 8, padding: "8px 12px", fontSize: 13, width: "100%", boxSizing: "border-box",
  };
  const labelStyle = {
    fontSize: 10, letterSpacing: 2, color: C.muted, marginBottom: 6,
    fontFamily: "'DM Mono', monospace", display: "block",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1001, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, width: 440, maxWidth: "90vw", boxShadow: "0 16px 48px rgba(0,0,0,0.4)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>Add Task</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Step {step} of 3</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Progress bar */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: s <= step ? C.accent : C.border, transition: "background 0.2s" }} />
          ))}
        </div>

        {/* Step 1: Identity */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>SERIAL NUMBER</label>
              <div style={{ ...inputStyle, color: C.muted, userSelect: "none", cursor: "default" }}>{draft.serial}</div>
            </div>
            <div>
              <label style={labelStyle}>DESCRIPTION *</label>
              <input
                autoFocus
                style={inputStyle}
                value={draft.description}
                onChange={e => set("description", e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleNext()}
                placeholder="What needs to be done?"
              />
            </div>
            <div>
              <label style={labelStyle}>CATEGORY</label>
              <input
                list="atm-category-list"
                style={inputStyle}
                value={draft.category}
                onChange={e => set("category", e.target.value)}
                placeholder="e.g. Backend, Frontend…"
              />
              <datalist id="atm-category-list">
                {filteredCategories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>
        )}

        {/* Step 2: Scheduling */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>DAYS *</label>
                <input
                  autoFocus
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
              <label style={labelStyle}>DEPENDS ON</label>
              <input
                list="atm-sn-list"
                style={inputStyle}
                value={draft.dependsOn}
                onChange={e => set("dependsOn", e.target.value)}
                placeholder="Comma-separated serial numbers"
              />
              <datalist id="atm-sn-list">
                {existingSerials.map(sn => <option key={sn} value={sn} />)}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>STATUS</label>
              <select style={inputStyle} value={draft.status} onChange={e => set("status", e.target.value)}>
                {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Step 3: Assignment & Review */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>ASSIGNEE</label>
              <select autoFocus style={inputStyle} value={draft.assignee} onChange={e => set("assignee", e.target.value)}>
                <option value="">— unassigned</option>
                {resources.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
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
            {/* Summary card */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 11, color: C.muted, lineHeight: 1.9 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: C.muted, marginBottom: 6, letterSpacing: 2 }}>SUMMARY</div>
              <div><span style={{ color: C.text, fontFamily: "'DM Mono', monospace" }}>#{draft.serial}</span>&ensp;{draft.description}</div>
              {draft.category && <div>Category: <span style={{ color: C.text }}>{draft.category}</span></div>}
              <div>Days: <span style={{ color: C.text }}>{draft.days}</span> · Complexity: <span style={{ color: C.text }}>{draft.complexity}</span></div>
              {draft.dependsOn && <div>Depends on: <span style={{ color: C.text, fontFamily: "'DM Mono', monospace" }}>{draft.dependsOn}</span></div>}
              <div>Status: <span style={{ color: C.text }}>{draft.status}</span></div>
            </div>
          </div>
        )}

        {/* Inline error */}
        {error && <div style={{ fontSize: 11, color: C.red, marginTop: 12 }}>{error}</div>}

        {/* Navigation */}
        <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "flex-end" }}>
          {step > 1 && (
            <button
              onClick={handleBack}
              style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "7px 18px", cursor: "pointer", fontSize: 12 }}
            >Back</button>
          )}
          {step < 3 ? (
            <button
              onClick={handleNext}
              style={{ background: C.accent, border: "none", color: "#fff", borderRadius: 8, padding: "7px 18px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >Next</button>
          ) : (
            <button
              onClick={() => onSubmit(draft)}
              style={{ background: C.green, border: "none", color: "#fff", borderRadius: 8, padding: "7px 18px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >Add Task</button>
          )}
        </div>
      </div>
    </div>
  );
}
