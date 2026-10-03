import path from "node:path";
import { fileURLToPath } from "node:url";

const FULL_COMMIT_SHA = /^[a-f0-9]{40}$/i;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export function isCurrentMainImage({ ref, sourceSha, mainSha }) {
  return (
    ref === "refs/heads/main" &&
    FULL_COMMIT_SHA.test(sourceSha ?? "") &&
    FULL_COMMIT_SHA.test(mainSha ?? "") &&
    sourceSha.toLowerCase() === mainSha.toLowerCase()
  );
}

export async function getCurrentMainSha({ apiUrl, repository, token }) {
  if (!/^https?:\/\//i.test(apiUrl ?? "")) throw new Error("GITHUB_API_URL must be an HTTP URL");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("GITHUB_REPOSITORY must have owner/repository form");
  }
  if (!token) throw new Error("GITHUB_TOKEN is required to read the current main commit");

  const url = `${apiUrl.replace(/\/$/, "")}/repos/${repository}/commits/main`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status} for current main`);
  const commit = await response.json();
  if (!FULL_COMMIT_SHA.test(commit.sha ?? "")) {
    throw new Error("GitHub API did not return a full current-main commit SHA");
  }
  return commit.sha.toLowerCase();
}

async function main(argv) {
  const currentMainSha = await getCurrentMainSha({
    apiUrl: process.env.GITHUB_API_URL,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  if (argv.includes("--print-current")) {
    process.stdout.write(`${currentMainSha}\n`);
    return;
  }

  const isCurrent = isCurrentMainImage({
    ref: process.env.GITHUB_REF,
    sourceSha: process.env.GITHUB_SHA,
    mainSha: currentMainSha,
  });
  process.stdout.write(`main_sha=${currentMainSha}\nis_current=${isCurrent}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Could not verify the current main commit: ${error.message}\n`);
    process.exitCode = 1;
  });
}
