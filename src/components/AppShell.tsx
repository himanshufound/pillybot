import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "./Button";
import { signOut } from "../lib/supabase";

const navItems = [
  { to: "/", label: "Today" },
  { to: "/add", label: "Add" },
  { to: "/verify", label: "Verify" },
  { to: "/parse", label: "Parse" },
  { to: "/alerts", label: "Alerts" },
  { to: "/caregiver", label: "Caregiver" },
  { to: "/settings", label: "Settings" },
];

export function AppShell() {
  const navigate = useNavigate();

  async function handleSignOut() {
    try {
      await signOut();
    } catch (error) {
      // Surface to console; the navigation below still kicks the user
      // out of the protected shell so the local session is unusable.
      console.error("Sign out failed", error);
    }
    navigate("/auth", { replace: true });
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_8%_8%,rgba(20,184,166,0.18),transparent_28%),radial-gradient(circle_at_90%_12%,rgba(251,191,36,0.16),transparent_24%),linear-gradient(135deg,#f8fafc,#eef7f4_48%,#fff7ed)] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/65 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-4">
            <NavLink to="/" className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 font-black text-white shadow-lg">
                P
              </span>
              <span>
                <span className="block text-lg font-black tracking-tight">Pillybot</span>
                <span className="block text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
                  Care console
                </span>
              </span>
            </NavLink>
            <Button className="lg:hidden" onClick={handleSignOut} type="button" variant="ghost">
              Sign out
            </Button>
          </div>

          <nav className="flex gap-2 overflow-x-auto rounded-full bg-white/70 p-1 ring-1 ring-slate-200">
            {navItems.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition ${
                    isActive ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white"
                  }`
                }
                end={item.to === "/"}
                key={item.to}
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <Button className="hidden lg:inline-flex" onClick={handleSignOut} type="button" variant="secondary">
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
