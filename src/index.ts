import {
  createActionComposition,
  DefaultExecClient,
  runComposedAction,
} from "@terella/action-framework";
import { BuildActionsWorkflow } from "./workflow.js";

const composition = createActionComposition({
  githubContext: { repo: { owner: "owner", repo: "repo" } },
  dependencies: {
    createExecClient: () => new DefaultExecClient(),
  },
});

runComposedAction(composition, BuildActionsWorkflow).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
