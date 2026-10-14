import { lazy, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App } from "./App";
import "./index.css";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { applyTheme, storedTheme } from "./theme";

// The Job page (its review, editor and timeline) is most of the code: it loads when first opened,
// so that Home shows without it. App holds its skeleton meanwhile.
const JobPage = lazy(() => import("./pages/JobPage").then((module) => ({ default: module.JobPage })));

const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: "jobs/:jobId", element: <JobPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

// The page itself was themed before paint; this brings the browser chrome (theme-color) along.
applyTheme(storedTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
