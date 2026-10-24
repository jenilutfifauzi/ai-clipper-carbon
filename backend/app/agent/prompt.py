"""The Agent's system prompt: the scoped MCP server's instructions, then the Candidate it works on."""

from app.candidates import Candidate


def system_prompt(instructions: str, job_id: str, candidate: Candidate) -> str:
    """API models get it as their system message; ACP agents in front of their first prompt."""
    return f"""\
{instructions}

# This Agent Session
Job: {job_id}
Candidate: {candidate.id}
Title: {candidate.title}
Length: {candidate.duration:.1f} s
Canvas Aspect: {candidate.aspect.value}
Segments: {len(candidate.segments)}
Text Layers: {len(candidate.text_layers)}
Music Clips: {len(candidate.music)}
Overlays: {len(candidate.overlays)}
Shapes: {len(candidate.shapes)}

Pass this Job's and this Candidate's ids to every tool. Read the Candidate (get_candidate) before you edit it."""
