export interface DecodedConflict {
  variableName: string;
  variableType: string;
  slot: string;
  functions: string[];
  conflictType: string;
  suggestion: string;
}

export interface ConflictMatrix {
  rows: string[]; // function names
  cols: string[]; // variable names
  cells: number[][]; // intensity values (conflict count)
}

export interface ConflictAnalysis {
  conflicts: DecodedConflict[];
  matrix: ConflictMatrix;
}

export interface VibeScoreResultDto {
  vibeScore: number;
  conflicts: number;
  reExecutions: number;
  gasEfficiency: number;
  engineBased: boolean;
  suggestions: string[];
  traceResults?: any[];
  conflictAnalysis?: ConflictAnalysis;
}
