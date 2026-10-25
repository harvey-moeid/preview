import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";
import assert from "node:assert/strict";
for (const name of readdirSync(".github/workflows")) {
  const text = readFileSync(`.github/workflows/${name}`, "utf8"),
    workflow = parse(text);
  assert(workflow.on && workflow.jobs, `${name}: invalid structure`);
  assert(
    !text.includes("pull_request_target") && !text.includes("workflow_run"),
    "Unsafe implicit privileged trigger",
  );
  for (const job of Object.values(workflow.jobs)) {
    assert(
      job["runs-on"] === "ubuntu-latest" && job["timeout-minutes"] <= 15,
      "Disposable bounded runner required",
    );
    for (const step of job.steps) {
      if (step.uses)
        assert(/@[a-f0-9]{40}$/.test(step.uses), "Pin every action SHA");
      if (step.uses?.startsWith("actions/checkout"))
        assert(step.with?.["persist-credentials"] === false);
      assert(
        !/\$\{\{\s*(?:inputs|github\.event)\./.test(step.run || ""),
        "No shell input interpolation",
      );
    }
  }
  if (name === "build-untrusted.yml") {
    assert(Object.keys(workflow.permissions).length === 0);
    assert(!/secrets\.|environment:|cache:|self-hosted/.test(text));
    assert(!/write/.test(JSON.stringify(workflow.jobs.build.permissions)));
  }
  if (name === "preview-validation.yml")
    assert(!/secrets\./.test(JSON.stringify(workflow.jobs.smoke)));
  console.log(`Validated ${name}`);
}
