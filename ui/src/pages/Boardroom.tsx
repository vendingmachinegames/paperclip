import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@/lib/router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import type { Agent, IssueComment } from "@paperclipai/shared";
import { stripBoardroomCardBlocks } from "@paperclipai/shared";
import { companiesApi, type BoardroomCard } from "@/api/companies";
import { issuesApi } from "@/api/issues";
import { agentsApi } from "@/api/agents";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { Identity } from "@/components/Identity";
import { MarkdownBody } from "@/components/MarkdownBody";
import { MarkdownEditor, type MentionOption } from "@/components/MarkdownEditor";
import { BoardroomCardView } from "@/components/BoardroomCards";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/timeAgo";
import { cn } from "@/lib/utils";

const EMPTY_CARDS: BoardroomCard[] = [];

/**
 * Minimal Boardroom view — renders the company-wide group conversation.
 *
 * Slice 3 is intentionally bare: fetch the conversation issue + comments,
 * show them in order, offer a composer. Live streaming, tool-call cards,
 * @mention autocomplete, feedback, reassignment, and artifact renderers
 * come in later slices alongside the chat plugin.
 */
export function Boardroom() {
  const { companySlug } = useParams<{ companySlug?: string }>();
  const { companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const company = useMemo(() => {
    if (!companySlug) return null;
    const normalized = companySlug.toLowerCase();
    return companies.find((c) => c.slug.toLowerCase() === normalized) ?? null;
  }, [companies, companySlug]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Boardroom" }]);
  }, [setBreadcrumbs]);

  const boardroomQuery = useQuery({
    queryKey: company ? queryKeys.companies.boardroom(company.id) : ["boardroom", "__idle__"],
    queryFn: () => companiesApi.getBoardroom(company!.id),
    enabled: Boolean(company),
  });
  const boardroomIssue = boardroomQuery.data?.boardroom ?? null;

  const commentsQuery = useQuery({
    queryKey: company
      ? queryKeys.companies.boardroomComments(company.id)
      : ["boardroom-comments", "__idle__"],
    queryFn: () => issuesApi.listComments(boardroomIssue!.id, { order: "asc" }),
    enabled: Boolean(boardroomIssue),
    refetchInterval: 5_000,
  });

  const agentsQuery = useQuery({
    queryKey: company ? queryKeys.agents.list(company.id) : ["agents", "__idle__"],
    queryFn: () => agentsApi.list(company!.id),
    enabled: Boolean(company),
    // Poll faster than comments so the typing indicator appears/
    // disappears promptly when an agent's heartbeat starts/finishes.
    refetchInterval: 2_500,
  });

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agentsQuery.data ?? []) map.set(agent.id, agent);
    return map;
  }, [agentsQuery.data]);

  const cardsQuery = useQuery({
    queryKey: company
      ? queryKeys.companies.boardroomCards(company.id)
      : ["boardroom-cards", "__idle__"],
    queryFn: () => companiesApi.listBoardroomCards(company!.id),
    enabled: Boolean(company),
    refetchInterval: 5_000,
  });

  const cardsByCommentId = useMemo(() => {
    const map = new Map<string, BoardroomCard[]>();
    for (const card of cardsQuery.data?.cards ?? []) {
      const list = map.get(card.commentId) ?? [];
      list.push(card);
      map.set(card.commentId, list);
    }
    return map;
  }, [cardsQuery.data]);

  const runningAgents = useMemo(
    () => (agentsQuery.data ?? []).filter((a) => a.status === "running"),
    [agentsQuery.data],
  );

  const mentionOptions = useMemo<MentionOption[]>(() => {
    return [...(agentsQuery.data ?? [])]
      .filter((a) => a.status !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({
        id: `agent:${a.id}`,
        name: a.name,
        kind: "agent" as const,
        agentId: a.id,
        agentIcon: a.icon,
      }));
  }, [agentsQuery.data]);

  const [draft, setDraft] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lastCommentIdRef = useRef<string | null>(null);

  const addComment = useMutation({
    mutationFn: async (body: string) => {
      if (!boardroomIssue) throw new Error("Boardroom not ready");
      return issuesApi.addComment(boardroomIssue.id, body);
    },
    onSuccess: () => {
      setDraft("");
      if (company) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.companies.boardroomComments(company.id),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.companies.boardroomCards(company.id),
        });
      }
    },
  });

  // Auto-scroll to bottom when new comments arrive.
  useEffect(() => {
    const comments = commentsQuery.data ?? [];
    if (comments.length === 0) return;
    const last = comments[comments.length - 1]!;
    if (last.id !== lastCommentIdRef.current) {
      lastCommentIdRef.current = last.id;
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [commentsQuery.data]);

  if (!company) {
    return (
      <div className="mx-auto max-w-2xl py-10 text-sm text-muted-foreground">
        Select a company to view its Boardroom.
      </div>
    );
  }

  if (boardroomQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading Boardroom…</div>;
  }

  const comments = commentsQuery.data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-4 py-3 md:px-6">
        <h1 className="text-base font-semibold">Boardroom</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {company.name} · everyone in this company can post and read here
        </p>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-4 md:px-6"
      >
        {comments.length === 0 ? (
          <div className="mx-auto max-w-lg rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            The Boardroom is empty. Anything posted here is visible to the
            user and every agent on this company. Start the conversation —
            once the CEO agent is running, they'll reply in here.
          </div>
        ) : (
          <ol className="mx-auto flex max-w-3xl flex-col gap-4">
            {comments.map((comment) => (
              <BoardroomMessage
                key={comment.id}
                comment={comment}
                agent={comment.authorAgentId ? agentById.get(comment.authorAgentId) ?? null : null}
                cards={cardsByCommentId.get(comment.id) ?? EMPTY_CARDS}
                companyId={company.id}
              />
            ))}
            {runningAgents.map((agent) => (
              <TypingIndicator key={agent.id} agent={agent} />
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-border px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <div className="flex-1 min-w-0">
            <MarkdownEditor
              value={draft}
              onChange={setDraft}
              placeholder="Post to the Boardroom… type @ to mention an agent."
              mentions={mentionOptions}
              onSubmit={() => {
                const trimmed = draft.trim();
                if (trimmed && !addComment.isPending) addComment.mutate(trimmed);
              }}
              bordered
              contentClassName="min-h-[52px] max-h-[28dvh] overflow-y-auto pr-1 text-sm scrollbar-auto-hide"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              const trimmed = draft.trim();
              if (trimmed) addComment.mutate(trimmed);
            }}
            disabled={!draft.trim() || addComment.isPending}
            className="shrink-0"
          >
            {addComment.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
        {addComment.error && (
          <p className="mx-auto mt-2 max-w-3xl text-xs text-destructive">
            {addComment.error instanceof Error ? addComment.error.message : "Failed to post"}
          </p>
        )}
      </div>
    </div>
  );
}

const TypingIndicator = memo(function TypingIndicator({ agent }: { agent: Agent }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Identity name={agent.name} size="xs" />
        <span aria-hidden>·</span>
        <span>typing</span>
      </div>
      <div className="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm">
        <TypingDot delay="0ms" />
        <TypingDot delay="150ms" />
        <TypingDot delay="300ms" />
      </div>
    </li>
  );
});

function TypingDot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
      style={{ animationDelay: delay }}
    />
  );
}

const BoardroomMessage = memo(function BoardroomMessage({
  comment,
  agent,
  cards,
  companyId,
}: {
  comment: IssueComment;
  agent: Agent | null;
  cards: BoardroomCard[];
  companyId: string;
}) {
  const authorName = agent?.name ?? (comment.authorUserId ? "You" : "System");
  const isAgent = Boolean(comment.authorAgentId);
  const strippedBody = useMemo(() => stripBoardroomCardBlocks(comment.body), [comment.body]);
  const hasText = strippedBody.length > 0;

  return (
    <li className={cn("flex flex-col gap-1")}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Identity name={authorName} size="xs" />
        <span aria-hidden>·</span>
        <span>{timeAgo(new Date(comment.createdAt))}</span>
        {isAgent && (
          <span className="rounded-sm bg-muted px-1 py-px text-[10px] uppercase tracking-wide">
            agent
          </span>
        )}
      </div>
      {hasText && (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">
          <MarkdownBody>{strippedBody}</MarkdownBody>
        </div>
      )}
      {cards.map((card) => (
        <BoardroomCardView key={card.id} card={card} companyId={companyId} />
      ))}
    </li>
  );
});
