"""Conclusion: written by the moderator when the user asks for one. Never automatic."""

from __future__ import annotations

from collections.abc import AsyncIterator

from app.llm.router import get_provider, model_for

CONCLUSION_SYSTEM = (
    "You are the moderator of a multi-AI brainstorm. Write the FINAL conclusion of the debate.\n"
    "Rules:\n"
    "- Korean, 4-8 short lines. No preamble such as '결론:'.\n"
    "- Cover: 핵심 합의 (what the group converged on), 남은 쟁점 (unresolved disagreement or open questions), "
    "다음 행동 (concrete next steps for the user).\n"
    "- Use ONLY what the conversation and the idea graph contain. Never invent facts, numbers or new ideas.\n"
    "- If the debate did not converge, say so plainly and name the options still on the table.\n"
    "- Output the conclusion text only."
)


async def stream_conclusion(
    topic: str, messages: list[str], graph_line: str = "", project_context: str = ""
) -> AsyncIterator[str]:
    """Stream the moderator's written conclusion over the whole debate."""
    provider = get_provider()
    convo = "\n".join(f"- {m[:400]}" for m in messages[-30:])
    sys = CONCLUSION_SYSTEM
    if project_context:
        sys += f"\n\n{project_context[:4000]}"
    prompt = [
        {"role": "system", "content": sys},
        {
            "role": "user",
            "content": (
                f"Topic: {topic}\n"
                + (f"Idea graph: {graph_line}\n" if graph_line else "")
                + f"Debate so far:\n{convo}"
            ),
        },
    ]
    async for tok in provider.stream(prompt, model=model_for("moderator"), role="conclusion", temperature=0.4):
        yield tok
