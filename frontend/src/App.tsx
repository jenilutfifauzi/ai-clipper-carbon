import { Scissors } from "lucide-react";
import { Suspense } from "react";
import { Link, Outlet, useMatch } from "react-router";
import { ThemeToggle } from "./components/ThemeToggle";
import { cx } from "./format";
import { JobSkeleton } from "./pages/job/JobSkeleton";

// The shell every page sits in: the orange blobs the glass blurs, the header, and the page. The
// Job page is wider, for the review's list beside its editor.
export function App() {
  const width = useMatch("/jobs/:jobId") ? "max-w-6xl" : "max-w-4xl";
  return (
    <div className="min-h-dvh font-sans">
      <div aria-hidden className="blobs" />
      <header className={cx("mx-auto flex items-center justify-between gap-4 px-4 pt-5 sm:px-6 sm:pt-6", width)}>
        <Link
          to="/"
          className="-mx-1 inline-flex min-h-11 items-center gap-2.5 rounded-control px-1 text-lg font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-[10px] bg-linear-to-b from-accent to-accent-end text-on-accent shadow-accent"
          >
            <Scissors size={18} strokeWidth={2.5} />
          </span>
          AI Clipper
        </Link>
        <ThemeToggle />
      </header>
      <main className={cx("mx-auto px-4 py-5 sm:px-6 sm:py-8", width)}>
        {/* Only the Job page loads lazily. */}
        <Suspense fallback={<JobSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
