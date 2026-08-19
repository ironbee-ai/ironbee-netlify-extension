import { useNetlifySDK } from "@netlify/sdk/ui/react";
import { Alert, Button, Card, CardLoader, CardTitle, SiteDeploySurface } from "@netlify/sdk/ui/react/components";
import { trpc } from "../trpc.js";
import { COPY } from "../copy.js";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const REFETCH_WHILE_RUNNING_MS = 15_000;

export const SiteDeploy = () => {
  const sdk = useNetlifySDK();
  const deployId = sdk.context.deployId;
  const status = trpc.deploy.status.useQuery(
    { deployId: deployId ?? "" },
    {
      enabled: deployId !== null,
      refetchInterval: (query) => {
        const job = query.state.data?.job;
        return job !== null && job !== undefined && !TERMINAL_STATUSES.has(job.status) ? REFETCH_WHILE_RUNNING_MS : false;
      },
    },
  );

  if (deployId === null) {
    return null;
  }
  if (status.isLoading) {
    return <CardLoader />;
  }
  if (status.isError) {
    return (
      <SiteDeploySurface>
        <Alert type="error">{status.error.message}</Alert>
      </SiteDeploySurface>
    );
  }

  const data = status.data;
  if (!data || !data.enabled) {
    return (
      <SiteDeploySurface>
        <Card>
          <CardTitle>{COPY.deploy.title}</CardTitle>
          <p>{COPY.deploy.notEnabled}</p>
        </Card>
      </SiteDeploySurface>
    );
  }
  const job = data.job;
  if (job === null) {
    return (
      <SiteDeploySurface>
        <Card>
          <CardTitle>{COPY.deploy.title}</CardTitle>
          <p>{COPY.deploy.noJob}</p>
        </Card>
      </SiteDeploySurface>
    );
  }

  const running = !TERMINAL_STATUSES.has(job.status);
  const verdict = job.result?.status;
  const headline = running
    ? COPY.deploy.running
    : job.status === "cancelled"
      ? COPY.deploy.cancelled
      : verdict === "pass"
        ? COPY.deploy.passed
        : verdict === "fail"
          ? COPY.deploy.failed
          : COPY.deploy.inconclusive;
  const alertType = running ? "info" : verdict === "pass" ? "success" : verdict === "fail" ? "error" : "warn";

  return (
    <SiteDeploySurface>
      <Card>
        <CardTitle>{COPY.deploy.title}</CardTitle>
        <Alert type={alertType}>{headline}</Alert>
        {job.result?.summary && <p className="tw-mt-3">{job.result.summary}</p>}
        {job.result?.issues && job.result.issues.length > 0 && (
          <>
            <p className="tw-mt-3 tw-font-semibold">{COPY.deploy.issuesTitle}</p>
            <ul className="tw-list-disc tw-pl-5">
              {job.result.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </>
        )}
        {job.sessionUrl && (
          <div className="tw-mt-4">
            <Button href={job.sessionUrl} target="_blank" rel="noopener noreferrer" level="secondary">
              {COPY.deploy.openSession}
            </Button>
          </div>
        )}
      </Card>
    </SiteDeploySurface>
  );
};
