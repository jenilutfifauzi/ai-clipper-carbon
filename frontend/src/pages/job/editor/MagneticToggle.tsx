import { Magnet } from "lucide-react";
import { Button } from "../../../components/Button";
import { setMagnetic, useMagnetic } from "./magnetic";

const TITLE = "Magnetic timeline: deleting, trimming or inserting Segments moves the layers with them";

/** The Magnetic timeline's switch, for a Timeline's bar: lit while it is on. */
export function MagneticToggle() {
  const on = useMagnetic();
  return (
    <Button variant="ghost" size="icon" className="aria-pressed:text-accent-text" onClick={() => setMagnetic(!on)} aria-pressed={on} aria-label="Magnetic timeline" title={TITLE}>
      <Magnet aria-hidden size={17} />
    </Button>
  );
}
