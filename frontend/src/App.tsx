import { Scissors } from "lucide-react";
import { Link, Outlet } from "react-router";

// The shell every page sits in.
export function App() {
  return (
    <div className="min-h-dvh font-sans">
      <header className="mx-auto flex max-w-4xl items-center px-4 pt-6 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-accent text-on-accent">
            <Scissors size={18} strokeWidth={2.5} />
          </span>
          AI Clipper
        </Link>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
