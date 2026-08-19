import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardLoader,
  CardTitle,
  SiteConfigurationSurface,
} from "@netlify/sdk/ui/react/components";
import { trpc } from "../trpc.js";
import { COPY } from "../copy.js";

type DeployContext = "production" | "deploy-preview" | "branch-deploy";
const DEFAULT_CONTEXTS: DeployContext[] = ["deploy-preview", "branch-deploy"];
const CONTEXT_OPTIONS: { value: DeployContext; label: string }[] = [
  { value: "deploy-preview", label: COPY.site.contextPreview },
  { value: "branch-deploy", label: COPY.site.contextBranch },
  { value: "production", label: COPY.site.contextProduction },
];

export const SiteConfiguration = () => {
  const trpcUtils = trpc.useUtils();
  const connection = trpc.connection.status.useQuery();
  const site = trpc.site.status.useQuery();
  const hookHealth = trpc.site.hookHealth.useQuery(undefined, { enabled: site.data?.status === "active" });
  const visibility = trpc.site.visibility.useQuery(undefined, { enabled: connection.data?.connected === true });

  const invalidate = async () => {
    await Promise.all([
      trpcUtils.site.status.invalidate(),
      trpcUtils.site.hookHealth.invalidate(),
      trpcUtils.site.visibility.invalidate(),
    ]);
  };
  const [previewsMadePublic, setPreviewsMadePublic] = useState(false);
  const enable = trpc.site.enable.useMutation({
    onSuccess: async (result) => {
      setPreviewsMadePublic(result.previewsMadePublic);
      await invalidate();
    },
  });
  const makePublic = trpc.site.makePublic.useMutation({ onSuccess: invalidate });
  const disable = trpc.site.disable.useMutation({ onSuccess: invalidate });
  const setContexts = trpc.site.setContexts.useMutation({ onSuccess: invalidate });
  const resume = trpc.site.resumeHook.useMutation({ onSuccess: invalidate });

  if (connection.isLoading || site.isLoading) {
    return <CardLoader />;
  }

  if (connection.data?.connected !== true) {
    return (
      <SiteConfigurationSurface>
        <Card>
          <CardTitle>{COPY.site.title}</CardTitle>
          <Alert type="warn">{COPY.site.teamNotConnected}</Alert>
        </Card>
      </SiteConfigurationSurface>
    );
  }

  const active = site.data?.status === "active";
  const contexts: DeployContext[] = (site.data?.contexts as DeployContext[] | null | undefined) ?? DEFAULT_CONTEXTS;
  const toggleContext = (context: DeployContext) => {
    const next = contexts.includes(context) ? contexts.filter((value) => value !== context) : [...contexts, context];
    setContexts.mutate({ contexts: next.length === 0 ? null : next });
  };
  const error = enable.error ?? disable.error ?? setContexts.error ?? resume.error ?? makePublic.error ?? site.error;

  return (
    <SiteConfigurationSurface>
      <Card>
        <CardTitle>{COPY.site.title}</CardTitle>
        {error && <Alert type="error" title={COPY.site.errorTitle} className="tw-mb-4">{error.message}</Alert>}
        {active ? (
          <>
            <p>{COPY.site.enabledText}</p>
            <p className="tw-mt-2 tw-text-sm">{COPY.site.lastEvent(site.data?.lastEventAt ?? null)}</p>
            {previewsMadePublic && <Alert type="success" className="tw-mt-4">{COPY.site.previewsMadePublic}</Alert>}
            {visibility.data?.productionPrivate && (
              <Alert type="warn" className="tw-mt-4">
                {COPY.site.previewsPrivateAll}
                <div className="tw-mt-2 tw-flex tw-flex-col tw-gap-2">
                  <div>
                    <Button level="secondary" loading={makePublic.isPending} onClick={() => makePublic.mutate()}>{COPY.site.makePublic}</Button>
                    <span className="tw-ml-2 tw-text-sm">{COPY.site.makePublicHelp}</span>
                  </div>
                  <span className="tw-text-sm">{COPY.site.privateAlternative}</span>
                </div>
              </Alert>
            )}
            {visibility.data?.passwordProtected && <Alert type="info" className="tw-mt-4">{COPY.site.passwordProtected}</Alert>}
            {visibility.data && !visibility.data.previewsPrivate && !visibility.data.passwordProtected && !previewsMadePublic && (
              <p className="tw-mt-2 tw-text-sm">{COPY.site.previewsPublicOk}</p>
            )}
            {hookHealth.data?.state === "paused" && (
              <Alert type="warn" className="tw-mt-4">
                {COPY.site.hookPaused}
                <div className="tw-mt-2">
                  <Button level="secondary" loading={resume.isPending} onClick={() => resume.mutate()}>{COPY.site.resume}</Button>
                </div>
              </Alert>
            )}
            {hookHealth.data?.state === "missing" && <Alert type="warn" className="tw-mt-4">{COPY.site.hookMissing}</Alert>}
            {hookHealth.data?.state === "ok" && <p className="tw-mt-2 tw-text-sm">{COPY.site.hookOk}</p>}

            <p className="tw-mt-4 tw-font-semibold">{COPY.site.contextsTitle}</p>
            <div className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-2">
              {CONTEXT_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  level={contexts.includes(option.value) ? "primary" : "secondary"}
                  disabled={setContexts.isPending}
                  onClick={() => toggleContext(option.value)}
                >
                  {contexts.includes(option.value) ? `${option.label} ✓` : option.label}
                </Button>
              ))}
            </div>

            <p className="tw-mt-4 tw-font-semibold">{COPY.site.protectionTitle}</p>
            <p className="tw-text-sm">{COPY.site.protectionText}</p>
            {connection.data?.settingsUrl && (
              <div className="tw-mt-2">
                <Button href={connection.data.settingsUrl} target="_blank" rel="noopener noreferrer" level="secondary">
                  {COPY.site.protectionOpen}
                </Button>
              </div>
            )}

            <div className="tw-mt-6">
              <Button variant="danger" level="tertiary" loading={disable.isPending} onClick={() => disable.mutate()}>
                {COPY.site.disable}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>{COPY.site.disabledText}</p>
            <div className="tw-mt-4">
              <Button loading={enable.isPending} onClick={() => enable.mutate({})}>{COPY.site.enable}</Button>
            </div>
          </>
        )}
      </Card>
    </SiteConfigurationSurface>
  );
};
