import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { Panel } from "../../components/Panel";
import { Skeleton } from "../../components/Skeleton";
import { STAGES } from "../../stages";

// The Job page's shape while its code or the Job itself loads: the header's lines and the stages in
// their compact row. It lives outside the Job page's chunk, to show while that loads.
export function JobSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <BackLink />
      <p role="status" className="sr-only">
        Loading the Job
      </p>
      <div aria-hidden className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="my-1 h-6 w-16" />
            <Skeleton className="my-[3px] h-3.5 w-28 rounded-full" />
          </div>
          <Skeleton className="my-1 h-4 w-72 max-w-full rounded-full" />
          <Skeleton className="my-[3px] h-3.5 w-96 max-w-full rounded-full" />
        </div>
        <Panel className="flex flex-wrap gap-x-6 gap-y-3">
          {STAGES.map((stage) => (
            <span key={stage.status} className="flex items-center gap-2.5">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="my-1 h-4 w-16 rounded-full" />
            </span>
          ))}
        </Panel>
        <Panel className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="aspect-video w-20 shrink-0 sm:w-28" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/2 rounded-full" />
                <Skeleton className="h-3.5 w-1/3 rounded-full" />
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

export function BackLink() {
  return (
    <Link to="/" className="-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-control px-1 text-sm text-muted hover:text-text">
      <ArrowLeft aria-hidden size={16} />
      All Jobs
    </Link>
  );
}
