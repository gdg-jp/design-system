import {
  Button,
  IconButton,
  Icons,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ThemeProvider,
} from "@gdgjp/design-system";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(
  <ThemeProvider>
    <main className="bg-background text-foreground p-8">
      <h1>Tailwind CSS contract</h1>
      <Button className="rounded-xl px-8">utility override</Button>
      <div data-testid="accent" className="bg-gdg-yellow text-black">
        GDG Yellow
      </div>
      <div data-testid="secondary" className="bg-secondary text-secondary-foreground">
        Muted blue secondary
      </div>
      <div data-testid="bare-border" className="border p-4">
        bare
      </div>
      <div data-testid="deliberate-border" className="border-2 border-foreground p-4">
        deliberate
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-2" data-testid="compact-controls">
        <Input className="h-8 w-32" aria-label="Compact input" />
        <Select defaultValue="long">
          <SelectTrigger className="h-8 w-32" aria-label="Compact selection">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="long">非常に長い日本語のチャプター名</SelectItem>
          </SelectContent>
        </Select>
        <Textarea rows={2} className="w-32" aria-label="Two lines" />
        <IconButton size="sm" aria-label="Compact icon">
          <Icons name="Heart" className="size-3" />
        </IconButton>
        <Icons name="AlertCircle" size={18} data-testid="sized-icon" />
      </div>
      <div className="w-64 space-y-2" data-testid="labelled-input">
        <Label htmlFor="destination">Destination URL</Label>
        <Input id="destination" type="url" />
      </div>
    </main>
  </ThemeProvider>,
);
