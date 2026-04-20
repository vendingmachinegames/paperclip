import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, ListChecks, UserPlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { companiesApi, type BoardroomCard } from "@/api/companies";

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function useAcceptRejectCard(companyId: string, cardId: string) {
  const queryClient = useQueryClient();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: queryKeys.companies.boardroomCards(companyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
  }

  const accept = useMutation({
    mutationFn: () => companiesApi.acceptBoardroomCard(companyId, cardId),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: () => companiesApi.rejectBoardroomCard(companyId, cardId),
    onSuccess: invalidate,
  });

  return { accept, reject };
}

interface BoardroomCardProps {
  card: BoardroomCard;
  companyId: string;
}

export function BoardroomCardView({ card, companyId }: BoardroomCardProps) {
  switch (card.kind) {
    case "hire_proposal":
      return <HireProposalCard card={card} companyId={companyId} />;
    case "task_completion":
      return <TaskCompletionCard card={card} companyId={companyId} />;
    default:
      return <UnknownKindCard card={card} />;
  }
}

function CardFrame({
  icon,
  title,
  subtitle,
  state,
  children,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string | null;
  state: BoardroomCard["state"];
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const stateBadge =
    state === "accepted" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> Accepted
      </span>
    ) : state === "rejected" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300">
        <XCircle className="h-3 w-3" /> Rejected
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
        Pending
      </span>
    );

  return (
    <div
      className={cn(
        "mt-2 rounded-lg border bg-muted/30 p-3 shadow-sm",
        state === "accepted" && "border-emerald-500/30",
        state === "rejected" && "border-rose-500/30 opacity-80",
        state === "pending" && "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 text-muted-foreground">{icon}</div>
          <div>
            <div className="text-sm font-semibold leading-tight">{title}</div>
            {subtitle && (
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
        </div>
        {stateBadge}
      </div>
      {children && <div className="mt-2 text-xs text-muted-foreground">{children}</div>}
      {footer && <div className="mt-3 flex items-center gap-2">{footer}</div>}
    </div>
  );
}

function HireProposalCard({ card, companyId }: BoardroomCardProps) {
  const name = stringField(card.payload, "name") ?? "Unnamed agent";
  const role = stringField(card.payload, "role") ?? "general";
  const adapter = stringField(card.payload, "adapterType") ?? "claude_local";
  const description = stringField(card.payload, "description");
  const reportsTo = stringField(card.payload, "reportsTo");

  const { accept, reject } = useAcceptRejectCard(companyId, card.id);
  const busy = accept.isPending || reject.isPending;

  const resultName =
    card.resultPayload && typeof card.resultPayload.name === "string"
      ? card.resultPayload.name
      : null;

  return (
    <CardFrame
      icon={<UserPlus className="h-4 w-4" />}
      title={`Hire proposal: ${name}`}
      subtitle={`${role} · ${adapter}${reportsTo ? ` · reports to ${reportsTo}` : ""}`}
      state={card.state}
      footer={
        card.state === "pending" ? (
          <>
            <Button size="sm" onClick={() => accept.mutate()} disabled={busy}>
              {accept.isPending ? "Hiring…" : "Hire"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => reject.mutate()}
              disabled={busy}
            >
              Decline
            </Button>
            {accept.error instanceof Error && (
              <span className="text-xs text-destructive">{accept.error.message}</span>
            )}
          </>
        ) : card.state === "accepted" && resultName ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Bot className="h-3 w-3" /> Hired as {resultName}
          </span>
        ) : null
      }
    >
      {description}
    </CardFrame>
  );
}

function TaskCompletionCard({ card, companyId }: BoardroomCardProps) {
  const title = stringField(card.payload, "title") ?? "Task complete";
  const summary = stringField(card.payload, "summary");
  const taskIssueId = stringField(card.payload, "issueId");

  const { accept, reject } = useAcceptRejectCard(companyId, card.id);
  const busy = accept.isPending || reject.isPending;

  return (
    <CardFrame
      icon={<ListChecks className="h-4 w-4" />}
      title={title}
      subtitle={taskIssueId ? `Issue ${taskIssueId.slice(0, 8)}…` : null}
      state={card.state}
      footer={
        card.state === "pending" ? (
          <>
            <Button size="sm" onClick={() => accept.mutate()} disabled={busy}>
              {accept.isPending ? "Closing…" : "Mark complete"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => reject.mutate()}
              disabled={busy}
            >
              Not yet
            </Button>
            {accept.error instanceof Error && (
              <span className="text-xs text-destructive">{accept.error.message}</span>
            )}
          </>
        ) : null
      }
    >
      {summary}
    </CardFrame>
  );
}

function UnknownKindCard({ card }: { card: BoardroomCard }) {
  return (
    <CardFrame
      icon={<Bot className="h-4 w-4" />}
      title={`Unknown card: ${card.kind}`}
      state={card.state}
    >
      <pre className="overflow-x-auto text-[11px]">
        {JSON.stringify(card.payload, null, 2)}
      </pre>
    </CardFrame>
  );
}
