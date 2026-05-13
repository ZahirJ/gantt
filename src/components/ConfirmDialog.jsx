export default function ConfirmDialog({ message, confirmLabel = "Delete", onConfirm, onCancel, C }) {
  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "24px 28px", minWidth: 280, maxWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
      >
        <div style={{ fontSize: 14, color: C.text, marginBottom: 20, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, padding: "7px 18px", cursor: "pointer", fontSize: 12 }}
          >Cancel</button>
          <button
            onClick={onConfirm}
            style={{ background: C.red, border: "none", color: "#fff", borderRadius: 7, padding: "7px 18px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
