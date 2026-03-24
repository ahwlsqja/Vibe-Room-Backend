export interface DeploymentRecord {
  id: string;
  contractName: string;
  contractSource: string;
  address: string | null;
  txHash: string | null;
  status: string;
  createdAt: Date;
}

export interface UserDeploymentsResponse {
  deployments: DeploymentRecord[];
  total: number;
  page: number;
  limit: number;
}
