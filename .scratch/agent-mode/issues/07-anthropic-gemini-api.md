# 07: API providers: Anthropic and Gemini

**Parent spec:** `spec.md` (Implementation Decisions "API tool loop").

**What to build:** the tool loop from 03 also drives Anthropic Messages and the Gemini API, so the owner can use either with a key.

- **Adapters.** Split `api_loop.py` into a provider-neutral loop and adapters, each with one function: stream one model step and return text, thoughts and tool calls.
  - OpenAI-compatible (from 03).
  - Anthropic: the `anthropic` SDK, streamed, with tool use and thinking blocks shown as thoughts. A prompt-cache breakpoint goes on the system prompt and the tools.
  - Gemini: the `google-genai` SDK already used by `llm.py`, with function declarations from the MCP tool schemas. Strip schema keywords Gemini refuses.
- **Models.**
  - Anthropic defaults to `claude-sonnet-5-5`, with `claude-opus-5-5` and `claude-haiku-5-5` listed.
  - Gemini defaults to the `GEMINI_MODEL` the app already uses.
- **Keys.** `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` are the env fallbacks.

**Blocked by:** 03

**Status:** done

- [x] Each adapter, given a scripted stream (fake transport / fake client), produces the same event sequence as the OpenAI test in 03.
- [x] A Gemini schema with `additionalProperties` / `$defs` is cleaned before sending.
- [x] Tests in `backend/tests/test_agent_api_adapters.py`; only it is run.
