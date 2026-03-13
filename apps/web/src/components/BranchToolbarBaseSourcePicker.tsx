import type { DraftWorktreeBaseSource } from "../composerDraftStore";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "./ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";

interface BranchToolbarBaseSourcePickerProps {
  value: DraftWorktreeBaseSource;
  disabled?: boolean;
  onChange: (value: DraftWorktreeBaseSource) => void;
}

function labelForSource(value: DraftWorktreeBaseSource): string {
  return value === "remote" ? "From remote" : "From local";
}

export function BranchToolbarBaseSourcePicker({
  value,
  disabled = false,
  onChange,
}: BranchToolbarBaseSourcePickerProps) {
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="xs" />}
        className="text-muted-foreground/70 hover:text-foreground/80"
        disabled={disabled}
      >
        <span className="max-w-[140px] truncate">{labelForSource(value)}</span>
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end" side="top" className="min-w-40">
        <MenuRadioGroup
          value={value}
          onValueChange={(nextValue) => onChange(nextValue as DraftWorktreeBaseSource)}
        >
          <MenuRadioItem value="remote">From remote</MenuRadioItem>
          <MenuRadioItem value="local">From local</MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
