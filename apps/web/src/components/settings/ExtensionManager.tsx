"use no memo";

import {
  ArrowUpRightIcon,
  CheckIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "@tanstack/react-router";

import {
  fetchExtensionCatalog,
  getExtensionCatalogCategories,
  type ExtensionCatalogItem,
  type ExtensionKind,
  type ExtensionTone,
  resolveExtensionTone,
} from "~/extensionCatalog";
import { useExtensionManagerStore } from "~/extensionManagerStore";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { toastManager } from "~/components/ui/toast";
import { ProjectFavicon } from "~/components/ProjectFavicon";

import { useSettingsSidebarProjects } from "./useSettingsSidebarProjects";

const EXTENSION_DRAG_MIME = "application/x-t3code-extension-id";

const toneClassNames: Record<ExtensionTone, string> = {
  amber:
    "bg-[radial-gradient(circle_at_top,var(--color-amber-300),var(--color-amber-500)_62%,color-mix(in_srgb,var(--color-amber-700)_75%,black))] text-amber-950",
  blue: "bg-[radial-gradient(circle_at_top,var(--color-blue-300),var(--color-blue-500)_62%,color-mix(in_srgb,var(--color-blue-700)_75%,black))] text-blue-950",
  emerald:
    "bg-[radial-gradient(circle_at_top,var(--color-emerald-300),var(--color-emerald-500)_62%,color-mix(in_srgb,var(--color-emerald-700)_75%,black))] text-emerald-950",
  rose: "bg-[radial-gradient(circle_at_top,var(--color-rose-300),var(--color-rose-500)_62%,color-mix(in_srgb,var(--color-rose-700)_75%,black))] text-rose-950",
  slate:
    "bg-[radial-gradient(circle_at_top,var(--color-slate-200),var(--color-slate-400)_62%,color-mix(in_srgb,var(--color-slate-700)_75%,black))] text-slate-950",
  sky: "bg-[radial-gradient(circle_at_top,var(--color-sky-200),var(--color-sky-400)_62%,color-mix(in_srgb,var(--color-sky-700)_75%,black))] text-sky-950",
  violet:
    "bg-[radial-gradient(circle_at_top,var(--color-violet-300),var(--color-violet-500)_62%,color-mix(in_srgb,var(--color-violet-700)_75%,black))] text-violet-950",
};

const extensionPanelClassName = "rounded-[24px] border border-white/8 bg-white/[0.03] p-6";
const extensionRowClassName =
  "flex items-center gap-4 rounded-2xl border border-white/6 bg-white/[0.025] px-4 py-3";
const extensionMetaBadgeClassName =
  "rounded-full border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-white/58";
const extensionCountBadgeClassName =
  "rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/58";
const extensionSearchInputClassName =
  "h-11 rounded-2xl border-white/8 bg-white/[0.04] ps-10 text-white placeholder:text-white/32";
const extensionOutlineButtonClassName =
  "border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.05]";

function extensionGlyph(title: string): string {
  return title
    .split(/\s+/)
    .map((segment) => segment[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function eventHasExtensionDrag(event: Pick<DragEvent<HTMLElement>, "dataTransfer">): boolean {
  return Array.from(event.dataTransfer.types).includes(EXTENSION_DRAG_MIME);
}

function buildProjectRoute(project: { environmentId: string; id: string }) {
  return {
    to: "/settings/projects/$environmentId/$projectId" as const,
    params: {
      environmentId: project.environmentId,
      projectId: project.id,
    },
  };
}

function ExtensionIcon({ item }: { item: ExtensionCatalogItem }) {
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-2xl text-[11px] font-semibold tracking-[0.18em] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]",
        toneClassNames[resolveExtensionTone(item)],
      )}
    >
      {extensionGlyph(item.title)}
    </div>
  );
}

function ExtensionSurfaceCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(extensionPanelClassName, className)}>{children}</div>;
}

function ExtensionStatusChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-xs text-white/68",
        className,
      )}
    >
      {children}
    </span>
  );
}

function ExtensionSearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className="relative flex-1">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/32" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(extensionSearchInputClassName, className)}
      />
    </div>
  );
}

