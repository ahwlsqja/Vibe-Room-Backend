/** Analysis result returned by the analysis pipeline */
export interface AnalysisResult {
  analysis: {
    summary: string;
    fixedCode: string | null;
    explanation: string;
    isMonadSpecific: boolean;
    category?: string;
    parallelismScore?: number;
  } | null;
  optimization: {
    score: number;
    deductions: Array<{ reason: string; points: number }>;
    suggestions: string[];
  } | null;
}
