import { CodingTask, CodingResult } from "@/types/agent";
import { applyFileChanges } from "@/lib/fs-ops";
import { optimizeResources } from "@/lib/resource-modes";

export class WorkerAgent {
  constructor() {}

  async execute(task: CodingTask): Promise<CodingResult> {
    // Enforce low-resource mode + find max-efficiency workarounds  
    optimizeResources("balanced-minimal");

    try {
      const result = await task.run();

      // Apply file edits if the task generated modifications  
      if (result?.fileChanges) {
        await applyFileChanges(result.fileChanges);
      }

      return {
        success: true,
        details: result?.details || "Task completed.",
      };
    } catch (err: any) {
      return {
        success: false,
        details: err?.message || "Worker execution error.",
      };
    }
  }
}

export const workerAgent = new WorkerAgent();
