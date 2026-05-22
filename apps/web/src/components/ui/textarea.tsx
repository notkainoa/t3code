"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import type * as React from "react";

import { cn } from "~/lib/utils";

type TextareaProps = React.ComponentProps<"textarea"> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
};

function Textarea({ className, size = "default", unstyled = false, ...props }: TextareaProps) {
  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-md border border-input bg-background text-foreground shadow-xs transition-[color,box-shadow,border-color] has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-aria-invalid:border-destructive has-focus-visible:has-aria-invalid:ring-destructive/20 has-disabled:cursor-not-allowed has-disabled:opacity-50 dark:has-focus-visible:has-aria-invalid:ring-destructive/40",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <FieldPrimitive.Control
        render={(defaultProps) => (
          <textarea
            className={cn(
              "field-sizing-content min-h-24 w-full rounded-[inherit] px-3 py-2 text-base outline-none placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground md:text-sm",
              size === "sm" && "min-h-20 px-2.5 py-1.5 text-[12px]",
              size === "lg" && "min-h-28 px-3.5 py-2.5 text-sm",
            )}
            data-slot="textarea"
            {...mergeProps(defaultProps, props)}
          />
        )}
      />
    </span>
  );
}

export { Textarea, type TextareaProps };
