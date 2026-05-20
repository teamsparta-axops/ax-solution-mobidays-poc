import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db";
import { ExtractDemo } from "./extract-demo";

export const dynamic = "force-dynamic";

const SAMPLE_MEETING = `# 네오플라잇 정기 미팅 — Skyborne 글로벌 출시
일시: 2026-03-12 14:00
장소: 강남 사옥 4F 회의실 B

참석(당사): 박민준(AE), 이지원(PM)
참석(광고주): 김재훈(UA 매니저), 이서영(과장)

## 논의 요약
- 글로벌 신작 'Skyborne' 1H 출시 캠페인 검토
- UA 비용 효율 개선 니즈 → CTV / 리테일미디어 관심 표명
- 기존 자사 솔루션 MoView는 만족스러우나, attribution 정확도 보강 요구
- 예산: 캠페인 1건당 5억 ± / 연간 50억 규모

## 액션
- (당사) CTV 매체 카탈로그 1주 내 공유
- (광고주) 내부 KPI 정렬 후 4월 첫 주 재미팅
- 다음 미팅: 2026-04-08 화상

## 기타
김재훈 매니저 휴대폰 010-1234-9921, 이메일 jh.kim@neoflight.demo
`;

export default async function ExtractPage() {
  const accounts = await prisma.account.findMany({
    select: { cmid: true, canonicalName: true },
    orderBy: { canonicalName: "asc" },
  });

  return (
    <AppShell>
      <PageHeader
        eyebrow="RFP 4-4 ② · 비정형 데이터 처리 설계"
        title="미팅록 추출 파이프라인 라이브 시연"
        description="원문 → 7단계 파이프라인 → 구조화 JSON + PII 마스킹 + 청크/임베딩 + 엔티티 링킹. 미팅록이 AI Agent의 검색 컨텍스트로 즉시 활용됩니다."
        breadcrumbs={[
          { href: "/", label: "홈" },
          { href: "/kb", label: "Knowledge Base" },
          { label: "비정형 처리" },
        ]}
      />
      <ExtractDemo sampleText={SAMPLE_MEETING} accounts={accounts} />
    </AppShell>
  );
}
