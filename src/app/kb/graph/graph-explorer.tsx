"use client";

import { useState, useEffect } from "react";
import { Info, Link2, Network, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────
type Tier = "Gold" | "Silver" | "Bronze";
type EdgeType = "domain" | "normalized_name" | "embedding" | "contact_overlap";

interface GraphNode {
  id: string;
  label: string;
  source: string;
  tier: Tier;
  x: number;
  y: number;
  canonical?: boolean;
  cmid?: string;
  cluster?: number; // connected-component group id
  separated?: boolean; // red X badge
  separationReason?: string;
}

interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  label: string;
}


// ── Style helpers ──────────────────────────────────────────────────────────
const TIER_STYLES: Record<Tier, string> = {
  Gold: "bg-[color:var(--color-brand-lime)] text-[color:var(--color-brand-ink)] border border-[color:var(--color-brand-lime)]",
  Silver: "bg-[color:var(--color-info-bg)] text-[color:var(--color-info)] border border-[color:var(--color-info)]/30",
  Bronze: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)] border border-[color:var(--color-border)]",
};

const TIER_BADGE_TONE = { Gold: "lime", Silver: "info", Bronze: "neutral" } as const;

const EDGE_COLORS: Record<EdgeType, string> = {
  domain: "#3B82F6",
  normalized_name: "#C8F135",
  embedding: "#F97316",
  contact_overlap: "#A855F7",
};

const EDGE_LABELS: Record<EdgeType, string> = {
  domain: "도메인 일치",
  normalized_name: "정규화 이름",
  embedding: "임베딩 유사도",
  contact_overlap: "거래처 겹침",
};

const CLUSTER_COLORS: Record<number, string> = {
  1: "rgba(59,130,246,0.06)",
  2: "rgba(168,85,247,0.06)",
};

// ── Pipeline layer card ────────────────────────────────────────────────────
const PIPELINE_LAYERS = [
  {
    num: "1",
    title: "정규화",
    sub: "Bronze → Silver",
    desc: "법인격 제거, NFKC, KSIC 표준화",
    active: false,
  },
  {
    num: "2",
    title: "컨텍스트 그래프 ER",
    sub: "Silver → Gold",
    desc: "GraphFrames Connected Component",
    active: true,
  },
  {
    num: "3",
    title: "LLM 판정",
    sub: "0.8 ~ 0.92 구간",
    desc: "GPT-5.2 Structured Output",
    active: false,
  },
  {
    num: "4",
    title: "거버넌스",
    sub: "Unity Catalog",
    desc: "Lineage + CDC 전파",
    active: false,
  },
];

