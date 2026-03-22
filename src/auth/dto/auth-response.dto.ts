export interface AuthUserDto {
  id: string;
  githubId: string;
  username: string;
  avatarUrl: string | null;
  deployCount: number;
}

export interface AuthResponseDto {
  accessToken: string;
  user: AuthUserDto;
}
