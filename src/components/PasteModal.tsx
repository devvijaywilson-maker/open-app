"use client";

import React, { useState, useEffect, useRef } from "react";
import { ClipboardPaste, X } from "lucide-react";

interface PasteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (text: string, replaceAll: boolean) => void;
}

export const PasteModal: React.FC<PasteModalProps> = ({
  isOpen,
  onClose,
  onInsert,
}) => {
  const [content, setContent] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setContent("");
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mono-card"
        style={{
          maxWidth: "520px",
          width: "100%",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "0.95rem" }}>
            <ClipboardPaste size={16} />
            <span>Paste Code / Text</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              padding: "4px",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Paste your code or text below using <strong>Ctrl+V / Cmd+V</strong>:
        </p>

        <textarea
          ref={inputRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste content here..."
          className="input-field"
          style={{
            minHeight: "180px",
            fontFamily: "var(--font-mono)",
            fontSize: "0.85rem",
            lineHeight: 1.5,
            resize: "vertical",
            whiteSpace: "pre",
          }}
        />

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            Cancel
          </button>
          <button
            onClick={() => {
              if (content) {
                onInsert(content, false);
                onClose();
              }
            }}
            disabled={!content.trim()}
            className="btn btn-secondary btn-sm"
          >
            Insert at Cursor
          </button>
          <button
            onClick={() => {
              if (content) {
                onInsert(content, true);
                onClose();
              }
            }}
            disabled={!content.trim()}
            className="btn btn-primary btn-sm"
          >
            Replace All
          </button>
        </div>
      </div>
    </div>
  );
};
