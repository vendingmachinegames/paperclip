import { useEffect, useMemo, useState } from "react";
import type { PluginPageProps, PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";

type LibraryItemKind = "work_product" | "document" | "attachment";

interface LibraryItem {
  kind: LibraryItemKind;
  id: string;
  title: string;
  subtitle: string | null;
  issueId: string;
  issueTitle: string | null;
  issueIdentifier: string | null;
  url: string | null;
  contentType: string | null;
  byteSize: number | null;
  updatedAt: string;
  createdAt: string;
  extra: Record<string, unknown>;
}

interface LibraryResponse {
  items: LibraryItem[];
}

const KIND_LABELS: Record<LibraryItemKind, string> = {
  work_product: "Work product",
  document: "Document",
  attachment: "Attachment",
};

const KIND_FILTERS: Array<{ value: "all" | LibraryItemKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "work_product", label: "Work products" },
  { value: "document", label: "Documents" },
  { value: "attachment", label: "Attachments" },
];

function formatBytes(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function navigateInternal(href: string) {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function issueHrefFor(companySlug: string | null, item: LibraryItem): string | null {
  if (!companySlug) return null;
  return `/${companySlug}/issues/${item.issueId}`;
}

function primaryActionFor(
  companySlug: string | null,
  item: LibraryItem,
): { label: string; href: string; external: boolean } | null {
  if (item.kind === "work_product" && item.url) {
    return { label: "Open", href: item.url, external: true };
  }
  if (item.kind === "attachment" && item.url) {
    return { label: "Download", href: item.url, external: true };
  }
  const issueHref = issueHrefFor(companySlug, item);
  if (issueHref) {
    return { label: "Open in issue", href: issueHref, external: false };
  }
  return null;
}

export function LibraryPage({ context }: PluginPageProps) {
  const { companyId, companySlug } = context;
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | LibraryItemKind>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setError(null);
    setItems(null);
    fetch(`/api/companies/${encodeURIComponent(companyId)}/library?limit=500`, {
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json() as Promise<LibraryResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load library");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q)
        || (item.subtitle ?? "").toLowerCase().includes(q)
        || (item.issueTitle ?? "").toLowerCase().includes(q)
        || (item.issueIdentifier ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, kindFilter, query]);

  const counts = useMemo(() => {
    const result: Record<LibraryItemKind, number> = {
      work_product: 0,
      document: 0,
      attachment: 0,
    };
    for (const item of items ?? []) {
      result[item.kind] += 1;
    }
    return result;
  }, [items]);

  const selectedItem = useMemo(
    () => (selectedId ? filtered.find((i) => `${i.kind}:${i.id}` === selectedId) ?? null : null),
    [selectedId, filtered],
  );

  if (!companyId) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Select a company to view its Library.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold leading-tight">Library</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every file, document, and work product generated by tickets in this company.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {KIND_FILTERS.map((option) => {
          const selected = option.value === kindFilter;
          const count = option.value === "all" ? (items?.length ?? 0) : counts[option.value];
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setKindFilter(option.value)}
              className={
                selected
                  ? "rounded-full border border-transparent bg-foreground px-3 py-1 text-xs font-medium text-background"
                  : "rounded-full border border-border bg-transparent px-3 py-1 text-xs font-medium text-foreground/80 hover:bg-accent/50 hover:text-foreground transition-colors"
              }
            >
              {option.label}
              <span className="ml-1 opacity-60">{count}</span>
            </button>
          );
        })}
        <div className="ml-auto">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, issue, body…"
            className="w-72 rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-foreground/40"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!items && !error && (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      )}

      {items && filtered.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? "Nothing here yet. Work products, issue documents, and file attachments will appear as agents generate them."
            : "No matches."}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid flex-1 min-h-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <ol className="flex min-h-0 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {filtered.map((item) => {
              const itemKey = `${item.kind}:${item.id}`;
              const isSelected = itemKey === selectedId;
              return (
                <li key={itemKey}>
                  <LibraryRow
                    item={item}
                    selected={isSelected}
                    onSelect={() => setSelectedId(itemKey)}
                  />
                </li>
              );
            })}
          </ol>
          <aside className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-4">
            {selectedItem ? (
              <LibraryDetail item={selectedItem} companyId={companyId} companySlug={companySlug} />
            ) : (
              <div className="py-10 text-center text-xs text-muted-foreground">
                Select a row to see details.
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: LibraryItemKind }) {
  const colors: Record<LibraryItemKind, string> = {
    work_product: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    document: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    attachment: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${colors[kind]}`}
    >
      <KindIcon kind={kind} />
      {KIND_LABELS[kind]}
    </span>
  );
}

function KindIcon({ kind }: { kind: LibraryItemKind }) {
  if (kind === "work_product") {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h2" />
        <path d="M6 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
      </svg>
    );
  }
  if (kind === "document") {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function LibraryRow({
  item,
  selected,
  onSelect,
}: {
  item: LibraryItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const size = formatBytes(item.byteSize);
  const issueLabel = item.issueIdentifier ?? item.issueTitle ?? item.issueId.slice(0, 8);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full cursor-pointer px-4 py-3 text-left transition-colors ${
        selected ? "bg-accent/60" : "hover:bg-accent/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
            <KindBadge kind={item.kind} />
          </div>
          {item.subtitle && (
            <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {item.subtitle}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{issueLabel}</span>
            <span aria-hidden>·</span>
            <span>{formatDate(item.updatedAt)}</span>
            {size && (
              <>
                <span aria-hidden>·</span>
                <span>{size}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function LibraryDetail({
  item,
  companyId,
  companySlug,
}: {
  item: LibraryItem;
  companyId: string;
  companySlug: string | null;
}) {
  const action = primaryActionFor(companySlug, item);
  const issueHref = issueHrefFor(companySlug, item);
  const isDocument = item.kind === "document";
  const docKey = typeof item.extra.key === "string" ? item.extra.key : null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-2">
          <KindBadge kind={item.kind} />
          <span className="text-[11px] text-muted-foreground">
            {formatDate(item.updatedAt)}
          </span>
        </div>
        <h2 className="mt-2 text-base font-semibold leading-tight break-words">
          {item.title}
        </h2>
        {item.subtitle && (
          <p className="mt-1 text-sm text-muted-foreground break-words">{item.subtitle}</p>
        )}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-muted-foreground">Issue</dt>
        <dd>
          {issueHref ? (
            <a
              href={issueHref}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigateInternal(issueHref);
              }}
              className="text-foreground hover:underline"
            >
              {item.issueIdentifier ?? item.issueTitle ?? item.issueId.slice(0, 8)}
            </a>
          ) : (
            <span className="text-foreground">
              {item.issueIdentifier ?? item.issueTitle ?? item.issueId.slice(0, 8)}
            </span>
          )}
        </dd>
        {item.contentType && (
          <>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="text-foreground">{item.contentType}</dd>
          </>
        )}
        {formatBytes(item.byteSize) && (
          <>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="text-foreground">{formatBytes(item.byteSize)}</dd>
          </>
        )}
        {typeof item.extra.provider === "string" && (
          <>
            <dt className="text-muted-foreground">Provider</dt>
            <dd className="text-foreground">{String(item.extra.provider)}</dd>
          </>
        )}
        {typeof item.extra.status === "string" && (
          <>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-foreground">{String(item.extra.status)}</dd>
          </>
        )}
      </dl>

      {action && (
        <div className="flex flex-wrap gap-2">
          {action.external ? (
            <a
              href={action.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
            >
              {action.label}
              <ExternalLinkIcon />
            </a>
          ) : (
            <a
              href={action.href}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigateInternal(action.href);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
            >
              {action.label} →
            </a>
          )}
        </div>
      )}

      {isDocument && docKey && (
        <DocumentPreview companyId={companyId} issueId={item.issueId} docKey={docKey} />
      )}

      {item.kind === "attachment" && item.contentType?.startsWith("image/") && item.url && (
        <div className="mt-1 rounded-md border border-border overflow-hidden bg-muted/20">
          <img src={item.url} alt={item.title} className="max-h-[360px] w-full object-contain" />
        </div>
      )}
    </div>
  );
}

function DocumentPreview({
  companyId,
  issueId,
  docKey,
}: {
  companyId: string;
  issueId: string;
  docKey: string;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBody(null);
    setError(null);
    fetch(
      `/api/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(docKey)}`,
      { credentials: "include" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ body?: string; content?: string }>;
      })
      .then((data) => {
        if (cancelled) return;
        setBody(data.body ?? data.content ?? "");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, issueId, docKey]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (body === null) {
    return <div className="text-xs text-muted-foreground">Loading preview…</div>;
  }

  if (body.length === 0) {
    return <div className="text-xs text-muted-foreground italic">Document is empty.</div>;
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Preview
      </div>
      <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words text-xs text-foreground font-mono leading-relaxed">
        {body.slice(0, 4000)}
        {body.length > 4000 && "\n\n…"}
      </pre>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

/**
 * Sidebar entry for the Library. Mounted inside the host's company sidebar
 * via the `sidebar` plugin slot. Uses the same Tailwind classes as
 * SidebarNavItem so it looks identical to the built-in links.
 */
export function LibrarySidebarLink({ context }: PluginWidgetProps) {
  const { companySlug } = context;
  const href = companySlug ? `/${companySlug}/library` : "/library";

  const [isActive, setIsActive] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.location.pathname === href;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setIsActive(window.location.pathname === href);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("popstate", update);
    };
  }, [href]);

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigateInternal(href);
    setIsActive(true);
  }

  const base =
    "flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors";
  const activeClasses = "bg-accent text-foreground";
  const inactiveClasses = "text-foreground/80 hover:bg-accent/50 hover:text-foreground";

  return (
    <a
      href={href}
      onClick={handleClick}
      className={`${base} ${isActive ? activeClasses : inactiveClasses}`}
    >
      <span className="relative shrink-0">
        <LibraryIcon />
      </span>
      <span className="flex-1 truncate">Library</span>
    </a>
  );
}

function LibraryIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3v18" />
      <path d="M10 3v18" />
      <path d="m14.5 3.5 5 17" />
      <path d="M4 21h18" />
    </svg>
  );
}
