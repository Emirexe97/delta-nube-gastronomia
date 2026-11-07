import { Component, type ErrorInfo, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

export class RouteErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Route rendering failed", error, info); }
  render() {
    if (this.state.error) return <div role="alert" className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><p>No se pudo cargar esta sección. Tus demás secciones siguen disponibles.</p><NavLink className="mt-2 inline-block font-semibold underline" to="/resumen">Volver a Resumen</NavLink></div>;
    return this.props.children;
  }
}
