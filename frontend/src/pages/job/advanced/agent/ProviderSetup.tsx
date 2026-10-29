import { ExternalLink, LogIn, TriangleAlert } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { api, ApiError, type AcpAgentProvider, type AgentLogin, type AgentProviderListing, type ApiAgentProvider, type ProviderStatus } from "../../../../api";
import { Button } from "../../../../components/Button";
import { CopyButton } from "../../../../components/CopyButton";

const FIELD = "min-h-11 w-full rounded-[10px] border border-border bg-fill px-3 text-base";

/**
 * Setting up an Agent Provider that isn't ready: an API provider's key (and base URL, for an
 * OpenAI-compatible one) and model, saved on this Mac; an ACP agent's install hint and Login.
 */
export function ProviderSetup({ listing, onSaved }: { listing: AgentProviderListing; onSaved: (listing: AgentProviderListing) => void }) {
  const { provider, status } = listing;
  return (
    <div data-provider-setup="" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Set up {provider.label}</h2>
        <a href={provider.docs_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 self-start text-sm text-text underline decoration-text/40 hover:decoration-text">
          {provider.label}'s docs
          <ExternalLink aria-hidden size={13} />
        </a>
      </div>
      {provider.kind === "api" ? (
        <ApiSetup key={provider.id} provider={provider} status={status} onSaved={onSaved} />
      ) : (
        <AcpSetup key={provider.id} provider={provider} status={status} />
      )}
    </div>
  );
}

function ApiSetup({ provider, status, onSaved }: { provider: ApiAgentProvider; status: ProviderStatus; onSaved: (listing: AgentProviderListing) => void }) {
  const id = useId();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(status.base_url ?? "");
  const [model, setModel] = useState(status.model ?? provider.default_model ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await api.saveAgentCredential(provider.id, {
          ...(key.trim() ? { api_key: key.trim() } : {}),
          ...(provider.base_url_editable && baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
        }),
      );
      setKey("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save it");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <p className="text-sm text-pretty text-muted">
        {status.has_key
          ? `A key is set (${status.key_source === "env" ? "from .env" : "saved"}). Paste another to replace it.`
          : `Paste a key, or set ${provider.key_env.join(" or ")} in the backend's .env. It stays on this Mac.`}
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-key`} className="text-sm font-medium">
          API key
        </label>
        <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} className={FIELD} />
      </div>
      {provider.base_url_editable && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-url`} className="text-sm font-medium">
            Base URL
          </label>
          <input
            id={`${id}-url`}
            type="url"
            spellCheck={false}
            placeholder={provider.base_url}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className={FIELD}
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-model`} className="text-sm font-medium">
          Model
        </label>
        <input
          id={`${id}-model`}
          type="text"
          spellCheck={false}
          list={`${id}-models`}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          className={FIELD}
        />
        <datalist id={`${id}-models`}>
          {provider.models.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="solid" className="self-start" disabled={saving || (!key.trim() && !status.has_key)}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

// Said when the backend can't sign this provider in from here yet.
const LOGIN_LATER = "Signing in from here isn't available yet.";

function AcpSetup({ provider, status }: { provider: AcpAgentProvider; status: ProviderStatus }) {
  const [login, setLogin] = useState<AgentLogin | { error: string } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const terminal = provider.login_command?.join(" ");

  async function signIn() {
    setSigningIn(true);
    try {
      setLogin(await api.loginAgentProvider(provider.id));
    } catch (reason) {
      const message = reason instanceof ApiError && reason.status === 404 ? LOGIN_LATER : reason instanceof Error ? reason.message : "Couldn't sign in";
      setLogin({ error: terminal ? `${message} Run \`${terminal}\` in a terminal.` : message });
    } finally {
      setSigningIn(false);
    }
  }

  const command = login && "command" in login && login.command?.join(" ");
  return (
    <div className="flex flex-col gap-3">
      {provider.warning && (
        <p className="flex items-start gap-1.5 text-sm text-pretty text-muted">
          <TriangleAlert aria-hidden size={15} className="mt-0.5 shrink-0 text-danger" />
          {provider.warning}
        </p>
      )}
      {provider.setup_note && <p className="text-sm text-pretty text-muted">{provider.setup_note}</p>}
      {status.installed === false && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Install it</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] bg-fill px-3 py-2 text-sm">{provider.install_hint}</code>
            <CopyButton text={provider.install_hint} label="Copy the install command" look="icon" />
          </div>
        </div>
      )}
      {status.login !== "signed_in" && (
        <div className="flex flex-col gap-1">
          <Button className="self-start" disabled={signingIn} onClick={signIn}>
            <LogIn aria-hidden size={16} />
            Log in
          </Button>
          {login && "error" in login && <p className="text-sm text-pretty text-danger">{login.error}</p>}
          {command && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[10px] bg-fill px-3 py-2 text-sm">{command}</code>
              <CopyButton text={command} label="Copy the login command" look="icon" />
            </div>
          )}
          {login && "message" in login && !login.command && <p className="text-sm text-pretty text-muted">{login.message}</p>}
        </div>
      )}
    </div>
  );
}
