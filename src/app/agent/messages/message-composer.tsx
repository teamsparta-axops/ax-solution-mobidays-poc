"use client";

import { useState } from "react";
import {
  Check,
  CheckCircle,
  Copy,
  Loader2,
  Mail,
  PlayCircle,
  Save,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Account {
  cmid: string;
  canonicalName: string;
  industryLabel: string | null;
  contacts: { fullName: string; title: string | null; email: string | null }[];
}
interface Session {
  id: string;
  title: string;
  track: string | null;
}
interface Draft {
  subject: string;
  body: string;
  variables: Record<string, string>;
  evidence: { type: string; text: string }[];
  gmailHref?: string;
  contactEmail?: string;
}

const PURPOSE_OPTIONS = [
  { value: "Invitation", label: "초청 메일" },
  { value: "Proposal", label: "제안 메일" },
  { value: "Reminder", label: "리마인드" },
  { value: "FollowUp", label: "팔로업" },
  { value: "PostEvent", label: "행사 후" },
] as const;
type Purpose = (typeof PURPOSE_OPTIONS)[number]["value"];

export function MessageComposer({
  accounts,
  sessions,
  initialCmid,
  initialPurpose,
  initialSessionId,
}: {
  accounts: Account[];
  sessions: Session[];
  initialCmid?: string;
  initialPurpose?: string;
  initialSessionId?: string;
}) {
  const [cmid, setCmid] = useState(initialCmid ?? accounts[0]?.cmid ?? "");
  const [purpose, setPurpose] = useState<Purpose>(
    (PURPOSE_OPTIONS.find((p) => p.value === initialPurpose)?.value as Purpose) ?? "Invitation",
  );
  const [tone, setTone] = useState<"formal" | "friendly" | "concise">("formal");
  const [sessionId, setSessionId] = useState(initialSessionId ?? "");

  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edited, setEdited] = useState<{ subject: string; body: string } | null>(null);
  const [status, setStatus] = useState<"draft" | "pending" | "approved" | "sent">("draft");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const account = accounts.find((a) => a.cmid === cmid);

  const onGenerate = async () => {
    setLoading(true);
    setDraft(null);
    setEdited(null);
    setStatus("draft");
    setGenerateError(null);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cmid, purpose, tone, sessionId: sessionId || undefined }),
      });
      const json = await res.json();
      if (res.ok) {
        setDraft(json);
        setEdited({ subject: json.subject, body: json.body });
      } else {
        setGenerateError(json?.error ?? `오류가 발생했습니다 (${res.status})`);
      }
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const copyBody = async () => {
    if (!edited) return;
    await navigator.clipboard.writeText(`${edited.subject}\n\n${edited.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const saveDraft = async () => {
    if (!edited) return;
    setSaving(true);
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cmid,
          purpose,
          channel: "Email",
          subject: edited.subject,
          body: edited.body,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const gmailUrl = edited && account
    ? buildGmailComposeUrl({
        to: account.contacts[0]?.email ?? "",
        subject: edited.subject,
        body: edited.body,
      })
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-4 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>새 메시지 초안</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <Field label="대상 광고주">
              <select
                value={cmid}
                onChange={(e) => setCmid(e.target.value)}
                className="w-full h-9 px-3 border rounded-md border-[color:var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-brand-ink)]/15"
              >
                {accounts.map((a) => (
                  <option key={a.cmid} value={a.cmid}>
                    {a.canonicalName} {a.industryLabel ? `· ${a.industryLabel}` : ""}
                  </option>
                ))}
              </select>
              {account?.contacts[0] && (
                <div className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                  대표 컨택: {account.contacts[0].fullName} · {account.contacts[0].title ?? "—"}
                  {account.contacts[0].email && ` · ${maskEmail(account.contacts[0].email)}`}
                </div>
              )}
            </Field>

            <Field label="용도">
              <div className="grid grid-cols-3 gap-1.5">
                {PURPOSE_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPurpose(p.value)}
                    className={cn(
                      "h-9 rounded-md text-xs font-medium border border-[color:var(--color-border)] transition",
                      purpose === p.value
                        ? "bg-[color:var(--color-brand-ink)] text-white border-[color:var(--color-brand-ink)]"
                        : "hover:border-[color:var(--color-brand-ink)]",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="톤">
              <div className="grid grid-cols-3 gap-1.5">
                {["formal", "friendly", "concise"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTone(t as "formal")}
                    className={cn(
                      "h-9 rounded-md text-xs font-medium border border-[color:var(--color-border)] transition",
                      tone === t && "bg-[color:var(--color-brand-lime)] text-[color:var(--color-brand-ink)] border-[color:var(--color-brand-lime)]",
                    )}
                  >
                    {t === "formal" ? "정중" : t === "friendly" ? "친근" : "간결"}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="연결 세션 (선택)">
              <select
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="w-full h-9 px-3 border rounded-md border-[color:var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-brand-ink)]/15"
              >
                <option value="">— 선택 안 함 —</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} {s.track ? `· ${s.track}` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Button onClick={onGenerate} disabled={loading} className="w-full">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {loading ? "초안 생성 중…" : "AI로 초안 생성"}
            </Button>
            {generateError && (
              <div className="rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-xs text-[color:var(--color-danger)]">
                {generateError}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>승인 흐름</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-1.5 text-xs">
              {[
                { id: "draft", label: "초안 작성", desc: "Editor가 수정" },
                { id: "pending", label: "승인 요청", desc: "매니저에게 알림" },
                { id: "approved", label: "승인 완료", desc: "발송 가능" },
                { id: "sent", label: "발송 완료", desc: "Gmail Deep-link" },
              ].map((s) => {
                const active = status === s.id;
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "flex items-center gap-2 rounded px-2 py-1.5",
                      active && "bg-[color:var(--color-brand-lime-bg)]",
                    )}
                  >
                    <span
                      className={cn(
                        "size-5 rounded-full flex items-center justify-center text-[10px] font-semibold",
                        active
                          ? "bg-[color:var(--color-brand-ink)] text-white"
                          : "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
                      )}
                    >
                      {s.id === "sent" ? <Check className="size-3" /> : "·"}
                    </span>
                    <span className="font-medium">{s.label}</span>
                    <span className="text-[color:var(--color-muted-foreground)] ml-auto">{s.desc}</span>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
      </div>

      <div className="lg:col-span-8 space-y-4">
        {!draft && !loading && (
          <Card className="bg-[color:var(--color-brand-ink)] text-white">
            <CardBody className="flex items-center gap-4">
              <div className="size-10 rounded-md bg-[color:var(--color-brand-lime)] text-[color:var(--color-brand-ink)] flex items-center justify-center">
                <Mail className="size-5" />
              </div>
              <div>
                <div className="font-semibold tracking-tight">왼쪽에서 [AI로 초안 생성]</div>
                <div className="text-xs text-white/70 mt-0.5">
                  대상 광고주 · 용도 · 톤을 선택하면 초안이 자동 생성됩니다.
                </div>
              </div>
            </CardBody>
          </Card>
        )}
        {loading && (
          <Card>
            <CardBody className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin" />
              <div>
                <div className="font-medium text-sm">LLM 호출 중…</div>
                <div className="text-xs text-[color:var(--color-muted-foreground)]">
                  Mock 모드: 결정론적 응답을 약 0.9초 후 반환.
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {edited && draft && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>이메일 초안</span>
                  <Badge tone={status === "sent" ? "success" : status === "approved" ? "info" : "neutral"}>
                    {status === "draft" ? "초안" : status === "pending" ? "승인 대기" : status === "approved" ? "승인 완료" : "발송 완료"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] mb-1 font-medium">
                    제목
                  </div>
                  <input
                    value={edited.subject}
                    onChange={(e) => setEdited({ ...edited, subject: e.target.value })}
                    className="w-full h-9 px-3 border rounded-md border-[color:var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-brand-ink)]/15"
                  />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] mb-1 font-medium">
                    본문
                  </div>
                  <textarea
                    value={edited.body}
                    onChange={(e) => setEdited({ ...edited, body: e.target.value })}
                    rows={16}
                    className="w-full p-3 border rounded-md border-[color:var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-brand-ink)]/15 leading-relaxed"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[color:var(--color-border)]">
                  <Button variant="outline" onClick={copyBody}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "복사됨" : "복사"}
                  </Button>
                  {draft?.gmailHref ? (
                    <Button
                      variant="outline"
                      onClick={() => window.open(draft.gmailHref, "_blank")}
                    >
                      <Mail className="size-4" /> Gmail로 열기
                    </Button>
                  ) : (
                    <Button variant="outline" disabled title="담당자 이메일 정보 없음">
                      <Mail className="size-4" /> Gmail로 열기
                    </Button>
                  )}
                  <Button variant="outline" onClick={saveDraft} disabled={saving || saved}>
                    {saved ? <CheckCircle className="size-4" /> : <Save className="size-4" />}
                    {saved ? "저장됨 ✓" : saving ? "저장 중…" : "초안 저장"}
                  </Button>
                  {status === "draft" && (
                    <Button variant="secondary" onClick={() => setStatus("pending")}>
                      <PlayCircle className="size-4" /> 승인 요청
                    </Button>
                  )}
                  {status === "pending" && (
                    <Button variant="lime" onClick={() => setStatus("approved")}>
                      <Check className="size-4" /> 매니저 승인 (시연용 1-click)
                    </Button>
                  )}
                  {status === "approved" && gmailUrl && (
                    <a
                      href={gmailUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setStatus("sent")}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-[color:var(--color-brand-ink)] text-white text-sm font-medium hover:bg-[color:var(--color-brand-ink-2)]"
                    >
                      <Send className="size-4" /> Gmail에서 열기
                    </a>
                  )}
                  {status === "sent" && (
                    <Badge tone="success">발송 완료 → 활동 로그 기록됨</Badge>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-4" /> 변수 & 근거
                </CardTitle>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs mb-3">
                  {Object.entries(draft.variables).map(([k, v]) => (
                    <div
                      key={k}
                      className="rounded border border-[color:var(--color-border)] px-2 py-1.5"
                    >
                      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                        {k}
                      </div>
                      <div className="font-mono mt-0.5">{v || "—"}</div>
                    </div>
                  ))}
                </div>
                <div className="text-xs space-y-1">
                  {draft.evidence.map((e, i) => (
                    <div
                      key={i}
                      className="border-l-2 border-[color:var(--color-brand-lime)] pl-2 text-[color:var(--color-muted-foreground)] italic"
                    >
                      <Badge tone="neutral" className="mr-1.5">{e.type}</Badge>
                      &ldquo;{e.text}&rdquo;
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[color:var(--color-foreground)]/80 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function buildGmailComposeUrl({
  to,
  subject,
  body,
}: {
  to: string;
  subject: string;
  body: string;
}): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to,
    su: subject,
    body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

function maskEmail(s: string): string {
  const [local, domain] = s.split("@");
  if (!domain) return s;
  return `${local[0] ?? ""}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}
