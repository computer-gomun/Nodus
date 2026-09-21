"""Free-debate engine: scheduler picks speaker, LLM streams, turns tracked, snapshots on cadence."""

from __future__ import annotations

import asyncio
import random

from sqlalchemy import select

from app.agents.base import agents_for_count, debate_system_prompt
from app.agents.moderator import observe
from app.agents.scheduler import pick_next_agent
from app.api.stream_bus import publish
from app.branching.manager import build_context
from app.config import settings
from app.database import SessionLocal
from app.graph.extractor import extract_snapshot
from app.graph.manager import get_graph, merge_snapshot
from app.llm.router import get_provider, model_for
from app.models.branch import Branch
from app.models.message import Message
from app.models.project import Project
from app.project.context import load_context_text

_running: set[str] = set()


def is_running(branch_id: str) -> bool:
    return branch_id in _running


async def run_discussion(branch_id: str, turns: int = 10) -> None:
    """Run up to `turns` AI turns on a branch. Safe to call as a background task."""
    if branch_id in _running:
        return
    _running.add(branch_id)
    try:
        await _run(branch_id, turns)
    finally:
        _running.discard(branch_id)


async def _run(branch_id: str, turns: int) -> None:
    async with SessionLocal() as session:
        branch = await session.get(Branch, branch_id)
        if branch is None:
            return
        project = await session.get(Project, branch.project_id)
        topic = project.topic if project else ""

        # Project Analyzer: session-start analysis (once). If a background analysis is
        # still in flight we wait briefly; never re-analyze per turn.
        if project and project.project_path and not project.project_context:
            for _ in range(6):
                if project.context_status == "analyzing":
                    await session.refresh(project)
                    await asyncio.sleep(5)
                else:
                    break
            if not project.project_context:
                await publish(branch_id, "error", {"message": "프로젝트 폴더 분석이 실패해 프로젝트 맥락 없이 진행합니다"})
        project_ctx_text = load_context_text(project) if project else ""

        branch.status = "running"
        await session.commit()

        agents = agents_for_count(branch.agent_count)
        cap = settings.max_turns_safety_cap
        limit = branch.max_turns if branch.max_turns and branch.max_turns > 0 else cap
        remaining_total = max(limit - branch.ai_turn_count, 0)
        todo = max(min(turns, remaining_total, cap), 0)
        if todo == 0:
            branch.status = "idle"
            await session.commit()
            await publish(branch_id, "done", {"reason": "turn_limit_reached"})
            return

        for _ in range(todo):
            # Re-check stop flag (user may pause by starting another run? keep simple: status check)
            await session.refresh(branch)
            if branch.status == "stopped":
                break

            recent_ids_rows = (
                await session.execute(
                    select(Message.agent_id)
                    .where(Message.branch_id == branch_id, Message.role == "agent")
                    .order_by(Message.created_at.desc())
                    .limit(5)
                )
            ).all()
            recent_ids = [r[0] for r in reversed(recent_ids_rows) if r[0]]
            agent = pick_next_agent(agents, recent_ids, random.Random())

            msgs = (
                await session.execute(
                    select(Message).where(Message.branch_id == branch_id).order_by(Message.created_at)
                )
            ).scalars().all()
            graph = await get_graph(session, branch_id)
            ctx = build_context(topic, branch, list(msgs), project_context=project_ctx_text)
            # ctx[0] = topic/branch system; prepend persona system, keep conversation tail
            graph_line = "; ".join(n["label"] for n in graph["nodes"][-10:])
            ctx = [
                ctx[0],  # system: topic + fork context
                {"role": "system", "content": debate_system_prompt(agent, topic)},
                *ctx[1:],
                {
                    "role": "user",
                    "content": (
                        f"Stay on topic: {topic}\n"
                        + ("Idea-graph so far: " + graph_line + "\n" if graph_line else "")
                        + f"Continue the debate as {agent.name}. Respond in Korean, one focused move."
                    ),
                },
            ]

            await publish(branch_id, "agent_start", {"agent_id": agent.id, "agent_name": agent.name})
            provider = get_provider()
            chunks: list[str] = []
            try:
                async for tok in provider.stream(
                    ctx, model=model_for("debate"), persona=agent.tendency, turn_hint=branch.ai_turn_count + 1
                ):
                    chunks.append(tok)
                    await publish(branch_id, "token", {"agent_id": agent.id, "token": tok})
            except Exception as e:
                # Skip failed agent, keep debate alive
                await publish(branch_id, "error", {"message": f"{agent.name} 발언 실패, 건너뜁니다: {e}"})
                continue

            content = "".join(chunks).strip()
            # Strip echoed "[name] ..." / "name: ..." prefixes copied from context format
            for _ in range(3):
                stripped = False
                if content.startswith("["):
                    end = content.find("]")
                    if 0 < end <= 30 and len(content) > end + 1:
                        content = content[end + 1 :].strip()
                        stripped = True
                for pref in (f"{agent.name}:", f"{agent.name} :"):
                    if content.startswith(pref):
                        content = content[len(pref) :].strip()
                        stripped = True
                if not stripped:
                    break
            if not content:
                await publish(branch_id, "error", {"message": f"{agent.name} 빈 답변을 반환해 건너뜁니다"})
                continue

            branch.ai_turn_count += 1
            msg = Message(
                branch_id=branch_id,
                role="agent",
                agent_id=agent.id,
                agent_name=agent.name,
                content=content,
                turn=branch.ai_turn_count,
            )
            session.add(msg)
            await session.commit()
            await session.refresh(msg)
            await publish(
                branch_id,
                "agent_message",
                {
                    "id": msg.id,
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "content": content,
                    "turn": msg.turn,
                },
            )
            await publish(
                branch_id, "turn_complete", {"turn": branch.ai_turn_count, "max_turns": branch.max_turns}
            )

            # Moderator (silent; publishes only on trigger)
            try:
                all_texts = [m.content for m in list(msgs) + [msg] if m.role in ("agent", "user")]
                alert = await observe(topic, all_texts, project_context=project_ctx_text)
                if alert:
                    mod = Message(
                        branch_id=branch_id, role="moderator", agent_name="진행 도우미", content=alert["message"]
                    )
                    session.add(mod)
                    await session.commit()
                    await publish(branch_id, "moderator_alert", alert)
            except Exception:
                try:
                    await session.rollback()
                except Exception:
                    pass

            # Graph snapshot on cadence (user-configured interval, never hardcoded)
            try:
                if branch.graph_interval > 0 and branch.ai_turn_count % branch.graph_interval == 0:
                    await publish(branch_id, "graph_snapshot_start", {"turn": branch.ai_turn_count})
                    since = (
                        await session.execute(
                            select(Message)
                            .where(Message.branch_id == branch_id)
                            .order_by(Message.created_at.desc())
                            .limit(branch.graph_interval * 2 + 5)
                        )
                    ).scalars().all()
                    ordered = list(reversed(since))
                    new_payload = [
                        {
                            "id": m.id,
                            "role": m.role,
                            "agent_name": m.agent_name,
                            "content": m.content,
                        }
                        for m in ordered
                    ]
                    snap = await extract_snapshot(topic, new_payload, graph["nodes"])
                    # Attach real message ids: map LLM-less refs by appending recent agent msg ids
                    recent_agent_ids = [m.id for m in ordered if m.role == "agent"][-branch.graph_interval :]
                    for nd in snap.nodes:
                        if not nd.source_messages:
                            nd.source_messages = recent_agent_ids[-2:]
                    updated = await merge_snapshot(session, branch_id, snap)
                    await session.commit()
                    await publish(
                        branch_id,
                        "graph_update",
                        {"turn": branch.ai_turn_count, "graph": updated, "summary": snap.summary},
                    )
            except Exception as e:
                await session.rollback()
                await publish(branch_id, "error", {"message": f"지도 갱신 실패 (토론은 계속됩니다): {e}"})

            await asyncio.sleep(0)

        branch.status = "idle"
        await session.commit()
        await publish(branch_id, "done", {"turn": branch.ai_turn_count})
