import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Loader } from "./components/Loader";
import { ProtectedRoute } from "./components/ProtectedRoute";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const AddMedicationPage = lazy(() => import("./pages/AddMedicationPage"));
const VerifyPage = lazy(() => import("./pages/VerifyPage"));
const ParsePrescriptionPage = lazy(() => import("./pages/ParsePrescriptionPage"));
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
const CaregiverPage = lazy(() => import("./pages/CaregiverPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-slate-50">
          <Loader label="Loading Pillybot" />
        </div>
      }
    >
      <Routes>
        <Route element={<AuthPage />} path="/auth" />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route element={<DashboardPage />} index />
            <Route element={<AddMedicationPage />} path="/add" />
            <Route element={<VerifyPage />} path="/verify" />
            <Route element={<ParsePrescriptionPage />} path="/parse" />
            <Route element={<AlertsPage />} path="/alerts" />
            <Route element={<CaregiverPage />} path="/caregiver" />
            <Route element={<SettingsPage />} path="/settings" />
          </Route>
        </Route>
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </Suspense>
  );
}
