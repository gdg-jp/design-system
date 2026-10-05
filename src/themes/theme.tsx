import { Monitor, Moon, Sun } from "lucide-react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { type ComponentProps, useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../components/DropdownMenu";
import { IconButton } from "../components/IconButton";
import { TooltipProvider } from "../components/Tooltip";

export { useTheme };
export type ThemeProviderProps = Pick<
  ComponentProps<typeof NextThemeProvider>,
  "children" | "nonce" | "forcedTheme" | "storageKey" | "defaultTheme"
>;

export function ThemeProvider({
  children,
  storageKey = "gdg-apps-theme",
  defaultTheme = "system",
  ...props
}: ThemeProviderProps) {
  useEffect(() => {
    const key = () => {
      document.documentElement.dataset.gdgInput = "keyboard";
    };
    const pointer = () => {
      document.documentElement.dataset.gdgInput = "pointer";
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", pointer, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", pointer, true);
    };
  }, []);
  return (
    <NextThemeProvider
      {...props}
      attribute="class"
      storageKey={storageKey}
      defaultTheme={defaultTheme}
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={400} skipDelayDuration={300}>
        {children}
      </TooltipProvider>
    </NextThemeProvider>
  );
}

export function ThemeToggle({
  "aria-label": label = "配色",
  className,
}: { "aria-label"?: string; className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={label}
          className={className}
          variant="ghost"
          size="sm"
          disabled={!mounted}
        >
          {mounted && resolvedTheme === "dark" ? (
            <Moon size={16} aria-hidden="true" />
          ) : (
            <Sun size={16} aria-hidden="true" />
          )}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={mounted ? theme : "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun size={16} aria-hidden="true" />
            ライト
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon size={16} aria-hidden="true" />
            ダーク
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor size={16} aria-hidden="true" />
            システム
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
