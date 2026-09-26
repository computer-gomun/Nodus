"""Conclusion: the moderator judges readiness, the user can force one at any time."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

from app.llm.router import get_provider, model_for

JUDGE_SYSTEM = (
    "You are the moderator of a multi-AI brainstorm. Decide whether the debate has enough material "
    "to be concluded NOW.\n"
    "Reply with exactly one line:\n"
    "'READY: <short Korean reason>' when the participants have converged on a direction, keep repeating "
    "themselves, or have already covered the useful moves;\n"
    "'NOT_READY' otherwise.\n"
    "Never conclude early: a couple of shallow exchanges, or mere politeness, is NOT_READY."
)

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


async def judge_ready(topic: str, messages: list[str], project_context: str = "") -> str | None:
    """Ask the moderator whether the debate can be wrapped up. Returns its reason, or None."""
    provider = get_provider()
    convo = "\n".join(f"- {m[:300]}" for m in messages[-20:])
    sys = JUDGE_SYSTEM
    if project_context:
        sys += f"\n\n{project_context[:4000]}\nThe debate concerns the project above."
    prompt = [
        {"role": "system", "content": sys},
        {"role": "user", "content": f"Topic: {topic}\nRecent messages:\n{convo}"},
    ]
    try:
        out = (await provider.generate(prompt, model=model_for("moderator"), temperature=0.2)).strip()
    except Exception:
        return None
    # Tolerate "READY", "**READY**: …", "READY: …"; never match "NOT_READY".
    m = re.match(r"\**\s*READY\b\**\s*[:：]?\s*(.*)", out, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    reason = m.group(1).strip()
    if reason:
        reason = reason.splitlines()[0].strip()[:200]
    return reason or "토론이 충분히 무르익었습니다"


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
