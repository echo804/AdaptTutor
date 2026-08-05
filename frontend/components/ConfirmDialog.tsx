"use client";

import { useEffect } from "react";

/** 站内确认弹窗（M4r15）：替换浏览器原生 confirm——原生 confirm 在暗色主题下是黑底，与站点风格割裂。
 * 复古毛玻璃风：半透明深色遮罩 + 玻璃卡片 + 琥珀主按钮，随主题变量联动。
 */

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmText = "确认删除",
  cancelText = "取消",
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Esc 取消 + 焦点管理
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(10,15,30,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl animate-fade"
        style={{
          background: "rgba(250,250,249,0.92)",
          borderColor: "var(--border)",
          backdropFilter: "blur(12px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-full px-4 py-1.5 text-sm transition-opacity hover:opacity-80"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            className="rounded-full px-4 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              background: danger ? "#b3543c" : "var(--accent)",
              color: "#fff",
            }}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
