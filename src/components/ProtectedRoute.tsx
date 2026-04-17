import { Navigate, Outlet } from "react-router-dom";
import { Loader } from "./Loader";
import { useAuth } from "../lib/auth";

export function ProtectedRoute() {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50">
        <Loader label="Opening your care workspace" />
      </div>
    );
  }

  if (!user) {
    return <Navigate replace to="/auth" />;
  }

  return <Outlet />;
}
