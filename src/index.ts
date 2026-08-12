import {
  createActionComposition,
  runComposedAction,
} from "@terella/action-framework";
import { BuildActionsWorkflow } from "./workflow.js";

const composition = createActionComposition({
  githubContext: { repo: { owner: "owner", repo: "repo" } },
  dependencies: {},
});

runComposedAction(composition, BuildActionsWorkflow).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
