import { Link } from "react-router";
import { Panel } from "../components/Panel";

export function NotFound() {
  return (
    <Panel>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-3 inline-block text-accent-text hover:underline">
        Back to the Jobs
      </Link>
    </Panel>
  );
}
