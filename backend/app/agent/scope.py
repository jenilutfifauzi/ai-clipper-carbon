"""What an Agent may touch: one Job's one Candidate, named by a bearer token the scoped MCP server
(/mcp/agent) reads on each call, and the tools it may call there."""

import secrets

from pydantic import BaseModel

# The MCP server's tools an Agent may call: reading and editing its Candidate (edit_candidate's
# dry_run is its dry run), its Revisions, the Job's Transcript, the Media Library and the other
# assets, the Presets, Templates and Looks, Narration and the Channel Profile; and show_ui, which
# only the scoped server has (an Agent UI in the chat). None creates, deletes or retries a Job,
# renders or exports, deletes an asset or a Preset, or sets the Channel Profile.
ALLOWED_TOOLS = (
    "get_candidate",
    "edit_candidate",
    "merge_candidate_items",
    "remove_candidate_items",
    "list_candidate_revisions",
    "restore_candidate_revision",
    "get_transcript",
    "list_assets",
    "get_media_words",
    "list_presets",
    "apply_template",
    "generate_speech",
    "get_channel_profile",
    "save_frame",
    "show_ui",
)


class AgentScope(BaseModel):
    """The Candidate an Agent Session works on, and its Agent Turn running now (None between turns)."""

    job_id: str
    candidate_id: str
    session_id: str
    turn_id: str | None = None

    @property
    def edit_tab(self) -> str:
        """The tab its saves name (X-Edit-Tab): its turn's, else its session's."""
        return f"agent:{self.turn_id or self.session_id}"


class ScopeRegistry:
    """The scopes of the Agent Sessions open now, by their token. In memory: a token dies with the app."""

    def __init__(self) -> None:
        self._scopes: dict[str, AgentScope] = {}

    def issue(self, scope: AgentScope) -> str:
        token = secrets.token_urlsafe(32)
        self._scopes[token] = scope
        return token

    def resolve(self, token: str | None) -> AgentScope | None:
        return self._scopes.get(token) if token else None

    def set_turn(self, token: str, turn_id: str | None) -> None:
        scope = self._scopes.get(token)
        if scope is None:
            return
        self._scopes[token] = scope.model_copy(update={"turn_id": turn_id})

    def revoke(self, token: str) -> None:
        self._scopes.pop(token, None)