// ── Main component ─────────────────────────────────────────────────────────
export function GraphExplorer() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [separatedCount, setSeparatedCount] = useState(0);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((data: { nodes: GraphNode[]; edges: GraphEdge[]; stats?: { separatedCount?: number } }) => {
        if (data.nodes?.length) {
          setNodes(data.nodes);
          setEdges(data.edges ?? []);
          setSeparatedCount(data.stats?.separatedCount ?? 0);
        } else {
          setFetchFailed(true);
        }
      })
      .catch(() => {
        setFetchFailed(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const connectedEdges = selectedNode
    ? edges.filter((e) => e.from === selectedNode.id || e.to === selectedNode.id)
    : [];

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));

  // Compute cluster bboxes from live nodes (exclude separated nodes)
  const nonSeparatedNodes = nodes.filter((n) => !n.separated);
  const clusterIds = [...new Set(nonSeparatedNodes.map((n) => n.cluster).filter((c): c is number => c != null))];
  function clusterBBoxLive(clusterId: number) {
    const ns = nonSeparatedNodes.filter((n) => n.cluster === clusterId);
    if (ns.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
    const xs = ns.map((n) => n.x);
    const ys = ns.map((n) => n.y);
    const pad = 48;
    return {
      left: Math.min(...xs) - pad,
      top: Math.min(...ys) - pad,
      right: Math.max(...xs) + pad,
      bottom: Math.max(...ys) + pad,
    };
  }

  const bbox1 = clusterBBoxLive(1);
  const bbox2 = clusterBBoxLive(2);

  return (
    <div className="space-y-6">
      {/* Main graph card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">
              <Network className="size-4 text-[color:var(--color-muted-foreground)]" />
              Connected Component 시각화
            </CardTitle>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Legend – edge types */}
              {(Object.keys(EDGE_COLORS) as EdgeType[]).map((t) => (
                <span key={t} className="flex items-center gap-1.5 text-xs text-[color:var(--color-muted-foreground)]">
                  <span className="inline-block w-5 h-0.5 rounded-full" style={{ backgroundColor: EDGE_COLORS[t] }} />
                  {EDGE_LABELS[t]}
                </span>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <div className="flex gap-0 divide-x divide-[color:var(--color-border)]">
            {/* Graph canvas */}
            <div className="flex-1 min-w-0">
              {/* Tier legend */}
              <div className="flex items-center gap-3 px-5 pt-4 pb-2">
                {(["Gold", "Silver", "Bronze"] as Tier[]).map((t) => (
                  <span key={t} className="flex items-center gap-1.5 text-xs">
                    <span className={cn("inline-block w-2.5 h-2.5 rounded-sm", TIER_STYLES[t])} />
                    <span className="text-[color:var(--color-muted-foreground)]">{t}</span>
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-xs text-[color:var(--color-muted-foreground)]">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm border-2 border-[color:var(--color-brand-lime)]" />
                  Canon (정본)
                </span>
              </div>

              {/* Relative container: node divs + SVG overlay */}
              <div className="relative mx-5 mb-5 mt-2 overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/30" style={{ height: 560 }}>
                {loading ? (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
                    그래프 로드 중...
                  </div>
                ) : !loading && fetchFailed && nodes.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
                    데이터 없음
                  </div>
                ) : !loading && !fetchFailed && nodes.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-[color:var(--color-muted-foreground)] text-center px-8">
                    연결된 계정 데이터가 없습니다. /admin/seed 에서 데이터를 초기화하세요.
                  </div>
                ) : (
                  <>
                {/* Cluster background shapes */}
                {clusterIds.map((clusterId, idx) => {
                  const bb = clusterBBoxLive(clusterId);
                  const colors = ["rgba(59,130,246,0.06)", "rgba(168,85,247,0.06)", "rgba(34,197,94,0.06)"];
                  const borders = ["rgba(59,130,246,0.2)", "rgba(168,85,247,0.2)", "rgba(34,197,94,0.2)"];
                  return (
                    <div
                      key={clusterId}
                      className="absolute rounded-2xl"
                      style={{
                        left: bb.left,
                        top: bb.top,
                        width: bb.right - bb.left,
                        height: bb.bottom - bb.top,
                        background: colors[idx % colors.length],
                        border: `1px dashed ${borders[idx % borders.length]}`,
                      }}
                    />
                  );
                })}
                {/* Cluster labels (keep static labels for first two for backwards compat) */}
                <span
                  className="absolute text-[10px] font-semibold text-blue-400 uppercase tracking-wider select-none"
                  style={{ left: bbox1.left + 8, top: bbox1.top + 6 }}
                >
                  Component 1 · 삼성전자
                </span>
                <span
                  className="absolute text-[10px] font-semibold text-purple-400 uppercase tracking-wider select-none"
                  style={{ left: bbox2.left + 8, top: bbox2.top + 6 }}
                >
                  Component 2 · 네오플라이트
                </span>

                {/* SVG edge layer */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
                  <defs>
                    {(Object.keys(EDGE_COLORS) as EdgeType[]).map((t) => (
                      <marker
                        key={t}
                        id={`arrow-${t}`}
                        markerWidth="6"
                        markerHeight="6"
                        refX="5"
                        refY="3"
                        orient="auto"
                      >
                        <path d="M0,0 L0,6 L6,3 z" fill={EDGE_COLORS[t]} fillOpacity={0.7} />
                      </marker>
                    ))}
                  </defs>
                  {edges.map((edge, i) => {
                    const src = nodeMap[edge.from];
                    const dst = nodeMap[edge.to];
                    if (!src || !dst) return null;
                    const mx = (src.x + dst.x) / 2;
                    const my = (src.y + dst.y) / 2;
                    const color = EDGE_COLORS[edge.type];
                    const highlighted =
                      selectedNodeId === edge.from || selectedNodeId === edge.to;
                    return (
                      <g key={i}>
                        <line
                          x1={src.x}
                          y1={src.y}
                          x2={dst.x}
                          y2={dst.y}
                          stroke={color}
                          strokeWidth={highlighted ? 2.5 : 1.5}
                          strokeOpacity={highlighted ? 1 : 0.45}
                          markerEnd={`url(#arrow-${edge.type})`}
                        />
                        <text
                          x={mx}
                          y={my - 4}
                          textAnchor="middle"
                          fontSize={9}
                          fill={color}
                          fillOpacity={highlighted ? 0.9 : 0.55}
                        >
                          {edge.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* Node divs */}
                {nodes.map((node) => {
                  const isSelected = selectedNodeId === node.id;
                  return (
                    <div
                      key={node.id}
                      onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
                      className={cn(
                        "absolute cursor-pointer select-none transition-all duration-150",
                        "-translate-x-1/2 -translate-y-1/2",
                      )}
                      style={{ left: node.x, top: node.y, zIndex: 2 }}
                    >
                      <div
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-xs font-medium shadow-sm transition-all",
                          TIER_STYLES[node.tier],
                          node.canonical && "ring-2 ring-[color:var(--color-brand-lime)] ring-offset-1",
                          isSelected && "scale-110 shadow-md",
                          !isSelected && "hover:scale-105 hover:shadow",
                        )}
                      >
                        <div className="text-center leading-tight whitespace-nowrap">{node.label}</div>
                        <div className="text-center text-[9px] opacity-70 mt-0.5">{node.source}</div>
                        {node.canonical && (
                          <div className="text-center text-[9px] font-semibold mt-0.5">★ 정본</div>
                        )}
                      </div>
                      {node.separated && (
                        <div className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold shadow">
                          ✕
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Separated node labels */}
                {nodes.filter((n) => n.separated).map((n) => (
                  <div
                    key={`sep-label-${n.id}`}
                    className="absolute text-[9px] text-red-400 font-medium whitespace-nowrap"
                    style={{ left: n.x - 20, top: n.y + 22, zIndex: 3 }}
                  >
                    분리됨 (BRN 상이)
                  </div>
                ))}

                {/* Click hint */}
                {!selectedNodeId && (
                  <div className="absolute bottom-3 right-4 text-[10px] text-[color:var(--color-muted-foreground)] select-none">
                    노드 클릭 시 상세 표시
                  </div>
                )}
                  </>
                )}
              </div>
              {/* Stats row */}
              <div className="flex items-center gap-3 px-5 pb-3 pt-1 flex-wrap">
                <span className="text-[10px] text-[color:var(--color-muted-foreground)]">
                  정본 <strong className="text-[color:var(--color-foreground)]">{nodes.filter((n) => n.canonical).length}</strong>건
                </span>
                <span className="text-[10px] text-[color:var(--color-muted-foreground)]">
                  소스 노드 <strong className="text-[color:var(--color-foreground)]">{nodes.filter((n) => !n.canonical && !n.separated).length}</strong>건
                </span>
                {separatedCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 border border-red-300 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                    ✕ 분리됨 {separatedCount}건
                  </span>
                )}
              </div>
            </div>

            {/* Side panel */}
            <div className="w-64 shrink-0 flex flex-col">
              <div className="px-4 pt-4 pb-3 border-b border-[color:var(--color-border)]">
                <p className="text-xs font-semibold text-[color:var(--color-muted-foreground)] uppercase tracking-wide">
                  노드 상세
                </p>
              </div>
              <div className="flex-1 p-4">
                {selectedNode ? (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-snug">{selectedNode.label}</p>
                      <button
                        onClick={() => setSelectedNodeId(null)}
                        className="shrink-0 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1.5 text-xs text-[color:var(--color-muted-foreground)]">
                      <div className="flex items-center justify-between">
                        <span>소스</span>
                        <span className="font-medium text-[color:var(--color-foreground)]">{selectedNode.source}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Tier</span>
                        <Badge tone={TIER_BADGE_TONE[selectedNode.tier]}>{selectedNode.tier}</Badge>
                      </div>
                      {selectedNode.canonical && selectedNode.cmid && (
                        <div className="flex items-center justify-between">
                          <span>CMID</span>
                          <span className="font-mono font-medium text-[color:var(--color-brand-ink)] text-[10px]">{selectedNode.cmid}</span>
                        </div>
                      )}
                      {selectedNode.canonical && (
                        <div className="flex items-center justify-between">
                          <span>역할</span>
                          <Badge tone="lime">정본 (Canon)</Badge>
                        </div>
                      )}
                      {selectedNode.separated && (
                        <div className="mt-2 rounded-md bg-red-50 border border-red-200 p-2 text-[10px] text-red-600">
                          <strong>분리 이유:</strong> {selectedNode.separationReason}
                        </div>
                      )}
                    </div>

                    {connectedEdges.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-[color:var(--color-muted-foreground)] uppercase tracking-wide mb-1.5">
                          연결 엣지 ({connectedEdges.length})
                        </p>
                        <ul className="space-y-1.5">
                          {connectedEdges.map((edge, i) => {
                            const peer = nodeMap[edge.from === selectedNode.id ? edge.to : edge.from];
                            return (
                              <li
                                key={i}
                                className="flex items-start gap-2 text-[10px] text-[color:var(--color-muted-foreground)]"
                              >
                                <span
                                  className="mt-0.5 shrink-0 inline-block w-2 h-2 rounded-full"
                                  style={{ backgroundColor: EDGE_COLORS[edge.type] }}
                                />
                                <div className="min-w-0">
                                  <span className="font-medium text-[color:var(--color-foreground)]">{peer?.label}</span>
                                  <br />
                                  {edge.label}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {connectedEdges.length === 0 && !selectedNode.separated && (
                      <p className="text-xs text-[color:var(--color-muted-foreground)]">연결된 엣지 없음</p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                    <Link2 className="size-6 text-[color:var(--color-border)]" />
                    <p className="text-xs text-[color:var(--color-muted-foreground)]">
                      그래프에서 노드를 클릭하면 연결 정보가 표시됩니다.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Pipeline layers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-4 text-[color:var(--color-muted-foreground)]" />
            4-Layer 통합 ID 해소 파이프라인
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PIPELINE_LAYERS.map((layer) => (
              <div
                key={layer.num}
                className={cn(
                  "relative rounded-lg p-3 border transition-all",
                  layer.active
                    ? "border-[color:var(--color-brand-lime)] bg-[color:var(--color-brand-lime)]/10"
                    : "border-[color:var(--color-border)] bg-[color:var(--color-muted)]/40",
                )}
              >
                {layer.active && (
                  <span className="absolute top-2 right-2">
                    <Badge tone="lime" className="text-[9px] px-1.5 py-0">현재</Badge>
                  </span>
                )}
                <div
                  className={cn(
                    "text-lg font-bold mb-1",
                    layer.active ? "text-[color:var(--color-brand-ink)]" : "text-[color:var(--color-muted-foreground)]",
                  )}
                >
                  {layer.num}
                </div>
                <div className="text-xs font-semibold leading-snug">{layer.title}</div>
                <div className="text-[10px] text-[color:var(--color-muted-foreground)] mt-0.5">{layer.sub}</div>
                <div className="text-[10px] text-[color:var(--color-muted-foreground)] mt-1 leading-snug">{layer.desc}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Vercel PoC note */}
      <div className="flex items-start gap-3 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-info-bg)]/40 px-4 py-3">
        <Info className="size-4 shrink-0 text-[color:var(--color-info)] mt-0.5" />
        <p className="text-xs text-[color:var(--color-muted-foreground)] leading-relaxed">
          <strong className="text-[color:var(--color-foreground)]">Vercel PoC 주석:</strong>{" "}
          이 PoC에서는 GraphFrames 알고리즘을 Next.js 서버리스로 재현합니다. 실 운영에서는 Databricks GraphFrames로 수백만 건 규모로 확장됩니다.
        </p>
      </div>
    </div>
  );
}
