import type { ReactNode } from "react";

type NoticeProps = {
  type?: "error" | "success" | "info";
  children: ReactNode;
};

const styles = {
  error: "border-rose-200 bg-rose-50 text-rose-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
};

export function Notice({ type = "info", children }: NoticeProps) {
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${styles[type]}`}>
      {children}
    </div>
  );
}