function ExtensionSectionHeader({
  icon,
  title,
  count,
}: {
  icon: ReactNode;
  title: string;
  count: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
      </div>
      <span className={extensionCountBadgeClassName}>{count}</span>
    </div>
  );
}

function extensionAssignmentCount(
  item: ExtensionCatalogItem,
  projectInstallIdsByProjectKey: Record<string, string[]>,
) {
  return Object.values(projectInstallIdsByProjectKey).filter((extensions) =>
    extensions.includes(item.id),
  ).length;
}

function matchesExtensionQuery(item: ExtensionCatalogItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }

  return [item.title, item.summary, item.category, item.sourceLabel].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function DiscoverItemRow({
  item,
  globalInstallIds,
  projectInstallIdsByProjectKey,
  onOpen,
  onDragStateChange,
}: {
  item: ExtensionCatalogItem;
  globalInstallIds: readonly string[];
  projectInstallIdsByProjectKey: Record<string, string[]>;
  onOpen: () => void;
  onDragStateChange: (extensionId: string | null) => void;
}) {
  const projectCount = extensionAssignmentCount(item, projectInstallIdsByProjectKey);
  const isInstalled = globalInstallIds.includes(item.id) || projectCount > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onOpen}
      onDragEnd={() => onDragStateChange(null)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(EXTENSION_DRAG_MIME, item.id);
        event.dataTransfer.setData("text/plain", item.title);
        onDragStateChange(item.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.025] px-3 py-3 text-left transition hover:border-white/10 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/18"
    >
      <ExtensionIcon item={item} />
      <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
          <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground/72">
            {item.summary}
          </p>
        </div>
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.02] text-muted-foreground/70 transition group-hover:bg-white/[0.05] group-hover:text-foreground",
          isInstalled && "bg-white/[0.04] text-foreground/72",
        )}
      >
        {isInstalled ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <PlusIcon className="size-3.5 stroke-[1.75]" />
        )}
      </div>
    </div>
  );
}

function groupItemsByCategory(items: readonly ExtensionCatalogItem[]) {
  const grouped = new Map<string, ExtensionCatalogItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.category);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(item.category, [item]);
    }
  }
  return [...grouped.entries()];
}

function PluginProviderTitleTabs({
  preferredPluginProvider,
  onValueChange,
}: {
  preferredPluginProvider: "codex" | "claudeCode";
  onValueChange: (value: "codex" | "claudeCode") => void;
}) {
  return (
    <div className="mx-auto inline-flex items-center gap-1 rounded-2xl border border-white/8 bg-white/[0.03] p-1">
      <button
        type="button"
        onClick={() => onValueChange("codex")}
        className={cn(
          "rounded-xl px-4 py-2 text-sm font-medium tracking-[-0.02em] transition sm:px-5",
          preferredPluginProvider === "codex"
            ? "bg-white/[0.08] text-foreground"
            : "text-white/52 hover:bg-white/[0.04] hover:text-foreground",
        )}
      >
        Plugins for Codex
      </button>
      <button
        type="button"
        onClick={() => onValueChange("claudeCode")}
        className={cn(
          "rounded-xl px-4 py-2 text-sm font-medium tracking-[-0.02em] transition sm:px-5",
          preferredPluginProvider === "claudeCode"
            ? "bg-white/[0.08] text-foreground"
            : "text-white/52 hover:bg-white/[0.04] hover:text-foreground",
        )}
      >
        Plugins for Claude Code
      </button>
    </div>
  );
}

