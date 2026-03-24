export interface CommunityContract {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  vibeScore: number | null;
  publishedAt: string;
  author: string;
}

export interface CommunityContractsResult {
  contracts: CommunityContract[];
  total: number;
  page: number;
  limit: number;
}
