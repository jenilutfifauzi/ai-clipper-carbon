import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { renderedTheme, toggleTheme, watchTheme, type Theme } from "../theme";
import { Button } from "./Button";

// The header's light/dark switch. Its icon is the theme on screen; its label, the one it switches to.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(renderedTheme);
  useEffect(() => watchTheme(() => setTheme(renderedTheme())), []);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(toggleTheme())}
      size="icon"
    >
      {theme === "dark" ? <Moon aria-hidden size={19} /> : <Sun aria-hidden size={19} />}
    </Button>
  );
}
