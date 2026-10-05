import type { ComponentProps } from "react";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";

export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  const field = useField(props);
  return (
    <textarea
      {...props}
      {...field}
      rows={rows}
      className={cn("gdg-input", "gdg-textarea", className)}
    />
  );
}
