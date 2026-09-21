export interface Project {
  id: string;
  title: string;
  topic: string;
  created_at: string;
  updated_at: string;
  root_branch_id?: string;
  project_path?: string | null;
  context_status?: string;
  context_summary?: string;
}

export interface BranchInfo {
  id: string;
  name: string;
  parent_branch_id: string | null;
  fork_node_id: string | null;
  fork_source_node_id: string | null;
  fork_turn: number;
  agent_count: number;
  graph_interval: number;
  max_turns: number;
  ai_turn_count: number;
  status: string;
  message_count?: number;
  node_count?: number;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: "agent" | "user" | "moderator";
  agent_id?: string | null;
  agent_name?: string | null;
  content: string;
  turn?: number | null;
  created_at: string;
}

export interface GraphNode {
  id: string;
  type: "idea" | "question" | "objection" | "problem" | "decision" | "conclusion";
  label: string;
  description: string;
  status: string;
  source_messages: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface Discussion {
  id: string;
  project_id: string;
  topic: string;
  title: string;
  name: string;
  parent_branch_id: string | null;
  fork_node_id: string | null;
  fork_turn: number;
  agent_count: number;
  graph_interval: number;
  max_turns: number;
  ai_turn_count: number;
  status: string;
  is_running: boolean;
  messages: ChatMessage[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export interface ModeratorAlert {
  type: string;
  message: string;
}

export const NODE_TYPE_LABEL: Record<string, string> = {
  idea: "아이디어",
  question: "질문",
  objection: "반론",
  problem: "문제",
  decision: "결정",
  conclusion: "정리",
};

export const EDGE_TYPE_LABEL: Record<string, string> = {
  supports: "지지",
  contradicts: "반대",
  refines: "다듬음",
  derives_from: "파생",
  related_to: "연관",
  duplicates: "중복",
};

export const NODE_STATUS_LABEL: Record<string, string> = {
  active: "진행 중",
  refined: "다려짐",
  merged: "합쳐짐",
  dropped: "보류",
};
