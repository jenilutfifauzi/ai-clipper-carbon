import { NewJobForm } from "./home/NewJobForm";
import { RecentJobs } from "./home/RecentJobs";

export function Home() {
  return (
    <div className="flex flex-col gap-5">
      <NewJobForm />
      <RecentJobs />
    </div>
  );
}
