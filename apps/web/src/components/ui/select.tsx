"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDownIcon, ChevronsUpDownIcon, ChevronUpIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "~/lib/utils";

const Select = SelectPrimitive.Root;

const selectTriggerVariants = cva(
  "relative inline-flex cursor-pointer select-none items-center justify-between gap-2 rounded-md border text-left text-sm outline-none transition-[color,box-shadow,background-color,border-color] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      variant: {
        default:
          "w-full min-w-36 border-input bg-background text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='opacity-'])]:opacity-50",
        ghost:
          "border-transparent text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-pressed:bg-accent hover:bg-accent hover:text-foreground",
      },
      size: {
        default: "min-h-9 px-3",
        lg: "min-h-10 px-3.5",
        sm: "min-h-8 gap-1.5 px-2.5 text-[12px]",
        xs: "h-7 gap-1 px-2.5 text-[12px] [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
  },
);

const selectTriggerIconClassName = "-me-1 size-4 opacity-50";

interface SelectButtonProps extends useRender.ComponentProps<"button"> {
  size?: VariantProps<typeof selectTriggerVariants>["size"];
  variant?: VariantProps<typeof selectTriggerVariants>["variant"];
}

function SelectButton({ className, size, variant, render, children, ...props }: SelectButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    children: (
      <>
        <span className="flex-1 truncate in-data-placeholder:text-muted-foreground/72">
          {children}
        </span>
        {variant === "ghost" ? (
          <ChevronDownIcon className="size-3 opacity-50" />
        ) : (
          <ChevronsUpDownIcon className={selectTriggerIconClassName} />
        )}
      </>
    ),
    className: cn(selectTriggerVariants({ size, variant }), "min-w-none", className),
    "data-slot": "select-button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

function SelectTrigger({
  className,
  size = "default",
  variant = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(selectTriggerVariants({ size, variant }), className)}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <ChevronDownIcon className="size-3 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn("flex-1 truncate data-placeholder:text-muted-foreground", className)}
      data-slot="select-value"
      {...props}
    />
  );
}

function SelectPopup({
  className,
  popupClassName,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  matchTriggerWidth = true,
  anchor,
  ...props
}: SelectPrimitive.Popup.Props & {
  popupClassName?: string;
  side?: SelectPrimitive.Positioner.Props["side"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
  align?: SelectPrimitive.Positioner.Props["align"];
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
  matchTriggerWidth?: boolean;
  anchor?: SelectPrimitive.Positioner.Props["anchor"];
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 select-none"
        data-slot="select-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className="origin-(--transform-origin) text-foreground"
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow
            className="top-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:top-px before:h-[200%] before:rounded-t-[calc(var(--radius-lg)-1px)] before:bg-linear-to-b before:from-50% before:from-popover"
            data-slot="select-scroll-up-arrow"
          >
            <ChevronUpIcon className="relative size-4.5 sm:size-4" />
          </SelectPrimitive.ScrollUpArrow>
          <div
            className={cn(
              "relative h-full rounded-md border bg-popover shadow-md",
              matchTriggerWidth && "min-w-(--anchor-width)",
              popupClassName,
            )}
          >
            <SelectPrimitive.List
              className={cn("max-h-(--available-height) overflow-y-auto p-1", className)}
              data-slot="select-list"
            >
              {children}
            </SelectPrimitive.List>
          </div>
          <SelectPrimitive.ScrollDownArrow
            className="bottom-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:bottom-px before:h-[200%] before:rounded-b-[calc(var(--radius-lg)-1px)] before:bg-linear-to-t before:from-50% before:from-popover"
            data-slot="select-scroll-down-arrow"
          >
            <ChevronDownIcon className="relative size-4.5 sm:size-4" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  hideIndicator = false,
  ...props
}: SelectPrimitive.Item.Props & {
  hideIndicator?: boolean;
}) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "grid min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default items-center gap-2 rounded-md py-1.5 text-sm outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        hideIndicator ? "grid-cols-[1fr] ps-3 pe-3" : "grid-cols-[1rem_1fr] ps-2 pe-4",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      {hideIndicator ? null : (
        <SelectPrimitive.ItemIndicator className="col-start-1" data-slot="select-item-indicator">
          <svg
            fill="none"
            height="24"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="24"
            xmlns="http://www.w3.org/1500/svg"
          >
            <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
          </svg>
        </SelectPrimitive.ItemIndicator>
      )}
      <SelectPrimitive.ItemText
        className={cn("min-w-0", hideIndicator ? "col-start-1" : "col-start-2")}
        data-slot="select-item-text"
      >
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      className={cn("mx-2 my-1 h-px bg-border", className)}
      data-slot="select-separator"
      {...props}
    />
  );
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectGroupLabel(props: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      className="px-2 py-1.5 font-medium text-muted-foreground text-xs"
      data-slot="select-group-label"
      {...props}
    />
  );
}

export {
  Select,
  SelectTrigger,
  SelectButton,
  selectTriggerVariants,
  SelectValue,
  SelectPopup,
  SelectPopup as SelectContent,
  SelectItem,
  SelectSeparator,
  SelectGroup,
  SelectGroupLabel,
};
