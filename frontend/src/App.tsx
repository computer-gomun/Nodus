import { useCallback, useEffect, useState } from "react";
import { api } from "./api/client";
import ChatPane from "./chat/ChatPane";
import NodePanel from "./components/NodePanel";
import ThemeToggle from "./components/ThemeToggle";
import GraphView from "./graph/GraphView";
import { useEventStream } from "./hooks/useEventStream";
import SettingsModal from "./settings/SettingsModal";
import type { BranchInfo, ChatMessage, Discussion, ModeratorAlert, Project } from "./types";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<(Project & { branches: BranchInfo[] }) | null>(null);
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [streaming, setStreaming] = useState<{ agentId: string; agentName?: string; text: string } | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [alert, setAlert] = useState<ModeratorAlert | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [composer, setComposer] = useState("");
  const [runTurns, setRunTurns] = useState(10);
  const [busy, setBusy] = useState(false);
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "graph">("chat");
  const [llmOk, setLlmOk] = useState<boolean | null>(null);

  const branchId = discussion?.id ?? null;
  const running = discussion?.is_running || thinking !== null || busy;

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      setError(`프로젝트 목록을 불러오지 못했습니다: ${e}`);
    }
  }, []);

  const openProject = useCallback(async (id: string, preferBranch?: string) => {
    try {
      const p = await api.getProject(id);
      setProject(p);
      const root = p.branches.find((b) => b.parent_branch_id === null) ?? p.branches[0];
      const target = preferBranch ?? root?.id;
      if (target) {
        const d = await api.getDiscussion(target);
        setDiscussion(d);
        setSelectedNode(null);
        setAlert(null);
        setStreaming(null);
      }
    } catch (e) {
      setError(`프로젝트를 열지 못했습니다: ${e}`);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
    api.health().then((h) => setLlmOk(h.llm_configured)).catch(() => setLlmOk(false));
  }, [refreshProjects]);

  // Poll while the Project Analyzer is running in the background
  useEffect(() => {
    if (project?.context_status !== "analyzing") return;
    const t = setInterval(async () => {
      if (!project) return;
      try {
        const p = await api.getProject(project.id);
        setProject(p);
        if (p.context_status !== "analyzing") clearInterval(t);
      } catch {
        /* ignore */
      }
    }, 6000);
    return () => clearInterval(t);
  }, [project?.id, project?.context_status]);

  useEventStream(branchId, {
    onToken: useCallback((agentId: string, token: string) => {
      setStreaming((s) => ({ agentId, agentName: s?.agentName, text: (s?.text ?? "") + token }));
    }, []),
    onEvent: useCallback(
      (event: string, data: unknown) => {
        const d = data as Record<string, unknown>;
        if (event === "agent_start") {
          setThinking((d.agent_name as string) ?? "AI");
          setStreaming({ agentId: (d.agent_id as string) ?? "", agentName: (d.agent_name as string) ?? "", text: "" });
        } else if (event === "agent_message") {
          const m = d as unknown as ChatMessage;
          setDiscussion((prev) => (prev ? { ...prev, messages: [...prev.messages, m] } : prev));
          setStreaming(null);
          setThinking(null);
        } else if (event === "user_message") {
          const m = d as unknown as ChatMessage;
          setDiscussion((prev) =>
            prev && !prev.messages.some((x) => x.id === m.id)
              ? { ...prev, messages: [...prev.messages, m] }
              : prev
          );
        } else if (event === "turn_complete") {
          setDiscussion((prev) =>
            prev ? { ...prev, ai_turn_count: (d.turn as number) ?? prev.ai_turn_count } : prev
          );
        } else if (event === "graph_update") {
          const g = d.graph as Discussion["graph"];
          if (g) setDiscussion((prev) => (prev ? { ...prev, graph: g } : prev));
        } else if (event === "moderator_alert") {
          setAlert(d as unknown as ModeratorAlert);
          const m: ChatMessage = {
            id: `mod-${Date.now()}`,
            role: "moderator",
            agent_name: "진행 도우미",
            content: (d.message as string) ?? "",
            created_at: new Date().toISOString(),
          };
          setDiscussion((prev) => (prev ? { ...prev, messages: [...prev.messages, m] } : prev));
        } else if (event === "done") {
          setThinking(null);
          setStreaming(null);
          setBusy(false);
          if (branchId) api.getDiscussion(branchId).then(setDiscussion).catch(() => {});
          if (project) api.getProject(project.id).then(setProject).catch(() => {});
        } else if (event === "error") {
          setError((d.message as string) ?? "오류가 발생했습니다.");
        } else if (event === "branch_created") {
          if (project) api.getProject(project.id).then(setProject).catch(() => {});
        }
      },
      [branchId, project]
    ),
  });

  const start = async () => {
    if (!discussion || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.startDiscussion(discussion.id, runTurns);
      setDiscussion((p) => (p ? { ...p, is_running: true } : p));
    } catch (e) {
      setError(`토론 시작 실패: ${e}`);
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!discussion) return;
    try {
      await api.stopDiscussion(discussion.id);
    } catch (e) {
      setError(`중지 실패: ${e}`);
    }
    setBusy(false);
    setThinking(null);
  };

  const send = async () => {
    if (!discussion || !composer.trim()) return;
    const text = composer.trim();
    setComposer("");
    try {
      const m = await api.sendMessage(discussion.id, text);
      setDiscussion((p) => (p ? { ...p, messages: [...p.messages, m] } : p));
    } catch (e) {
      setError(`메시지 전송 실패: ${e}`);
    }
  };

  const fork = async () => {
    if (!discussion || !selectedNode) return;
    const nodeLabel = discussion.graph.nodes.find((n) => n.id === selectedNode)?.label ?? "";
    setForking(true);
    try {
      const child = await api.forkBranch(discussion.id, selectedNode, nodeLabel ? nodeLabel.slice(0, 24) : undefined);
      if (project) {
        const p = await api.getProject(project.id);
        setProject(p);
      }
      setDiscussion(child);
      setSelectedNode(null);
      setAlert(null);
    } catch (e) {
      setError(`분기 생성 실패: ${e}`);
    } finally {
      setForking(false);
    }
  };

  const openBranch = async (branchId: string) => {
    try {
      const d = await api.getDiscussion(branchId);
      setDiscussion(d);
      setSelectedNode(null);
      setAlert(null);
      setStreaming(null);
    } catch (e) {
      setError(`토론을 열지 못했습니다: ${e}`);
    }
  };

  const createProject = async (s: { title: string; topic: string; agent_count: number; graph_interval: number; max_turns: number }) => {
    try {
      const p = await api.createProject(s);
      setShowNew(false);
      await refreshProjects();
      await openProject(p.id, p.root_branch_id);
    } catch (e) {
      setError(`프로젝트 생성 실패: ${e}`);
    }
  };

  const deleteProject = async (id: string) => {
    try {
      await api.deleteProject(id);
      await refreshProjects();
    } catch (e) {
      setError(`프로젝트 삭제 실패: ${e}`);
    }
  };

  if (!project || !discussion) {
    return (
      <div>
        <header className="topbar">
          <span className="brand">
            <img src="/nodus.svg" className="logo-img" alt="Nodus" />
            <span className="logo">NODUS</span>
          </span>
          <span className="sub">아이디어 브레인스토밍</span>
          <span className="spacer" />
          <button className="primary" onClick={() => setShowNew(true)}>+ 새 프로젝트</button>
          <ThemeToggle />
        </header>
        <main className="home">
          <div className="hero">
            <img src="/nodus.svg" className="hero-img" alt="Nodus" />
            <h1>NODUS</h1>
          </div>
          <p style={{ color: "var(--muted)" }}>
            "이거 만들려고 하는데 뭘 넣으면 좋을까?" — AI들이 자유롭게 아이디어를 내고 토론하면,
            생각이 지도로 정리되고 마음에 드는 아이디어에서 바로 새 토론을 갈라낼 수 있어요.
            {llmOk === false && " (키가 없어 오프라인 데모 모드로 동작합니다.)"}
          </p>
          {error && <div className="alert">{error}</div>}
          {projects.map((p) => (
            <div key={p.id} className="card" onClick={() => openProject(p.id)} style={{ position: "relative" }}>
              <b>{p.title}</b>
              <div className="topic">{p.topic}</div>
              <button
                style={{ position: "absolute", right: 10, top: 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`"${p.title}" 프로젝트를 삭제할까요?`)) deleteProject(p.id);
                }}
              >
                삭제
              </button>
            </div>
          ))}
          {projects.length === 0 && <div className="empty">아직 프로젝트가 없습니다. 새로 만들어 보세요.</div>}
        </main>
        {showNew && <SettingsModal onClose={() => setShowNew(false)} onCreate={createProject} />}
      </div>
    );
  }

  const sel = discussion.graph.nodes.find((n) => n.id === selectedNode) ?? null;
  const nextSnapshotIn =
    discussion.graph_interval > 0
      ? discussion.graph_interval - (discussion.ai_turn_count % discussion.graph_interval)
      : 0;
  const maxLabel = discussion.max_turns < 0 ? "∞" : String(discussion.max_turns);

  return (
    <div>
      <header className="topbar">
        <span className="brand" style={{ cursor: "pointer" }} onClick={() => { setProject(null); setDiscussion(null); refreshProjects(); }}>
          <img src="/nodus.svg" className="logo-img" alt="Nodus" />
          <span className="logo">NODUS</span>
        </span>
        <span className="sub">{project.title}</span>
        <div className="mobile-tabs">
          <button className={mobileTab === "chat" ? "primary" : ""} onClick={() => setMobileTab("chat")}>토론</button>
          <button className={mobileTab === "graph" ? "primary" : ""} onClick={() => setMobileTab("graph")}>아이디어 지도</button>
        </div>
        <span className="spacer" />
        {project.context_status === "analyzing" && <span className="sub">📁 프로젝트 폴더 분석 중…</span>}
        {project.context_status === "done" && <span className="sub">📁 프로젝트 코드 분석 완료 (모든 AI가 이 맥락으로 토론합니다)</span>}
        {project.context_status === "failed" && (
          <button onClick={async () => { try { await api.analyzeProject(project.id); } catch (e) { setError(`재분석 실패: ${e}`); } }}>
            코드 분석 다시 시도
          </button>
        )}
        <span className="sub">AI {discussion.agent_count}명 · {discussion.graph_interval}턴마다 지도 갱신 · 최대 {maxLabel}턴</span>
        <ThemeToggle />
      </header>

      <div className={`layout ${mobileTab === "chat" ? "chat-tab" : "graph-tab"}`}>
        <section className="pane chat-col">
          <div className="pane-head"><h2>토론 — {discussion.name}</h2></div>
          <div className="branches">
            {project.branches.map((b) => (
              <button
                key={b.id}
                className={`chip${b.id === discussion.id ? " active" : ""}`}
                onClick={() => openBranch(b.id)}
              >
                {b.parent_branch_id ? `⎇ ${b.name}` : `● ${b.name}`}
              </button>
            ))}
          </div>
          {alert && <div className="alert">진행 도우미: {alert.message}</div>}
          {error && <div className="alert">{error}</div>}
          <ChatPane messages={discussion.messages} streaming={streaming} thinkingAgent={thinking} />
          <div className="turnbar">
            발언 {discussion.ai_turn_count} / {maxLabel} · 다음 지도 갱신까지 {nextSnapshotIn}턴
            <div className="progress">
              <div
                style={{
                  width: discussion.graph_interval > 0
                    ? `${(100 * (discussion.graph_interval - nextSnapshotIn)) / discussion.graph_interval}%`
                    : "0%",
                }}
              />
            </div>
            <div className="controls" style={{ marginTop: 8 }}>
              <input
                type="number"
                min={1}
                max={100}
                value={runTurns}
                onChange={(e) => setRunTurns(Math.max(1, Math.min(100, Number(e.target.value) || 10)))}
                style={{ width: 70 }}
                title="진행할 턴 수"
              />
              {!running ? (
                <button className="primary" onClick={start}>
                  {discussion.messages.filter((m) => m.role === "agent").length === 0
                    ? "아이디어 토론 시작"
                    : `토론 계속 (${runTurns}턴)`}
                </button>
              ) : (
                <button onClick={stop}>중지</button>
              )}
            </div>
          </div>
          <div className="composer">
            <input
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="사용자 메시지 입력… (턴 수에 포함되지 않음)"
            />
            <button className="primary" onClick={send}>전송</button>
          </div>
        </section>

        <section className="pane graph-col">
          <div className="graph-main">
            <div className="pane-head">
              <h2>아이디어 지도 ({discussion.graph.nodes.length}개)</h2>
            </div>
            <div className="graph-wrap">
              <GraphView
                nodes={discussion.graph.nodes}
                edges={discussion.graph.edges}
                selectedId={selectedNode}
                onSelect={setSelectedNode}
              />
            </div>
          </div>
          {sel && (
            <NodePanel
              node={sel}
              nodes={discussion.graph.nodes}
              edges={discussion.graph.edges}
              messages={discussion.messages}
              branches={
                project?.branches.filter((b) => b.parent_branch_id === discussion.id && b.fork_source_node_id === sel.id) ?? []
              }
              onClose={() => setSelectedNode(null)}
              onFork={fork}
              onOpenBranch={openBranch}
              forking={forking}
            />
          )}
        </section>
      </div>
      {showNew && <SettingsModal onClose={() => setShowNew(false)} onCreate={createProject} />}
    </div>
  );
}
