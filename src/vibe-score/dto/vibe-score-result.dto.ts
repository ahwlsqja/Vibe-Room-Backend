export interface VibeScoreResultDto {
  vibeScore: number;
  conflicts: number;
  reExecutions: number;
  gasEfficiency: number;
  engineBased: boolean;
  suggestions: string[];
  traceResults?: any[];
}
