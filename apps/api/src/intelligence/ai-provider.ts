export type AiGenerateRequest = {
  model: string;
  input: string;
  maxOutputTokens: number;
  operation: string;
};

export type AiGenerateResult = {
  text: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export interface LlmProvider {
  readonly name: string;
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
  generateStructured<T>(request: AiGenerateRequest): Promise<T>;
  embed(input: string, model: string): Promise<number[]>;
}
