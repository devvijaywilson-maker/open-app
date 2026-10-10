"use client";

import React, { useState } from "react";
import { Shield, KeyRound, Clock, Flame, X, Check } from "lucide-react";

interface SecuritySettingsProps {
  isOpen: boolean;
  onClose: () => void;
  pin: string;
  onPinChange: (newPin: string) => void;
  expiryMinutes: number;
  onExpiryChange: (mins: number) => void;
  selfDestruct: boolean;
  onSelfDestructChange: (val: boolean) => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const SecuritySettingsModal: React.FC<SecuritySettingsProps> = ({
  isOpen,
  onClose,
  pin,
  onPinChange,
  expiryMinutes,
  onExpiryChange,
  selfDestruct,
  onSelfDestructChange,
  showToast,
}) => {
  const [tempPin, setTempPin] = useState(pin);
  const [tempExpiry, setTempExpiry] = useState(expiryMinutes);
  const [tempSelfDestruct, setTempSelfDestruct] = useState(selfDestruct);

  if (!isOpen) return null;

  const handleSave = () => {
    onPinChange(tempPin);
    onExpiryChange(tempExpiry);
    onSelfDestructChange(tempSelfDestruct);
    showToast("Settings applied", "success");
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        className="mono-card"
        style={{
          width: "100%",
          maxWidth: "400px",
          padding: "20px",
          background: "var(--background)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Shield size={18} />
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>Room Security</h3>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: "4px 8px" }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.82rem", fontWeight: 600, marginBottom: "6px" }}>
              <KeyRound size={14} /> Passcode (Optional)
            </label>
            <input
              type="password"
              className="input-field"
              placeholder="e.g. 4-digit PIN"
              value={tempPin}
              onChange={(e) => setTempPin(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.82rem", fontWeight: 600, marginBottom: "6px" }}>
              <Clock size={14} /> Auto Expiry
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
              {[
                { label: "15m", val: 15 },
                { label: "1h", val: 60 },
                { label: "24h", val: 1440 },
                { label: "Never", val: 0 },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  className={`btn btn-sm ${tempExpiry === opt.val ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setTempExpiry(opt.val)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              background: "var(--gutter-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: "var(--radius)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Flame size={16} />
              <div>
                <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>Burn After Read</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Erase room after first retrieval</div>
              </div>
            </div>
            <input
              type="checkbox"
              style={{ width: "16px", height: "16px", cursor: "pointer" }}
              checked={tempSelfDestruct}
              onChange={(e) => setTempSelfDestruct(e.target.checked)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
            <button onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button onClick={handleSave} className="btn btn-primary">
              <Check size={14} /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
