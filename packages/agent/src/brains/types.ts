export interface BrainRequest {
  systemPrompt: string;
  userPrompt: string;
  workspaceDir?: string;
}

export interface BrainResponse {
  text: string;
  brainUsed: string;
}

export interface Brain {
  run(req: BrainRequest): Promise<BrainResponse>;
}
