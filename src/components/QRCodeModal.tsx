"use client";

import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Copy, Check, Smartphone, ExternalLink } from "lucide-react";

import { copyTextToClipboard } from "@/lib/clipboard";

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomCode: string;
  roomKey?: string;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  isOpen,
  onClose,
  roomCode,
  roomKey,
  showToast,
}) => {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState<string>("");

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;

    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (isLocal) {
      // In local development, fetch the machine's LAN IP so phones on same Wi-Fi can connect
      fetch("/api/network")
        .then((res) => res.json())
        .then((data) => {
          if (data?.networkUrl) {
            setOrigin(data.networkUrl);
          } else {
            setOrigin(window.location.origin);
          }
        })
        .catch(() => setOrigin(window.location.origin));
    } else {
      // In production deployment, use the public domain directly
      setOrigin(window.location.origin);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentOrigin =
    origin || (typeof window !== "undefined" ? window.location.origin : "");
  const keyParam = roomKey ? `&key=${encodeURIComponent(roomKey)}` : "";
  const shareUrl = `${currentOrigin}?code=${encodeURIComponent(roomCode)}${keyParam}`;

  const handleCopyLink = async () => {
    const success = await copyTextToClipboard(shareUrl);
    if (success) {
      setCopied(true);
      showToast("Link copied", "success");
      setTimeout(() => setCopied(false), 2000);
    } else {
      showToast("Failed to copy link", "error");
    }
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
          maxWidth: "380px",
          padding: "20px",
          background: "var(--background)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Smartphone size={18} />
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>Mobile Sync</h3>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: "4px 8px" }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "14px" }}>
          Scan to authorize device for Room <strong>{roomCode}</strong>:
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "16px",
            background: "#ffffff",
            borderRadius: "var(--radius)",
            border: "1px solid var(--card-border)",
            margin: "0 auto 14px auto",
          }}
        >
          <QRCodeSVG value={shareUrl} size={180} level="M" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "var(--gutter-bg)",
              padding: "8px 12px",
              borderRadius: "var(--radius)",
              border: "1px solid var(--card-border)",
              fontSize: "0.78rem",
              fontFamily: "var(--font-mono)",
              wordBreak: "break-all",
              color: "var(--foreground)",
            }}
          >
            <ExternalLink size={14} style={{ flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{shareUrl}</span>
          </div>

          <button onClick={handleCopyLink} className="btn btn-primary" style={{ width: "100%", marginTop: "4px" }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy Mobile URL"}
          </button>
        </div>
      </div>
    </div>
  );
};
