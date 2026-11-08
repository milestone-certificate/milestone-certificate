/** Exact attempt matching: another date's result must not settle this exam. */
export function svpResultDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value)?.[1];
  if (!day) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

export function svpResultSaveIssue(
  result: { result: "PASS" | "FAIL" | "PENDING"; examDate: string | null },
  examDate: string,
): string | null {
  if (result.result === "PENDING") return "SVP-তে রেজাল্ট এখনো অপেক্ষমান।";
  if (!result.examDate) return "SVP পরীক্ষার তারিখ দেয়নি। মূল রেজাল্ট যাচাই করুন।";
  if (result.examDate !== examDate)
    return "SVP-এর ফল অন্য পরীক্ষার তারিখের। এই পরীক্ষায় সেভ করা হয়নি।";
  return null;
}

export function matchingPendingSvpExams<
  T extends {
    candidate_id: string | null;
    occupation_id: string | null;
    exam_date: string;
    result: string;
  },
>(
  exams: T[],
  candidate: { id: string; occupation_id: string | null },
  occupations: { id: string; svp_key: string | null }[],
  key: string,
  day?: string | null,
): T[] {
  return exams.filter(
    (exam) =>
      exam.candidate_id === candidate.id &&
      exam.result === "PENDING" &&
      (!day || exam.exam_date === day) &&
      occupations.some(
        (o) => o.id === (exam.occupation_id ?? candidate.occupation_id) && o.svp_key === key,
      ),
  );
}
