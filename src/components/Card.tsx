import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[2rem] border border-white/70 bg-white/78 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.08)] backdrop-blur ${className}`}
      {...props}
    />
  );
}
