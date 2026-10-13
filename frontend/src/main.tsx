import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App } from "./App";
import "./index.css";
import { Home } from "./pages/Home";
import { JobPage } from "./pages/JobPage";
import { NotFound } from "./pages/NotFound";
import { applyTheme, storedTheme } from "./theme";

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
