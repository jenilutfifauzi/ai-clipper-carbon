import { useState } from "react";
import { DiskMeter } from "../components/DiskMeter";
import { NewJobForm } from "./home/NewJobForm";
import { RecentJobs } from "./home/RecentJobs";

export function Home() {
  const [deletions, setDeletions] = useState(0);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
      <NewJobForm />
      <DiskMeter refresh={deletions} />
      <div className="lg:col-span-2">
        <RecentJobs onDeleted={() => setDeletions((n) => n + 1)} />
      </div>
    </div>
  );
}
