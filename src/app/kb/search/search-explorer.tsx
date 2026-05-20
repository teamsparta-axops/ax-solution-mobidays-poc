"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceType: string;
  ordinal: number;
  text: string;
  score: number;
  topics: string[];
  cmid: string | null;
  accountName: string | null;
  highlight: string;
}

interface SearchResponse {
  query: string;
  totalChunks: number;
  results: SearchResult[];
  method?: string;
}

const SAMPLE_QUERIES = ["예산 증가", "CTV 캠페인", "경쟁사 언급", "Q2 미팅", "UA 자동화"];

function sourceTypeTone(t: string): "lime" | "info" | "neutral" {
  if (t === "meeting_note") return "lime";
  if (t === "proposal") return "info";
  return "neutral";
}

function sourceTypeLabel(t: string): string {
  if (t === "meeting_note") return "미팅록";
  if (t === "proposal") return "제안서";
  if (t === "collateral") return "자료";
  return t;
}

function HighlightText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <mark key={i} className="bg-[color:var(--color-brand-lime)] text-[color:var(--color-brand-ink)] rounded px-0.5">{part.slice(2, -2)}</mark>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function ComparisonTable() {
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] overflow-hidden mb-6">
      <div className="px-5 py-3 border-b border-[color:var(--color-border)] font-semibold text-sm">BM25 vs pgvector 비교</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[color:var(--color-muted)]/50">
              <th className="text-left px-4 py-2 text-xs font-semibold text-[color:var(--color-muted-foreground)] uppercase tracking-wider">방식</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-[color:var(--color-brand-lime)] bg-[color:var(--color-brand-ink)] uppercase tracking-wider">이 PoC</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-[color:var(--color-muted-foreground)] uppercase tracking-wider">실 운영</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--color-border)]">
            {[
              ["검색 알고리즘", "OpenAI text-embedding-3-small cosine similarity", "pgvector cosine similarity"],
              ["임베딩", "text-embedding-3-small 1536d (lazy)", "voyage-multilingual-2 1024d"],
              ["검색 대상", "DocChunk 임베딩 벡터 (BM25 fallback)", "임베딩 벡터 인덱스"],
              ["확장성", "~수천 청크", "수백만 벡터"],
              ["레이턴시", "~200ms (첫 호출)", "~10ms (HNSW)"],
            ].map(([label, poc, prod]) => (
              <tr key={label} className="hover:bg-[color:var(--color-muted)]/30">
                <td className="px-4 py-2.5 font-medium text-[color:var(--color-foreground)]">{label}</td>
                <td className="px-4 py-2.5 text-[color:var(--color-muted-foreground)]">{poc}</td>
                <td className="px-4 py-2.5 text-[color:var(--color-muted-foreground)]">{prod}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SearchExplorer() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [totalChunks, setTotalChunks] = useState(0);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchMethod, setSearchMethod] = useState<string | null>(null);

  async function doSearch(q: string) {
    if (!q || q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      const data: SearchResponse = await res.json();
      setResults(data.results);
      setTotalChunks(data.totalChunks);
      setSearchMethod(data.method ?? null);
      setSearched(true);
    } catch {
      setError("검색 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const maxScore = results && results.length > 0 ? (results[0].score > 0 ? results[0].score : 1) : 1;

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-muted-foreground)] pointer-events-none">
            🔍
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(query)}
            placeholder="세일즈 시그널 검색..."
            className="w-full rounded-lg border border-[color:var(--color-border)] bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[color:var(--color-brand-ink)] focus:border-[color:var(--color-brand-ink)] transition"
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => doSearch(query)}
          disabled={loading}
          className="px-5"
        >
          검색
        </Button>
      </div>

      {/* Sample queries */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-[color:var(--color-muted-foreground)] self-center">샘플 쿼리:</span>
        {SAMPLE_QUERIES.map((sq) => (
          <button
            key={sq}
            onClick={() => { setQuery(sq); doSearch(sq); }}
            className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-1 text-xs hover:border-[color:var(--color-brand-ink)] hover:bg-[color:var(--color-muted)] transition"
          >
            {sq}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-3 text-[color:var(--color-muted-foreground)]">
          <span className="size-5 rounded-full border-2 border-[color:var(--color-brand-ink)] border-t-transparent animate-spin" />
          <span className="text-sm">임베딩 검색 중...</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-4 py-3 text-sm text-[color:var(--color-danger)]">
          {error}
        </div>
      )}

      {/* Pre-search: comparison table */}
      {!searched && !loading && <ComparisonTable />}

      {/* Results */}
      {!loading && searched && results !== null && (
        <>
          {results.length === 0 ? (
            <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-6 py-12 text-center text-[color:var(--color-muted-foreground)] text-sm">
              검색 결과 없음 — 다른 키워드로 시도해보세요.
            </div>
          ) : (
            <>
              <div className="text-sm text-[color:var(--color-muted-foreground)]">
                전체 <span className="font-semibold text-[color:var(--color-foreground)]">{totalChunks}</span>청크 중{" "}
                <span className="font-semibold text-[color:var(--color-foreground)]">{results.length}</span>건 매칭
              </div>
              <div className="space-y-3">
                {results.map((r) => (
                  <div
                    key={r.chunkId}
                    className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 hover:border-[color:var(--color-brand-ink)]/40 transition"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={sourceTypeTone(r.sourceType)}>{sourceTypeLabel(r.sourceType)}</Badge>
                        <span className="font-semibold text-sm text-[color:var(--color-foreground)]">{r.documentTitle}</span>
                        {r.cmid && r.accountName && (
                          <Link
                            href={`/accounts/${r.cmid}`}
                            className="text-xs text-[color:var(--color-brand-ink)] hover:underline"
                          >
                            {r.accountName}
                          </Link>
                        )}
                      </div>
                      <span className="shrink-0 text-[11px] text-[color:var(--color-muted-foreground)] font-mono">청크 #{r.ordinal}</span>
                    </div>

                    {/* Score bar */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-[11px] text-[color:var(--color-muted-foreground)] mb-1">
                        <span>{searchMethod === "bm25-fallback" ? "BM25 점수" : "유사도"}</span>
                        <span className="font-mono font-semibold text-[color:var(--color-foreground)]">{r.score.toFixed(4)}</span>
                      </div>
                      <div className="h-1 rounded-full bg-[color:var(--color-muted)]">
                        <div
                          className="h-1 rounded-full bg-[color:var(--color-brand-ink)] transition-all"
                          style={{ width: `${Math.min(100, maxScore > 0 ? (r.score / maxScore) * 100 : 0)}%` }}
                        />
                      </div>
                    </div>

                    {/* Topics */}
                    {r.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {r.topics.map((t) => (
                          <Badge key={t} tone="neutral">{t}</Badge>
                        ))}
                      </div>
                    )}

                    {/* Highlight */}
                    <p className="text-sm text-[color:var(--color-muted-foreground)] leading-relaxed line-clamp-3">
                      <HighlightText text={r.highlight ?? ""} />
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
