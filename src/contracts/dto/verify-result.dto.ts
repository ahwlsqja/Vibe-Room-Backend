export interface VerifyResultDto {
  verificationId: string;
  status: 'pending' | 'verified' | 'failed';
  match?: 'exact_match' | 'match' | null;
  explorerUrl?: string;
  error?: string;
}
