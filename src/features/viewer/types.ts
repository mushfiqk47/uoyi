import type { Clip, ViralDetails } from "../../lib/types";
import type { MomentVerdict } from "../../lib/ai/openai";

/** What the Viewer screen can ask one mounted stream card to do. */
export interface TileApi {
  clip(meta?: { note?: string; score?: number; title?: string; viral?: ViralDetails; groupId?: string; streams?: string[] }): Promise<Clip | null>;
  analyze(): Promise<{ verdict: MomentVerdict; transcript: string } | null>;
  ready(): boolean;
}
