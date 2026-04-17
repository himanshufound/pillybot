import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";
import { Link } from "react-router-dom";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-slate-950 text-white shadow-[0_16px_40px_rgba(15,23,42,0.18)] hover:-translate-y-0.5 hover:bg-slate-800",
  secondary: "bg-white/80 text-slate-950 ring-1 ring-slate-200 hover:-translate-y-0.5 hover:bg-white",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  variant?: Variant;
};

const base =
  "inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50";

export function Button({ className = "", variant = "primary", ...props }: ButtonProps) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function LinkButton({ className = "", to, variant = "primary", ...props }: LinkButtonProps) {
  return <Link className={`${base} ${variants[variant]} ${className}`} to={to} {...props} />;
}
