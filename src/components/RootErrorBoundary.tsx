import { Component, type ErrorInfo, type ReactNode } from "react";

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  hasError: boolean;
};

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Application render error", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="grid min-h-screen place-items-center bg-slate-50 px-4">
          <section className="w-full max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
            <h1 className="text-lg font-black">Unable to load Pillybot</h1>
            <p className="mt-2 text-sm font-semibold">
              Please refresh the page. If this keeps happening, verify project environment variables and redeploy.
            </p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
