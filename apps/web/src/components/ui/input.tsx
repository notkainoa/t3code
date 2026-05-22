"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "~/lib/utils";

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
  nativeInput?: boolean;
};

function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  ...props
}: InputProps) {
  const inputClassName = cn(
    "h-9 w-full min-w-0 rounded-[inherit] px-3 py-1 text-base outline-none placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground file:me-3 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm [transition:background-color_5000000s_ease-in-out_0s] md:text-sm",
    size === "sm" && "h-8 px-2.5 text-[12px]",
    size === "lg" && "h-10 px-3.5 text-sm",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" && "text-muted-foreground",
  );
  let inputElement: React.ReactElement;

  if (nativeInput) {
    const { style, onValueChange: _onValueChange, ...nativeInputProps } = props;
    const nativeStyle = typeof style === "function" ? undefined : style;

    inputElement = (
      <input
        className={inputClassName}
        data-slot="input"
        size={typeof size === "number" ? size : undefined}
        style={nativeStyle}
        {...(nativeInputProps as React.ComponentProps<"input">)}
      />
    );
  } else {
    inputElement = (
      <InputPrimitive
        className={inputClassName}
        data-slot="input"
        size={typeof size === "number" ? size : undefined}
        {...props}
      />
    );
  }

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
      data-slot="input-control"
    >
      {inputElement}
    </span>
  );
}

export { Input, type InputProps };
