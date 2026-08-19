import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardLoader,
  CardTitle,
  Link,
  TeamConfigurationSurface,
} from "@netlify/sdk/ui/react/components";
import { trpc } from "../trpc.js";
import { COPY } from "../copy.js";

export const TeamConfiguration = () => {
  const trpcUtils = trpc.useUtils();
  const status = trpc.connection.status.useQuery();
  const [connectUrl, setConnectUrl] = useState<string | null>(null);

  const start = trpc.connection.start.useMutation({
    onSuccess: (result) => {
      setConnectUrl(result.connectUrl);
    },
  });
  const disconnect = trpc.connection.disconnect.useMutation({
    onSuccess: async () => {
      setConnectUrl(null);
      await trpcUtils.connection.status.invalidate();
    },
  });

  if (status.isLoading) {
    return <CardLoader />;
  }

  if (status.isError) {
    return (
      <TeamConfigurationSurface>
        <Alert type="error" title={COPY.team.errorTitle}>{status.error.message}</Alert>
      </TeamConfigurationSurface>
    );
  }

  const connected = status.data?.connected === true;

  return (
    <TeamConfigurationSurface>
      <Card>
        <CardTitle>{COPY.team.title}</CardTitle>
        {connected ? (
          <>
            <p className="tw-mb-2 tw-font-semibold">{COPY.team.connectedTitle}</p>
            <p>{COPY.team.connectedText(status.data?.accountName ?? null)}</p>
            <div className="tw-mt-4 tw-flex tw-gap-2">
              {status.data?.settingsUrl && (
                <Button href={status.data.settingsUrl} target="_blank" rel="noopener noreferrer" level="secondary">
                  {COPY.team.openConsole}
                </Button>
              )}
              <Button
                variant="danger"
                level="tertiary"
                loading={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                {COPY.team.disconnect}
              </Button>
            </div>
            <p className="tw-mt-2 tw-text-sm">{COPY.team.disconnectHelp}</p>
          </>
        ) : connectUrl !== null ? (
          <>
            <p className="tw-mb-2 tw-font-semibold">{COPY.team.linkReadyTitle}</p>
            <p>{COPY.team.linkReadyText}</p>
            <div className="tw-mt-4 tw-flex tw-gap-2">
              <Button href={connectUrl} target="_blank" rel="noopener noreferrer">
                {COPY.team.openLink}
              </Button>
              <Button level="secondary" onClick={() => void trpcUtils.connection.status.invalidate()}>
                {COPY.team.refresh}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="tw-mb-2 tw-font-semibold">{COPY.team.notConnectedTitle}</p>
            <p>{COPY.team.notConnectedText}</p>
            <div className="tw-mt-4">
              <Button loading={start.isPending} onClick={() => start.mutate({ returnUrl: window.location.href })}>
                {start.isPending ? COPY.team.connectPending : COPY.team.connectButton}
              </Button>
            </div>
            {start.isError && (
              <Alert type="error" title={COPY.team.errorTitle} className="tw-mt-4">{start.error.message}</Alert>
            )}
          </>
        )}
        <p className="tw-mt-4 tw-text-sm">
          <Link href="https://ironbee.ai">ironbee.ai</Link>
        </p>
      </Card>
    </TeamConfigurationSurface>
  );
};