function ExtensionDetailsDialog({
  item,
  open,
  onOpenChange,
  projectTargetKey,
  onProjectTargetChange,
}: {
  item: ExtensionCatalogItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectTargetKey: string;
  onProjectTargetChange: (projectKey: string) => void;
}) {
  const projects = useSettingsSidebarProjects();
  const globalInstallIds = useExtensionManagerStore((state) => state.globalInstallIds);
  const projectInstallIdsByProjectKey = useExtensionManagerStore(
    (state) => state.projectInstallIdsByProjectKey,
  );
  const installGlobally = useExtensionManagerStore((state) => state.installGlobally);
  const assignToProject = useExtensionManagerStore((state) => state.assignToProject);

  const assignedProjectNames = useMemo(() => {
    if (!item) return [];
    return projects.flatMap((project) =>
      (projectInstallIdsByProjectKey[project.projectKey] ?? []).includes(item.id)
        ? [project.name]
        : [],
    );
  }, [item, projectInstallIdsByProjectKey, projects]);

  if (!item) return null;

  const isInstalledGlobally = globalInstallIds.includes(item.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-w-2xl rounded-[28px] border-white/8 bg-[linear-gradient(180deg,#151516_0%,#101011_100%)] text-foreground shadow-[0_32px_120px_rgba(0,0,0,0.52)]"
        bottomStickOnMobile={false}
      >
        <DialogHeader className="border-b border-white/8 pb-4">
          <div className="flex items-start gap-4">
            <ExtensionIcon item={item} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-2xl tracking-[-0.03em] text-foreground">
                  {item.title}
                </DialogTitle>
                <span className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-white/58">
                  {item.category}
                </span>
              </div>
              <DialogDescription className="mt-2 max-w-[56ch] text-sm leading-relaxed text-white/68">
                {item.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogPanel className="space-y-5 pt-5">
          <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/48">
                Source
              </span>
              <span className="text-xs text-white/48">{item.sourceLabel}</span>
            </div>
            {item.sourceUrl ? (
              <a
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-foreground underline decoration-white/18 underline-offset-4 transition hover:text-white"
                href={item.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open source details
                <ArrowUpRightIcon className="size-3.5" />
              </a>
            ) : (
              <p className="mt-2 text-sm text-white/60">Managed through the built-in catalog.</p>
            )}
            {item.installCommand ? (
              <pre className="mt-3 overflow-x-auto rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs text-white/88">
                <code>{item.installCommand}</code>
              </pre>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/48">
                Install
              </span>
              <span className="text-xs text-white/45">Assign globally or to a project</span>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <Button
                variant={isInstalledGlobally ? "outline" : "default"}
                className={cn(
                  "justify-center",
                  isInstalledGlobally &&
                    "border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.05]",
                )}
                onClick={() => {
                  installGlobally(item.id);
                  toastManager.add({
                    type: "success",
                    title: `${item.title} added globally`,
                    description:
                      "The extension is now available across projects in this prototype.",
                  });
                }}
              >
                {isInstalledGlobally ? "Installed globally" : "Install globally"}
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={projectTargetKey}
                  onValueChange={(value) => onProjectTargetChange(value ?? "")}
                >
                  <SelectTrigger
                    className="w-full border-white/10 bg-white/[0.04] text-foreground sm:flex-1"
                    aria-label="Install to project"
                  >
                    <SelectValue>
                      {projects.find((project) => project.projectKey === projectTargetKey)?.name ??
                        "Choose project"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {projects.map((project) => (
                      <SelectItem hideIndicator key={project.projectKey} value={project.projectKey}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Button
                  variant="outline"
                  className="border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.05]"
                  disabled={projectTargetKey.length === 0}
                  onClick={() => {
                    if (!projectTargetKey) return;
                    assignToProject(item.id, projectTargetKey);
                    const projectName =
                      projects.find((project) => project.projectKey === projectTargetKey)?.name ??
                      "project";
                    toastManager.add({
                      type: "success",
                      title: `${item.title} assigned`,
                      description: `Added to ${projectName}.`,
                    });
                  }}
                >
                  Install to project
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/48">
              Coverage
            </span>
            <div className="mt-3 flex flex-wrap gap-2">
              {isInstalledGlobally ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                  <CheckIcon className="size-3" />
                  Global install
                </span>
              ) : null}
              {assignedProjectNames.map((projectName) => (
                <span
                  key={projectName}
                  className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-xs text-white/68"
                >
                  {projectName}
                </span>
              ))}
              {!isInstalledGlobally && assignedProjectNames.length === 0 ? (
                <span className="text-sm text-white/55">Not assigned yet.</span>
              ) : null}
            </div>
          </section>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function ExtensionDiscoverPage({
  kind,
  title,
  subtitle,
}: {
  kind: ExtensionKind;
  title: string;
  subtitle: string;
}) {
  const projects = useSettingsSidebarProjects();
  const globalInstallIds = useExtensionManagerStore((state) => state.globalInstallIds);
  const projectInstallIdsByProjectKey = useExtensionManagerStore(
    (state) => state.projectInstallIdsByProjectKey,
  );
  const preferredPluginProvider = useExtensionManagerStore(
    (state) => state.preferredPluginProvider,
  );
  const setPreferredPluginProvider = useExtensionManagerStore(
    (state) => state.setPreferredPluginProvider,
  );
  const setDraggingExtensionId = useExtensionManagerStore((state) => state.setDraggingExtensionId);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [projectTargetKey, setProjectTargetKey] = useState("");
  const [items, setItems] = useState<readonly ExtensionCatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (projectTargetKey.length === 0 && projects[0]) {
      setProjectTargetKey(projects[0].projectKey);
    }
  }, [projectTargetKey.length, projects]);

  useEffect(() => {
    let cancelled = false;
    setIsCatalogLoading(true);
    setCatalogError(null);

    void fetchExtensionCatalog({
      kind,
      ...(kind === "plugin" ? { provider: preferredPluginProvider } : {}),
      query: deferredQuery,
    })
      .then((nextItems) => {
        if (cancelled) {
          return;
        }
        setItems(nextItems);
        setIsCatalogLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setItems([]);
        setCatalogError(error instanceof Error ? error.message : "Failed to load extensions.");
        setIsCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [deferredQuery, kind, preferredPluginProvider]);

  const categories = useMemo(() => getExtensionCatalogCategories(items), [items]);

  useEffect(() => {
    if (category !== "all" && !categories.includes(category)) {
      setCategory("all");
    }
  }, [categories, category]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) {
        return false;
      }
      return true;
    });
  }, [category, items]);

  const selectedItem = selectedItemId
    ? (items.find((item) => item.id === selectedItemId) ?? null)
    : null;
  const groupedItems = useMemo(() => groupItemsByCategory(filteredItems), [filteredItems]);

  return (
    <>
      <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#151516_0%,#101011_100%)] text-foreground">
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#151516_0%,#101011_100%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(48rem_18rem_at_top,rgba(255,255,255,0.05),transparent)]" />
          <div className="pointer-events-none absolute top-0 right-0 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.04),transparent_60%)] blur-2xl" />

          <div className="relative mx-auto w-full max-w-[1140px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
            <div className="flex min-h-[240px] flex-col justify-center py-8 sm:min-h-[264px] sm:py-10">
              <div className="mx-auto w-full max-w-[840px] text-center">
                {kind === "plugin" ? (
                  <PluginProviderTitleTabs
                    preferredPluginProvider={preferredPluginProvider}
                    onValueChange={setPreferredPluginProvider}
                  />
                ) : (
                  <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-[2.25rem]">
                    {title}
                  </h1>
                )}
                <p className="mx-auto mt-3 max-w-[60ch] text-sm leading-relaxed text-white/62 sm:text-base">
                  {subtitle}
                </p>
              </div>

              <div className="mx-auto mt-6 flex w-full max-w-[840px] flex-col gap-3 sm:flex-row">
                <ExtensionSearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder={kind === "plugin" ? "Search plugins" : "Search skills"}
                  className="h-10 rounded-xl"
                />

                {kind === "skill" ? (
                  <div className="inline-flex h-10 items-center rounded-xl border border-white/8 bg-white/[0.04] px-3 text-sm text-white/62 sm:w-auto">
                    skills.sh
                  </div>
                ) : null}

                <Select value={category} onValueChange={(value) => setCategory(value ?? "all")}>
                  <SelectTrigger
                    className="w-full rounded-xl border-white/8 bg-white/[0.04] sm:w-28"
                    aria-label="Filter category"
                  >
                    <SelectValue>{category === "all" ? "All" : category}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    <SelectItem hideIndicator value="all">
                      All
                    </SelectItem>
                    {categories.map((nextCategory) => (
                      <SelectItem hideIndicator key={nextCategory} value={nextCategory}>
                        {nextCategory}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-8 px-4 pb-8 sm:px-6 sm:pb-10 lg:px-8">
          <section className="space-y-6 pb-8">
            {catalogError ? (
              <ExtensionSurfaceCard>
                <Empty>
                  <EmptyMedia>
                    <PackageIcon className="size-5" />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>Catalog unavailable</EmptyTitle>
                    <EmptyDescription>{catalogError}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </ExtensionSurfaceCard>
            ) : isCatalogLoading ? (
              <ExtensionSurfaceCard>
                <Empty>
                  <EmptyMedia>
                    <PackageIcon className="size-5" />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>Loading catalog</EmptyTitle>
                    <EmptyDescription>
                      Fetching the latest extensions for this view.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </ExtensionSurfaceCard>
            ) : groupedItems.length === 0 ? (
              <ExtensionSurfaceCard>
                <Empty>
                  <EmptyMedia>
                    <SearchIcon className="size-5" />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>No matches</EmptyTitle>
                    <EmptyDescription>Try a different query or switch categories.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </ExtensionSurfaceCard>
            ) : (
              <div className="space-y-6">
                {groupedItems.map(([groupName, groupItems]) => (
                  <section key={groupName} className="space-y-3">
                    <div className="flex items-center justify-between gap-3 px-1">
                      <h2 className="text-sm font-semibold text-white/86">{groupName}</h2>
                      <span className="text-xs text-white/40">{groupItems.length} items</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {groupItems.map((item) => (
                        <DiscoverItemRow
                          key={item.id}
                          item={item}
                          globalInstallIds={globalInstallIds}
                          projectInstallIdsByProjectKey={projectInstallIdsByProjectKey}
                          onOpen={() => setSelectedItemId(item.id)}
                          onDragStateChange={setDraggingExtensionId}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      <ExtensionDetailsDialog
        item={selectedItem}
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItemId(null);
          }
        }}
        projectTargetKey={projectTargetKey}
        onProjectTargetChange={setProjectTargetKey}
      />
    </>
  );
}

function ProjectAssignedItemRow({
  item,
  projectKey,
}: {
  item: ExtensionCatalogItem;
  projectKey: string;
}) {
  const removeFromProject = useExtensionManagerStore((state) => state.removeFromProject);

  return (
    <div className={extensionRowClassName}>
      <ExtensionIcon item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{item.title}</span>
          <span className={extensionMetaBadgeClassName}>{item.kind}</span>
        </div>
        <p className="mt-1 text-sm text-white/62">{item.summary}</p>
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        className="shrink-0 text-white/70 hover:bg-white/[0.05] hover:text-white"
        aria-label={`Remove ${item.title}`}
        onClick={() => removeFromProject(item.id, projectKey)}
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

function ProjectCatalogItemRow({
  item,
  actionLabel,
  onAction,
}: {
  item: ExtensionCatalogItem;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className={extensionRowClassName}>
      <ExtensionIcon item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{item.title}</span>
          <span className={extensionMetaBadgeClassName}>{item.category}</span>
        </div>
        <p className="mt-1 text-sm text-white/62">{item.summary}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className={cn("shrink-0", extensionOutlineButtonClassName)}
        onClick={onAction}
      >
        <PlusIcon className="size-3.5" />
        {actionLabel}
      </Button>
    </div>
  );
}

export function PluginsDiscoverSettingsPage() {
  return (
    <ExtensionDiscoverPage
      kind="plugin"
      title="Plugins for Codex"
      subtitle="Browse the plugin catalog, inspect the source, and assign tools globally or to specific projects."
    />
  );
}

export function SkillsDiscoverSettingsPage() {
  return (
    <ExtensionDiscoverPage
      kind="skill"
      title="Make skills work your way"
      subtitle="Browse the skill catalog, inspect the source, and route workflows to the projects that need them."
    />
  );
}

export function ProjectExtensionsSettingsPage(input: {
  readonly environmentId: string;
  readonly projectId: string;
}) {
  const navigate = useNavigate();
  const projects = useSettingsSidebarProjects();
  const assignToProject = useExtensionManagerStore((state) => state.assignToProject);
  const setDraggingExtensionId = useExtensionManagerStore((state) => state.setDraggingExtensionId);
  const projectInstallIdsByProjectKey = useExtensionManagerStore(
    (state) => state.projectInstallIdsByProjectKey,
  );
  const [catalogItemsById, setCatalogItemsById] = useState<Record<string, ExtensionCatalogItem>>(
    {},
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const project =
    projects.find((candidate) =>
      candidate.memberProjectRefs.some(
        (ref) => ref.environmentId === input.environmentId && ref.projectId === input.projectId,
      ),
    ) ?? null;

  useEffect(() => {
    let cancelled = false;
    setIsCatalogLoading(true);
    setCatalogError(null);

    void Promise.all([
      fetchExtensionCatalog({ kind: "skill" }),
      fetchExtensionCatalog({ kind: "plugin", provider: "codex" }),
      fetchExtensionCatalog({ kind: "plugin", provider: "claudeCode" }),
    ])
      .then((catalogs) => {
        if (cancelled) {
          return;
        }

        const nextById: Record<string, ExtensionCatalogItem> = {};
        for (const item of catalogs.flat()) {
          nextById[item.id] = item;
        }
        setCatalogItemsById(nextById);
        setIsCatalogLoading(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setCatalogItemsById({});
          setCatalogError(
            error instanceof Error ? error.message : "Failed to load the extension catalog.",
          );
          setIsCatalogLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const assignedExtensionIds = useMemo(() => {
    if (!project) {
      return [];
    }
    return projectInstallIdsByProjectKey[project.projectKey] ?? [];
  }, [project, projectInstallIdsByProjectKey]);
  const assignedExtensionIdSet = useMemo(
    () => new Set(assignedExtensionIds),
    [assignedExtensionIds],
  );

  const allAssignedItems = useMemo(() => {
    if (!project) return [];
    return assignedExtensionIds
      .map((extensionId) => catalogItemsById[extensionId] ?? null)
      .flatMap((item) => (item ? [item] : []));
  }, [assignedExtensionIds, catalogItemsById, project]);

  const assignedItems = useMemo(
    () => allAssignedItems.filter((item) => matchesExtensionQuery(item, deferredQuery)),
    [allAssignedItems, deferredQuery],
  );

  const availableItems = useMemo(
    () =>
      Object.values(catalogItemsById)
        .filter(
          (item) =>
            !assignedExtensionIdSet.has(item.id) && matchesExtensionQuery(item, deferredQuery),
        )
        .sort((left, right) => left.title.localeCompare(right.title)),
    [assignedExtensionIdSet, catalogItemsById, deferredQuery],
  );

  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleAssign = useCallback(
    (item: ExtensionCatalogItem) => {
      if (!project) return;
      assignToProject(item.id, project.projectKey);
      toastManager.add({
        type: "success",
        title: `${item.title} assigned`,
        description: `Added to ${project.name}.`,
      });
    },
    [assignToProject, project],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!project) return;
      event.preventDefault();
      const extensionId = event.dataTransfer.getData(EXTENSION_DRAG_MIME);
      if (!extensionId) return;
      setDraggingExtensionId(null);
      setIsDropTarget(false);
      const item = catalogItemsById[extensionId] ?? null;
      if (item) {
        handleAssign(item);
        return;
      }
      assignToProject(extensionId, project.projectKey);
      toastManager.add({
        type: "success",
        title: "Extension assigned",
        description: `Added to ${project.name}.`,
      });
    },
    [assignToProject, catalogItemsById, handleAssign, project, setDraggingExtensionId],
  );

  if (!project) {
    return (
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        <Empty className="mx-auto max-w-xl rounded-[28px] border border-border/70 bg-card/70 p-8">
          <EmptyMedia>
            <PackageIcon className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Project not found</EmptyTitle>
            <EmptyDescription>
              The selected project is no longer available in the current workspace list.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const skills = assignedItems.filter((item) => item.kind === "skill");
  const plugins = assignedItems.filter((item) => item.kind === "plugin");
  const allAssignedSkills = allAssignedItems.filter((item) => item.kind === "skill");
  const allAssignedPlugins = allAssignedItems.filter((item) => item.kind === "plugin");
  const availableSkills = availableItems.filter((item) => item.kind === "skill").slice(0, 6);
  const availablePlugins = availableItems.filter((item) => item.kind === "plugin").slice(0, 6);
  const isFiltering = deferredQuery.trim().length > 0;

  return (
    <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#151516_0%,#101011_100%)] text-foreground">
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#151516_0%,#101011_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(48rem_18rem_at_top,rgba(255,255,255,0.05),transparent)]" />
        <div className="pointer-events-none absolute top-0 right-0 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.04),transparent_60%)] blur-2xl" />

        <div className="relative mx-auto w-full max-w-[1140px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          <section
            onDragEnter={(event) => {
              if (!eventHasExtensionDrag(event)) return;
              setIsDropTarget(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsDropTarget(false);
              }
            }}
            onDragOver={(event) => {
              if (!eventHasExtensionDrag(event)) return;
              event.preventDefault();
            }}
            onDrop={handleDrop}
            className={cn(
              "relative overflow-hidden rounded-[30px] border bg-[linear-gradient(180deg,#151516_0%,#101011_100%)] p-6 transition sm:p-8",
              isDropTarget
                ? "border-amber-400/50 shadow-[0_0_0_1px_rgba(251,191,36,0.35),0_30px_80px_rgba(251,191,36,0.10)]"
                : "border-white/8 shadow-[0_24px_72px_rgba(0,0,0,0.24)]",
            )}
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 h-36 bg-[radial-gradient(44rem_14rem_at_top,rgba(251,191,36,0.10),transparent)]" />
            </div>
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex size-12 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04]">
                    <ProjectFavicon
                      cwd={project.cwd}
                      environmentId={project.environmentId}
                      className="size-5"
                    />
                  </div>
                  <div className="min-w-0">
                    <h1 className="truncate text-2xl font-semibold tracking-[-0.04em] text-white sm:text-[2.25rem]">
                      {project.name}
                    </h1>
                    <p className="truncate text-sm text-white/52">{project.cwd}</p>
                  </div>
                </div>
                <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-white/62 sm:text-base">
                  Manage project-specific skills and plugins here, or drag new items onto this page
                  or the project entry in the settings sidebar.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <ExtensionStatusChip>{allAssignedSkills.length} skills</ExtensionStatusChip>
                <ExtensionStatusChip>{allAssignedPlugins.length} plugins</ExtensionStatusChip>
                {project.remoteEnvironmentLabels.length > 0 ? (
                  <ExtensionStatusChip>
                    {project.remoteEnvironmentLabels.join(", ")}
                  </ExtensionStatusChip>
                ) : null}
              </div>
            </div>

            <div className="relative mt-6 grid gap-3 border-t border-white/8 pt-6 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
              <ExtensionSearchInput
                value={query}
                onChange={setQuery}
                placeholder="Filter assigned and available extensions"
              />
              <Button
                variant="outline"
                className={cn("h-11 rounded-2xl", extensionOutlineButtonClassName)}
                onClick={() => void navigate({ to: "/settings/extensions/skills" })}
              >
                Browse skills
              </Button>
              <Button
                variant="outline"
                className={cn("h-11 rounded-2xl", extensionOutlineButtonClassName)}
                onClick={() => void navigate({ to: "/settings/extensions/plugins" })}
              >
                Browse plugins
              </Button>
            </div>

            <div className="relative mt-3 flex flex-wrap gap-2 text-xs">
              <ExtensionStatusChip>
                {isCatalogLoading ? "Loading catalog" : `${availableItems.length} available to add`}
              </ExtensionStatusChip>
              {isFiltering ? (
                <ExtensionStatusChip>Filter: {deferredQuery.trim()}</ExtensionStatusChip>
              ) : null}
              {catalogError ? (
                <span className="rounded-full border border-destructive/35 bg-destructive/10 px-2.5 py-1 text-destructive">
                  {catalogError}
                </span>
              ) : null}
            </div>
          </section>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-8 px-4 pb-8 sm:px-6 sm:pb-10 lg:px-8">
        <section className="grid gap-6 pb-8 lg:grid-cols-2">
          <ExtensionSurfaceCard className="space-y-4">
            <ExtensionSectionHeader
              icon={<SparklesIcon className="size-4 text-amber-400" />}
              title="Skills"
              count={`${allAssignedSkills.length} assigned`}
            />
            {skills.length === 0 ? (
              <p className="text-sm leading-relaxed text-white/62">
                {isFiltering
                  ? "No assigned skills match this filter."
                  : "No skills assigned yet. Add one below or drag it in from the catalog."}
              </p>
            ) : (
              <div className="space-y-3">
                {skills.map((item) => (
                  <ProjectAssignedItemRow
                    key={item.id}
                    item={item}
                    projectKey={project.projectKey}
                  />
                ))}
              </div>
            )}

            <div className="border-t border-white/8 pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/48">
                  Quick add
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-white/70 hover:bg-white/[0.05] hover:text-white"
                  onClick={() => void navigate({ to: "/settings/extensions/skills" })}
                >
                  Open catalog
                </Button>
              </div>
              {isCatalogLoading ? (
                <p className="text-sm leading-relaxed text-white/62">
                  Loading skills you can assign to this project.
                </p>
              ) : availableSkills.length === 0 ? (
                <p className="text-sm leading-relaxed text-white/62">
                  {catalogError
                    ? "The skill catalog is unavailable right now."
                    : isFiltering
                      ? "No available skills match this filter."
                      : "Every discovered skill is already assigned here."}
                </p>
              ) : (
                <div className="space-y-3">
                  {availableSkills.map((item) => (
                    <ProjectCatalogItemRow
                      key={item.id}
                      item={item}
                      actionLabel="Add"
                      onAction={() => handleAssign(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          </ExtensionSurfaceCard>

          <ExtensionSurfaceCard className="space-y-4">
            <ExtensionSectionHeader
              icon={<PackageIcon className="size-4 text-sky-400" />}
              title="Plugins"
              count={`${allAssignedPlugins.length} assigned`}
            />
            {plugins.length === 0 ? (
              <p className="text-sm leading-relaxed text-white/62">
                {isFiltering
                  ? "No assigned plugins match this filter."
                  : "No plugins assigned yet. Add one below or drag it in from the catalog."}
              </p>
            ) : (
              <div className="space-y-3">
                {plugins.map((item) => (
                  <ProjectAssignedItemRow
                    key={item.id}
                    item={item}
                    projectKey={project.projectKey}
                  />
                ))}
              </div>
            )}

            <div className="border-t border-white/8 pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/48">
                  Quick add
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-white/70 hover:bg-white/[0.05] hover:text-white"
                  onClick={() => void navigate({ to: "/settings/extensions/plugins" })}
                >
                  Open catalog
                </Button>
              </div>
              {isCatalogLoading ? (
                <p className="text-sm leading-relaxed text-white/62">
                  Loading plugins you can assign to this project.
                </p>
              ) : availablePlugins.length === 0 ? (
                <p className="text-sm leading-relaxed text-white/62">
                  {catalogError
                    ? "The plugin catalog is unavailable right now."
                    : isFiltering
                      ? "No available plugins match this filter."
                      : "Every discovered plugin is already assigned here."}
                </p>
              ) : (
                <div className="space-y-3">
                  {availablePlugins.map((item) => (
                    <ProjectCatalogItemRow
                      key={item.id}
                      item={item}
                      actionLabel="Add"
                      onAction={() => handleAssign(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          </ExtensionSurfaceCard>
        </section>
      </div>
    </div>
  );
}

export { buildProjectRoute, EXTENSION_DRAG_MIME };
