"use client";

import React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  text: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.type === "success" && (
            <CheckCircle2 size={18} className="text-emerald-400" style={{ color: "#10b981" }} />
          )}
          {t.type === "error" && (
            <AlertCircle size={18} className="text-rose-400" style={{ color: "#f43f5e" }} />
          )}
          {t.type === "info" && (
            <Info size={18} className="text-cyan-400" style={{ color: "#00f2fe" }} />
          )}
          <span>{t.text}</span>
          <button
            onClick={() => onDismiss(t.id)}
            style={{
              background: "none",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              marginLeft: "auto",
              padding: "2px",
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};
