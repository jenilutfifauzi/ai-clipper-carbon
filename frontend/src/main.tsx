import { lazy, StrictMode, Suspense, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App } from "./App";
import { ClerkProvider, SignInButton, useAuth } from "@clerk/react";
import { Scissors } from "lucide-react";
import { setClerkTokenProvider } from "./api";
import "./index.css";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { SettingsPage } from "./pages/SettingsPage";
import { applyTheme, storedTheme } from "./theme";

// The Job page (its review, editor and timeline) is most of the code: it loads when first opened,
// so that Home shows without it. App holds its skeleton meanwhile.
const JobPage = lazy(() => import("./pages/JobPage").then((module) => ({ default: module.JobPage })));
// The Advanced Edit is full screen, outside the shell, and loads when first opened.
const AdvancedEditPage = lazy(() =>
  import("./pages/job/advanced/AdvancedEdit").then((module) => ({ default: module.AdvancedEditPage })),
);

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "jobs/:jobId", element: <JobPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  {
    path: "jobs/:jobId/candidates/:candidateId/advanced",
    element: (
      <Suspense fallback={null}>
        <AdvancedEditPage />
      </Suspense>
    ),
  },
]);

function SignedOutWelcome() {
  return (
    <div className="relative min-h-dvh font-sans">
      <div aria-hidden className="blobs" />
      <header className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 pt-5 sm:px-6 sm:pt-6">
        <div className="inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight text-text">
          <span aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-linear-to-b from-accent to-accent-end text-on-accent shadow-accent">
            <Scissors size={18} strokeWidth={2.5} />
          </span>
          AI Clipper
        </div>
        <div className="flex items-center gap-2">
          <SignInButton mode="modal">
            <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-control px-3 text-sm font-medium text-muted hover:bg-fill hover:text-text">
              Masuk
            </button>
          </SignInButton>
        </div>
      </header>
      <main className="mx-auto grid max-w-4xl gap-8 px-4 py-12 sm:grid-cols-2 sm:items-center sm:px-6 sm:py-20">
        <section>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">AI Clipper</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text sm:text-4xl">Masuk untuk melanjutkan</h1>
          <p className="mt-4 max-w-prose text-base leading-7 text-muted">
            Autentikasi dikelola oleh Clerk. Minta akses akun kepada administrator aplikasi untuk mulai.
          </p>
        </section>
        <section className="rounded-2xl bg-fill/80 p-6 shadow-xl backdrop-blur sm:p-8">
          <h2 className="text-base font-semibold text-text">Data akun</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Data baru dipisahkan untuk setiap akun. Data lama belum ditetapkan ke akun mana pun dan tidak akan dipindahkan otomatis.
          </p>
        </section>
      </main>
    </div>
  );
}

function ClerkRoot() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  useLayoutEffect(() => {
    setClerkTokenProvider(() => getToken());
    return () => setClerkTokenProvider(null);
  }, [getToken]);

  if (!isLoaded) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted" role="status">Memuat sesi…</div>;
  }
  return isSignedIn ? <RouterProvider router={router} /> : <SignedOutWelcome />;
}

// The page itself was themed before paint; this brings the browser chrome (theme-color) along.
applyTheme(storedTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
      <ClerkRoot />
    </ClerkProvider>
  </StrictMode>,
);
