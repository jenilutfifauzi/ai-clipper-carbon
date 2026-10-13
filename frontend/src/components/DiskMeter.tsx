import { AlertTriangle, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type DiskUsage } from "../api";
import { cx, formatBytes } from "../format";
import { Panel } from "./Panel";

// The data directory's volume: how full it is, how much of it AI Clipper's Jobs take, and a warning
// when free space is low. Fetched again whenever `refresh` changes (after a delete).
export function DiskMeter({ refresh }: { refresh: number }) {
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.disk().then(
      (usage) => {
        setDisk(usage);
        setError(null);
      },
      (reason: Error) => setError(reason.message),
    );
  }, [refresh]);

  return (
    <Panel aria-labelledby="disk-heading" className="flex flex-col gap-4">
      <h2 id="disk-heading" className="flex items-center gap-2 font-semibold">
        <HardDrive aria-hidden size={18} className="text-muted" />
        Disk
      </h2>
      {error && <p className="text-sm text-danger">Couldn't read disk usage: {error}</p>}
      {disk && <Usage disk={disk} />}
      {!disk && !error && <p className="text-sm text-muted">Reading disk usage…</p>}
    </Panel>
  );
}

function Usage({ disk }: { disk: DiskUsage }) {
  const share = (bytes: number) => `${(100 * bytes) / disk.total_bytes}%`;
  const otherBytes = Math.max(0, disk.total_bytes - disk.free_bytes - disk.used_bytes);
  const usedPercent = Math.round((100 * (disk.total_bytes - disk.free_bytes)) / disk.total_bytes);
  return (
    <>
      <div>
        <p className={cx("text-2xl font-semibold tracking-tight tabular-nums", disk.warning && "text-danger")}>
          {formatBytes(disk.free_bytes)} free
        </p>
        <p className="text-sm text-muted">of {formatBytes(disk.total_bytes)}</p>
      </div>
      <div
        role="meter"
        aria-label="Disk space used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={usedPercent}
        aria-valuetext={`${usedPercent}% used, ${formatBytes(disk.free_bytes)} free`}
        className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-fill"
      >
        <div className="rounded-full bg-muted/50" style={{ width: share(otherBytes) }} />
        <div className="min-w-1 rounded-full bg-linear-to-r from-accent to-accent-end" style={{ width: share(disk.used_bytes) }} />
      </div>
      <div className="flex flex-col gap-1 text-sm text-muted">
        <p className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-full bg-accent" />
          AI Clipper uses {formatBytes(disk.used_bytes)}
        </p>
        <p className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-full bg-muted/50" />
          Other files {formatBytes(otherBytes)}
        </p>
      </div>
      {disk.warning && (
        <p role="alert" className="flex gap-2 rounded-control bg-danger-surface p-3 text-sm text-danger">
          <AlertTriangle aria-hidden size={18} className="shrink-0" />
          Less than {formatBytes(disk.warning_below_bytes)} free. Delete Jobs you're done with before starting a long
          episode.
        </p>
      )}
    </>
  );
}
