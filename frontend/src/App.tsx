import { Scissors } from "lucide-react";
import { Link, Outlet, useMatch } from "react-router";
import { cx } from "./format";

// The shell every page sits in. The Job page is wider, for the review's list beside its editor.
export function App() {
  const width = useMatch("/jobs/:jobId") ? "max-w-6xl" : "max-w-4xl";
  return (
    <div className="min-h-dvh font-sans">
      <header className={cx("mx-auto flex items-center px-4 pt-6 sm:px-6", width)}>
        <Link to="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-accent text-on-accent">
            <Scissors size={18} strokeWidth={2.5} />
          </span>
          AI Clipper
        </Link>
      </header>
      <main className={cx("mx-auto px-4 py-6 sm:px-6 sm:py-8", width)}>
        <Outlet />
      </main>
    </div>
  );
}
